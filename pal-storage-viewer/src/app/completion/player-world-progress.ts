import type { SaveSetSummary } from '../../backend/combine';
import type { WorldProgress } from './completion-model';
import { ownedCondensation } from './owned-condensation';

/** Shared inputs for tracker scoring and the precomputed demo summaries. */
export function playerWorldProgress(
  set: SaveSetSummary, player: SaveSetSummary['players'][number],
  rows: readonly Record<string, unknown>[], ownsLocalData: boolean,
): WorldProgress {
  return {
    labs: set.labs ?? [],
    hasLevel: set.has_level,
    guildAchievements: player.guild_achievements,
    keyItemIds: player.key_item_ids,
    maxFriendship: ownsLocalData ? set.max_friendship : null,
    friendshipUnavailable: !set.has_local_data ? 'Add LocalData.sav with "+ Files" to see friendship history.'
      : !ownsLocalData ? 'Select the player who owns LocalData.sav.'
      : 'Maximum friendship was not recorded in the loaded save.',
    inGameDay: set.in_game_day,
    ownedCondensation: set.has_level ? ownedCondensation(rows, set.letter, player.uid) : null,
    bases: set.has_level ? set.bases.length : null,
    pals: set.has_level || set.has_dimensional_storage ? set.pals : null,
    keyItems: player.key_items,
    attributes: player.attributes,
    arenaPoints: player.arena_points,
    arenaPointsUnavailable: set.has_level ? 'Arena Points were not recorded in the loaded save.' : 'Add Level.sav with "+ Files" to see Arena Points.',
    attributesUnavailable: set.has_level ? 'Player attributes were not recorded in the loaded save.' : 'Add Level.sav with "+ Files" to see player attributes.',
    seenSpecies: ownsLocalData ? set.seen_species : null,
    checkedNotes: ownsLocalData ? set.checked_notes : null,
    checkedUnavailable: !set.has_local_data ? 'Add LocalData.sav with "+ Files" to see checked journals.'
      : set.checked_notes == null ? 'Journal checks were not recorded in the loaded save.'
      : 'Select the player who owns LocalData.sav. Checked journals are only available for that player.',
    seenUnavailable: !set.has_local_data ? 'Add LocalData.sav with "+ Files" to see encountered species.'
      : set.seen_species == null ? 'Encounter data was not recorded in the loaded save.'
      : 'Select the player who owns LocalData.sav. Seen data is only available for that player.',
  };
}
