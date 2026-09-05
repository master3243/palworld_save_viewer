import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, Input, OnChanges } from '@angular/core';
import { elementIcons, workTable } from './trait-icons';
import { ELEMENT_NAMES } from '../backend/lookups';
import { GameDataService } from './game-data.service';
import { TooltipData, TooltipDirective } from './game-tooltip.component';

import { Game8LookupService } from './game8-lookup.service';
import { GenderIconComponent } from './gender-icon.component';
import { OfflineImageService } from './offline-image.service';
import { palImagePath } from './pal-image';
import { PalStorageRow } from './save-parser.service';

interface DetailField { key: string; label: string; value: string; rawValue?: string; }
interface PalStat { label: string; value: string; icon: 'hp' | 'attack' | 'defense' | 'crafting'; }
interface PassiveSkill { name: string; rank: string; color: string; rankMarker: string; rankIcon: string; tooltip: TooltipData; }
interface VitalBar { label: string; icon: string; value: string; percent: number; title: string; tone: string; tooltip: TooltipData | null; }
interface CombatStat { label: string; value: string; icon: 'attack' | 'defense' | 'crafting'; delta: number; tooltip: TooltipData; }
interface ActiveSkillChip { name: string; elementIndex: number; iconSrc: string; power: string; tooltip: TooltipData; url: string; }
interface PartnerSkill { name: string; level: string; text: string; tooltip: TooltipData; }
interface FoodEffect { name: string; effects: string; timeLeft: string; }

@Component({
  selector: 'app-pal-detail-card',
  standalone: true,
  imports: [CommonModule, GenderIconComponent, TooltipDirective],
  templateUrl: './pal-detail-card.component.html',
  styleUrl: './pal-detail-card.component.css'
})
export class PalDetailCardComponent implements OnChanges {
  @Input({ required: true }) row!: PalStorageRow;
  /** Show the save letter in the header (only useful with several saves loaded). */
  @Input() showSave = false;
  readonly elementIcons = elementIcons;
  readonly workTable = workTable;

  /** True once the species is known to the traits lookup (otherwise every level would read 0). */
  get hasWorkData(): boolean {
    return typeof this.row['elements'] === 'string' && this.row['elements'] !== '' || workTable(this.row).some((work) => work.rank > 0);
  }
  expandedFields = new Set<string>();
  palImageFailed = false;
  palImageSrc = '';
  alphaImageSrc = '';
  favoriteImageSrc = '';
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
    'partner_skill', 'partner_skill_level', 'partner_skill_text',
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
    bar('HP', 'hp', 'hp', this.numberFor('hp'), this.numberFor('max_hp'), 'Current HP at save time / max HP', this.statBreakdown('Max HP', 'max_hp', 'max_hp_base', 'trust_hp', 'passive_hp_pct', null));
    // SanityValue is only written once it drops, so a missing value is a full 100.
    bar('Hunger', 'bread', 'hunger', this.numberFor('full_stomach'), this.numberFor('hunger_max'), 'Hunger at save time / max', null);
    if (this.numberFor('hp') !== null) bar('SAN', 'san', 'sanity', this.numberFor('sanity') ?? 100, 100, 'Sanity at save time', null);
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
    const rows: [string, string][] = [['Species + level + IV', String(base - trust)]];
    if (trust) rows.push([`Trust rank ${this.numberFor('trust_rank') ?? 0}`, `+${trust}`]);
    if (stars) rows.push([`Condensing ${'★'.repeat(stars)}`, `+${stars * 5}%`]);
    if (souls) rows.push([`Pal Souls (rank ${souls})`, `+${souls * 3}%`]);
    if (trust || stars || souls) rows.push(['Base', String(base)]);
    if (pct) rows.push(['Passive skills', `${pct > 0 ? '+' : ''}${pct}%`]);
    if (foodPct) rows.push([`Food: ${this.valueFor('food_effect')}`, `${foodPct > 0 ? '+' : ''}${foodPct}%`]);
    rows.push(['Total', String(value)]);
    return { title: label, rows };
  }

  trust: { rank: string; progress: number; title: string } | null = null;
  private computeTrust(): { rank: string; progress: number; title: string } | null {
    const points = this.numberFor('friendship_points');
    const rank = this.numberFor('trust_rank');
    if (points === null || rank === null) return null;
    const next = this.numberFor('trust_next');
    const progress = this.numberFor('trust_progress') ?? 0;
    const title = next === null ? `Trust rank ${rank} (max) · ${points.toLocaleString()} points`
      : `Trust rank ${rank} · ${points.toLocaleString()} / ${next.toLocaleString()} points to the next rank`;
    return { rank: String(rank), progress, title };
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
      stats.push({ label: 'Work Speed', value: String(workSpeed), icon: 'crafting', delta: Math.sign(pct + foodPct), tooltip: { title: 'Work Speed', rows } });
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
    const timeLeft = seconds > 0 ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')} left at save time` : '';
    return { name, effects: parts.join(' · '), timeLeft };
  }

  partnerSkill: PartnerSkill | null = null;
  private computePartnerSkill(): PartnerSkill | null {
    const name = this.valueFor('partner_skill');
    if (!name) return null;
    const level = this.valueFor('partner_skill_level');
    const text = this.valueFor('partner_skill_text');
    return { name, level, text, tooltip: { title: `${name}${level ? ` Lv.${level}` : ''}`, lines: text ? [text] : [], note: text ? undefined : 'The game text for this skill needs data we do not have yet.' } };
  }

  activeSkillChips: ActiveSkillChip[] = [];
  learnedSkillChips: ActiveSkillChip[] = [];
  emptySlots: number[] = [];
  passiveSkills: PassiveSkill[] = [];

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
  }

  /** Learned skills that are not in the three equipped slots. */
  private computeLearnedSkillChips(): ActiveSkillChip[] {
    const equipped = new Set(this.listFor('active_skill_ids'));
    const ids = this.listFor('mastered_skill_ids');
    const names = this.listFor('learned_moves');
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
      const tooltip: TooltipData = { title: name, lines: description ? [description] : [] };
      if (detail) {
        tooltip.badge = { text: ELEMENT_NAMES[elementIndex] ?? '', iconSrc, element: elementIndex };
        tooltip.stats = [{ icon: 'clock', label: ':', value: String(detail.cooldown) }, { icon: 'power', label: 'Power:', value: String(detail.power) }];
        const effects = detail.effects.map(([effect, value]) => `${effect} ${value}`);
        if (detail.melee || effects.length) tooltip.note = [detail.melee ? 'Melee' : '', ...effects].filter(Boolean).join(' · ');
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

  get rankStars(): boolean[] {
    return Array.from({ length: 4 }, (_, index) => index < this.displayRank);
  }

  get ivStats(): PalStat[] {
    const stats: PalStat[] = [
      { label: 'HP', value: this.valueFor('iv_hp'), icon: 'hp' },
      { label: 'Attack', value: this.valueFor('iv_attack'), icon: 'attack' },
      { label: 'Defense', value: this.valueFor('iv_defense'), icon: 'defense' }
    ];
    return stats.filter((stat) => stat.value !== '');
  }

  get soulStats(): PalStat[] {
    const stats: PalStat[] = [
      { label: 'HP', value: this.valueFor('soul_rank_hp'), icon: 'hp' },
      { label: 'Attack', value: this.valueFor('soul_rank_attack'), icon: 'attack' },
      { label: 'Defense', value: this.valueFor('soul_rank_defense'), icon: 'defense' },
      { label: 'Crafting', value: this.valueFor('soul_rank_craft_speed'), icon: 'crafting' }
    ];
    return stats.filter((stat) => stat.value !== '');
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
      return { name, rank, color, rankMarker, rankIcon, tooltip: { title: name, lines: description ? [description] : [], note: description ? undefined : 'No description in the game data.' } };
    });
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

  get fields(): DetailField[] {
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
