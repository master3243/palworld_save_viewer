import { Injectable } from '@angular/core';

interface Game8Entry { number: string; url: string; }
type Game8Lookup = Record<string, Game8Entry>;

@Injectable({ providedIn: 'root' })
export class Game8LookupService {
  private readonly lookupPromise = this.loadLookup();

  async urlFor(palName: string): Promise<string> {
    return (await this.lookupPromise)[palName]?.url || '';
  }

  private async loadLookup(): Promise<Game8Lookup> {
    try {
      const response = await fetch(new URL('resources/game8_lookup.json', document.baseURI));
      return response.ok ? await response.json() as Game8Lookup : {};
    } catch {
      return {};
    }
  }
}
