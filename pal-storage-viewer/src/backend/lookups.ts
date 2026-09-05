/**
 * Game-data lookups (skill names, passive ranks, species names). Built once from the
 * resource files and shared by every parse.
 */

export interface LookupSources {
  activeSkillsJson: string;
  passiveSkillsJson: string;
  passiveRanksLua: string;
  palNamesLua: string;
  /** resources/pal_traits_lookup.json: element icon indexes and base work ranks per species. */
  palTraitsJson: string;
}

/** Element icon indexes (into ELEMENT_NAMES) and base work ranks (in WORK_KEYS order) of a species. */
export interface PalTraits {
  e: number[];
  w: number[];
}

/** In-game names of the nine elements, in icon order (T_Icon_element_s_00..08). */
export const ELEMENT_NAMES = ['Neutral', 'Fire', 'Water', 'Electric', 'Grass', 'Dark', 'Dragon', 'Ground', 'Ice'];

/** EPalWorkSuitability order minus OilExtraction, which the game dropped. Also the traits table order. */
export const WORK_KEYS = [
  'EmitFlame', 'Watering', 'Seeding', 'GenerateElectricity', 'Handcraft', 'Collection', 'Deforest',
  'Mining', 'ProductMedicine', 'Cool', 'Transport', 'MonsterFarm',
];

/** In-game names of the work suitabilities, in WORK_KEYS order. */
export const WORK_NAMES = [
  'Kindling', 'Watering', 'Planting', 'Generating Electricity', 'Handiwork', 'Gathering', 'Lumbering',
  'Mining', 'Medicine Production', 'Cooling', 'Transporting', 'Farming',
];

/** Row keys for the per-work columns, in WORK_KEYS order. */
export const WORK_COLUMN_KEYS = [
  'work_kindling', 'work_watering', 'work_planting', 'work_electricity', 'work_handiwork', 'work_gathering', 'work_lumbering',
  'work_mining', 'work_medicine', 'work_cooling', 'work_transporting', 'work_farming',
];

export class Lookups {
  readonly activeSkills = new Map<string, string>();
  readonly passiveSkills = new Map<string, string>();
  readonly passiveRanks = new Map<string, number>();
  readonly palNames = new Map<string, string>();
  /** lower-case species id -> spelling used by the game data (drives image file names). */
  readonly palCanonical = new Map<string, string>();
  /** lower-case species id -> elements and base work ranks. */
  readonly palTraits = new Map<string, PalTraits>();

  constructor(sources: Partial<LookupSources>) {
    if (sources.activeSkillsJson) {
      for (const [key, value] of Object.entries(JSON.parse(sources.activeSkillsJson) as Record<string, { localized_name?: string }>)) {
        this.activeSkills.set(key.replace(/^EPalWazaID::/, ''), value.localized_name ?? '');
      }
    }
    if (sources.passiveSkillsJson) {
      for (const [key, value] of Object.entries(JSON.parse(sources.passiveSkillsJson) as Record<string, { localized_name?: string }>)) {
        this.passiveSkills.set(key, value.localized_name ?? '');
      }
    }
    if (sources.passiveRanksLua) {
      for (const rawLine of sources.passiveRanksLua.split(/\r?\n/)) {
        const line = rawLine.trim().replace(/,+$/, '');
        if (!line.startsWith('[') || !line.includes('=')) continue;
        const [keyPart, valuePart] = line.split(/=(.*)/s);
        const key = keyPart.trim().replace(/^\[|\]$/g, '').replace(/^"|"$/g, '').toLowerCase();
        const rank = Number.parseInt(valuePart.trim(), 10);
        if (Number.isNaN(rank)) continue;
        this.passiveRanks.set(key, rank);
      }
    }
    if (sources.palNamesLua) {
      for (const rawLine of sources.palNamesLua.split(/\r?\n/)) {
        const line = rawLine.trim().replace(/,+$/, '');
        if (!line.includes('=') || !line.includes('"')) continue;
        const [keyPart, valuePart] = line.split(/=(.*)/s);
        const key = keyPart.trim();
        const value = valuePart.trim().replace(/^"|"$/g, '');
        if (key && value) {
          this.palNames.set(key, value);
          this.palNames.set(key.toLowerCase(), value);
        }
      }
    }
    if (sources.palTraitsJson) {
      const parsed = JSON.parse(sources.palTraitsJson) as { pals?: Record<string, PalTraits> };
      for (const [key, value] of Object.entries(parsed.pals ?? {})) this.palTraits.set(key.toLowerCase(), value);
    }
    for (const key of this.palNames.keys()) {
      const lower = key.toLowerCase();
      if (lower !== key || !this.palCanonical.has(lower)) {
        if (!this.palCanonical.has(lower)) this.palCanonical.set(lower, key);
      }
    }
  }

  static passiveColorFromRank(rank: number | null | undefined): string {
    if (rank === null || rank === undefined) return '';
    if (rank < 0) return 'negative';
    if (rank >= 4) return 'platinum';
    if (rank === 3) return 'gold';
    return 'regular';
  }

  palDisplayName(speciesId: string): [string, string] {
    let variant = '';
    let baseId = speciesId;
    if (baseId.startsWith('BOSS_')) {
      variant = 'Alpha';
      baseId = baseId.slice('BOSS_'.length);
    } else if (baseId.startsWith('PREDATOR_')) {
      variant = 'Predator';
      baseId = baseId.slice('PREDATOR_'.length);
    }
    let display = this.palNames.get(baseId)
      || this.palNames.get(baseId.toLowerCase())
      || this.palNames.get(speciesId)
      || this.palNames.get(speciesId.toLowerCase())
      || baseId;
    for (const suffix of [' (Boss)', ' (Predator)']) {
      if (display.endsWith(suffix)) display = display.slice(0, -suffix.length);
    }
    return [display, variant];
  }

  /** Elements and base work ranks of a species (boss and predator variants share the base species'). */
  traitsFor(speciesId: string): PalTraits | null {
    const lower = speciesId.toLowerCase();
    const base = this.canonicalSpeciesId(speciesId).toLowerCase();
    return this.palTraits.get(lower) ?? this.palTraits.get(base) ?? null;
  }

  canonicalSpeciesId(speciesId: string): string {
    let baseId = speciesId;
    for (const prefix of ['BOSS_', 'Boss_', 'PREDATOR_']) {
      if (baseId.startsWith(prefix)) {
        baseId = baseId.slice(prefix.length);
        break;
      }
    }
    return this.palCanonical.get(baseId.toLowerCase()) ?? baseId;
  }
}
