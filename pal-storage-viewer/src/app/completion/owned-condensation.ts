export type CondensationCounts = [number, number, number, number, number];

/** Current owned Pals, counted once per instance at their exact star rank. */
export function ownedCondensation(
  rows: readonly Record<string, unknown>[], save: string, playerUid: string,
): Record<string, CondensationCounts> {
  const counts: Record<string, CondensationCounts> = {};
  const uid = (value: unknown) => typeof value === 'string' ? value.replace(/-/g, '').toLowerCase() : '';
  const owner = uid(playerUid);
  const seen = new Set<string>();
  for (const row of rows) {
    // Base workers can omit OwnerPlayerUId while retaining their instance's player ID.
    const rowOwner = uid(row['owner_player_uid']) || uid(row['instance_player_uid']);
    if (row['save_id'] !== save || !owner || rowOwner !== owner) continue;
    const instance = uid(row['instance_id']);
    if (instance && seen.has(instance)) continue;
    if (instance) seen.add(instance);
    const rank = row['rank'] ?? 1;
    const species = row['species_base_id'];
    if (typeof rank !== 'number' || !Number.isInteger(rank) || rank < 1 || rank > 5 || typeof species !== 'string' || !species) continue;
    const values = counts[species.toLowerCase()] ??= [0, 0, 0, 0, 0];
    values[rank - 1]++;
  }
  return counts;
}
