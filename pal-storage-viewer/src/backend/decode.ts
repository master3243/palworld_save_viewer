/**
 * Palworld save container: `PlM1` wraps an Oodle/Kraken-compressed GVAS payload.
 * The decompressor itself is injected (ooz WebAssembly in the browser).
 */
export interface OodleDecoder {
  decompress(data: Uint8Array, rawSize: number): Uint8Array;
}

const GVAS = [0x47, 0x56, 0x41, 0x53];
const PLM1 = [0x50, 0x6c, 0x4d, 0x31];

function startsWith(bytes: Uint8Array, signature: number[], at = 0): boolean {
  return signature.every((byte, index) => bytes[at + index] === byte);
}

function isCompressedSave(bytes: Uint8Array): boolean {
  return startsWith(bytes, PLM1, 8);
}

/** Return the GVAS bytes for a save file, decompressing when needed. */
export function decodeSave(bytes: Uint8Array, oodle: OodleDecoder): Uint8Array {
  if (startsWith(bytes, GVAS)) return bytes;
  if (!isCompressedSave(bytes)) {
    throw new Error('This does not look like a Palworld PlM1/GVAS save file.');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const uncompressedLength = view.getUint32(0, true);
  const compressedLength = view.getUint32(4, true);
  const decoded = new Uint8Array(oodle.decompress(bytes.subarray(12, 12 + compressedLength), uncompressedLength));
  if (!startsWith(decoded, GVAS)) {
    throw new Error('The save decoded, but the result was not a GVAS payload.');
  }
  return decoded;
}
