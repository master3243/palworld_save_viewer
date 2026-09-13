import type { SaveSetSummary } from '../backend/combine';
import { CompletionData, summarize } from './completion/completion-model';
import { playerWorldProgress } from './completion/player-world-progress';

export interface DemoSummary {
  percent: number | null;
  pals: number;
  level: number | null;
  day: number | null;
  players: number;
}

/** Run offline for the picker, using the tracker's exact scoring and exclusion criteria. */
export function demoSummary(sets: SaveSetSummary[], rows: Record<string, unknown>[], data: CompletionData): DemoSummary {
  const result: DemoSummary = { percent: null, pals: rows.length, level: null, day: null, players: 0 };
  const players = new Set<string>();
  const max = (a: number | null, b: number | null) => b == null ? a : a == null ? b : Math.max(a, b);
  for (const set of sets) {
    result.day = max(result.day, set.in_game_day);
    for (const player of set.players) {
      // Multiple snapshots of the same player (the original demo) count only once.
      players.add(player.uid.replace(/-/g, '').toLowerCase());
      result.level = max(result.level, player.level);
      if (!player.completion) continue;
      const canOwnLocalData = set.has_local_data && !(set.local_owner_filters?.[player.uid]?.length);
      const world = playerWorldProgress(set, player, rows, canOwnLocalData);
      result.percent = max(result.percent, summarize(player.completion, data, world).percent);
    }
  }
  result.players = players.size;
  return result;
}
