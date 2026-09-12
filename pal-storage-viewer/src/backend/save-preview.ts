import type { GuildAchievementProgress } from './achievement-progress';
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
  guildAchievements?: Record<string, GuildAchievementProgress | null>;
  itemIds?: Record<string, string[] | null>;
  arenaPoints?: Record<string, number | null>;
  keyItemContainerId?: string | null;
  maxFriendship?: number | null;
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
      preview.keyItemContainerId = parsed.payload.key_item_container_id;
      break;
    case 'level':
      preview.players = parsed.payload.players.map(player => ({ uid: player.player_uid, name: player.name }));
      preview.bases = parsed.payload.bases.length;
      preview.labs = parsed.payload.labs;
      preview.guildAchievements = parsed.payload.guild_achievements;
      preview.itemIds = parsed.payload.item_ids;
      preview.arenaPoints = Object.fromEntries(parsed.payload.players.filter(p => p.player_uid).map(p => [p.player_uid!, p.arena_points ?? null]));
      break;
    case 'local_data':
      preview.maxFriendship = parsed.payload.max_friendship;
      break;
  }
  return preview;
}
