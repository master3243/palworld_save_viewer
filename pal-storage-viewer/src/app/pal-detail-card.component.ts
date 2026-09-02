import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, Input, OnChanges } from '@angular/core';

import { Game8LookupService } from './game8-lookup.service';
import { OfflineImageService } from './offline-image.service';
import { PalStorageRow } from './save-parser.service';

interface DetailField { key: string; label: string; value: string; rawValue?: string; }
interface PalStat { label: string; value: string; icon: 'hp' | 'attack' | 'defense' | 'crafting'; }
interface PassiveSkill { name: string; rank: string; color: string; rankMarker: string; rankIcon: string; }

@Component({
  selector: 'app-pal-detail-card',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './pal-detail-card.component.html',
  styleUrl: './pal-detail-card.component.css'
})
export class PalDetailCardComponent implements OnChanges {
  @Input({ required: true }) row!: PalStorageRow;
  expandedFields = new Set<string>();
  palImageFailed = false;
  palImageSrc = '';
  alphaImageSrc = '';
  favoriteImageSrc = '';
  game8Url = 'https://game8.co/games/Palworld/archives/439556';
  private readonly imageSources = new Map<string, string>();

  private readonly featuredKeys = new Set([
    'pal_name', 'pal_variant', 'species_id', 'nickname', 'filtered_nickname',
    'level', 'rank', 'gender', 'is_lucky', 'favorite_index', 'hp',
    'iv_hp', 'iv_attack', 'iv_defense', 'soul_rank_hp', 'soul_rank_attack',
    'soul_rank_defense', 'soul_rank_craft_speed', 'skills', 'skill_ranks', 'skill_colors',
    'passive_skill_ids', 'combat_moves', 'active_skill_ids'
  ]);

  get name(): string {
    return this.valueFor('nickname') || this.valueFor('pal_name') || this.valueFor('species_id') || 'Pal';
  }

  get subtitle(): string {
    const species = this.valueFor('pal_name');
    return [species !== this.name ? species : '', this.valueFor('pal_variant')].filter(Boolean).join(' · ');
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
    const speciesId = this.imageSpeciesId(this.valueFor('species_id'));
    return speciesId ? `assets/pals/${encodeURIComponent(speciesId)}.pog` : '';
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

  get passiveSkills(): PassiveSkill[] {
    const names = this.listFor('skills');
    const ranks = this.listFor('skill_ranks');
    const colors = this.listFor('skill_colors');
    return names.map((name, index) => {
      const rank = ranks[index] || '';
      const color = colors[index] || 'regular';
      const numericRank = Number(rank);
      const rankMarker = numericRank < 0 ? `▼${Math.abs(numericRank)}` : numericRank > 0 ? `▲${numericRank}` : '';
      const direction = numericRank < 0 ? 'minus' : 'plus';
      const rankIcon = numericRank
        ? `assets/ui/passive_${direction}_${Math.abs(numericRank)}.pog`
        : '';
      return { name, rank, color, rankMarker, rankIcon };
    });
  }

  get activeMoves(): string[] { return this.listFor('combat_moves'); }

  activeSkillUrl(move: string): string {
    return `https://palworld.wiki.gg/wiki/${encodeURIComponent(move.replace(/\s+/g, '_'))}`;
  }

  constructor(
    private readonly offlineImages: OfflineImageService,
    private readonly game8Lookup: Game8LookupService,
    private readonly changeDetector: ChangeDetectorRef
  ) {}

  ngOnChanges(): void {
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
  isExpandable(field: DetailField): boolean { return field.value.length > 120 || field.value.split(',').length > 4; }
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

  private imageSpeciesId(value: string): string {
    return value
      .replace(/^(?:BOSS_|Boss_|PREDATOR_|POLICE_|RAID_|SUMMON_)/, '')
      .replace(/^Quest_Farmer03_/, '')
      .replace(/_(?:BossRush|Oilrig|Tower|otomo|MAX)$/, '')
      .replace(/_Quest(?:_Enemy|_Friend)?$/, '')
      .replace(/_2$/, '');
  }

  private get wikiName(): string {
    return this.valueFor('pal_name') || this.name;
  }

  private toLabel(key: string): string {
    return key.split('_').filter(Boolean).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
  }
}
