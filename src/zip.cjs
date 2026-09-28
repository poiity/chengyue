// Minimal ZIP support for this app: store-only writing (images are already compressed) with ZIP64
// when an archive grows past 4 GB, and reading of Pixiv ugoira frame archives (stored or deflated).
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const zlib = require('node:zlib');

const MAX32 = 0xffffffff;
function dosTime(date) {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  };
}
async function fileCrc(file, signal) {
  let crc = 0;
  for await (const chunk of fs.createReadStream(file, { signal })) crc = zlib.crc32(chunk, crc);
  return crc >>> 0;
}
// entries: [{ path, name }] read from disk, or [{ data: Buffer, name }] held in memory.
async function writeZip(entries, target, signal) {
  signal?.throwIfAborted();
  const handle = await fsp.open(target, 'wx');
  let offset = 0;
  const write = async buffer => { await handle.write(buffer, 0, buffer.length, offset); offset += buffer.length; };
  const central = [], stamp = dosTime(new Date());
  try {
    for (const entry of entries) {
      signal?.throwIfAborted();
      const name = Buffer.from(entry.name, 'utf8');
      const size = entry.data ? entry.data.length : (await fsp.stat(entry.path)).size;
      const crc = entry.data ? zlib.crc32(entry.data) >>> 0 : await fileCrc(entry.path, signal);
      const big = size >= MAX32, start = offset;
      const extra = big ? Buffer.alloc(20) : Buffer.alloc(0);
      if (big) { extra.writeUInt16LE(1, 0); extra.writeUInt16LE(16, 2); extra.writeBigUInt64LE(BigInt(size), 4); extra.writeBigUInt64LE(BigInt(size), 12); }
      const local = Buffer.alloc(30);
      local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(big ? 45 : 20, 4); local.writeUInt16LE(0x0800, 6);
      local.writeUInt16LE(0, 8); local.writeUInt16LE(stamp.time, 10); local.writeUInt16LE(stamp.date, 12);
      local.writeUInt32LE(crc, 14); local.writeUInt32LE(big ? MAX32 : size, 18); local.writeUInt32LE(big ? MAX32 : size, 22);
      local.writeUInt16LE(name.length, 26); local.writeUInt16LE(extra.length, 28);
      await write(Buffer.concat([local, name, extra]));
      if (entry.data) await write(entry.data);
      else for await (const chunk of fs.createReadStream(entry.path, { signal })) await write(chunk);
      central.push({ name, crc, size, start });
    }
    const cdStart = offset;
    for (const { name, crc, size, start } of central) {
      const fields = [];
      if (size >= MAX32) fields.push(size, size);
      if (start >= MAX32) fields.push(start);
      const extra = Buffer.alloc(fields.length ? 4 + fields.length * 8 : 0);
      if (fields.length) { extra.writeUInt16LE(1, 0); extra.writeUInt16LE(fields.length * 8, 2); fields.forEach((v, i) => extra.writeBigUInt64LE(BigInt(v), 4 + i * 8)); }
      const header = Buffer.alloc(46);
      header.writeUInt32LE(0x02014b50, 0); header.writeUInt16LE(45, 4); header.writeUInt16LE(fields.length ? 45 : 20, 6);
      header.writeUInt16LE(0x0800, 8); header.writeUInt16LE(0, 10); header.writeUInt16LE(stamp.time, 12); header.writeUInt16LE(stamp.date, 14);
      header.writeUInt32LE(crc, 16); header.writeUInt32LE(Math.min(size, MAX32), 20); header.writeUInt32LE(Math.min(size, MAX32), 24);
      header.writeUInt16LE(name.length, 28); header.writeUInt16LE(extra.length, 30); header.writeUInt32LE(Math.min(start, MAX32), 42);
      await write(Buffer.concat([header, name, extra]));
    }
    const cdSize = offset - cdStart, count = central.length;
    if (count > 0xffff || cdStart >= MAX32 || cdSize >= MAX32) {
      const record = Buffer.alloc(56), locator = Buffer.alloc(20), recordStart = offset;
      record.writeUInt32LE(0x06064b50, 0); record.writeBigUInt64LE(44n, 4); record.writeUInt16LE(45, 12); record.writeUInt16LE(45, 14);
      record.writeBigUInt64LE(BigInt(count), 24); record.writeBigUInt64LE(BigInt(count), 32); record.writeBigUInt64LE(BigInt(cdSize), 40); record.writeBigUInt64LE(BigInt(cdStart), 48);
      locator.writeUInt32LE(0x07064b50, 0); locator.writeBigUInt64LE(BigInt(recordStart), 8); locator.writeUInt32LE(1, 16);
      await write(Buffer.concat([record, locator]));
    }
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Math.min(count, 0xffff), 8); end.writeUInt16LE(Math.min(count, 0xffff), 10);
    end.writeUInt32LE(Math.min(cdSize, MAX32), 12); end.writeUInt32LE(Math.min(cdStart, MAX32), 16);
    await write(end);
    await handle.close();
  } catch (e) {
    await handle.close().catch(() => {});
    await fsp.rm(target, { force: true });
    throw e;
  }
}
// Reads every entry of a small archive held in memory. Returns Map(name -> Buffer).
function readZip(buffer, { maxBytes = 512 * 1024 * 1024 } = {}) {
  const endAt = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (endAt < 0 || endAt + 22 > buffer.length) throw new Error('动图压缩包格式无效');
  const count = buffer.readUInt16LE(endAt + 10);
  let at = buffer.readUInt32LE(endAt + 16), total = 0;
  const files = new Map();
  for (let i = 0; i < count; i++) {
    if (at + 46 > buffer.length || buffer.readUInt32LE(at) !== 0x02014b50) throw new Error('动图压缩包目录损坏');
    const method = buffer.readUInt16LE(at + 10), csize = buffer.readUInt32LE(at + 20), usize = buffer.readUInt32LE(at + 24);
    const nameLength = buffer.readUInt16LE(at + 28), extraLength = buffer.readUInt16LE(at + 30), commentLength = buffer.readUInt16LE(at + 32);
    const local = buffer.readUInt32LE(at + 42);
    const name = buffer.toString('utf8', at + 46, at + 46 + nameLength);
    at += 46 + nameLength + extraLength + commentLength;
    if (local + 30 > buffer.length || buffer.readUInt32LE(local) !== 0x04034b50) throw new Error('动图压缩包数据损坏');
    const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
    if (start + csize > buffer.length) throw new Error('动图压缩包不完整');
    total += usize; if (total > maxBytes) throw new Error('动图文件过大');
    const raw = buffer.subarray(start, start + csize);
    if (method === 0) files.set(name, raw);
    else if (method === 8) files.set(name, zlib.inflateRawSync(raw, { maxOutputLength: usize || maxBytes }));
    else throw new Error('不支持的动图压缩方式');
  }
  return files;
}
module.exports = { writeZip, readZip };
