import { SaveBuffer, asDict, findPropertyStart, guidOrNull, readFString, readPropertyList, readPropertyValue, readStructArrayProperty, readTagHeader } from './gvas';
import type { PalRecord } from './record';

export interface LocalOwnerEvidence {
  playerUids: string[];
  instanceIds: string[];
  containerIds: string[];
  trackedQuest: string | null;
}

export interface OwnerCandidate {
  uid: string;
  name?: string;
  containers?: string[];
  quests?: string[] | null;
  notes?: string[] | null;
}

export function extractOwnerQuests(buf: SaveBuffer): string[] | null {
  const ids = new Set<string>();
  let recorded = false;
  for (const name of ['OrderedQuestArray', 'CompletedQuestArray', 'OrderedQuestArray_FullRelease', 'CompletedQuestArray_FullRelease']) {
    const at = findPropertyStart(buf, name);
    if (at < 0) continue;
    try {
      const value = readPropertyValue(buf, at)[1];
      if (!Array.isArray(value)) return null;
      recorded = true;
      for (const entry of value) {
        const id = typeof entry === 'string' ? entry : asDict(entry)['QuestName'];
        if (typeof id === 'string') ids.add(id);
      }
    } catch { return null; }
  }
  return recorded ? [...ids] : null;
}

export function extractLocalOwnerEvidence(buf: SaveBuffer): LocalOwnerEvidence {
  const playerUids = new Set<string>(), instanceIds = new Set<string>(), containerIds = new Set<string>();
  const add = (set: Set<string>, value: unknown) => {
    const id = typeof value === 'string' ? guidOrNull(value) : null;
    if (id) set.add(id);
  };
  const at = findPropertyStart(buf, 'Local_MaxFriendshipPalIds');
  if (at >= 0) {
    try {
      const tag = readTagHeader(buf, at);
      const [key, afterKey] = readFString(buf, tag.offset);
      const [value, afterValue] = readFString(buf, afterKey);
      const end = afterValue + 1 + tag.size, count = buf.i32(afterValue + 5);
      if (tag.type === 'MapProperty' && key === 'StructProperty' && value === 'IntProperty' && count >= 0 && count <= 100000 && end <= buf.length) {
        let pos = afterValue + 9;
        const entries = [];
        for (let i = 0; i < count; i++) {
          const [fields, next] = readPropertyList(buf, pos, end);
          if (next <= pos || next + 4 > end) throw new Error('Invalid friendship entry');
          entries.push(fields); pos = next + 4;
        }
        if (pos === end) for (const fields of entries) {
          add(playerUids, fields['PlayerUId']); add(instanceIds, fields['InstanceId']);
        }
      }
    } catch { /* Unreadable evidence must not exclude a player. */ }
  }
  for (const preset of readStructArrayProperty(buf, findPropertyStart(buf, 'Local_OtomoLoadoutSaveData'))) {
    const pals = asDict(preset)['LoadoutPals'];
    if (!Array.isArray(pals)) continue;
    for (const value of pals) {
      const pal = asDict(value), id = asDict(pal['PalInstanceID']), saved = asDict(pal['SaveParameter']);
      add(playerUids, id['PlayerUId']); add(playerUids, saved['OwnerPlayerUId']);
      add(instanceIds, id['InstanceId']);
      add(containerIds, asDict(asDict(saved['SlotId'])['ContainerId'])['ID']);
    }
  }
  let tracked: string | null = null;
  try {
    const at = findPropertyStart(buf, 'TrackingQuestId');
    const value = at >= 0 ? readPropertyValue(buf, at)[1] : null;
    if (typeof value === 'string') tracked = value;
  } catch { /* Missing or unreadable selection adds no constraint. */ }
  return { playerUids: [...playerUids], instanceIds: [...instanceIds], containerIds: [...containerIds], trackedQuest: tracked && tracked !== 'None' ? tracked : null };
}

/** Union of matches within each ID rule; intersection across rules. Missing evidence is unconstrained. */
export function localOwnerFilters(local: LocalOwnerEvidence | null, checkedNotes: string[] | null, players: OwnerCandidate[], records: PalRecord[]): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  const instances = new Set(local?.instanceIds);
  const currentOwners = new Set(records.filter(pal => instances.has(pal.identity.instance_id ?? ''))
    .map(pal => guidOrNull(pal.ownership.owner_player_uid)).filter((id): id is string => !!id));
  const playerName = (uid: string) => players.find(player => player.uid === uid)?.name?.trim() || `Player ${uid}`;
  const ownerNames = [...currentOwners].map(playerName).join(', ');
  for (const player of players) {
    const name = playerName(player.uid);
    const reasons: string[] = [];
    if (local?.playerUids.length && !local.playerUids.includes(player.uid)) reasons.push(`Player IDs recorded with friendships or saved Pal teams in LocalData.sav do not include the ID for ${name}.`);
    if (local?.containerIds.length && player.containers?.length && !player.containers.some(id => local.containerIds.includes(id))) reasons.push(`The storage IDs recorded with saved Pal teams in LocalData.sav do not match the party or Palbox belonging to ${name}.`);
    if (currentOwners.size && !currentOwners.has(player.uid)) reasons.push(`Pals referenced by LocalData.sav are currently owned by ${ownerNames} in Level.sav.`);
    if (checkedNotes?.length && player.notes != null && checkedNotes.some(id => !player.notes!.includes(id))) reasons.push(`${name} has not obtained some journals marked as read in LocalData.sav.`);
    if (local?.trackedQuest && player.quests != null && !player.quests.includes(local.trackedQuest)) reasons.push(`${name} has not started or completed the tracked quest in LocalData.sav.`);
    result[player.uid] = reasons;
  }
  return result;
}

export function identifiedLocalOwner(local: LocalOwnerEvidence | null, players: OwnerCandidate[], records: PalRecord[]): string | null {
  if (!local) return null;
  const instances = new Set(local.instanceIds);
  const matches = new Set([
    ...local.playerUids,
    ...players.filter(player => player.containers?.some(id => local.containerIds.includes(id))).map(player => player.uid),
    ...records.filter(pal => instances.has(pal.identity.instance_id ?? ''))
      .map(pal => guidOrNull(pal.ownership.owner_player_uid)).filter((id): id is string => !!id),
  ]);
  const candidates = [...matches].map(uid => players.find(player => player.uid === uid) ?? { uid });
  const filters = localOwnerFilters({ ...local, trackedQuest: null }, null, candidates, records);
  const possible = candidates.filter(player => !filters[player.uid].length);
  return possible.length === 1 ? possible[0].uid : null;
}
