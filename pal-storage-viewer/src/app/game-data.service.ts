import { Injectable } from '@angular/core';
import { ActiveSkillDetail, ActiveSkillRow, PassiveSkillRow, activeSkillFromRow } from '../backend/lookups';

interface SkillText { localized_name?: string; description?: string; }

/** Skill descriptions and card data for the Pal card, loaded once from the resource files. */
@Injectable({ providedIn: 'root' })
export class GameDataService {
  private readonly activeText = new Map<string, SkillText>();
  private readonly passiveText = new Map<string, SkillText>();
  private readonly activeDetails = new Map<string, ActiveSkillDetail>();
  private readonly passiveDetails = new Map<string, string>();
  private loading: Promise<void> | null = null;

  /** Resolves once the tables are in memory; safe to call repeatedly. */
  load(): Promise<void> {
    this.loading ??= (async () => {
      const [active, passive, details] = await Promise.all([
        this.fetchJson<Record<string, SkillText>>('resources/active_skills_lookup.json'),
        this.fetchJson<Record<string, SkillText>>('resources/passive_skills_lookup.json'),
        this.fetchJson<{ active?: Record<string, ActiveSkillRow>; passive?: Record<string, PassiveSkillRow> }>('resources/skill_details_lookup.json'),
      ]);
      for (const [key, value] of Object.entries(active ?? {})) this.activeText.set(key.replace(/^EPalWazaID::/, ''), value);
      for (const [key, value] of Object.entries(passive ?? {})) this.passiveText.set(key, value);
      for (const [key, row] of Object.entries(details?.active ?? {})) this.activeDetails.set(key, activeSkillFromRow(row));
      for (const [key, [, description]] of Object.entries(details?.passive ?? {})) this.passiveDetails.set(key, description);
    })().catch(() => undefined);
    return this.loading;
  }

  activeDetail(id: string): ActiveSkillDetail | null { return this.activeDetails.get(id) ?? null; }
  activeDescription(id: string): string { return this.activeText.get(id)?.description || this.activeDetails.get(id)?.description || ''; }
  passiveDescription(id: string): string { return this.passiveText.get(id)?.description || this.passiveDetails.get(id) || ''; }

  private async fetchJson<T>(path: string): Promise<T | null> {
    try {
      const response = await fetch(new URL(path, document.baseURI));
      return response.ok ? (await response.json()) as T : null;
    } catch {
      return null;
    }
  }
}
