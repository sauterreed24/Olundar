export const MOD_PACK_TYPE = 'olundar.modpack.v1';

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const CRC_TABLE = buildCrcTable();

export function createModPackArchive(files) {
  const entries = normalizeZipFiles(files).map((entry) => ({
    ...entry,
    nameBytes: encoder.encode(entry.name),
    dataBytes: encoder.encode(entry.text)
  }));
  const parts = [];
  const centralParts = [];
  let offset = 0;

  for (const entry of entries) {
    if (entry.nameBytes.length > 0xffff) throw new Error(`Mod pack file name is too long: ${entry.name}`);
    if (entry.dataBytes.length > 0xffffffff) throw new Error(`Mod pack file is too large: ${entry.name}`);
    const crc = crc32(entry.dataBytes);
    const localHeader = new Uint8Array(30 + entry.nameBytes.length);
    writeUint32(localHeader, 0, 0x04034b50);
    writeUint16(localHeader, 4, 20);
    writeUint16(localHeader, 6, 0);
    writeUint16(localHeader, 8, 0);
    writeUint16(localHeader, 10, 0);
    writeUint16(localHeader, 12, 0);
    writeUint32(localHeader, 14, crc);
    writeUint32(localHeader, 18, entry.dataBytes.length);
    writeUint32(localHeader, 22, entry.dataBytes.length);
    writeUint16(localHeader, 26, entry.nameBytes.length);
    writeUint16(localHeader, 28, 0);
    localHeader.set(entry.nameBytes, 30);

    const centralHeader = new Uint8Array(46 + entry.nameBytes.length);
    writeUint32(centralHeader, 0, 0x02014b50);
    writeUint16(centralHeader, 4, 20);
    writeUint16(centralHeader, 6, 20);
    writeUint16(centralHeader, 8, 0);
    writeUint16(centralHeader, 10, 0);
    writeUint16(centralHeader, 12, 0);
    writeUint16(centralHeader, 14, 0);
    writeUint32(centralHeader, 16, crc);
    writeUint32(centralHeader, 20, entry.dataBytes.length);
    writeUint32(centralHeader, 24, entry.dataBytes.length);
    writeUint16(centralHeader, 28, entry.nameBytes.length);
    writeUint16(centralHeader, 30, 0);
    writeUint16(centralHeader, 32, 0);
    writeUint16(centralHeader, 34, 0);
    writeUint16(centralHeader, 36, 0);
    writeUint32(centralHeader, 38, 0);
    writeUint32(centralHeader, 42, offset);
    centralHeader.set(entry.nameBytes, 46);

    parts.push(localHeader, entry.dataBytes);
    centralParts.push(centralHeader);
    offset += localHeader.length + entry.dataBytes.length;
  }

  const centralOffset = offset;
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  if (centralOffset > 0xffffffff || centralSize > 0xffffffff || entries.length > 0xffff) throw new Error('Mod pack ZIP is too large.');

  const eocd = new Uint8Array(22);
  writeUint32(eocd, 0, 0x06054b50);
  writeUint16(eocd, 4, 0);
  writeUint16(eocd, 6, 0);
  writeUint16(eocd, 8, entries.length);
  writeUint16(eocd, 10, entries.length);
  writeUint32(eocd, 12, centralSize);
  writeUint32(eocd, 16, centralOffset);
  writeUint16(eocd, 20, 0);

  return concatUint8Arrays([...parts, ...centralParts, eocd]);
}

export function createModPackBlob(files) {
  return new Blob([createModPackArchive(files)], { type: 'application/zip' });
}

export async function readModPackArchive(file) {
  return parseModPackArchive(new Uint8Array(await file.arrayBuffer()));
}

export function parseModPackArchive(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const eocdOffset = findEndOfCentralDirectory(bytes);
  if (eocdOffset < 0) throw new Error('Mod pack ZIP is missing its central directory.');
  const entryCount = readUint16(bytes, eocdOffset + 10);
  const centralSize = readUint32(bytes, eocdOffset + 12);
  const centralOffset = readUint32(bytes, eocdOffset + 16);
  if (centralOffset + centralSize > bytes.length) throw new Error('Mod pack ZIP central directory is truncated.');

  const files = {};
  let cursor = centralOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (readUint32(bytes, cursor) !== 0x02014b50) throw new Error('Mod pack ZIP has an invalid central directory entry.');
    const method = readUint16(bytes, cursor + 10);
    const expectedCrc = readUint32(bytes, cursor + 16);
    const compressedSize = readUint32(bytes, cursor + 20);
    const uncompressedSize = readUint32(bytes, cursor + 24);
    const nameLength = readUint16(bytes, cursor + 28);
    const extraLength = readUint16(bytes, cursor + 30);
    const commentLength = readUint16(bytes, cursor + 32);
    const localOffset = readUint32(bytes, cursor + 42);
    const name = decoder.decode(bytes.slice(cursor + 46, cursor + 46 + nameLength));
    validateZipFileName(name);
    if (method !== 0) throw new Error(`Mod pack file ${name} uses compressed ZIP data. Export it from Olundar first.`);
    if (compressedSize !== uncompressedSize) throw new Error(`Mod pack file ${name} has mismatched ZIP sizes.`);
    const data = readLocalFileData(bytes, localOffset, name, compressedSize);
    if (crc32(data) !== expectedCrc) throw new Error(`Mod pack file ${name} failed CRC validation.`);
    files[name] = decoder.decode(data);
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

function readLocalFileData(bytes, localOffset, expectedName, size) {
  if (readUint32(bytes, localOffset) !== 0x04034b50) throw new Error(`Mod pack file ${expectedName} has an invalid local header.`);
  const nameLength = readUint16(bytes, localOffset + 26);
  const extraLength = readUint16(bytes, localOffset + 28);
  const name = decoder.decode(bytes.slice(localOffset + 30, localOffset + 30 + nameLength));
  if (name !== expectedName) throw new Error(`Mod pack file ${expectedName} local header mismatch.`);
  const dataOffset = localOffset + 30 + nameLength + extraLength;
  const dataEnd = dataOffset + size;
  if (dataEnd > bytes.length) throw new Error(`Mod pack file ${expectedName} is truncated.`);
  return bytes.slice(dataOffset, dataEnd);
}

function normalizeZipFiles(files) {
  if (!files || typeof files !== 'object' || Array.isArray(files)) throw new Error('Mod pack files must be an object.');
  return Object.entries(files).map(([name, text]) => {
    validateZipFileName(name);
    return { name, text: String(text ?? '') };
  });
}

function validateZipFileName(name) {
  if (!name || typeof name !== 'string') throw new Error('Mod pack file names must be non-empty strings.');
  if (name.includes('\\') || name.startsWith('/') || name.includes('../') || name.includes('..\\')) throw new Error(`Unsafe mod pack file name: ${name}`);
}

function findEndOfCentralDirectory(bytes) {
  const min = Math.max(0, bytes.length - 0xffff - 22);
  for (let index = bytes.length - 22; index >= min; index -= 1) {
    if (readUint32(bytes, index) === 0x06054b50) return index;
  }
  return -1;
}

function buildCrcTable() {
  const table = new Uint32Array(256);
  for (let n = 0; n < table.length; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let index = 0; index < bytes.length; index += 1) crc = CRC_TABLE[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function concatUint8Arrays(parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function readUint16(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readUint32(bytes, offset) {
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
}

function writeUint16(bytes, offset, value) {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
}

function writeUint32(bytes, offset, value) {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
  bytes[offset + 2] = (value >>> 16) & 0xff;
  bytes[offset + 3] = (value >>> 24) & 0xff;
}
