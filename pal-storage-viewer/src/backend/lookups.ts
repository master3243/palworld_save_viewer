/**
 * Game-data lookups (skill names, passive ranks, species names). Built once from the
 * resource files and shared by every parse.
 */

export interface LookupSources {
  activeSkillsJson: string;
  passiveSkillsJson: string;
  palNamesJson: string;
  /** resources/pal_traits_lookup.json: element icon indexes and base work ranks per species. */
  palTraitsJson: string;
  /** resources/skill_details_lookup.json: what the in-game skill cards show. */
  skillDetailsJson: string;
}

/** Per-species game data: element icon indexes (into ELEMENT_NAMES), base work ranks (WORK_KEYS order), and the stat inputs. */
export interface PalTraits {
  e: number[];
  w: number[];
  /** Stat scaling: HP, attack, defense. Alpha (BOSS_) variants carry their own. */
  s?: [number, number, number];
  /** Max full stomach (hunger bar length). */
  f?: number;
  /** Trust bonus rates: HP, attack, defense (meaning not yet verified). */
  t?: [number, number, number];
  /** Partner skill: name, text with {k} placeholders (or null), the values per level (1..5) that fill them, per-level suffix. */
  p?: [string, string | null, string[][] | null, string[] | null];
  /** Appetite: how much of the 10-segment food gauge the species eats. */
  a?: number;
  /** Skills learned by level: skill id -> level. */
  k?: Record<string, number>;
}

/** One active skill as the game's skill card shows it. */
export interface ActiveSkillDetail {
  name: string;
  /** Index into ELEMENT_NAMES, or -1. */
  element: number;
  power: number;
  cooldown: number;
  melee: boolean;
  /** Status effect buildups, e.g. [["Burn", 100]]. */
  effects: [string, number][];
  minRange: number;
  maxRange: number;
  description: string;
}

/** skill_details_lookup.json rows: name, element, power, cooldown, M/S, effects, min range, max range, description. */
export type ActiveSkillRow = [string, number, number, number, string, [string, number][], number, number, string];
/** skill_details_lookup.json rows: effects, description. */
export type PassiveSkillRow = [[string, number][], string];

export function activeSkillFromRow([name, element, power, cooldown, kind, effects, minRange, maxRange, description]: ActiveSkillRow): ActiveSkillDetail {
  return { name, element, power, cooldown, melee: kind === 'M', effects, minRange, maxRange, description };
}

/** Points needed for each trust rank, ascending by rank (negative ranks included). */
export type FriendshipRanks = [number, number][];

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
  /** Highest Pal level the current game allows. */
  maxLevel = 0;
  readonly friendshipRanks: FriendshipRanks = [];
  /** Total exp a Pal needs to reach level (index + 1). */
  expTotals: number[] = [];
  /** Active skill id (without the EPalWazaID:: prefix) -> skill card data. */
  readonly activeDetails = new Map<string, ActiveSkillDetail>();
  /** Passive skill id -> [effect type, value] pairs. */
  readonly passiveEffects = new Map<string, [string, number][]>();
  /** Lab research id -> stat it raises for every base worker (A/D), percent, work needed, display name. */
  readonly research = new Map<string, { kind: 'A' | 'D'; value: number; work: number; name: string }>();
  /** Food item id -> dish name and the stat percentages it grants while its effect lasts. */
  readonly foodBuffs = new Map<string, { name: string; effects: [string, number][] }>();

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
    if (sources.palNamesJson) {
      for (const [key, value] of Object.entries(JSON.parse(sources.palNamesJson) as Record<string, string>)) {
        this.palNames.set(key, value);
        this.palNames.set(key.toLowerCase(), value);
        this.palCanonical.set(key.toLowerCase(), key);
      }
    }
    if (sources.palTraitsJson) {
      const parsed = JSON.parse(sources.palTraitsJson) as {
        pals?: Record<string, PalTraits>; maxLevel?: number; friendship?: FriendshipRanks; exp?: number[];
        food?: Record<string, [string, [string, number][]]>;
        research?: Record<string, ['A' | 'D', number, number, string]>;
      };
      for (const [key, [name, effects]] of Object.entries(parsed.food ?? {})) this.foodBuffs.set(key, { name, effects });
      for (const [key, [kind, value, work, name]] of Object.entries(parsed.research ?? {})) this.research.set(key, { kind, value, work, name });
      for (const [key, value] of Object.entries(parsed.pals ?? {})) this.palTraits.set(key.toLowerCase(), value);
      this.maxLevel = parsed.maxLevel ?? 0;
      this.friendshipRanks.push(...(parsed.friendship ?? []));
      this.expTotals = parsed.exp ?? [];
    }
    if (sources.skillDetailsJson) {
      const parsed = JSON.parse(sources.skillDetailsJson) as {
        active?: Record<string, ActiveSkillRow>;
        passive?: Record<string, PassiveSkillRow>;
        ranks?: Record<string, number>;
      };
      for (const [key, rank] of Object.entries(parsed.ranks ?? {})) this.passiveRanks.set(key, rank);
      for (const [key, row] of Object.entries(parsed.active ?? {})) {
        this.activeDetails.set(key, activeSkillFromRow(row));
        if (!this.activeSkills.has(key)) this.activeSkills.set(key, row[0]);
      }
      for (const [key, [effects]] of Object.entries(parsed.passive ?? {})) this.passiveEffects.set(key, effects);
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
