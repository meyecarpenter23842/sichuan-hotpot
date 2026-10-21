// Offline QR Code Model 2, version 5-L (106 UTF-8 bytes max), byte mode.
// Fixed version suits menu.bepsi.click's short nonsecret public table locator.
// QR is encoded locally: no guest URL or table ID is sent to a QR service.
const SIZE = 37;
const DATA_CODEWORDS = 108;
const ECC_CODEWORDS = 26;
function mul(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}
function errorCorrection(data) {
  let generator = [1];
  let root = 1;
  for (let i = 0; i < ECC_CODEWORDS; i++) {
    const next = Array(generator.length + 1).fill(0);
    generator.forEach((value, j) => {
      next[j] ^= value;
      next[j + 1] ^= mul(value, root);
    });
    generator = next;
    root = mul(root, 2);
  }
  const result = Array(ECC_CODEWORDS).fill(0);
  for (const value of data) {
    const factor = value ^ result.shift();
    result.push(0);
    for (let i = 0; i < ECC_CODEWORDS; i++) result[i] ^= mul(generator[i + 1], factor);
  }
  return result;
}
export function tableQrMatrix(url) {
  const bytes = new TextEncoder().encode(url);
  if (!bytes.length || bytes.length > 106) throw new Error("QR_URL_TOO_LONG");
  const bits = [];
  function append(value, count) {
    for (let i = count - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  }
  append(0b0100, 4); // byte-mode
  append(bytes.length, 8); // versions 1..9
  for (const b of bytes) append(b, 8);
  for (let i = 0; i < 4 && bits.length < DATA_CODEWORDS * 8; i++) bits.push(0);
  while (bits.length % 8) bits.push(0);
  const data = [];
  for (let i = 0; i < bits.length; i += 8)
    data.push(parseInt(bits.slice(i, i + 8).join(""), 2));
  while (data.length < DATA_CODEWORDS) data.push(data.length % 2 === 0 ? 0xec : 0x11);
  const codewords = [...data, ...errorCorrection(data)];
  const grid = Array.from({ length: SIZE }, () => Array(SIZE).fill(false));
  const isFunction = Array.from({ length: SIZE }, () => Array(SIZE).fill(false));
  const set = (x, y, dark) => {
    if (x >= 0 && y >= 0 && x < SIZE && y < SIZE) {
      grid[y][x] = Boolean(dark);
      isFunction[y][x] = true;
    }
  };
  for (const [cx, cy] of [[3, 3], [SIZE - 4, 3], [3, SIZE - 4]]) {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const d = Math.max(Math.abs(dx), Math.abs(dy));
      set(cx + dx, cy + dy, d !== 2 && d !== 4);
    }
  }
  for (let i = 8; i < SIZE - 8; i++) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
    const d = Math.max(Math.abs(dx), Math.abs(dy));
    set(SIZE - 7 + dx, SIZE - 7 + dy, d === 2 || d === 0);
  }
  // QR format: ECC L (01), mask #0, BCH error correction.
  const formatData = 0b01000;
  let rem = formatData;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  const format = ((formatData << 10) | rem) ^ 0x5412;
  const getBit = i => ((format >>> i) & 1) !== 0;
  for (let i = 0; i <= 5; i++) set(8, i, getBit(i));
  set(8, 7, getBit(6)); set(8, 8, getBit(7)); set(7, 8, getBit(8));
  for (let i = 9; i < 15; i++) set(14 - i, 8, getBit(i));
  for (let i = 0; i < 8; i++) set(SIZE - 1 - i, 8, getBit(i));
  for (let i = 8; i < 15; i++) set(8, SIZE - 15 + i, getBit(i));
  set(8, SIZE - 8, true);
  let index = 0;
  for (let right = SIZE - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    const upward = ((right + 1) & 2) === 0;
    for (let vertical = 0; vertical < SIZE; vertical++) {
      const y = upward ? SIZE - 1 - vertical : vertical;
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        if (isFunction[y][x]) continue;
        let dark = index < codewords.length * 8
          && ((codewords[index >>> 3] >>> (7 - (index & 7))) & 1) !== 0;
        if ((x + y) % 2 === 0) dark = !dark;
        grid[y][x] = dark;
        index++;
      }
    }
  }
  if (index < codewords.length * 8) throw new Error("QR_CAPACITY_MISMATCH");
  return grid;
}
export function tableQrSvg(url) {
  const grid = tableQrMatrix(url);
  const dark = [];
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    if (grid[y][x]) dark.push(`M${x + 4} ${y + 4}h1v1h-1z`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="450" height="450" viewBox="0 0 45 45"><rect width="45" height="45" fill="white"/><path d="${dark.join("")}" fill="black"/></svg>`;
}
export function tableQrUrl(handle) {
  if (!/^[a-zA-Z0-9_-]{16,64}$/.test(handle)) throw new Error("INVALID_QR_HANDLE");
  return `https://menu.bepsi.click/?table=${encodeURIComponent(handle)}`;
}
