/** Tooltip content shared by the Pal table and detail card. */
import { ELEMENT_NAMES } from '../backend/lookups';
import type { ActiveSkillDetail } from '../backend/lookups';
import { condenseWorkBonus } from '../backend/stats';
import type { TooltipData, WorkLevelRow } from './game-tooltip.component';
import type { PalStorageRow } from './save-parser.service';
import type { TraitIcon } from './trait-icons';

/** Status ailment names as the game's skill cards show them. */
const STATUS_NAMES: Record<string, string> = {
  Burn: 'Burn', Wetness: 'Soak', Freeze: 'Freeze', Electrical: 'Electrify', Darkness: 'Blind',
  Poison: 'Poison', Muddy: 'Muddy', IvyCling: 'Ivy-Covered', Stun: 'Stun',
};

export function activeSkillTooltip(name: string, description: string, detail: ActiveSkillDetail | null): TooltipData {
  const elementIndex = detail?.element ?? -1;
  const iconSrc = elementIndex >= 0 ? `assets/icons/element_${String(elementIndex).padStart(2, '0')}.webp` : '';
  const tooltip: TooltipData = { title: name, lines: description ? [description] : [], width: 360 };
  if (detail) {
    tooltip.badge = { text: ELEMENT_NAMES[elementIndex] ?? '', iconSrc, element: elementIndex };
    tooltip.stats = [{ icon: 'clock', label: ':', value: String(detail.cooldown) }, { icon: 'power', label: 'Power:', value: String(detail.power) }];
    const [effect] = detail.effects;
    if (effect) tooltip.effect = { label: `Aggregate: ${STATUS_NAMES[effect[0]] ?? effect[0]}`, value: String(effect[1]) };
    if (detail.melee) tooltip.note = 'Melee';
  }
  return tooltip;
}
/** The game lists one effect per line with every figure in blue ("Max stamina +50.0%" then
 * "*This effect is only valid for rideable pals."). The data has the effects run together in one
 * string, so a new line starts after a figure wherever a capitalised word, "*" or "(" follows. */
export function passiveSkillTooltip(name: string, description: string): TooltipData {
  const lines = description.split(/(?<=\d%?|\d\))\s+(?=[A-Z*(])/).map((line) => line.trim()).filter(Boolean);
  const inline = lines.map((line) => line.split(/(\d+(?:\.\d+)?)/).filter(Boolean).map((text) => ({ text, value: /^\d/.test(text) })));
  return { title: name, inline, width: 360, note: description ? undefined : 'No description in the game data.' };
}

/** The whole work panel opens one grid: the Pal's suitability line at each condensing rank
 * (handbook ranks kept), each level-up in gold. */
export function workSuitabilityTooltip(row: PalStorageRow, works: TraitIcon[]): TooltipData | null {
  const raw = row['work_species'];
  const species = (Array.isArray(raw) ? raw : String(raw ?? '').split(',').map((value) => value.trim()).filter(Boolean)).map(Number);
  const storedRank = Number(row['rank']);
  const stars = Number.isFinite(storedRank) ? Math.max(0, Math.min(4, storedRank - 1)) : 0;
  if (species.length !== works.length || !species.every((rank) => Number.isFinite(rank))) return null;
  const current = condenseWorkBonus(species, stars);
  const handbook = works.map((work, index) => work.rank - species[index] - current[index]);
  if (!works.some((work) => work.rank > 0)) return null;
  const rankAt = (count: number) => { const bonus = condenseWorkBonus(species, count); return works.map((_, index) => species[index] + handbook[index] + bonus[index]); };
  const perStar = [0, 1, 2, 3, 4].map(rankAt);
  const rows: WorkLevelRow[] = perStar.map((ranks, count) => ({
    stars: count,
    current: count === stars,
    // Gold once a level is above the unstarred value, and it stays gold at every higher rank.
    items: ranks.map((rank, slot) => ({ src: works[slot].src, name: works[slot].name, rank, up: rank > perStar[0][slot], none: rank === 0 })),
  }));
  const extra = handbook.reduce((sum, value) => sum + Math.max(0, value), 0);
  return {
    title: 'Work Suitability',
    titleRight: `${'★'.repeat(stars)}${'☆'.repeat(4 - stars)}`,
    intro: ['Levels at each condensing rank:'],
    work: rows,
    width: 560,
    note: extra > 0 ? `Includes +${extra} from handbooks or items.` : undefined,
  };
}
