import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, Input, OnChanges } from '@angular/core';
import { elementIcons, workTable } from './trait-icons';
import { ELEMENT_NAMES } from '../backend/lookups';
import { condenseWorkBonus } from '../backend/stats';
import { GameDataService } from './game-data.service';
import { TooltipData, TooltipDirective, TextSegment, LevelLine, WorkLevelRow } from './game-tooltip.component';
import { ElementChartComponent } from './element-chart.component';

import { Game8LookupService } from './game8-lookup.service';
import { GenderIconComponent } from './gender-icon.component';
import { OfflineImageService } from './offline-image.service';
import { palImagePath } from './pal-image';
import { PalStorageRow } from './save-parser.service';

interface DetailField { key: string; label: string; value: string; rawValue?: string; }
interface PalStat { label: string; value: string; icon: 'hp' | 'attack' | 'defense' | 'crafting'; tone?: 'high' | 'perfect'; }

/** Status ailment names as the game's skill cards show them. */
const STATUS_NAMES: Record<string, string> = {
  Burn: 'Burn', Wetness: 'Soak', Freeze: 'Freeze', Electrical: 'Electrify', Darkness: 'Blind',
  Poison: 'Poison', Muddy: 'Muddy', IvyCling: 'Ivy-Covered', Stun: 'Stun',
};
interface PassiveSkill { name: string; rank: string; color: string; rankMarker: string; rankIcon: string; tooltip: TooltipData; }
interface VitalBar { label: string; icon: string; value: string; percent: number; title: string; tone: string; tooltip: TooltipData | null; }
interface CombatStat { label: string; value: string; icon: 'attack' | 'defense' | 'crafting'; delta: number; tooltip: TooltipData; }
interface ActiveSkillChip { name: string; elementIndex: number; iconSrc: string; power: string; tooltip: TooltipData; url: string; }
interface PartnerSkill { name: string; level: string; segments: TextSegment[]; tooltip: TooltipData; }
interface FoodEffect { name: string; effects: string; timeLeft: string; }
interface TrustBar { rank: string; progress: number; title: string; tooltip: TooltipData; }

@Component({
  selector: 'app-pal-detail-card',
  standalone: true,
  imports: [CommonModule, GenderIconComponent, TooltipDirective, ElementChartComponent],
  templateUrl: './pal-detail-card.component.html',
  styleUrl: './pal-detail-card.component.css'
})
export class PalDetailCardComponent implements OnChanges {
  @Input({ required: true }) row!: PalStorageRow;
  /** Show the save letter in the header (only useful with several saves loaded). */
  @Input() showSave = false;

  /** True once the species is known to the traits lookup (otherwise every level would read 0). */
  get hasWorkData(): boolean {
    return typeof this.row['elements'] === 'string' && this.row['elements'] !== '' || this.works.some((work) => work.rank > 0);
  }
  expandedFields = new Set<string>();
  palImageFailed = false;
  palImageSrc = '';
  alphaImageSrc = '';
  favoriteImageSrc = '';
  /** Game UI icons from assets/ui (male, female, lucky, hunger, trust, IVA, IVD, IVW, spirit). */
  uiIcons: Record<string, string> = {};
  private static readonly UI_ICON_KEYS = ['male', 'female', 'lucky', 'hunger', 'trust', 'IVA', 'IVD', 'IVW', 'spirit'];
  game8Url = 'https://game8.co/games/Palworld/archives/439556';
  private readonly imageSources = new Map<string, string>();

  private readonly featuredKeys = new Set([
    'elements', 'work', 'work_bonus', 'work_kindling', 'work_watering', 'work_planting', 'work_electricity', 'work_handiwork', 'work_gathering',
    'work_lumbering', 'work_mining', 'work_medicine', 'work_cooling', 'work_transporting', 'work_farming',
    'pal_name', 'paldeck_no', 'pal_variant', 'species_id', 'nickname', 'filtered_nickname',
    'level', 'rank', 'gender', 'is_lucky', 'favorite_index', 'hp',
    'iv_hp', 'iv_attack', 'iv_defense', 'soul_rank_hp', 'soul_rank_attack',
    'soul_rank_defense', 'soul_rank_craft_speed', 'skills', 'skill_ranks', 'skill_colors',
    'passive_skill_ids', 'combat_moves', 'active_skill_ids', 'location', 'location_detail', 'save_id',
    'full_stomach', 'sanity', 'friendship_points', 'exp',
    'max_hp', 'attack', 'defense', 'work_speed', 'max_hp_base', 'attack_base', 'defense_base',
    'passive_hp_pct', 'passive_attack_pct', 'passive_defense_pct', 'passive_work_speed_pct', 'hunger_max',
    'trust_rank', 'trust_progress', 'trust_next', 'exp_to_next', 'exp_progress',
    'partner_skill', 'partner_skill_level', 'partner_skill_text', 'partner_skill_levels', 'stat_parts', 'work_species',
    'food_amount', 'known_skill_ids', 'known_moves', 'research_attack_pct', 'research_defense_pct',
    'trust_hp', 'trust_attack', 'trust_defense', 'food_effect', 'food_attack_pct', 'food_defense_pct', 'food_work_speed_pct', 'food_seconds_left',
    'food_status_effect_item', 'food_with_status_effect_timer'
  ]);

  /** HP, hunger and SAN as the game's status bars show them (current values are as of the save). */
  vitalBars: VitalBar[] = [];
  private computeVitalBars(): VitalBar[] {
    const bars: VitalBar[] = [];
    const bar = (label: string, icon: string, tone: string, current: number | null, max: number | null, title: string, tooltip: TooltipData | null) => {
      if (current === null && max === null) return;
      const shown = current ?? max ?? 0;
      const percent = max ? Math.min(100, Math.max(0, shown / max * 100)) : 100;
      if (max !== null && shown > max + 0.5) {
        // Above the max we can compute: a bonus we do not model yet.
        bars.push({ label, icon, tone, value: String(this.round(shown)), percent: 100, title: `${title} · computed max: ${this.round(max)}`, tooltip });
        return;
      }
      const value = max !== null ? `${this.round(shown)} / ${this.round(max)}` : String(this.round(shown));
      bars.push({ label, icon, tone, value, percent, title, tooltip });
    };
    bar('HP', 'hp', 'hp', this.numberFor('hp'), this.numberFor('max_hp'), 'HP Current / Max', this.statBreakdown('Pal Vitality', 'max_hp', 'max_hp_base', 'trust_hp', 'passive_hp_pct', null));
    // Bar texts are the game's own tooltips.
    const hunger = this.numberFor('full_stomach');
    const hungerMax = this.numberFor('hunger_max');
    bar('Hunger', 'bread', 'hunger', hunger, hungerMax, 'Hunger Current / Max', {
      title: "Pal's Hunger",
      intro: ['SAN falls faster as this decreases.', 'Parameters decrease when starved.', 'Can be recovered by eating.'],
      rows: hunger !== null ? [['Current', hungerMax !== null ? `${this.round(hunger)} / ${this.round(hungerMax)}` : String(this.round(hunger))]] : undefined,
    });
    // SanityValue is only written once it drops, so a missing value is a full 100.
    if (this.numberFor('hp') !== null) {
      const sanity = this.numberFor('sanity') ?? 100;
      bar('SAN', 'san', 'sanity', sanity, 100, 'Current Sanity', {
        title: "Pal's Mental Stability",
        intro: ["Pals' mental stability decreases when working, and recovers when slacking off or sleeping.", 'Hot springs and good meals can increase the rate of recovery.', "If a Pal's mental stability decreases too much, it could cause them to become sick or injured."],
        rows: [['Current', `${this.round(sanity)} / 100`]],
      });
    }
    return bars;
  }

  /** How the game arrives at a stat: species value, trust, condensing, souls, passives, food. */
  private statBreakdown(label: string, key: string, baseKey: string, trustKey: string, pctKey: string, foodKey: string | null): TooltipData | null {
    const value = this.numberFor(key);
    const base = this.numberFor(baseKey);
    if (value === null || base === null) return null;
    const trust = this.numberFor(trustKey) ?? 0;
    const stars = this.displayRank;
    const soulKey = ({ max_hp: 'soul_rank_hp', attack: 'soul_rank_attack', defense: 'soul_rank_defense' } as Record<string, string>)[key] ?? '';
    const souls = this.numberFor(soulKey) ?? 0;
    const pct = this.numberFor(pctKey) ?? 0;
    const foodPct = foodKey ? this.numberFor(foodKey) ?? 0 : 0;
    const rows: [string, string, string?][] = [];
    const parts = this.statParts(key);
    const level = this.numberFor('level') ?? 1;
    const ivValue = this.numberFor(({ max_hp: 'iv_hp', attack: 'iv_attack', defense: 'iv_defense' } as Record<string, string>)[key] ?? '') ?? 0;
    if (parts) {
      const [flat, species, ivPart, scale] = parts;
      rows.push([key === 'max_hp' ? `Starting value (500 + 5 × Lv.${level})` : 'Starting value', String(flat)]);
      rows.push([`Species ${scale} × Lv.${level}`, `+${species}`]);
      rows.push([`IV ${ivValue}`, `+${ivPart}`]);
      if (trust || stars || souls) rows.push(['Species + level + IV', String(flat + species + ivPart), 'subtotal']);
    } else {
      rows.push(['Species + level + IV', String(base - trust)]);
    }
    if (stars) rows.push([`Condensing ${'★'.repeat(stars)}`, `+${stars * 5}%`]);
    if (souls) rows.push([`Pal Souls (rank ${souls})`, `+${souls * 3}%`]);
    if (trust) rows.push([`Bonus from Trust (rank ${this.numberFor('trust_rank') ?? 0})`, `+${trust}`]);
    if (trust || stars || souls) rows.push(['Base', String(base), 'subtotal']);
    if (pct) rows.push(['Passive Skills', `${pct > 0 ? '+' : ''}${pct}%`]);
    if (foodPct) rows.push([`Food: ${this.valueFor('food_effect')}`, `${foodPct > 0 ? '+' : ''}${foodPct}%`]);
    const researchPct = key === 'attack' ? this.numberFor('research_attack_pct') : key === 'defense' ? this.numberFor('research_defense_pct') : null;
    if (researchPct) rows.push(['Research Effects', `+${researchPct}%`]);
    rows.push(['Total', String(value)]);
    const intro = {
      'Pal Vitality': ["When a Pal's vitality reaches 0, its strength is exhausted and it is incapacitated.", 'Place an incapacitated Pal in a Palbox to restore its health.'],
      Attack: ["Pal's Attack.", 'Damage dealt increases as Attack increases.'],
      Defense: ["Pal's Defense.", 'Damage taken decreases as defense increases.'],
    }[label];
    return { title: label, titleRight: base !== value ? `${base} ≫ ${value}` : String(value), intro, rows };
  }

  /** [flat, species × level, IV part, species scaling, trust part] for a stat, from the parser's JSON. */
  private statParts(key: string): number[] | null {
    const raw = this.valueFor('stat_parts');
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as Record<string, number[]>;
      const parts = parsed[key === 'max_hp' ? 'hp' : key];
      return Array.isArray(parts) && parts.length >= 4 ? parts : null;
    } catch { return null; }
  }

  trust: TrustBar | null = null;
  private computeTrust(): TrustBar | null {
    const rank = this.numberFor('trust_rank');
    if (rank === null) return null;
    const points = this.numberFor('friendship_points') ?? 0;
    const next = this.numberFor('trust_next');
    const progress = this.numberFor('trust_progress') ?? 0;
    const title = next === null ? `Trust rank ${rank} (max) · ${points.toLocaleString()} points`
      : `Trust rank ${rank} · ${points.toLocaleString()} / ${next.toLocaleString()} points to the next rank`;
    const rows: [string, string][] = [['Trust rank', next === null ? `${rank} (max)` : String(rank)], ['Current', points.toLocaleString()]];
    if (next !== null) rows.push(['Next rank at', next.toLocaleString()]);
    const tooltip: TooltipData = {
      title: 'Trust',
      intro: ["A measure of a Pal's trust in you.", 'Rises based on how the Pal is treated.', "Higher trust increases the Pal's stats."],
      rows,
    };
    return { rank: String(rank), progress, title, tooltip };
  }

  expNext: { text: string; percent: number; title: string } | null = null;
  private computeExpNext(): { text: string; percent: number; title: string } | null {
    const toNext = this.numberFor('exp_to_next');
    if (toNext === null) return null;
    const percent = this.numberFor('exp_progress') ?? 0;
    if (toNext === 0 && percent >= 100) return { text: 'MAX', percent: 100, title: 'Max level' };
    return { text: toNext.toLocaleString(), percent, title: `${toNext.toLocaleString()} exp to the next level` };
  }

  combatStats: CombatStat[] = [];
  private computeCombatStats(): CombatStat[] {
    const stats: CombatStat[] = [];
    const push = (label: string, icon: CombatStat['icon'], key: string, baseKey: string, trustKey: string, pctKey: string, foodKey: string) => {
      const value = this.numberFor(key);
      const tooltip = this.statBreakdown(label, key, baseKey, trustKey, pctKey, foodKey);
      if (value === null || !tooltip) return;
      const base = this.numberFor(baseKey);
      stats.push({ label, value: String(value), icon, delta: base === null ? 0 : Math.sign(value - base), tooltip });
    };
    push('Attack', 'attack', 'attack', 'attack_base', 'trust_attack', 'passive_attack_pct', 'food_attack_pct');
    push('Defense', 'defense', 'defense', 'defense_base', 'trust_defense', 'passive_defense_pct', 'food_defense_pct');
    const workSpeed = this.numberFor('work_speed');
    if (workSpeed !== null) {
      const stars = this.displayRank;
      const pct = this.numberFor('passive_work_speed_pct') ?? 0;
      const foodPct = this.numberFor('food_work_speed_pct') ?? 0;
      const rows: [string, string][] = [['Every Pal', '70']];
      if (stars) rows.push([`Condensing ${'★'.repeat(stars)}`, `+${stars * 7}`]);
      if (pct) rows.push(['Passive skills', `${pct > 0 ? '+' : ''}${pct}%`]);
      if (foodPct) rows.push([`Food: ${this.valueFor('food_effect')}`, `+${foodPct}%`]);
      rows.push(['Total', String(workSpeed)]);
      const base = 70 + 7 * stars;
      stats.push({ label: 'Work Speed', value: String(workSpeed), icon: 'crafting', delta: Math.sign(pct + foodPct), tooltip: {
        title: 'Work Speed', titleRight: base !== workSpeed ? `${base} ≫ ${workSpeed}` : String(workSpeed),
        intro: ["Pal's Work Speed.", 'Affects the efficiency of working on various tasks at base.'], rows,
      } });
    }
    return stats;
  }

  /** The dish whose status effect is still running. */
  foodEffect: FoodEffect | null = null;
  private computeFoodEffect(): FoodEffect | null {
    const name = this.valueFor('food_effect');
    if (!name) return null;
    const parts: string[] = [];
    for (const [label, key] of [['Attack', 'food_attack_pct'], ['Defense', 'food_defense_pct'], ['Work Speed', 'food_work_speed_pct']]) {
      const pct = this.numberFor(key);
      if (pct) parts.push(`${label} ${pct > 0 ? '+' : ''}${pct}%`);
    }
    const seconds = this.numberFor('food_seconds_left') ?? 0;
    const timeLeft = seconds > 0 ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')} left` : '';
    return { name, effects: parts.join(' · '), timeLeft };
  }

  partnerSkill: PartnerSkill | null = null;
  private computePartnerSkill(): PartnerSkill | null {
    const name = this.valueFor('partner_skill');
    if (!name) return null;
    const level = this.valueFor('partner_skill_level');
    const text = this.valueFor('partner_skill_text');
    const title = `${name}${level ? ` Lv.${level}` : ''}`;
    const perLevel = this.partnerLevels(Number(level) || 1);
    if (!perLevel) {
      return { name, level, segments: text ? [{ text, value: false }] : [], tooltip: { title, lines: text ? [text] : [], note: text ? undefined : 'The game text for this skill needs data we do not have yet.' } };
    }
    const current = perLevel.find((line) => line.current) ?? perLevel[perLevel.length - 1];
    // The tooltip repeats the current text once, then lists just the level-driven values per level.
    const levels = perLevel.map((line) => {
      const segments: TextSegment[] = [];
      for (const seg of line.segments.filter((item) => item.value)) {
        if (segments.length) segments.push({ text: ' · ', value: false });
        segments.push(seg);
      }
      if (!segments.length) segments.push({ text: '—', value: false });
      return { ...line, segments };
    });
    return { name, level, segments: current.segments, tooltip: { title, rich: current.segments, levels, note: 'Partner skill level = condensing stars + 1' } };
  }

  /** The partner skill text at every level (from the `{t, v, x}` JSON), or null when it never changes. */
  private partnerLevels(level: number): LevelLine[] | null {
    const raw = this.valueFor('partner_skill_levels');
    if (!raw) return null;
    let data: { t: string; v: string[][] | null; x: string[] | null };
    try { data = JSON.parse(raw); } catch { return null; }
    const count = Math.max(data.v?.length ?? 0, data.x?.length ?? 0);
    if (!count) return null;
    return Array.from({ length: count }, (_, index) => {
      const values = data.v?.[Math.min(index, data.v.length - 1)] ?? [];
      const suffix = data.x?.[Math.min(index, data.x.length - 1)] ?? '';
      const segments: TextSegment[] = [];
      const pattern = /\{(\d+)\}/g;
      let last = 0;
      for (let match = pattern.exec(data.t); match; match = pattern.exec(data.t)) {
        // Take a leading "x"/"+" and a trailing "%" into the value so "x1.5" and "+30%" read as one figure.
        let start = match.index;
        let end = match.index + match[0].length;
        if (start > last && /[x×+]/.test(data.t[start - 1]) && (start - 1 === 0 || /\s/.test(data.t[start - 2]))) start -= 1;
        if (data.t[end] === '%') end += 1;
        if (start > last) segments.push({ text: data.t.slice(last, start), value: false });
        segments.push({ text: data.t.slice(start, match.index) + (values[Number(match[1])] ?? match[0]) + data.t.slice(match.index + match[0].length, end), value: true });
        last = end;
      }
      if (last < data.t.length) segments.push({ text: data.t.slice(last), value: false });
      if (suffix) segments.push({ text: ' ', value: false }, { text: suffix, value: true });
      return { label: `Lv.${index + 1}`, segments, current: index + 1 === level };
    });
  }

  activeSkillChips: ActiveSkillChip[] = [];
  learnedSkillChips: ActiveSkillChip[] = [];
  emptySlots: number[] = [];
  passiveSkills: PassiveSkill[] = [];
  works: ReturnType<typeof workTable> = [];
  workTooltip: TooltipData | null = null;
  /** Element chart popover, shown while the type chip is hovered. */
  showElementChart = false;
  get elementIndexes(): number[] { return this.elementChips.map((chip) => chip.index); }
  elementChips: { name: string; src: string; index: number }[] = [];
  rankStars: boolean[] = [];
  foodGauge: boolean[] = [];
  ivStats: PalStat[] = [];
  soulStats: PalStat[] = [];
  fields: DetailField[] = [];

  /** Recompute everything the template shows for the current row. */
  private refresh(): void {
    this.vitalBars = this.computeVitalBars();
    this.trust = this.computeTrust();
    this.expNext = this.computeExpNext();
    this.combatStats = this.computeCombatStats();
    this.foodEffect = this.computeFoodEffect();
    this.partnerSkill = this.computePartnerSkill();
    this.passiveSkills = this.computePassiveSkills();
    this.activeSkillChips = this.skillChips(this.listFor('active_skill_ids'), this.listFor('combat_moves'));
    this.learnedSkillChips = this.computeLearnedSkillChips();
    this.emptySlots = Array.from({ length: Math.max(0, 3 - this.activeSkillChips.length) }, (_, index) => index);
    this.works = workTable(this.row);
    this.workTooltip = this.computeWorkTooltip();
    this.elementChips = this.computeElementChips();
    this.rankStars = this.computeRankStars();
    this.foodGauge = this.computeFoodGauge();
    this.ivStats = this.computeIvStats();
    this.soulStats = this.computeSoulStats();
    this.fields = this.computeFields();
  }

  /** The whole work panel opens one grid: the Pal's suitability line at each condensing rank
   * (handbook ranks kept), each level-up in gold. */
  private computeWorkTooltip(): TooltipData | null {
    const species = this.listFor('work_species').map(Number);
    const stars = this.displayRank;
    if (species.length !== this.works.length || !species.every((rank) => Number.isFinite(rank))) return null;
    const current = condenseWorkBonus(species, stars);
    const handbook = this.works.map((work, index) => work.rank - species[index] - current[index]);
    const able = this.works.map((work, index) => index);
    if (!this.works.some((work) => work.rank > 0)) return null;
    const rankAt = (count: number) => { const bonus = condenseWorkBonus(species, count); return able.map((index) => species[index] + handbook[index] + bonus[index]); };
    const perStar = [0, 1, 2, 3, 4].map(rankAt);
    const rows: WorkLevelRow[] = perStar.map((ranks, count) => ({
      stars: count,
      current: count === stars,
      // Gold once a level is above the unstarred value, and it stays gold at every higher rank.
      items: ranks.map((rank, slot) => ({ src: this.works[able[slot]].src, name: this.works[able[slot]].name, rank, up: rank > perStar[0][slot], none: rank === 0 })),
    }));
    const extra = handbook.reduce((sum, value) => sum + Math.max(0, value), 0);
    return {
      title: 'Work Suitability',
      titleRight: `${'★'.repeat(stars)}${'☆'.repeat(4 - stars)}`,
      intro: ['Levels at each condensing rank:'],
      work: rows,
      fit: 'host',
      note: extra > 0 ? `Includes +${extra} from handbooks or items.` : undefined,
    };
  }

  /** Skills the Pal could swap in: mastered plus the species learnset, minus the three equipped slots. */
  private computeLearnedSkillChips(): ActiveSkillChip[] {
    const equipped = new Set(this.listFor('active_skill_ids'));
    const ids = this.listFor('known_skill_ids');
    const names = this.listFor('known_moves');
    const keep = ids.map((id, index) => [id, names[index] ?? id] as const).filter(([id]) => !equipped.has(id));
    return this.skillChips(keep.map(([id]) => id), keep.map(([, name]) => name));
  }

  private skillChips(ids: string[], names: string[]): ActiveSkillChip[] {
    return names.map((name, index) => {
      const id = ids[index] ?? '';
      const detail = this.gameData.activeDetail(id);
      const elementIndex = detail?.element ?? -1;
      const iconSrc = elementIndex >= 0 ? `assets/icons/element_${String(elementIndex).padStart(2, '0')}.webp` : '';
      const description = this.gameData.activeDescription(id);
      // One width for every skill card, like the game's, whatever the description length.
      const tooltip: TooltipData = { title: name, lines: description ? [description] : [], width: 360 };
      if (detail) {
        tooltip.badge = { text: ELEMENT_NAMES[elementIndex] ?? '', iconSrc, element: elementIndex };
        tooltip.stats = [{ icon: 'clock', label: ':', value: String(detail.cooldown) }, { icon: 'power', label: 'Power:', value: String(detail.power) }];
        const [effect] = detail.effects;
        if (effect) tooltip.effect = { label: `Aggregate: ${STATUS_NAMES[effect[0]] ?? effect[0]}`, value: String(effect[1]) };
        if (detail.melee) tooltip.note = 'Melee';
      }
      return { name, elementIndex, iconSrc, power: detail ? String(detail.power) : '', tooltip, url: this.activeSkillUrl(name) };
    });
  }

  private numberFor(key: string): number | null {
    const value = this.row[key];
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private round(value: number): number { return Math.round(value); }

  get name(): string {
    return this.valueFor('nickname') || this.valueFor('pal_name') || this.valueFor('species_id') || 'Pal';
  }

  get palpediaUrl(): string {
    return `https://www.palpedia.net/pals/${encodeURIComponent(this.wikiName)}`;
  }

  get wikiGgUrl(): string {
    return `https://palworld.wiki.gg/wiki/${encodeURIComponent(this.wikiName.replace(/\s+/g, '_'))}`;
  }

  get fandomUrl(): string {
    return `https://palworld.fandom.com/wiki/${encodeURIComponent(this.wikiName.replace(/\s+/g, '_'))}`;
  }

  get palDbUrl(): string {
    return `https://paldb.cc/en/${encodeURIComponent(this.wikiName.replace(/\s+/g, '_'))}`;
  }

  get initials(): string {
    return this.name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase();
  }

  get palImageUrl(): string {
    // The backend supplies the id as the game data spells it; saves vary in case.
    return palImagePath(this.valueFor('species_base_id'), this.valueFor('species_id'));
  }

  get gender(): string { return this.valueFor('gender'); }
  get isLucky(): boolean { return /^(true|1|yes)$/i.test(this.valueFor('is_lucky')); }
  get isAlpha(): boolean { return this.valueFor('pal_variant').toLowerCase().includes('alpha'); }

  get displayRank(): number {
    const storedRank = Number(this.valueFor('rank'));
    return Number.isFinite(storedRank) ? Math.max(0, Math.min(4, storedRank - 1)) : 0;
  }

  /** The game's 10-segment food gauge; filled segments are how much this species eats. */
  private computeFoodGauge(): boolean[] {
    const amount = this.numberFor('food_amount');
    return amount === null ? [] : Array.from({ length: 10 }, (_, index) => index < amount);
  }

  /** Mask image for a stat row, so the same mark can be white, cyan or gold: the game's defense and work
   * speed icons from assets/ui, plus a drawn heart and eight-point burst (the supplied attack icon is opaque). */
  statIconUrl(icon: PalStat['icon'] | CombatStat['icon']): string {
    const drawn: Record<string, string> = {
      hp: "M12 21.5S2.5 15.5 2.5 8.8C2.5 5.6 5 3.5 7.6 3.5c1.9 0 3.4 1 4.4 2.4 1-1.4 2.5-2.4 4.4-2.4 2.6 0 5.1 2.1 5.1 5.3 0 6.7-9.5 12.7-9.5 12.7z",
      attack: "M12.0 1.0 L14.6 5.7 L19.8 4.2 L18.3 9.4 L23.0 12.0 L18.3 14.6 L19.8 19.8 L14.6 18.3 L12.0 23.0 L9.4 18.3 L4.2 19.8 L5.7 14.6 L1.0 12.0 L5.7 9.4 L4.2 4.2 L9.4 5.7zM9.6 9.6h4.8v4.8H9.6z",
    };
    const asset = { defense: 'IVD', crafting: 'IVW' }[icon as string];
    if (asset) return this.uiIcons[asset] ? `url("${this.uiIcons[asset]}")` : '';
    const path = drawn[icon];
    return path ? `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><path fill-rule='evenodd' d='${path}'/></svg>`)}")` : '';
  }

  /** Pal Souls spent, the "+N" the game shows next to the stars. */
  get soulTotal(): number {
    return ['soul_rank_hp', 'soul_rank_attack', 'soul_rank_defense', 'soul_rank_craft_speed'].reduce((sum, key) => sum + (this.numberFor(key) ?? 0), 0);
  }

  /** Element chips like the game's header tab: icon, name and element colour. */
  private computeElementChips(): { name: string; src: string; index: number }[] {
    return elementIcons(this.row).map((icon) => ({ name: icon.name, src: icon.src, index: ELEMENT_NAMES.indexOf(icon.name) }));
  }

  private computeRankStars(): boolean[] {
    return Array.from({ length: 4 }, (_, index) => index < this.displayRank);
  }

  private computeIvStats(): PalStat[] {
    // Same colouring as the table: 70+ is high, 100 is perfect.
    const tone = (value: string): PalStat['tone'] => Number(value) === 100 ? 'perfect' : Number(value) >= 70 ? 'high' : undefined;
    const stats: PalStat[] = [
      { label: 'HP', value: this.valueFor('iv_hp'), icon: 'hp', tone: tone(this.valueFor('iv_hp')) },
      { label: 'Attack', value: this.valueFor('iv_attack'), icon: 'attack', tone: tone(this.valueFor('iv_attack')) },
      { label: 'Defense', value: this.valueFor('iv_defense'), icon: 'defense', tone: tone(this.valueFor('iv_defense')) }
    ];
    return stats.filter((stat) => stat.value !== '');
  }

  private computeSoulStats(): PalStat[] {
    const stats: PalStat[] = [
      { label: 'HP', value: this.valueFor('soul_rank_hp'), icon: 'hp' },
      { label: 'Attack', value: this.valueFor('soul_rank_attack'), icon: 'attack' },
      { label: 'Defense', value: this.valueFor('soul_rank_defense'), icon: 'defense' },
      { label: 'Work Speed', value: this.valueFor('soul_rank_craft_speed'), icon: 'crafting' }
    ];
    // The game's Enhancement screen always lists all four; the save only writes a Rank_* property once it
    // is above 0, so for a Pal (anything with species data) a missing one reads 0. Non-Pal rows show nothing.
    if (stats.every((stat) => stat.value === '') && !this.hasWorkData) return [];
    return stats.map((stat) => ({ ...stat, value: stat.value || '0' }));
  }

  private computePassiveSkills(): PassiveSkill[] {
    const names = this.listFor('skills');
    const ranks = this.listFor('skill_ranks');
    const colors = this.listFor('skill_colors');
    const ids = this.listFor('passive_skill_ids');
    return names.map((name, index) => {
      const rank = ranks[index] || '';
      const color = colors[index] || 'regular';
      const numericRank = Number(rank);
      const rankMarker = numericRank < 0 ? `▼${Math.abs(numericRank)}` : numericRank > 0 ? `▲${numericRank}` : '';
      const direction = numericRank < 0 ? 'minus' : 'plus';
      const rankIcon = numericRank
        ? `assets/ui/passive_${direction}_${Math.abs(numericRank)}.pog`
        : '';
      const description = this.gameData.passiveDescription(ids[index] ?? '');
      const inline = this.passiveLines(description);
      return { name, rank, color, rankMarker, rankIcon, tooltip: { title: name, inline, note: description ? undefined : 'No description in the game data.' } };
    });
  }

  /** The game lists one effect per line with every figure in blue ("Max stamina +50.0%" then
   * "*This effect is only valid for rideable pals."). The data has the effects run together in one
   * string, so a new line starts after a figure wherever a capitalised word, "*" or "(" follows. */
  private passiveLines(description: string): TextSegment[][] {
    if (!description) return [];
    const lines = description.split(/(?<=\d%?|\d\))\s+(?=[A-Z*(])/).map((line) => line.trim()).filter(Boolean);
    return lines.map((line) => line.split(/(\d+(?:\.\d+)?)/).filter(Boolean).map((text) => ({ text, value: /^\d/.test(text) })));
  }

  activeSkillUrl(move: string): string {
    return `https://palworld.wiki.gg/wiki/${encodeURIComponent(move.replace(/\s+/g, '_'))}`;
  }

  passiveSkillUrl(skill: string): string {
    return `https://palworld.wiki.gg/wiki/${encodeURIComponent(skill.replace(/\s+/g, '_'))}`;
  }

  constructor(
    private readonly offlineImages: OfflineImageService,
    private readonly game8Lookup: Game8LookupService,
    private readonly gameData: GameDataService,
    private readonly changeDetector: ChangeDetectorRef
  ) {
    void this.gameData.load().then(() => {
      if (this.row) this.refresh();
      this.changeDetector.markForCheck();
    });
  }

  ngOnChanges(): void {
    this.refresh();
    this.palImageFailed = false;
    this.palImageSrc = '';
    const palPath = this.palImageUrl;
    const currentPalName = this.wikiName;
    this.game8Url = 'https://game8.co/games/Palworld/archives/439556';
    void this.game8Lookup.urlFor(currentPalName).then((url) => {
      if (this.wikiName === currentPalName && url) {
        this.game8Url = url;
        this.changeDetector.markForCheck();
      }
    });
    if (palPath) {
      void this.offlineImages.load(palPath).then((source) => {
        if (this.palImageUrl === palPath) {
          this.palImageSrc = source;
          this.changeDetector.markForCheck();
        }
      });
    }

    void this.offlineImages.load('assets/ui/alpha.pog').then((source) => {
      this.alphaImageSrc = source;
      this.changeDetector.markForCheck();
    });
    for (const key of PalDetailCardComponent.UI_ICON_KEYS) {
      if (this.uiIcons[key]) continue;
      void this.offlineImages.load(`assets/ui/${key}.pog`).then((source) => {
        this.uiIcons[key] = source;
        this.changeDetector.markForCheck();
      });
    }
    const favorite = Number(this.valueFor('favorite_index'));
    this.favoriteImageSrc = '';
    if (favorite >= 1 && favorite <= 3) {
      void this.offlineImages.load(`assets/ui/fav${favorite}.pog`).then((source) => {
        this.favoriteImageSrc = source;
        this.changeDetector.markForCheck();
      });
    }
    for (const skill of this.passiveSkills) {
      if (!skill.rankIcon || this.imageSources.has(skill.rankIcon)) continue;
      void this.offlineImages.load(skill.rankIcon).then((source) => {
        this.imageSources.set(skill.rankIcon, source);
        this.changeDetector.markForCheck();
      });
    }
  }

  imageSource(path: string): string { return this.imageSources.get(path) || ''; }

  private computeFields(): DetailField[] {
    return Object.keys(this.row)
      .filter((key) => !this.featuredKeys.has(key) && this.formatValue(this.row[key]) !== '')
      .map((key) => {
        const rawValue = this.formatValue(this.row[key]);
        return {
          key,
          label: this.toLabel(key),
          value: key === 'owned_time' ? this.formatDate(rawValue) : rawValue,
          rawValue: key === 'owned_time' ? rawValue : undefined
        };
      });
  }

  valueFor(key: string): string { return this.formatValue(this.row[key]); }
  isExpandable(field: DetailField): boolean { return field.value.length > 48 || field.value.split(',').length > 4; }
  isExpanded(field: DetailField): boolean { return this.expandedFields.has(field.key); }

  toggleField(field: DetailField): void {
    if (!this.isExpandable(field)) return;
    this.expandedFields.has(field.key) ? this.expandedFields.delete(field.key) : this.expandedFields.add(field.key);
  }

  private listFor(key: string): string[] {
    const value = this.row[key];
    if (Array.isArray(value)) return value.map(String).filter(Boolean);
    return this.formatValue(value).split(',').map((item) => item.trim()).filter(Boolean);
  }

  private formatValue(value: unknown): string {
    if (Array.isArray(value)) return value.join(', ');
    if (value && typeof value === 'object') return JSON.stringify(value);
    if (value === null || value === undefined) return '';
    return String(value).replace(/\s*;\s*/g, ', ');
  }

  private formatDate(value: string): string {
    // Unreal DateTime values are 100-nanosecond ticks since 0001-01-01.
    const numericValue = Number(value);
    const date = /^-?\d+$/.test(value)
      ? new Date(numericValue / 10_000 - 62_135_596_800_000)
      : new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
  }

  private get wikiName(): string {
    return this.valueFor('pal_name') || this.name;
  }

  private toLabel(key: string): string {
    return key.split('_').filter(Boolean).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
  }
}
