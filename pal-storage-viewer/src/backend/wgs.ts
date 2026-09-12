/**
 * Read-only WGS mapping, adapted from Z1ni/XGP-save-extractor at
 * 3e1bf319a9760a476968239c563e76f1c741c467 (main.py).
 */

export interface SaveInput {
  file: File;
  /** Relative path inside a dropped/picked folder. Keeps separate worlds apart. */
  path: string;
}

/*! @license
MIT License

Copyright (c) 2021 Mark Mäkinen

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/
class Reader {
  private offset = 0;
  private readonly bytes: Uint8Array;
  constructor(buffer: ArrayBuffer) { this.bytes = new Uint8Array(buffer); }
  take(length: number): Uint8Array {
    if (length < 0 || length > this.bytes.length - this.offset) throw new Error('Truncated WGS metadata.');
    const value = this.bytes.subarray(this.offset, this.offset + length);
    this.offset += length;
    return value;
  }
  u32(): number {
    const bytes = this.take(4);
    return new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0, true);
  }
  text(units = this.u32()): string {
    return new TextDecoder('utf-16le', { fatal: true }).decode(this.take(units * 2)).replace(/\0+$/, '');
  }
  guid(): string {
    const bytes = this.take(16);
    // WGS uses Windows GUID byte order, not Unreal's four-word GUID layout.
    return [3, 2, 1, 0, 5, 4, 7, 6, 8, 9, 10, 11, 12, 13, 14, 15]
      .map(index => bytes[index].toString(16).padStart(2, '0')).join('');
  }
}

const normalized = (path: string) => path.replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();
const isBackup = (path: string) => path.split('/').some(part => part === 't' || /(?:^|[._-])backups?(?:$|[._-])/i.test(part));

/** Map current containers to logical save paths; settings and backup slots aren't inputs. */
function savePath(name: string): string | null {
  if (name === 'GlobalPalStorage') return 'GlobalPalStorage.sav';
  const match = /^([0-9a-f]{32})-(.+)$/i.exec(name);
  if (!match || /^Slot\d+-/i.test(match[2])) return null;
  const [, world, part] = match;
  if (/^Level-\d+$/i.test(part) && part !== 'Level-01') {
    throw new Error(`Unsupported Xbox world part: ${name}.`);
  }
  if (part === 'Level' || part === 'Level-01') return `${world}/Level.sav`;
  if (part === 'LevelMeta') return `${world}/LevelMeta.sav`;
  if (part === 'LocalData') return `${world}/LocalData.sav`;
  const player = /^Players-([0-9a-f]{32}(?:_dps)?)$/i.exec(part);
  return player ? `${world}/Players/${player[1]}.sav` : null;
}

/**
 * Read only the tiny index/container metadata. Files wrap the original blobs without
 * copying/decompressing them; the existing worker handles the actual save payloads.
 */
export async function resolveWgsFiles(inputs: SaveInput[]): Promise<SaveInput[]> {
  const indexes = inputs.filter(input => /(?:^|\/)containers\.index$/i.test(normalized(input.path)) && !isBackup(normalized(input.path)));
  if (!indexes.length) {
    if (inputs.some(input => /^container\.\d+$/i.test(input.file.name))) {
      throw new Error('The Xbox folder is missing containers.index. Drop the whole wgs folder, including its account folder.');
    }
    return inputs;
  }
  const files = new Map(inputs.map(input => [normalized(input.path), input.file]));
  const roots = indexes.map(input => normalized(input.path).replace(/containers\.index$/, ''));
  const result = inputs.filter(input => !roots.some(root => normalized(input.path).startsWith(root)));
  for (const index of indexes) {
    const root = index.path.replace(/\\/g, '/').replace(/containers\.index$/i, '');
    try {
      const reader = new Reader(await index.file.arrayBuffer());
      if (reader.u32() !== 14) throw new Error('Unsupported WGS index version.');
      const count = reader.u32();
      reader.text(); // console package display name (usually empty on PC)
      if (!/^PocketpairInc\.Palworld_/i.test(reader.text())) throw new Error('This WGS folder is not a Palworld save.');
      reader.take(12); // timestamp and unknown word
      reader.text();
      reader.take(8);
      const paths = new Set<string>();
      for (let i = 0; i < count; i++) {
        const name = reader.text();
        reader.text();
        reader.text();
        const version = reader.take(1)[0];
        reader.take(4);
        const folder = reader.guid();
        reader.take(24); // timestamp and unused fields
        const path = savePath(name);
        if (!path) continue;
        if (paths.has(path.toLowerCase())) throw new Error(`Multiple current containers for ${path}.`);
        paths.add(path.toLowerCase());
        const metadata = files.get(normalized(`${root}${folder}/container.${version}`));
        if (!metadata) throw new Error(`Missing container.${version} for ${path}. Let Xbox finish syncing, then drop the whole wgs folder again.`);
        const container = new Reader(await metadata.arrayBuffer());
        if (container.u32() !== 4) throw new Error('Unsupported WGS container version.');
        const blobs = container.u32();
        let payload: File | undefined;
        for (let j = 0; j < blobs; j++) {
          const blobName = container.text(64);
          const first = container.guid();
          const second = container.guid();
          if (blobName.toLowerCase() !== 'data') continue;
          const candidates = [...new Set([first, second])]
            .map(guid => files.get(normalized(`${root}${folder}/${guid}`))).filter((file): file is File => !!file);
          if (candidates.length !== 1 || payload) {
            throw new Error(`Missing or ambiguous data for ${path}. Let Xbox finish syncing, then drop the whole wgs folder again.`);
          }
          payload = candidates[0];
        }
        if (!payload) throw new Error(`No Data blob for ${path}.`);
        result.push({path: root + path, file: new File([payload], path.split('/').pop()!, {lastModified: payload.lastModified})});
      }
    } catch (error) {
      throw new Error(`${index.path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return result;
}
