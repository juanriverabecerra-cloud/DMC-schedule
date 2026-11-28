// A minimal reader for old-style Excel files (.xls: BIFF8 inside an OLE2 compound file), enough for
// the reports ACGME's Case Logs hand out, and for a New Innovations hours file someone re-saved in
// Excel (text and number cells on one sheet). Plain functions over a Uint8Array, no dependencies,
// so the same code runs in Node and in a browser.

const u16 = (b, o) => b[o] | (b[o + 1] << 8);
const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
const f64 = (b, o) => new DataView(b.buffer, b.byteOffset + o, 8).getFloat64(0, true);

const OLE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const END = 0xfffffffe, FREE = 0xffffffff;

// The "Workbook" stream out of the compound file.
function workbookStream(b) {
  if (!OLE.every((x, i) => b[i] === x)) throw new Error("Not an .xls file");
  const secSize = 1 << u16(b, 0x1e);
  const miniSize = 1 << u16(b, 0x20);
  const sector = (n) => 512 + n * secSize; // the header always takes 512 bytes
  // The FAT's own sectors: 109 listed in the header, the rest in a DIFAT chain.
  const fatSectors = [];
  for (let i = 0; i < 109; i++) { const s = u32(b, 0x4c + i * 4); if (s !== FREE) fatSectors.push(s); }
  for (let s = u32(b, 0x44), n = u32(b, 0x48); n-- > 0 && s !== END && s !== FREE;) {
    const at = sector(s), per = secSize / 4 - 1;
    for (let i = 0; i < per; i++) { const x = u32(b, at + i * 4); if (x !== FREE) fatSectors.push(x); }
    s = u32(b, at + per * 4);
  }
  const fat = [];
  for (const s of fatSectors) for (let i = 0; i < secSize / 4; i++) fat.push(u32(b, sector(s) + i * 4));
  const chain = (start, table) => {
    const out = [];
    for (let s = start, guard = 0; s !== END && s !== FREE && s < table.length && guard < 1e6; s = table[s], guard++) out.push(s);
    return out;
  };
  const read = (start, size) => {
    const out = new Uint8Array(size);
    let pos = 0;
    for (const s of chain(start, fat)) {
      const n = Math.min(secSize, size - pos);
      if (n <= 0) break;
      out.set(b.subarray(sector(s), sector(s) + n), pos);
      pos += n;
    }
    return out;
  };
  // The directory: find the root (which holds the mini stream) and the workbook.
  const dirStart = u32(b, 0x30);
  const dirSecs = chain(dirStart, fat);
  const entries = [];
  for (const s of dirSecs) {
    for (let i = 0; i < secSize / 128; i++) {
      const at = sector(s) + i * 128;
      const len = u16(b, at + 0x40);
      let name = "";
      for (let j = 0; j + 2 < len; j += 2) name += String.fromCharCode(u16(b, at + j));
      entries.push({ name, type: b[at + 0x42], start: u32(b, at + 0x74), size: u32(b, at + 0x78) });
    }
  }
  const root = entries.find((e) => e.type === 5);
  const book = entries.find((e) => e.type === 2 && /^(workbook|book)$/i.test(e.name));
  if (!book) throw new Error("No workbook in the file");
  if (book.size >= u32(b, 0x38)) return read(book.start, book.size);
  // Small streams live in the mini stream, in 64-byte pieces listed by the mini FAT.
  const miniFat = [];
  for (const s of chain(u32(b, 0x3c), fat)) for (let i = 0; i < secSize / 4; i++) miniFat.push(u32(b, sector(s) + i * 4));
  const mini = read(root.start, root.size);
  const out = new Uint8Array(book.size);
  let pos = 0;
  for (const s of chain(book.start, miniFat)) {
    const n = Math.min(miniSize, book.size - pos);
    if (n <= 0) break;
    out.set(mini.subarray(s * miniSize, s * miniSize + n), pos);
    pos += n;
  }
  return out;
}

// An RK number: a compressed integer or the top half of a double, maybe divided by 100.
function rkValue(rk) {
  let v;
  if (rk & 2) v = rk >> 2;
  else {
    const buf = new DataView(new ArrayBuffer(8));
    buf.setUint32(4, rk & 0xfffffffc, true);
    v = buf.getFloat64(0, true);
  }
  return rk & 1 ? v / 100 : v;
}

// The shared strings. A string can run on into CONTINUE records; when its characters do, the next
// piece starts with a fresh byte saying whether they're one or two bytes each.
function sharedStrings(chunks) {
  let ci = 0, pos = 0;
  const cur = () => chunks[ci];
  const need = () => { if (pos >= cur().length && ci + 1 < chunks.length) { ci++; pos = 0; } };
  const byte = () => { need(); return cur()[pos++]; };
  const word = () => byte() | (byte() << 8);
  const dword = () => (word() | (word() << 16)) >>> 0;
  const skip = (n) => { while (n > 0) { need(); const k = Math.min(n, cur().length - pos); pos += k; n -= k; } };
  skip(4); // total count
  const unique = dword();
  const out = [];
  for (let i = 0; i < unique && ci < chunks.length; i++) {
    const count = word();
    const flags = byte();
    let wide = flags & 1;
    const runs = flags & 8 ? word() : 0;
    const ext = flags & 4 ? dword() : 0;
    let s = "";
    for (let n = 0; n < count; n++) {
      if (pos >= cur().length && ci + 1 < chunks.length) { ci++; pos = 0; wide = cur()[pos++] & 1; }
      s += String.fromCharCode(wide ? word() : byte());
    }
    skip(runs * 4 + ext);
    out.push(s);
  }
  return out;
}

// Every cell of the first sheet, as rows of values (strings and numbers), top to bottom.
export function readXls(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const w = workbookStream(b);
  const records = [];
  for (let o = 0; o + 4 <= w.length;) {
    const type = u16(w, o), len = u16(w, o + 2);
    records.push({ type, data: w.subarray(o + 4, o + 4 + len) });
    o += 4 + len;
  }
  let sst = [];
  const cells = new Map();
  let sheets = 0;
  const put = (r, c, v) => { if (!cells.has(r)) cells.set(r, []); cells.get(r)[c] = v; };
  for (let i = 0; i < records.length; i++) {
    const { type, data: d } = records[i];
    if (type === 0x0809) { sheets++; continue; } // BOF: 1 is the workbook globals, 2 the first sheet
    if (sheets > 2) break;
    if (type === 0x00fc) {
      const chunks = [d];
      while (records[i + 1]?.type === 0x003c) chunks.push(records[++i].data);
      sst = sharedStrings(chunks);
    } else if (type === 0x00fd) put(u16(d, 0), u16(d, 2), sst[u32(d, 6)] ?? "");
    else if (type === 0x0203) put(u16(d, 0), u16(d, 2), f64(d, 6));
    else if (type === 0x027e) put(u16(d, 0), u16(d, 2), rkValue(u32(d, 6)));
    else if (type === 0x00bd) {
      const row = u16(d, 0), first = u16(d, 2), last = u16(d, d.length - 2);
      for (let c = first; c <= last; c++) put(row, c, rkValue(u32(d, 4 + (c - first) * 6 + 2)));
    } else if (type === 0x0204) {
      const n = u16(d, 6), wide = d[8] & 1;
      let s = "";
      for (let k = 0; k < n; k++) s += String.fromCharCode(wide ? u16(d, 9 + k * 2) : d[9 + k]);
      put(u16(d, 0), u16(d, 2), s);
    } else if (type === 0x0006 && !(d[12] === 0xff && d[13] === 0xff)) put(u16(d, 0), u16(d, 2), f64(d, 6));
  }
  return [...cells.keys()].sort((a, b2) => a - b2).map((r) => cells.get(r));
}
