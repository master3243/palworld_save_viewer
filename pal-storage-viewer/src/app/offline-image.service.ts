import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class OfflineImageService {
  private readonly cache = new Map<string, Promise<string>>();

  load(path: string): Promise<string> {
    if (!path) return Promise.resolve('');
    const resolvedPath = new URL(path, document.baseURI).toString();
    let request = this.cache.get(resolvedPath);
    if (!request) {
      request = fetch(resolvedPath)
        .then(async (response) => {
          if (!response.ok) throw new Error(`Could not load ${path} (${response.status})`);
          return this.toDataUrl(await response.text());
        })
        .catch(() => '');
      this.cache.set(resolvedPath, request);
    }
    return request;
  }

  private toDataUrl(encoded: string): string {
    const payload = encoded.replace(/\s+/g, '');
    return payload && /^[A-Za-z0-9+/]+={0,2}$/.test(payload)
      ? `data:image/png;base64,${payload}`
      : '';
  }
}
