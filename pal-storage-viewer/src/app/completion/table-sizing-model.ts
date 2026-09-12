import { formatNumber } from '@angular/common';
import { Category, TrackedItem } from './completion-model';
import { palWikiLinks } from '../pal-wiki-links';

export interface SizingColumn { className: string; values: string[]; }

const text = (value: unknown): string => String(value ?? '').replace(/[&<>"']/g, char =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
const number = (value: number | null | undefined): string => value == null ? '' : formatNumber(value, 'en-US');
const count = (value: string, total?: string): string => `<span class="card-count">${text(value)}${total === undefined ? '' : `<span>/${text(total)}</span>`}</span>`;

/** Lightweight copies of displayed values. Sizing applies the same rule to every column. */
export function trackerSizingColumns(category: Category, options: {
  pal: boolean; fishing: boolean; details: boolean;
  stateLabel: (item: TrackedItem) => string;
  itemIcon: (item: TrackedItem) => boolean;
  suffixes: string[];
}): SizingColumn[] {
  const columns: SizingColumn[] = [];
  const add = (className: string, value: (item: TrackedItem, index: number) => string) =>
    columns.push({ className, values: [...new Set(category.items.map(value))] });
  add('state-col', item => `<span class="item-status"><span class="state-dot"></span>${text(options.stateLabel(item))}</span>`);
  if (category.hasNumbers) add('no-col', (item, index) => options.pal
    ? `<span class="paldeck-number"><span class="paldeck-number-label">No.</span><span class="paldeck-number-digits">${text(item.no === null ? '' : String(item.no).padStart(3, '0'))}${options.suffixes[index] ? `<small>${text(options.suffixes[index])}</small>` : ''}</span></span>`
    : item.noMax === undefined ? text(item.no) : count(String(item.no ?? ''), String(item.noMax)));
  if (options.pal) add('portrait-col', () => '<img alt="">');
  if (category.hasTags) add('tag-col', item => item.tag ? `<span class="tag-chip">${text(item.tag)}</span>` : '');
  add('name-col', item => `${item.crafting || options.itemIcon(item) ? `<img ${category.key === 'technologies' ? 'class="technology-icon"' : ''} alt="">` : ''}<span>${text(item.name)}</span>`);
  if (category.key === 'achievements') {
    add('achievement-requirement', item => `${text(item.achievement?.description)}${item.achievement?.unknown ? '<small class="achievement-estimate">Unconfirmed</small>' : ''}`);
    add('achievement-progress', item => count(item.achievement?.current == null ? '?' : number(item.achievement.current), number(item.achievement?.target)));
  }
  if (category.key === 'notes') add('checked-col', item => item.checked == null ? '?' : item.checked ? '✔' : '✘');
  if (category.key === 'paldeck') add('seen-col', item => item.seen == null ? '?' : item.seen ? '✔' : '✘');
  if (category.key === 'crafting') {
    add('', item => text(item.crafting?.group));
    add('', item => `<span class="craft-rarity">${text(['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary'][item.crafting!.rarity])}</span>`);
    add('craft-number craft-weight', item => `${text(number(item.crafting!.weight))}<img alt="">`);
    add('craft-number craft-value', item => `${text(number(item.crafting!.baseValue))}<img alt="">`);
    add('craft-number craft-tech-level', item => {
      const craft = item.crafting!;
      return text(craft.technologyLevels.length ? craft.technologyLevels.join(', ') : craft.inheritedTechnologyLevels.length ? `(${craft.inheritedTechnologyLevels.join(', ')})` : '-');
    });
    add('craft-source', item => `<span>${text(item.crafting!.sourceLabel || '-')}</span>`);
    add('crafted-col', item => count(item.crafting!.count === null ? '-' : number(item.crafting!.count)));
    add('craft-ingredients', item => `<details><summary>${item.crafting!.recipes.length === 1 ? 'Recipe' : item.crafting!.recipes.length + ' recipes'}</summary></details>`);
    add('craft-stats', item => item.crafting!.stats.length ? `<div>${item.crafting!.stats.map(stat => `<span>${text(stat[0])}: ${text(number(stat[1]))}</span>`).join('')}</div>` : '-');
  }
  if (category.key === 'captureBonus') {
    add('no-col', item => count(number(item.captureProgress?.done), number(item.captureProgress?.total)));
    add('butchered-col', item => item.butchered == null ? '?' : text(number(item.butchered)));
    for (const stars of [0, 1, 2, 3, 4]) add('condensed-col', item => item.condensed == null ? '?' : item.condensed[stars] ? text(number(item.condensed[stars])) : '');
  }
  if (options.fishing) for (const size of ['common', 'whopper', 'lunker'] as const) add('fishing-col', item => text(number(item.fishing?.[size])));
  if (options.pal) add('pal-links-col', () => `<span class="wiki-links">${palWikiLinks('').map(link => `<a class="wiki-link"><span>${text(link.label)}</span><svg></svg></a>`).join('')}</span>`);
  if (options.details) add('detail-col', item => `<span>${text(item.detail)}</span>`);
  if (category.hasCoords) add('coords-col', item => item.coords ? `<button class="coordinate-link">${text(item.coords)}${item.map ? `<small> · ${text(item.map)}</small>` : ''} ↗</button>` : '');
  return columns;
}
