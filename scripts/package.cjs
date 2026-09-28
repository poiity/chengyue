// Builds the portable Windows folder and ZIPs from the installed Electron runtime.
// The app has no runtime npm dependencies, so only src/, ui/ and the metadata are copied.
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const { version } = require(path.join(root, 'package.json'));
const tag = `v${version.replace(/\.0$/, '')}`;
const out = path.resolve(root, '..', `PixivLight-${tag}-Windows-x64`);
const appDir = path.join(out, 'resources', 'app');
const keepLocales = new Set(['en-US.pak', 'zh-CN.pak', 'zh-TW.pak', 'ja.pak']);
// Windows 10+ ships bsdtar, which writes UTF-8 ZIP archives.
const zip = (dir, target, exclude = []) => execFileSync('tar', ['-a', '-c', '-f', target, ...exclude.flatMap(x => ['--exclude', x]), '-C', path.dirname(dir), path.basename(dir)], { stdio: 'inherit' });
(async () => {
  await fs.rm(out, { recursive: true, force: true });
  await fs.cp(path.join(root, 'node_modules', 'electron', 'dist'), out, { recursive: true, dereference: true, filter: p => path.basename(p) !== 'default_app.asar' && (path.basename(path.dirname(p)) !== 'locales' || keepLocales.has(path.basename(p))) });
  await fs.rename(path.join(out, 'electron.exe'), path.join(out, 'PixivLight.exe'));
  await fs.mkdir(appDir, { recursive: true });
  for (const entry of ['src', 'ui', 'package.json', 'README.md']) await fs.cp(path.join(root, entry), path.join(appDir, entry), { recursive: true });
  await fs.copyFile(path.join(root, 'README.md'), path.join(out, '使用说明.md'));
  zip(out, path.resolve(root, '..', `澄阅-${tag}-Windows-x64.zip`));
  zip(root, path.resolve(root, '..', `澄阅-${tag}-源码.zip`), ['node_modules', '.git']);
  console.log(JSON.stringify({ executable: path.join(out, 'PixivLight.exe') }, null, 2));
})().catch(e => { console.error(e); process.exitCode = 1; });
