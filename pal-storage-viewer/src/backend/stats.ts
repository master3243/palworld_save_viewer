/**
 * Stats the game derives from a Pal's record and species data: max HP, attack, defense, work speed,
 * trust rank, exp to the next level, the partner skill and any food effect. The formulas were fitted
 * to in-game screenshots of stored Pals (29 of 30 numbers exact, one off by 2):
 *
 *   scaling' = species scaling + trust rate * trust rank            (trust adds to the species stat)
 *   HP  = floor(500 + 5L + scaling'.hp * 0.5 * L * (1 + 0.3 IV/100))
 *   ATK = floor(100 + scaling'.atk * 0.075 * L * (1 + 0.3 IV/100)), DEF the same from 50
 *   then x (1 + 0.05 stars) -> floor, x (1 + 0.03 soul rank) -> floor, x (1 + passives % + food % + research %) -> round
 *   work speed = floor((70 + 7 stars) * (1 + passives %))
 *   a food status effect multiplies on top while its timer runs.
 */
import { Lookups } from './lookups';

export interface StatInputs {
  species_id: string;
  level: number | null;
  exp: number | null;
  /** Save `Rank` byte: condensing stars + 1. */
  rank: number | null;
  ivs: { hp: number | null; attack: number | null; defense: number | null };
  soul_ranks: { hp: number | null; attack: number | null; defense: number | null; craft_speed: number | null };
  passive_skill_ids: string[];
  active_skill_ids: string[];
  mastered_skill_ids: string[];
  friendship_points: number | null;
  food_item: string | null;
  food_seconds_left: number | null;
}

export interface DerivedStats {
  max_hp: number | null;
  attack: number | null;
  defense: number | null;
  work_speed: number | null;
  /** After trust, condensing and souls, before passives and food: what the game shows left of the arrow. */
  max_hp_base: number | null;
  attack_base: number | null;
  defense_base: number | null;
  /** How much of the base value the trust rank contributes. */
  trust_hp: number | null;
  trust_attack: number | null;
  trust_defense: number | null;
  /** Summed passive skill percentages. */
  passive_hp_pct: number;
  passive_attack_pct: number;
  passive_defense_pct: number;
  passive_work_speed_pct: number;
  /** Active food status effect. */
  food_effect: string | null;
  food_attack_pct: number;
  food_defense_pct: number;
  food_work_speed_pct: number;
  food_seconds_left: number | null;
  hunger_max: number | null;
  trust_rank: number | null;
  /** Progress through the current trust rank, 0-100. */
  trust_progress: number | null;
  /** Points needed for the next trust rank (null at the top rank). */
  trust_next: number | null;
  exp_to_next: number | null;
  /** Progress through the current level, 0-100. */
  exp_progress: number | null;
  partner_skill: string | null;
  partner_skill_level: number | null;
  partner_skill_text: string | null;
  /** JSON per stat (hp/attack/defense): [flat, species part, IV part, species scaling, trust part] before condensing and souls, for the card's breakdown. */
  stat_parts: string | null;
  /** JSON `{t, v, x}`: the text template with `{k}` placeholders, the values per level and per-level suffixes, for the card's per-level view. */
  partner_skill_levels: string | null;
  /** Appetite on the game's 10-segment food gauge. */
  food_amount: number | null;
  /** Every skill the Pal can equip: the save's mastered list plus the species learnset up to its level. */
  known_skill_ids: string[];
  known_moves: string[];
}

const EMPTY: DerivedStats = {
  max_hp: null, attack: null, defense: null, work_speed: null,
  max_hp_base: null, attack_base: null, defense_base: null,
  trust_hp: null, trust_attack: null, trust_defense: null,
  passive_hp_pct: 0, passive_attack_pct: 0, passive_defense_pct: 0, passive_work_speed_pct: 0,
  food_effect: null, food_attack_pct: 0, food_defense_pct: 0, food_work_speed_pct: 0, food_seconds_left: null,
  hunger_max: null, trust_rank: null, trust_progress: null, trust_next: null,
  exp_to_next: null, exp_progress: null, partner_skill: null, partner_skill_level: null, partner_skill_text: null, partner_skill_levels: null, stat_parts: null,
  food_amount: null, known_skill_ids: [], known_moves: [],
};

/** Percent of each stat a set of passives adds (negatives included). */
export function passivePercents(ids: string[], lookups: Lookups): { hp: number; attack: number; defense: number; workSpeed: number } {
  const total = { hp: 0, attack: 0, defense: 0, workSpeed: 0 };
  for (const id of ids) {
    for (const [type, value] of lookups.passiveEffects.get(id) ?? []) {
      if (type === 'MaxHP') total.hp += value;
      else if (type === 'ShotAttack') total.attack += value;
      else if (type === 'Defense') total.defense += value;
      else if (type === 'CraftSpeed') total.workSpeed += value;
    }
  }
  return total;
}

/** Trust rank for a points total, with progress through it and the next threshold. */
export function trustRank(points: number, lookups: Lookups): { rank: number; progress: number; next: number | null } {
  const ranks = lookups.friendshipRanks;
  if (!ranks.length) return { rank: 0, progress: 0, next: null };
  if (points < 0) {
    // Negative ranks count down: -1 from -1 point, -2 from -1000, -3 from -10000.
    let rank = 0;
    for (const [value, required] of ranks) if (value < 0 && points <= required && value < rank) rank = value;
    return { rank, progress: 0, next: 0 };
  }
  let current: [number, number] = [0, 0];
  let next: [number, number] | null = null;
  for (const entry of ranks) {
    if (entry[0] < 0) continue;
    if (points >= entry[1]) current = entry;
    else if (next === null) next = entry;
  }
  if (next === null) return { rank: current[0], progress: 100, next: null };
  const span = next[1] - current[1];
  return { rank: current[0], progress: span > 0 ? Math.min(100, Math.max(0, (points - current[1]) / span * 100)) : 0, next: next[1] };
}

const roundHalfUp = (value: number) => Math.floor(value + 0.5);

/** Base value with the percentages summed and applied once, rounded like the game
 * (a base Bellanoir with Serenity +10% and research +8% reads 307 = 260 × 1.18, not 260 × 1.1 × 1.08). */
export function finalStat(base: number, percents: number[]): number {
  return roundHalfUp(base * (1 + percents.reduce((sum, pct) => sum + pct, 0) / 100));
}

/** Attack and defense percentages a guild's completed lab research gives its base workers, with the items that count. */
export function researchBonus(labs: Record<string, number>[], lookups: Lookups): { attack: number; defense: number; items: string[] } {
  // A world can hold several guilds' labs; the player's is the one with the most work done.
  const lab = [...labs].sort((a, b) => Object.values(b).reduce((x, y) => x + y, 0) - Object.values(a).reduce((x, y) => x + y, 0))[0] ?? {};
  const out = { attack: 0, defense: 0, items: [] as string[] };
  for (const [id, entry] of lookups.research) {
    if ((lab[id] ?? 0) < entry.work) continue;
    if (entry.kind === 'A') out.attack += entry.value; else out.defense += entry.value;
    out.items.push(entry.name);
  }
  return out;
}

/**
 * Condensing: the stars go round the species' suitabilities from the highest down (ties: the one
 * listed last in the game's order), one rank each, starting over once every suitability got one.
 * A single-suitability Pal therefore gets all four stars on it (4-star Omascul: Gathering 5 -> 9).
 */
export function condenseWorkBonus(baseRanks: number[], stars: number): number[] {
  const bonus = baseRanks.map(() => 0);
  const byLevel = baseRanks.map((rank, index) => ({ rank, index })).filter((entry) => entry.rank > 0).sort((a, b) => b.rank - a.rank || b.index - a.index);
  for (let star = 0; star < Math.max(0, Math.min(4, stars)) && byLevel.length; star++) bonus[byLevel[star % byLevel.length].index] += 1;
  return bonus;
}

export function deriveStats(input: StatInputs, lookups: Lookups): DerivedStats {
  const traits = lookups.traitsFor(input.species_id);
  const out: DerivedStats = { ...EMPTY };
  // A record without Level/Exp/FriendshipPoint is a fresh level 1 Pal in game; derive from those defaults
  // (the raw columns stay blank).
  const level = input.level ?? (traits ? 1 : null);
  const exp = input.exp ?? 0;
  const points = input.friendship_points ?? (traits ? 0 : null);
  const stars = Math.max(0, Math.min(4, (input.rank ?? 1) - 1));
  const passives = passivePercents(input.passive_skill_ids, lookups);
  out.passive_hp_pct = passives.hp;
  out.passive_attack_pct = passives.attack;
  out.passive_defense_pct = passives.defense;
  out.passive_work_speed_pct = passives.workSpeed;
  out.hunger_max = traits?.f ?? null;

  let trust = 0;
  if (points !== null) {
    const rank = trustRank(points, lookups);
    out.trust_rank = rank.rank;
    out.trust_progress = Math.round(rank.progress * 10) / 10;
    out.trust_next = rank.next;
    trust = Math.max(0, rank.rank);
  }

  const food = input.food_item && (input.food_seconds_left ?? 0) > 0 ? lookups.foodBuffs.get(input.food_item) : undefined;
  if (food) {
    out.food_effect = food.name;
    out.food_seconds_left = input.food_seconds_left;
    for (const [type, value] of food.effects) {
      if (type === 'Attack') out.food_attack_pct += value;
      else if (type === 'Defense') out.food_defense_pct += value;
      else if (type === 'WorkSpeed') out.food_work_speed_pct += value;
    }
  }

  if (traits?.s && level !== null && level > 0) {
    const [hpScale, attackScale, defenseScale] = traits.s;
    const [hpRate, attackRate, defenseRate] = traits.t ?? [0, 0, 0];
    const iv = (value: number | null) => 1 + 0.3 * (value ?? 0) / 100;
    const condense = 1 + 0.05 * stars;
    const souls = (rank: number | null) => 1 + 0.03 * (rank ?? 0);
    const raw = {
      hp: (scale: number) => Math.floor(500 + 5 * level + scale * 0.5 * level * iv(input.ivs.hp)),
      attack: (scale: number) => Math.floor(100 + scale * 0.075 * level * iv(input.ivs.attack)),
      defense: (scale: number) => Math.floor(50 + scale * 0.075 * level * iv(input.ivs.defense)),
    };
    const base = (value: number, soulRank: number | null) => Math.floor(Math.floor(value * condense) * souls(soulRank));
    const hpBase = base(raw.hp(hpScale + hpRate * trust), input.soul_ranks.hp);
    const attackBase = base(raw.attack(attackScale + attackRate * trust), input.soul_ranks.attack);
    const defenseBase = base(raw.defense(defenseScale + defenseRate * trust), input.soul_ranks.defense);
    out.max_hp_base = hpBase;
    out.attack_base = attackBase;
    out.defense_base = defenseBase;
    // Raw pieces of each stat: flat amount, species × level, what the IV adds, and what trust adds.
    const parts = (flat: number, scale: number, rate: number, factor: number, value: number | null, rawStat: (scale: number) => number) => {
      const species = Math.floor(scale * factor * level);
      const noTrust = rawStat(scale);
      return [flat, species, noTrust - flat - species, scale, rawStat(scale + rate * trust) - noTrust];
    };
    out.stat_parts = JSON.stringify({
      hp: parts(500 + 5 * level, hpScale, hpRate, 0.5, input.ivs.hp, raw.hp),
      attack: parts(100, attackScale, attackRate, 0.075, input.ivs.attack, raw.attack),
      defense: parts(50, defenseScale, defenseRate, 0.075, input.ivs.defense, raw.defense),
    });
    out.trust_hp = hpBase - base(raw.hp(hpScale), input.soul_ranks.hp);
    out.trust_attack = attackBase - base(raw.attack(attackScale), input.soul_ranks.attack);
    out.trust_defense = defenseBase - base(raw.defense(defenseScale), input.soul_ranks.defense);
    out.max_hp = roundHalfUp(hpBase * (1 + passives.hp / 100));
    out.attack = finalStat(attackBase, [passives.attack, out.food_attack_pct]);
    out.defense = finalStat(defenseBase, [passives.defense, out.food_defense_pct]);
  }
  if (level !== null && level > 0) {
    // Work speed starts at 70 for every species, +7 per condensing star, then passives (and food) multiply.
    out.work_speed = Math.floor((70 + 7 * stars) * (1 + passives.workSpeed / 100) * (1 + out.food_work_speed_pct / 100));
  }

  if (level !== null && lookups.expTotals.length > level) {
    const atMax = lookups.maxLevel > 0 && level >= lookups.maxLevel;
    const current = lookups.expTotals[level - 1] ?? 0;
    const next = lookups.expTotals[level];
    if (!atMax && next > current) {
      out.exp_to_next = Math.max(0, next - exp);
      out.exp_progress = Math.round(Math.min(100, Math.max(0, (exp - current) / (next - current) * 100)) * 10) / 10;
    } else if (atMax) {
      out.exp_to_next = 0;
      out.exp_progress = 100;
    }
  }

  // Alpha (BOSS_) rows come from a table without appetite or learnset; fall back to the base species.
  const baseTraits = lookups.traitsFor(lookups.canonicalSpeciesId(input.species_id));
  out.food_amount = traits?.a ?? baseTraits?.a ?? null;
  // The game's swap list: mastered skills plus everything the species learns by this level (the save
  // only stores MasteredWaza once a skill fruit or similar adds one), ordered by element then power.
  const learnset = traits?.k ?? baseTraits?.k ?? {};
  const known = new Set(input.mastered_skill_ids);
  // A record without a Level property is a level 1 Pal in game.
  for (const [skill, needed] of Object.entries(learnset)) if ((level ?? 1) >= needed) known.add(skill);
  for (const skill of input.active_skill_ids) known.add(skill);
  const sortKey = (id: string) => { const d = lookups.activeDetails.get(id); return [d?.element ?? 99, d?.power ?? 0]; };
  out.known_skill_ids = [...known].sort((a, b) => { const [ea, pa] = sortKey(a); const [eb, pb] = sortKey(b); return ea - eb || pa - pb; });
  out.known_moves = out.known_skill_ids.map((id) => lookups.activeSkills.get(id) ?? id);

  // A variant row may only know the skill name; the base species row has the text.
  const partner = (traits?.p?.[1] ? traits.p : null) ?? (baseTraits?.p?.[1] ? baseTraits.p : null) ?? traits?.p ?? baseTraits?.p;
  if (partner) {
    const [name, text, levels, extra] = partner;
    out.partner_skill = name;
    out.partner_skill_level = stars + 1;
    const values = levels?.[Math.min(stars, levels.length - 1)] ?? [];
    const suffix = extra?.[Math.min(stars, extra.length - 1)] ?? '';
    out.partner_skill_text = text
      ? `${text.replace(/\{(\d+)\}/g, (match, index) => values[Number(index)] ?? match)}${suffix ? ` ${suffix}` : ''}`
      : null;
    out.partner_skill_levels = text && (levels || extra) ? JSON.stringify({ t: text, v: levels, x: extra }) : null;
  }
  return out;
}
