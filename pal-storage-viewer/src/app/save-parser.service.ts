import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';

export type PalStorageRow = Record<string, unknown>;

type OozModule = {
  decompress(data: Uint8Array, rawSize: number): Uint8Array;
};

type PyodideRuntime = {
  FS: {
    mkdirTree(path: string): void;
    writeFile(path: string, data: string | Uint8Array): void;
  };
  runPythonAsync<T = unknown>(code: string): Promise<T>;
};

declare global {
  interface Window {
    loadPyodide?: (config: { indexURL: string }) => Promise<PyodideRuntime>;
  }
}

@Injectable({ providedIn: 'root' })
export class SaveParserService {
  private readonly pyodideVersion = '0.26.4';
  private pyodidePromise?: Promise<PyodideRuntime>;
  private oozPromise?: Promise<OozModule>;

  constructor(private readonly http: HttpClient) {}

  async parse(file: File): Promise<PalStorageRow[]> {
    this.validateFileName(file.name);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const decoded = await this.decodeSave(bytes);
    const pyodide = await this.getPyodide();

    pyodide.FS.writeFile('/app/input.gvas', decoded);
    let jsonText: string;
    try {
      jsonText = await pyodide.runPythonAsync<string>(`
import importlib
import sys
sys.path.insert(0, '/app')
main = importlib.import_module('main')
main.extract_decoded_save_to_json('/app/input.gvas', '/app/resources', flattened=True)
`);
    } catch (error) {
      throw new Error(this.formatParseError(error));
    }

    const rows = JSON.parse(jsonText) as PalStorageRow[];
    if (!rows.length) {
      throw new Error(this.wrongSaveMessage());
    }
    return rows;
  }

  private async getPyodide(): Promise<PyodideRuntime> {
    this.pyodidePromise ??= this.loadPyodideRuntime().then(async (pyodide) => {
      pyodide.FS.mkdirTree('/app/resources');
      await Promise.all([
        this.writeTextFile(pyodide, '/app/main.py', 'python/main.py'),
        this.writeTextFile(pyodide, '/app/data_manager.py', 'python/data_manager.py'),
        this.writeTextFile(pyodide, '/app/resources/active_skills_lookup.json', 'resources/active_skills_lookup.json'),
        this.writeTextFile(pyodide, '/app/resources/passive_skills_lookup.json', 'resources/passive_skills_lookup.json'),
        this.writeTextFile(pyodide, '/app/resources/passive_ranks_lookup.lua', 'resources/passive_ranks_lookup.lua'),
        this.writeTextFile(pyodide, '/app/resources/pal_names_lookup.lua', 'resources/pal_names_lookup.lua')
      ]);
      return pyodide;
    });
    return this.pyodidePromise;
  }

  private async loadPyodideRuntime(): Promise<PyodideRuntime> {
    if (!window.loadPyodide) {
      await this.loadScript(`https://cdn.jsdelivr.net/pyodide/v${this.pyodideVersion}/full/pyodide.js`);
    }
    if (!window.loadPyodide) {
      throw new Error('Pyodide did not load. Check your browser network access and try again.');
    }
    return window.loadPyodide({
      indexURL: `https://cdn.jsdelivr.net/pyodide/v${this.pyodideVersion}/full/`
    });
  }

  private loadScript(src: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
      if (existing) {
        existing.addEventListener('load', () => resolve(), { once: true });
        existing.addEventListener('error', () => reject(new Error(`Could not load ${src}`)), { once: true });
        if (window.loadPyodide) resolve();
        return;
      }

      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error(`Could not load ${src}`));
      document.head.appendChild(script);
    });
  }

  private async writeTextFile(pyodide: PyodideRuntime, path: string, url: string): Promise<void> {
    pyodide.FS.writeFile(path, await this.loadText(url));
  }

  private async decodeSave(bytes: Uint8Array): Promise<Uint8Array> {
    if (this.startsWith(bytes, [0x47, 0x56, 0x41, 0x53])) {
      return bytes;
    }
    if (!this.startsWith(bytes.subarray(8, 12), [0x50, 0x6c, 0x4d, 0x31])) {
      throw new Error('This does not look like a Palworld PlM1/GVAS save file.');
    }

    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const uncompressedLength = view.getUint32(0, true);
    const compressedLength = view.getUint32(4, true);
    const compressed = bytes.subarray(12, 12 + compressedLength);
    const ooz = await this.getOoz();
    const decoded = new Uint8Array(ooz.decompress(compressed, uncompressedLength));
    if (!this.startsWith(decoded, [0x47, 0x56, 0x41, 0x53])) {
      throw new Error('The save decoded, but the result was not a GVAS payload.');
    }
    return decoded;
  }

  private getOoz(): Promise<OozModule> {
    const decoderUrl = new URL('resources/browser/ooz-index.js', document.baseURI).toString();
    this.oozPromise ??= import(/* @vite-ignore */ decoderUrl) as Promise<OozModule>;
    return this.oozPromise;
  }

  private loadText(url: string): Promise<string> {
    return firstValueFrom(this.http.get(url, { responseType: 'text' }));
  }

  private startsWith(bytes: Uint8Array, signature: number[]): boolean {
    return signature.every((byte, index) => bytes[index] === byte);
  }

  private validateFileName(fileName: string): void {
    const normalized = fileName.trim().toLowerCase();
    if (normalized === 'level.sav' || normalized.endsWith('/level.sav') || normalized.endsWith('\\level.sav')) {
      throw new Error(this.wrongSaveMessage());
    }
  }

  private formatParseError(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    if (
      message.includes('OverflowError') ||
      message.includes('extract_records') ||
      message.includes('PalIndividualCharacterSaveParameter')
    ) {
      return this.wrongSaveMessage();
    }
    return message.split('\n')[0] || 'Could not load this save file.';
  }

  private wrongSaveMessage(): string {
    return 'This looks like the wrong save file. Use the player dimensional storage save from the Players folder, usually a file ending in _dps.sav, not Level.sav.';
  }
}
