/**
 * Stats the game derives from a Pal's record and species data: max HP, attack, defense, work speed,
 * trust rank, exp to the next level and the partner skill. Formulas were fitted to in-game
 * screenshots of stored Pals (see the notes on each step); trust and Pal Soul bonuses are not
 * included yet because their rules have not been verified.
 */
import { Lookups } from './lookups';

export interface StatInputs {
  species_id: string;
  level: number | null;
  exp: number | null;
  /** Save `Rank` byte: condensing stars + 1. */
  rank: number | null;
  ivs: { hp: number | null; attack: number | null; defense: number | null };
  passive_skill_ids: string[];
  friendship_points: number | null;
}

export interface DerivedStats {
  max_hp: number | null;
  attack: number | null;
  defense: number | null;
  work_speed: number | null;
  /** Species value after level, IV and condensing, before passives: what the game shows left of the arrow. */
  max_hp_base: number | null;
  attack_base: number | null;
  defense_base: number | null;
  /** Summed passive skill percentages. */
  passive_hp_pct: number;
  passive_attack_pct: number;
  passive_defense_pct: number;
  passive_work_speed_pct: number;
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
}

const EMPTY: DerivedStats = {
  max_hp: null, attack: null, defense: null, work_speed: null,
  max_hp_base: null, attack_base: null, defense_base: null,
  passive_hp_pct: 0, passive_attack_pct: 0, passive_defense_pct: 0, passive_work_speed_pct: 0,
  hunger_max: null, trust_rank: null, trust_progress: null, trust_next: null,
  exp_to_next: null, exp_progress: null, partner_skill: null, partner_skill_level: null, partner_skill_text: null,
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

export function deriveStats(input: StatInputs, lookups: Lookups): DerivedStats {
  const traits = lookups.traitsFor(input.species_id);
  const out: DerivedStats = { ...EMPTY };
  const level = input.level;
  const stars = Math.max(0, Math.min(4, (input.rank ?? 1) - 1));
  const passives = passivePercents(input.passive_skill_ids, lookups);
  out.passive_hp_pct = passives.hp;
  out.passive_attack_pct = passives.attack;
  out.passive_defense_pct = passives.defense;
  out.passive_work_speed_pct = passives.workSpeed;
  out.hunger_max = traits?.f ?? null;

  if (traits?.s && level !== null && level > 0) {
    const [hpScale, attackScale, defenseScale] = traits.s;
    const iv = (value: number | null) => 1 + 0.3 * (value ?? 0) / 100;
    // Condensing adds 5% per star; passives add their percentages to the same multiplier
    // (a 1-star Lamball with +30% defense passives reads 135 = 100 * 1.35, not 100 * 1.05 * 1.3).
    const condense = 1 + 0.05 * stars;
    const multiplier = (pct: number) => condense + pct / 100;
    // HP and attack floor the species value before the multiplier; defense does not
    // (fitted to stored Pals: Lamball 997 HP / 157 attack, Fuack 136 defense).
    const hp = Math.floor(500 + 5 * level + hpScale * 0.5 * level * iv(input.ivs.hp));
    const attack = Math.floor(100 + attackScale * 0.075 * level * iv(input.ivs.attack));
    const defense = 50 + defenseScale * 0.075 * level * iv(input.ivs.defense);
    out.max_hp_base = Math.floor(hp * condense);
    out.attack_base = Math.floor(attack * condense);
    out.defense_base = Math.floor(defense * condense);
    out.max_hp = Math.floor(hp * multiplier(passives.hp));
    out.attack = Math.floor(attack * multiplier(passives.attack));
    out.defense = Math.floor(defense * multiplier(passives.defense));
  }
  if (level !== null && level > 0) {
    // Work speed starts at 70 for every species, +7 per condensing star, then passives multiply.
    out.work_speed = Math.floor((70 + 7 * stars) * (1 + passives.workSpeed / 100));
  }

  if (input.friendship_points !== null) {
    const trust = trustRank(input.friendship_points, lookups);
    out.trust_rank = trust.rank;
    out.trust_progress = Math.round(trust.progress * 10) / 10;
    out.trust_next = trust.next;
  }

  if (level !== null && input.exp !== null && lookups.expTotals.length > level) {
    const atMax = lookups.maxLevel > 0 && level >= lookups.maxLevel;
    const current = lookups.expTotals[level - 1] ?? 0;
    const next = lookups.expTotals[level];
    if (!atMax && next > current) {
      out.exp_to_next = Math.max(0, next - input.exp);
      out.exp_progress = Math.round(Math.min(100, Math.max(0, (input.exp - current) / (next - current) * 100)) * 10) / 10;
    } else if (atMax) {
      out.exp_to_next = 0;
      out.exp_progress = 100;
    }
  }

  if (traits?.p) {
    const [name, text, values] = traits.p;
    out.partner_skill = name;
    out.partner_skill_level = stars + 1;
    const value = values?.[Math.min(stars, values.length - 1)];
    out.partner_skill_text = text ? text.replace('{ActiveSkillMainValueByRank}', value === undefined ? '?' : String(value)) : null;
  }
  return out;
}
