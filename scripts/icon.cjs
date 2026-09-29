// Renders the app icon (the sidebar brand mark) to build/icon.png and, on macOS, build/icon.icns.
// Run with Electron: pnpm run icon
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const out = path.resolve(__dirname, '..', 'build');
// 1024 canvas with the 824 px macOS icon grid; the small lower-left corner matches the brand mark.
const html = `<!doctype html><meta charset="utf-8"><style>
  html, body { margin: 0; width: 1024px; height: 1024px; background: transparent; overflow: hidden; }
  div { position: absolute; left: 100px; top: 92px; width: 824px; height: 824px; box-sizing: border-box; display: grid; place-items: center;
    border-radius: 200px 200px 200px 72px; background: linear-gradient(145deg, #57b6ff, #0c83ec);
    box-shadow: 0 18px 28px #0c3e7040, inset 0 3px 0 #ffffff40; color: #fff;
    font: 600 500px/1 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei UI', sans-serif; padding-bottom: 28px; }
</style><div>澄</div>`;
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1024, height: 1024, show: false, transparent: true, frame: false, useContentSize: true, webPreferences: { offscreen: true } });
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  await new Promise(resolve => setTimeout(resolve, 500));
  const image = (await win.webContents.capturePage()).resize({ width: 1024, height: 1024, quality: 'best' });
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'icon.png'), image.toPNG());
  if (process.platform === 'darwin') {
    const set = path.join(out, 'icon.iconset');
    fs.rmSync(set, { recursive: true, force: true }); fs.mkdirSync(set);
    for (const size of [16, 32, 128, 256, 512]) {
      fs.writeFileSync(path.join(set, `icon_${size}x${size}.png`), image.resize({ width: size, height: size, quality: 'best' }).toPNG());
      fs.writeFileSync(path.join(set, `icon_${size}x${size}@2x.png`), image.resize({ width: size * 2, height: size * 2, quality: 'best' }).toPNG());
    }
    execFileSync('iconutil', ['-c', 'icns', set, '-o', path.join(out, 'icon.icns')]);
    fs.rmSync(set, { recursive: true, force: true });
  }
  console.log(`icon written to ${out}`);
  app.exit(0);
}).catch(e => { console.error(e); app.exit(1); });
