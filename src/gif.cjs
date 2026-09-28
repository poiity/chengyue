// Small animated-GIF encoder for ugoira export. One palette (median cut over sampled pixels of
// every frame) keeps colours stable between frames; frames are streamed, never held all at once.

const channel = (key, shift) => (key >> shift) & 31;
// 15-bit colour key from 8-bit BGRA pixel data.
const keyAt = (bgra, i) => ((bgra[i + 2] >> 3) << 10) | ((bgra[i + 1] >> 3) << 5) | (bgra[i] >> 3);

function buildPalette(histogram) {
  let boxes = [];
  const used = []; for (let k = 0; k < 32768; k++) if (histogram[k]) used.push(k);
  if (!used.length) used.push(0);
  const describe = keys => {
    let count = 0; const min = [31, 31, 31], max = [0, 0, 0];
    for (const k of keys) { count += histogram[k] || 1; for (let c = 0; c < 3; c++) { const v = channel(k, 10 - c * 5); if (v < min[c]) min[c] = v; if (v > max[c]) max[c] = v; } }
    const ranges = max.map((v, c) => v - min[c]), axis = ranges.indexOf(Math.max(...ranges));
    return { keys, count, axis, score: keys.length > 1 ? count * (ranges[axis] + 1) : -1 };
  };
  boxes.push(describe(used));
  while (boxes.length < 256) {
    let best = -1; boxes.forEach((b, i) => { if (b.score > 0 && (best < 0 || b.score > boxes[best].score)) best = i; });
    if (best < 0) break;
    const box = boxes[best], shift = 10 - box.axis * 5;
    const keys = [...box.keys].sort((a, b) => channel(a, shift) - channel(b, shift));
    let half = box.count / 2, acc = 0, cut = 1;
    for (let i = 0; i < keys.length - 1; i++) { acc += histogram[keys[i]] || 1; if (acc >= half) { cut = i + 1; break; } }
    boxes.splice(best, 1, describe(keys.slice(0, cut)), describe(keys.slice(cut)));
  }
  const palette = new Uint8Array(768), colours = [];
  boxes.forEach((box, i) => {
    let r = 0, g = 0, b = 0, n = 0;
    for (const k of box.keys) { const w = histogram[k] || 1; r += channel(k, 10) * w; g += channel(k, 5) * w; b += channel(k, 0) * w; n += w; }
    const rgb = [r / n, g / n, b / n].map(v => Math.min(255, Math.round(v * 8.225)));
    palette.set(rgb, i * 3); colours.push(rgb);
  });
  const map = new Int16Array(32768).fill(-1);
  const nearest = key => {
    const r = channel(key, 10) * 8.225, g = channel(key, 5) * 8.225, b = channel(key, 0) * 8.225;
    let best = 0, distance = Infinity;
    for (let i = 0; i < colours.length; i++) {
      const [pr, pg, pb] = colours[i], d = (pr - r) ** 2 + (pg - g) ** 2 + (pb - b) ** 2;
      if (d < distance) { distance = d; best = i; }
    }
    return (map[key] = best);
  };
  return { palette, index: key => (map[key] >= 0 ? map[key] : nearest(key)) };
}
// GIF LZW (variable code width up to 12 bits) packed into 255-byte sub-blocks.
function lzw(indices) {
  const minCode = 8, clear = 256, eoi = 257;
  // Worst case is ~1.5 bytes per pixel plus one length byte per 255-byte sub-block.
  let out = Buffer.allocUnsafe(Math.ceil(indices.length * 1.6) + 1024), length = 0, blockStart = 0, bits = 0, acc = 0;
  const push = b => { if (length === out.length) { const grown = Buffer.allocUnsafe(out.length * 2); out.copy(grown); out = grown; } out[length++] = b; };
  push(minCode); blockStart = length; push(0);
  const byte = b => { push(b); if (length - blockStart - 1 === 255) { out[blockStart] = 255; blockStart = length; push(0); } };
  let size = minCode + 1;
  const emit = code => { acc |= code << bits; bits += size; while (bits >= 8) { byte(acc & 255); acc >>>= 8; bits -= 8; } };
  const table = new Int16Array(4096 * 256), gen = new Uint16Array(4096 * 256);
  let generation = 1, next = eoi + 1;
  emit(clear);
  let current = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i], key = (current << 8) | k;
    if (gen[key] === generation) { current = table[key]; continue; }
    emit(current);
    if (next === 4096) {
      emit(clear); next = eoi + 1; size = minCode + 1;
      if (++generation === 65536) { gen.fill(0); generation = 1; }
    } else {
      if (next >= 1 << size) size++;
      table[key] = next++; gen[key] = generation;
    }
    current = k;
  }
  emit(current); emit(eoi);
  if (bits > 0) byte(acc & 255);
  const tail = length - blockStart - 1;
  if (tail) { out[blockStart] = tail; push(0); } else out[blockStart] = 0;
  return out.subarray(0, length);
}
function u16(v) { return [v & 255, (v >> 8) & 255]; }
// readFrame(i) -> { bgra, width, height, delay(ms) }; write(buffer) appends to the output.
async function encodeGif({ frameCount, readFrame, write, onProgress = () => {}, signal }) {
  if (!frameCount) throw new Error('动图没有可用的帧');
  const histogram = new Uint32Array(32768);
  let width = 0, height = 0;
  for (let f = 0; f < frameCount; f++) {
    signal?.throwIfAborted();
    const frame = await readFrame(f);
    if (!f) ({ width, height } = frame);
    if (frame.width !== width || frame.height !== height) throw new Error('动图帧尺寸不一致，无法合成 GIF');
    const step = Math.max(1, Math.floor((width * height) / 60000)) * 4;
    for (let i = 0; i < frame.bgra.length; i += step) histogram[keyAt(frame.bgra, i)]++;
    onProgress('analyse', f + 1, frameCount);
  }
  if (width > 65535 || height > 65535) throw new Error('动图尺寸过大');
  const { palette, index } = buildPalette(histogram);
  await write(Buffer.from([...Buffer.from('GIF89a'), ...u16(width), ...u16(height), 0xf7, 0, 0]));
  await write(Buffer.from(palette));
  await write(Buffer.from([0x21, 0xff, 11, ...Buffer.from('NETSCAPE2.0'), 3, 1, 0, 0, 0]));
  for (let f = 0; f < frameCount; f++) {
    signal?.throwIfAborted();
    const { bgra, delay } = await readFrame(f);
    const pixels = new Uint8Array(width * height);
    for (let p = 0, i = 0; p < pixels.length; p++, i += 4) pixels[p] = index(keyAt(bgra, i));
    const centis = Math.max(2, Math.min(65535, Math.round((Number(delay) || 100) / 10)));
    await write(Buffer.from([0x21, 0xf9, 4, 0x04, ...u16(centis), 0, 0, 0x2c, 0, 0, 0, 0, ...u16(width), ...u16(height), 0]));
    await write(lzw(pixels));
    onProgress('encode', f + 1, frameCount);
  }
  await write(Buffer.from([0x3b]));
}
module.exports = { encodeGif, lzw, buildPalette };
