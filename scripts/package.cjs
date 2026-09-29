// Builds the portable release from the Electron runtime, on the platform it runs on:
//   Windows: a portable folder and ZIP.     pnpm run pack
//   macOS:   澄阅.app in a DMG.             pnpm run pack [-- --arch arm64|x64]  (default: this Mac's architecture)
// The app has no runtime npm dependencies, so only src/, ui/ and the metadata are copied.
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const { version } = require(path.join(root, 'package.json'));
const tag = `v${version.replace(/\.0$/, '')}`;
const electronDir = path.dirname(require.resolve('electron/package.json', { paths: [root] }));
const appFiles = ['src', 'ui', 'package.json', 'README.md'];
const keepLocales = new Set(['en-US.pak', 'zh-CN.pak', 'zh-TW.pak', 'ja.pak']);
const run = (command, args) => execFileSync(command, args, { stdio: 'inherit' });
async function copyApp(appDir) {
  await fs.mkdir(appDir, { recursive: true });
  for (const entry of appFiles) await fs.cp(path.join(root, entry), path.join(appDir, entry), { recursive: true });
}

async function windows() {
  const out = path.resolve(root, '..', `PixivLight-${tag}-Windows-x64`);
  // Windows 10+ ships bsdtar, which writes UTF-8 ZIP archives.
  const zip = (dir, target, exclude = []) => run('tar', ['-a', '-c', '-f', target, ...exclude.flatMap(x => ['--exclude', x]), '-C', path.dirname(dir), path.basename(dir)]);
  await fs.rm(out, { recursive: true, force: true });
  await fs.cp(path.join(electronDir, 'dist'), out, { recursive: true, dereference: true, filter: p => path.basename(p) !== 'default_app.asar' && (path.basename(path.dirname(p)) !== 'locales' || keepLocales.has(path.basename(p))) });
  await fs.rename(path.join(out, 'electron.exe'), path.join(out, 'PixivLight.exe'));
  await copyApp(path.join(out, 'resources', 'app'));
  await fs.copyFile(path.join(root, 'README.md'), path.join(out, '使用说明.md'));
  zip(out, path.resolve(root, '..', `澄阅-${tag}-Windows-x64.zip`));
  zip(root, path.resolve(root, '..', `澄阅-${tag}-源码.zip`), ['node_modules', '.git']);
  return { executable: path.join(out, 'PixivLight.exe') };
}

// ---- macOS -------------------------------------------------------------------------------------
const MAC_NAME = '澄阅', MAC_EXEC = 'PixivLight', BUNDLE_ID = 'io.github.poiity.chengyue';
const keepLproj = new Set(['en.lproj', 'zh_CN.lproj', 'zh_TW.lproj', 'ja.lproj']);
const setString = (file, key, value) => run('plutil', ['-replace', key, '-string', value, file]);
// The installed runtime matches this Mac; another architecture is fetched (and cached) the same way Electron's installer does.
async function electronApp(arch, work) {
  if (arch === process.arch) return path.join(electronDir, 'dist', 'Electron.app');
  const { downloadArtifact } = require(require.resolve('@electron/get', { paths: [electronDir] }));
  const archive = await downloadArtifact({ version: require(path.join(electronDir, 'package.json')).version, artifactName: 'electron', platform: 'darwin', arch, checksums: require(path.join(electronDir, 'checksums.json')) });
  const target = path.join(work, `electron-${arch}`);
  run('ditto', ['-x', '-k', archive, target]);
  return path.join(target, 'Electron.app');
}
async function mac() {
  const archArg = process.argv.indexOf('--arch');
  const arch = archArg > 0 ? process.argv[archArg + 1] : process.arch;
  if (!['arm64', 'x64'].includes(arch)) throw new Error('--arch 只支持 arm64 或 x64');
  const label = `macOS-${arch === 'arm64' ? 'AppleSilicon' : 'Intel'}`;
  const out = path.resolve(root, '..', `PixivLight-${tag}-${label}`);
  const app = path.join(out, `${MAC_NAME}.app`), contents = path.join(app, 'Contents'), resources = path.join(contents, 'Resources');
  await fs.rm(out, { recursive: true, force: true });
  await fs.mkdir(out, { recursive: true });
  // ditto keeps the framework symlinks that a plain copy would flatten.
  run('ditto', [await electronApp(arch, out), app]);
  await fs.rm(path.join(out, `electron-${arch}`), { recursive: true, force: true });

  // The helpers must be named after CFBundleName ("澄阅 Helper (Renderer)"), which is how Electron finds them.
  const info = path.join(contents, 'Info.plist');
  await fs.rename(path.join(contents, 'MacOS', 'Electron'), path.join(contents, 'MacOS', MAC_EXEC));
  for (const [key, value] of [['CFBundleExecutable', MAC_EXEC], ['CFBundleName', MAC_NAME], ['CFBundleDisplayName', MAC_NAME], ['CFBundleIdentifier', BUNDLE_ID],
    ['CFBundleShortVersionString', version], ['CFBundleVersion', version], ['CFBundleIconFile', 'icon.icns'], ['CFBundleDevelopmentRegion', 'zh_CN'],
    ['LSApplicationCategoryType', 'public.app-category.entertainment'], ['NSHumanReadableCopyright', 'MIT License']]) setString(info, key, value);
  // The app is loaded from Resources/app, so the integrity record of the removed default_app.asar goes too.
  run('plutil', ['-remove', 'ElectronAsarIntegrity', info]);
  const frameworks = path.join(contents, 'Frameworks');
  for (const helper of (await fs.readdir(frameworks)).filter(name => name.startsWith('Electron Helper'))) {
    const name = helper.replace(/^Electron/, MAC_NAME).replace(/\.app$/, ''), old = helper.replace(/\.app$/, '');
    const dir = path.join(frameworks, `${name}.app`);
    await fs.rename(path.join(frameworks, helper), dir);
    await fs.rename(path.join(dir, 'Contents', 'MacOS', old), path.join(dir, 'Contents', 'MacOS', name));
    const helperInfo = path.join(dir, 'Contents', 'Info.plist');
    setString(helperInfo, 'CFBundleExecutable', name); setString(helperInfo, 'CFBundleName', name);
    setString(helperInfo, 'CFBundleIdentifier', `${BUNDLE_ID}.helper`);
  }

  // Resources: our icon and app, the four interface languages Chromium needs, nothing else.
  for (const entry of await fs.readdir(resources)) {
    if (entry === 'default_app.asar' || entry === 'electron.icns' || (entry.endsWith('.lproj') && !keepLproj.has(entry))) await fs.rm(path.join(resources, entry), { recursive: true, force: true });
  }
  await fs.copyFile(path.join(root, 'build', 'icon.icns'), path.join(resources, 'icon.icns'));
  await copyApp(path.join(resources, 'app'));

  // Ad-hoc signature: every file changed above invalidated the original one, and Apple silicon refuses unsigned code.
  // Readable by every account on the Mac, whatever the permissions of the source checkout.
  run('chmod', ['-R', 'u+rwX,go+rX,go-w', app]);
  run('xattr', ['-cr', app]);
  run('codesign', ['--force', '--deep', '--sign', '-', app]);
  run('codesign', ['--verify', '--deep', '--strict', app]);

  // DMG: the app, a shortcut to Applications for drag-to-install, and the manual.
  const stage = path.join(out, 'dmg');
  await fs.mkdir(stage);
  run('ditto', [app, path.join(stage, `${MAC_NAME}.app`)]);
  await fs.symlink('/Applications', path.join(stage, 'Applications'));
  await fs.copyFile(path.join(root, 'README.md'), path.join(stage, '使用说明.md'));
  await fs.chmod(path.join(stage, '使用说明.md'), 0o644);
  // ASCII name: GitHub drops non-ASCII characters from release asset names.
  const dmg = path.resolve(root, '..', `Chengyue-${tag}-${label}.dmg`);
  await fs.rm(dmg, { force: true });
  run('hdiutil', ['create', '-quiet', '-volname', MAC_NAME, '-srcfolder', stage, '-fs', 'HFS+', '-format', 'UDZO', '-ov', dmg]);
  await fs.rm(stage, { recursive: true, force: true });
  await fs.copyFile(path.join(root, 'README.md'), path.join(out, '使用说明.md'));
  return { app, dmg };
}

(async () => {
  const result = process.platform === 'darwin' ? await mac() : await windows();
  console.log(JSON.stringify(result, null, 2));
})().catch(e => { console.error(e); process.exitCode = 1; });
