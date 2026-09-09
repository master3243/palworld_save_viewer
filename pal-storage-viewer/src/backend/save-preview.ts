import type { PlayerCompletion } from './completion';
import { palCount, type ParsedFile, type SaveKind } from './saves';

/** Preview data without the large Pal records used to build the table. */
export interface SavePreview {
  kind: SaveKind;
  pals: number | null;
  error?: string;
  worldName?: string;
  day?: number | null;
  playerUid?: string | null;
  completion?: PlayerCompletion | null;
  players?: { uid: string | null; name: string }[];
  bases?: number;
  labs?: Record<string, number>[];
}

export function previewSave(parsed: ParsedFile | { error: string }): SavePreview {
  if ('error' in parsed) return { kind: 'unknown', pals: null, error: parsed.error };
  const preview: SavePreview = { kind: parsed.kind, pals: palCount(parsed) };
  switch (parsed.kind) {
    case 'level_meta':
      preview.worldName = parsed.payload.world_name;
      preview.day = parsed.payload.in_game_day;
      break;
    case 'player':
      preview.playerUid = parsed.payload.player_uid;
      preview.completion = parsed.payload.completion;
      break;
    case 'level':
      preview.players = parsed.payload.players.map(player => ({ uid: player.player_uid, name: player.name }));
      preview.bases = parsed.payload.bases.length;
      preview.labs = parsed.payload.labs;
      break;
  }
  return preview;
}
