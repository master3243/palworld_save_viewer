import type { SavePreview } from '../backend/save-preview';
import type { SaveSetSummary } from './save-parser.service';
import { type CompletionData, summarize } from './completion/completion-model';

export interface PendingFileDetail {
  text: string;
  stat?: string;
  statTitle?: string;
  pending?: boolean;
}

/** Resolve only within one world, using the currently selected files. */
export function pendingFileDetails(
  previews: readonly (SavePreview | undefined)[],
  data: CompletionData | null,
  loadedSet?: SaveSetSummary,
  catalogPending = false,
): PendingFileDetail[] {
  const names = new Map(loadedSet?.players.map(player => [player.uid, player.name]) ?? []);
  const labs = [...(loadedSet?.labs ?? [])];
  for (const preview of previews) {
    if (preview?.kind !== 'level') continue;
    for (const player of preview.players ?? []) {
      if (player.uid) names.set(player.uid, player.name);
    }
    labs.push(...(preview.labs ?? []));
  }
  return previews.map(preview => {
    if (!preview) return { text: '' };
    if (preview.error) return { text: `Could not read file: ${preview.error}` };
    switch (preview.kind) {
      case 'level_meta':
        return { text: preview.worldName || 'Unknown world', stat: preview.day != null ? `day ${preview.day}` : '' };
      case 'level': {
        const players = preview.players?.length ?? 0;
        const bases = preview.bases ?? 0;
        return { text: `${players} player${players === 1 ? '' : 's'} · ${bases} base${bases === 1 ? '' : 's'}` };
      }
      case 'player': {
        const name = (preview.playerUid && names.get(preview.playerUid)) || '';
        if (preview.completion && data) {
          return { text: name, stat: `${summarize(preview.completion, data, { labs }).percent}%`, statTitle: 'Tracker progress' };
        }
        const pending = Boolean(preview.completion && catalogPending);
        return { text: name, stat: pending ? '...' : '-', statTitle: pending ? 'Loading progress...' : 'Progress unavailable', pending };
      }
      default: return { text: '' };
    }
  });
}
