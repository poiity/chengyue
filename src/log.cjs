// Local error log. Secrets (session cookies, CSRF tokens) and the system user name are redacted
// before anything is written; account names, passwords and cookie values are never logged.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const LIMIT = 1024 * 1024;
const patterns = [
  [/(PHPSESSID[=:]\s*)[^;\s"']+/gi, '$1[已隐藏]'],
  [/((?:x-)?csrf[-_]?token["']?\s*[:=]\s*["']?)[^"'\s,;}]+/gi, '$1[已隐藏]'],
  [/("token"\s*:\s*")[^"]*/gi, '$1[已隐藏]'],
  [/((?:cookie|authorization)["']?\s*[:=]\s*["']?)[^"'\n]+/gi, '$1[已隐藏]'],
  [/([?&](?:token|tt|sessid)=)[^&\s]+/gi, '$1[已隐藏]']
];
function redact(value) {
  let text = String(value ?? '');
  for (const [pattern, replacement] of patterns) text = text.replace(pattern, replacement);
  const home = os.homedir();
  if (home) text = text.split(home).join(process.platform === 'win32' ? '%USERPROFILE%' : '~');
  // Windows (C:\Users\name) and macOS (/Users/name) profile folders of any user.
  return text.replace(/([A-Z]:\\Users\\)[^\\/\s]+/gi, '$1%USERNAME%').replace(/(\/Users\/)[^/\s]+/g, '$1%USERNAME%').slice(0, 4000);
}
class Logger {
  constructor(dir) { this.dir = dir; this.file = path.join(dir, 'pixiv-light.log'); this.recent = new Map(); }
  write(level, scope, error) {
    const message = error instanceof Error ? `${error.message}\n${error.stack?.split('\n').slice(1, 6).join('\n') || ''}` : error;
    const text = redact(message).trim();
    // Identical messages within a minute are written once, so a failing loop cannot flood the disk.
    const key = `${level}|${scope}|${text}`, now = Date.now();
    if (now - (this.recent.get(key) || 0) < 60000) return;
    this.recent.set(key, now); if (this.recent.size > 200) this.recent.delete(this.recent.keys().next().value);
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      if (fs.existsSync(this.file) && fs.statSync(this.file).size > LIMIT) fs.renameSync(this.file, this.file.replace(/\.log$/, '.old.log'));
      fs.appendFileSync(this.file, `${new Date().toISOString()} [${level}] ${scope}: ${text}\n`);
    } catch {}
  }
  info(scope, message) { this.write('INFO', scope, message); }
  warn(scope, error) { this.write('WARN', scope, error); }
  error(scope, error) { this.write('ERROR', scope, error); }
}
module.exports = { Logger, redact };
