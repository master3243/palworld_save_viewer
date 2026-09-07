import { unzlibSync } from 'fflate';

/** Palworld's Oodle (PlM1), zlib (PlZ1/2) and Xbox CNK0 save containers. */
export interface OodleDecoder {
  decompress(data: Uint8Array, rawSize: number): Uint8Array;
}

function signature(bytes: Uint8Array, at = 0): string {
  return String.fromCharCode(...bytes.subarray(at, at + 4));
}

function checkLength(actual: number, expected: number): void {
  if (actual !== expected) throw new Error('The save has an incorrect length; it may be incomplete.');
}

/** Xbox blobs can retain bytes after the zlib stream, which native DecompressionStream rejects. */
function inflate(bytes: Uint8Array, expected: number): Uint8Array {
  // The extra byte detects expansion beyond the header without allowing unbounded output.
  const decoded = unzlibSync(bytes, { out: new Uint8Array(expected + 1) });
  checkLength(decoded.length, expected);
  return decoded;
}

/** Return the GVAS bytes. PlZ length semantics follow cheahjs/palworld-save-tools/palsav.py. */
export function decodeSave(bytes: Uint8Array, oodle: OodleDecoder): Uint8Array {
  if (signature(bytes) === 'GVAS') return bytes;
  if (bytes.length < 12) throw new Error('The save header is truncated.');
  if (signature(bytes, 8).startsWith('CNK')) {
    const count = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(4, true);
    if (signature(bytes, 8) !== 'CNK0' || count !== 1) throw new Error('This Xbox CNK save variant is not supported.');
    bytes = bytes.subarray(12);
    if (bytes.length < 12) throw new Error('The Xbox save header is truncated.');
  }
  const format = signature(bytes, 8);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const rawLength = view.getUint32(0, true);
  const compressedLength = view.getUint32(4, true);
  const payload = bytes.subarray(12);
  let decoded: Uint8Array;
  if (format === 'PlM1') {
    checkLength(payload.length, compressedLength);
    decoded = new Uint8Array(oodle.decompress(payload, rawLength));
  } else if (format === 'PlZ1' || format === 'PlZ2') {
    if (format === 'PlZ1') {
      checkLength(payload.length, compressedLength);
      decoded = inflate(payload, rawLength);
    } else {
      // In double zlib saves the header describes the INNER compressed payload.
      decoded = inflate(inflate(payload, compressedLength), rawLength);
    }
  } else {
    throw new Error('This does not look like a Palworld PlM/PlZ/GVAS save file.');
  }
  checkLength(decoded.length, rawLength);
  if (signature(decoded) !== 'GVAS') throw new Error('The save decoded, but the result was not a GVAS payload.');
  return decoded;
}
