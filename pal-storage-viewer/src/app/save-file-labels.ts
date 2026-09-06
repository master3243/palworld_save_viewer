/**
 * Labels for save files and their kinds, shared by the sources bar, the load
 * confirmation and the page.
 */
import type { SaveSource } from './save-parser.service';

/** Short tag for a file kind, used on every chip. */
export function kindTag(kind: string): string {
  switch (kind) {
    case 'dimensional_storage': return 'DPS';
    case 'level': return 'World';
    case 'player': return 'Player';
    case 'level_meta': return 'Info';
    default: return 'Skip';
  }
}

/** Tooltip explaining what a file kind is for. */
export function kindTitle(kind: string): string {
  switch (kind) {
    case 'level': return 'Data for every Pal (minus the dimensional storage)';
    case 'dimensional_storage': return 'Dimensional Pal Storage.';
    case 'player': return 'A map of containers to the player\'s party or Pal Box, plus the player\'s progress record (bosses, effigies, journals, quests) for the 100% tracker.';
    case 'level_meta': return 'Metadata used to label the save.';
    default: return 'Not a pal save; ignored.';
  }
}

/** Two or three words on what a file contributes; shown on chips and in the confirmation. */
export function kindBlurb(kind: string): string {
  switch (kind) {
    case 'level': return 'party · box · bases';
    case 'dimensional_storage': return 'dimensional storage';
    case 'player': return 'party / box ids · progress';
    case 'level_meta': return 'world name · day';
    default: return 'no pals';
  }
}

/** Long player-id file names read as "…0001_dps.sav"; the full name stays in the tooltip. */
export function shortFileName(name: string): string {
  const match = /^([0-9a-f]{32})(_dps)?\.sav$/i.exec(name);
  return match ? `…${match[1].slice(-4)}${match[2] ?? ''}.sav` : name;
}

export function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

export function savedAtLabel(value: string | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

/** Tooltip for a loaded file: what it is and what it contributed. */
export function sourceTitle(source: SaveSource): string {
  const parts = [source.kind_label];
  if (source.set) parts.push(`folder: ${source.set}`);
  if (source.world_name) parts.push(`world: ${source.world_name}`);
  if (source.players) parts.push(`${source.players} player${source.players === 1 ? '' : 's'}`);
  if (source.bases) parts.push(`${source.bases} base${source.bases === 1 ? '' : 's'}`);
  if (source.skipped?.wild_or_npc) parts.push(`${source.skipped.wild_or_npc} wild/NPC skipped`);
  if (source.note) parts.push(source.note);
  return parts.join(' · ');
}
