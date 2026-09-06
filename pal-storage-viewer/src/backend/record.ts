/**
 * One pal record from a PalIndividualCharacterSaveParameter block. Properties the
 * file omits stay null/empty: Level.sav
 * skips values still at their default, and we report only what is in the file.
 */
import {
  PropertyDict, PropertyValue, SaveBuffer, asDict, enumShort, findPropertyStart, guidOrNull,
  readBool, readByte, readDateTime, readEnum, readEnumArray, readFixedPoint64, readFloat, readGuid, readInt,
  readInt64, readName, readNameArray, readStr, readStructArrayProperty, readStructProperty, readUInt16,
  readVector, validatedPropertyNames, indexProperties
} from './gvas';
import { Lookups, WORK_KEYS } from './lookups';
import { DerivedStats, deriveStats } from './stats';

export interface Identity {
  instance_id: string | null;
  instance_player_uid: string | null;
  debug_name: string;
}

export interface FoodRegene {
  item_id: PropertyValue | undefined;
  effect_time: PropertyValue | undefined;
  remaining_time: PropertyValue | undefined;
  effect_parameters: PropertyValue[];
}

export interface Placement {
  location: string;
  detail: string;
}

/** Nested record shape; flattening to table rows happens in one place. */
export interface PalRecord {
  storage_index: number;
  identity: Identity;
  pal_box: { container_id: string | null; slot_index: PropertyValue | undefined };
  item_container_id: string | null;
  pal_name: string;
  pal_variant: string;
  species_id: string;
  species_base_id: string;
  unique_npc_id: string | null;
  gender: string;
  nickname: string;
  filtered_nickname: string;
  level: number | null;
  exp: number | null;
  rank: number | null;
  rank_up_exp: number | null;
  unused_status_points: number | null;
  soul_ranks: { hp: number | null; attack: number | null; defense: number | null; craft_speed: number | null };
  ivs: { hp: number | null; attack: number | null; defense: number | null };
  needs: {
    hp: number | null; shield_hp: number | null; full_stomach: number | null; sanity: number | null;
    hunger_type: string; physical_health: string; worker_sick: string;
  };
  flags: Record<string, boolean | null>;
  favorite_index: number | null;
  voice_id: number | null;
  skin_name: string | null;
  passive_skill_ids: string[];
  skills: string[];
  skill_ranks: (number | null)[];
  skill_colors: string[];
  active_skill_ids: string[];
  combat_moves: string[];
  mastered_skill_ids: string[];
  learned_moves: string[];
  friendship: { points: number | null; otomo_seconds: number | null; active_otomo_seconds: number | null; basecamp_seconds: number | null };
  /** Stats the game computes from the record and species data (see stats.ts). */
  derived: DerivedStats;
  ownership: {
    owned_time: number | null; owner_player_uid: string | null; old_owner_player_uids: PropertyValue[];
    last_nickname_modifier_player_uid: string | null;
  };
  arena: {
    rank_points: number | null;
    restore: {
      valid: PropertyValue | undefined; hp: PropertyValue | undefined; full_stomach: PropertyValue | undefined;
      sanity: PropertyValue | undefined; worker_sick: PropertyValue | undefined;
      food_status_effect_item: PropertyValue | undefined; food_status_effect_timer: PropertyValue | undefined;
      food_regene: FoodRegene; food_full_stomach_keep_item: PropertyValue | undefined;
      food_full_stomach_keep_timer: PropertyValue | undefined;
    };
  };
  base_camp_event: { type: string; progress_time: number | null };
  status_points: { got: Record<string, PropertyValue>; got_ex: Record<string, PropertyValue> };
  food_regene: FoodRegene;
  skin_applied_character_id: string | null;
  expedition_map_object_instance_id: string | null;
  timers: {
    pal_revive: number | null; partner_skill_cooldown_max: number | null; partner_skill_last_used_time: number | null;
    food_with_status_effect: number | null; food_with_full_stomach_keep: number | null;
  };
  food: { status_effect_item: string | null; full_stomach_keep_item: string | null };
  work: { current_suitability: string; off_suitability_list: PropertyValue[]; add_ranks: Record<string, PropertyValue>[]; overflow_granted_ranks: Record<string, PropertyValue>[] };
  /** Element icon indexes of the species (see ELEMENT_NAMES); empty when unknown. */
  elements: number[];
  /** Work rank per suitability in WORK_KEYS order: the species' base rank plus ranks gained by this pal. */
  work_ranks: number[];
  /** Ranks this pal gained on top of its species (condensing, handbooks), in WORK_KEYS order. */
  work_bonus_ranks: number[];
  location: { last_jumped: { x: number; y: number; z: number } | null };
  migration: { exp_table_version: number | null };
  raw_property_names: string[];
  /* Filled in by combine: */
  placement?: Placement;
  owner_name?: string;
  save?: string;
  save_id?: string;
  source_file?: string;
  source_kind?: string;
}

const STATUS_POINT_NAMES: Record<string, string> = {
  '最大HP': 'max_hp',
  '最大SP': 'max_sp',
  '攻撃力': 'attack',
  '防御力': 'defense',
  '所持重量': 'carry_weight',
  '捕獲率': 'capture_rate',
  '作業速度': 'work_speed',
};

function statusPointsDict(items: PropertyValue[]): Record<string, PropertyValue> {
  const out: Record<string, PropertyValue> = {};
  for (const item of items) {
    if (!item || typeof item !== 'object' || Array.isArray(item) || item instanceof Uint8Array) continue;
    const dict = item as PropertyDict;
    const name = typeof dict['StatusName'] === 'string' ? dict['StatusName'] : String(dict['StatusName']);
    out[STATUS_POINT_NAMES[name] ?? name] = dict['StatusPoint'] ?? null;
  }
  return out;
}

function suitabilityRankItems(items: PropertyValue[]): Record<string, PropertyValue>[] {
  const out: Record<string, PropertyValue>[] = [];
  for (const item of items) {
    if (!item || typeof item !== 'object' || Array.isArray(item) || item instanceof Uint8Array) continue;
    const mapped: Record<string, PropertyValue> = {};
    for (const [key, value] of Object.entries(item as PropertyDict)) mapped[key] = (enumShort(value) ?? null) as PropertyValue;
    out.push(mapped);
  }
  return out;
}

export function foodRegeneInfo(info: PropertyValue | undefined): FoodRegene {
  const dict = asDict(info);
  const params = dict['RegeneEfectParameters'];
  return {
    item_id: dict['ItemId'],
    effect_time: dict['EffectTime'],
    remaining_time: dict['RemainingTime'],
    effect_parameters: Array.isArray(params) ? params : [],
  };
}

/**
 * Read one pal from the block [start, end) of `buf`. `identity` overrides the InstanceId
 * wrapper (Level.sav keeps it in the map key). Returns null for an empty slot.
 */
export function buildRecord(
  buf: SaveBuffer,
  start: number,
  end: number,
  storageIndex: number,
  lookups: Lookups,
  identity: Identity | null = null,
  /** Where the block's tagged properties begin (after any struct header at `start`). */
  propertyListStart: number = start
): PalRecord | null {
  // Fast path: the block's own top-level tags. Fallback: a byte search, which also
  // reaches nested labels when a top-level one is absent.
  const index = indexProperties(buf, propertyListStart, end);
  const prop = (label: string) => index.get(label) ?? findPropertyStart(buf, label, start, end);

  const characterId = readName(buf, prop('CharacterID')) ?? '';
  if (!characterId || characterId === 'None') return null;

  const [palName, palVariant] = lookups.palDisplayName(characterId);
  const activeSkillIds = readEnumArray(buf, prop('EquipWaza'), 'EPalWazaID::');
  const masteredSkillIds = readEnumArray(buf, prop('MasteredWaza'), 'EPalWazaID::');
  const passiveSkillIds = readNameArray(buf, prop('PassiveSkillList'));
  const passiveRanks = passiveSkillIds.map((id) => lookups.passiveRanks.get(id.toLowerCase()) ?? null);

  if (identity === null) {
    const instance = asDict(readStructProperty(buf, prop('InstanceId')));
    identity = {
      instance_id: guidOrNull(instance['InstanceId']),
      instance_player_uid: guidOrNull(instance['PlayerUId']),
      debug_name: typeof instance['DebugName'] === 'string' ? instance['DebugName'] : '',
    };
  }
  const slotId = asDict(readStructProperty(buf, prop('SlotId')));
  const itemContainer = asDict(readStructProperty(buf, prop('ItemContainerId')));
  const workOption = asDict(readStructProperty(buf, prop('WorkSuitabilityOptionInfo')));
  const arenaRestore = asDict(readStructProperty(buf, prop('ArenaRestoreParameter')));
  const offList = workOption['OffWorkSuitabilityList'];
  const addRanks = suitabilityRankItems(readStructArrayProperty(buf, prop('GotWorkSuitabilityAddRankList')));
  const traits = lookups.traitsFor(characterId);
  const baseRanks = WORK_KEYS.map((_, index) => traits?.w[index] ?? 0);
  const workBonus = WORK_KEYS.map((key) => {
    let bonus = 0;
    for (const item of addRanks) {
      if (item['WorkSuitability'] === key && typeof item['Rank'] === 'number') bonus += item['Rank'];
    }
    return bonus;
  });
  // Condensing: the stars go round the species' suitabilities from the highest down (ties: the one
  // listed last in the game's order), one rank each, starting over once every suitability got one.
  // A single-suitability Pal therefore gets all four stars on it (4-star Omascul: Gathering 5 -> 9).
  const stars = Math.max(0, Math.min(4, (readByte(buf, prop('Rank')) ?? 1) - 1));
  const byLevel = baseRanks.map((rank, index) => ({ rank, index })).filter((entry) => entry.rank > 0).sort((a, b) => b.rank - a.rank || b.index - a.index);
  for (let star = 0; star < stars && byLevel.length; star++) workBonus[byLevel[star % byLevel.length].index] += 1;
  const workRanks = WORK_KEYS.map((_, index) => baseRanks[index] + workBonus[index]);
  const derived = deriveStats({
    species_id: characterId,
    level: readByte(buf, prop('Level')),
    exp: readInt64(buf, prop('Exp')),
    rank: readByte(buf, prop('Rank')),
    ivs: { hp: readByte(buf, prop('Talent_HP')), attack: readByte(buf, prop('Talent_Shot')), defense: readByte(buf, prop('Talent_Defense')) },
    soul_ranks: {
      hp: readByte(buf, prop('Rank_HP')), attack: readByte(buf, prop('Rank_Attack')),
      defense: readByte(buf, prop('Rank_Defence')), craft_speed: readByte(buf, prop('Rank_CraftSpeed')),
    },
    passive_skill_ids: passiveSkillIds,
    active_skill_ids: activeSkillIds,
    mastered_skill_ids: masteredSkillIds,
    friendship_points: readInt(buf, prop('FriendshipPoint')),
    food_item: readName(buf, prop('FoodWithStatusEffect')),
    food_seconds_left: readInt(buf, prop('Tiemr_FoodWithStatusEffect')),
  }, lookups);

  return {
    storage_index: storageIndex,
    identity,
    pal_box: {
      container_id: guidOrNull(asDict(slotId['ContainerId'])['ID']),
      slot_index: slotId['SlotIndex'],
    },
    item_container_id: guidOrNull(itemContainer['ID']),
    pal_name: palName,
    pal_variant: palVariant,
    species_id: characterId,
    species_base_id: lookups.canonicalSpeciesId(characterId),
    unique_npc_id: readName(buf, prop('UniqueNPCID')),
    gender: readEnum(buf, prop('Gender'), 'EPalGenderType::'),
    nickname: readStr(buf, prop('NickName')),
    filtered_nickname: readStr(buf, prop('FilteredNickName')),
    level: readByte(buf, prop('Level')),
    exp: readInt64(buf, prop('Exp')),
    rank: readByte(buf, prop('Rank')),
    rank_up_exp: readUInt16(buf, prop('RankUpExp')),
    unused_status_points: readUInt16(buf, prop('UnusedStatusPoint')),
    soul_ranks: {
      hp: readByte(buf, prop('Rank_HP')),
      attack: readByte(buf, prop('Rank_Attack')),
      defense: readByte(buf, prop('Rank_Defence')),
      craft_speed: readByte(buf, prop('Rank_CraftSpeed')),
    },
    ivs: {
      hp: readByte(buf, prop('Talent_HP')),
      attack: readByte(buf, prop('Talent_Shot')),
      defense: readByte(buf, prop('Talent_Defense')),
    },
    needs: {
      hp: readFixedPoint64(buf, prop('Hp')),
      shield_hp: readFixedPoint64(buf, prop('ShieldHP')),
      full_stomach: readFloat(buf, prop('FullStomach')),
      sanity: readFloat(buf, prop('SanityValue')),
      hunger_type: readEnum(buf, prop('HungerType'), 'EPalStatusHungerType::'),
      physical_health: readEnum(buf, prop('PhysicalHealth'), 'EPalStatusPhysicalHealthType::'),
      worker_sick: readEnum(buf, prop('WorkerSick'), 'EPalBaseCampWorkerSickType::'),
    },
    flags: {
      is_lucky: readBool(buf, prop('IsRarePal')),
      is_awakening: readBool(buf, prop('bIsAwakening')),
      is_player: readBool(buf, prop('IsPlayer')),
      allow_base_camp_battle: readBool(buf, prop('bAllowBaseCampBattle')),
      applied_death_penalty: readBool(buf, prop('bAppliedDeathPenarty')),
      apply_shield_damage: readBool(buf, prop('bApplyShieldDamage')),
      enable_player_respawn_in_hardcore: readBool(buf, prop('bEnablePlayerRespawnInHardcore')),
      favorite_changed_by_friendship: readBool(buf, prop('bFavoriteChangedByFriendship')),
      disable_sale_in_pal_lost: readBool(buf, prop('bDisableSaleInPalLost')),
      excluded_from_team_mission: readBool(buf, prop('bIsExcludedFromTeamMission')),
      imported_character: readBool(buf, prop('bImportedCharacter')),
    },
    favorite_index: readByte(buf, prop('FavoriteIndex')),
    voice_id: readByte(buf, prop('VoiceID')),
    skin_name: readName(buf, prop('SkinName')),
    passive_skill_ids: passiveSkillIds,
    skills: passiveSkillIds.map((id) => lookups.passiveSkills.get(id) ?? id),
    skill_ranks: passiveRanks,
    skill_colors: passiveRanks.map((rank) => Lookups.passiveColorFromRank(rank)),
    active_skill_ids: activeSkillIds,
    combat_moves: activeSkillIds.map((id) => lookups.activeSkills.get(id) ?? id),
    mastered_skill_ids: masteredSkillIds,
    learned_moves: masteredSkillIds.map((id) => lookups.activeSkills.get(id) ?? id),
    friendship: {
      points: readInt(buf, prop('FriendshipPoint')),
      otomo_seconds: readInt(buf, prop('FriendshipOtomoSec')),
      active_otomo_seconds: readInt(buf, prop('FriendshipActiveOtomoSec')),
      basecamp_seconds: readInt(buf, prop('FriendshipBasecampSec')),
    },
    derived,
    ownership: {
      owned_time: readDateTime(buf, prop('OwnedTime')),
      owner_player_uid: readGuid(buf, prop('OwnerPlayerUId')),
      old_owner_player_uids: readStructArrayProperty(buf, prop('OldOwnerPlayerUIds')),
      last_nickname_modifier_player_uid: readGuid(buf, prop('LastNickNameModifierPlayerUid')),
    },
    arena: {
      rank_points: readInt(buf, prop('ArenaRankPoint')),
      restore: {
        valid: arenaRestore['bValid'],
        hp: arenaRestore['Hp'],
        full_stomach: arenaRestore['FullStomach'],
        sanity: arenaRestore['SanityValue'],
        worker_sick: enumShort(arenaRestore['WorkerSick']),
        food_status_effect_item: arenaRestore['FoodWithStatusEffect'],
        food_status_effect_timer: arenaRestore['Tiemr_FoodWithStatusEffect'],
        food_regene: foodRegeneInfo(arenaRestore['FoodRegeneEffectInfo']),
        food_full_stomach_keep_item: arenaRestore['FoodWithFullStomachKeep'],
        food_full_stomach_keep_timer: arenaRestore['Tiemr_FoodWithFullStomachKeep'],
      },
    },
    base_camp_event: {
      type: readEnum(buf, prop('BaseCampWorkerEventType'), 'EPalBaseCampWorkerEventType::'),
      progress_time: readFloat(buf, prop('BaseCampWorkerEventProgressTime')),
    },
    status_points: {
      got: statusPointsDict(readStructArrayProperty(buf, prop('GotStatusPointList'))),
      got_ex: statusPointsDict(readStructArrayProperty(buf, prop('GotExStatusPointList'))),
    },
    food_regene: foodRegeneInfo(readStructProperty(buf, prop('FoodRegeneEffectInfo'))),
    skin_applied_character_id: guidOrNull(readGuid(buf, prop('SkinAppliedCharacterId'))),
    expedition_map_object_instance_id: guidOrNull(readGuid(buf, prop('MapObjectConcreteInstanceIdAssignedToExpedition'))),
    timers: {
      pal_revive: readFloat(buf, prop('PalReviveTimer')),
      partner_skill_cooldown_max: readFloat(buf, prop('PartnerSkillCoolDownTimeMax')),
      partner_skill_last_used_time: readDateTime(buf, prop('PartnerSkillLastUsedTime')),
      food_with_status_effect: readInt(buf, prop('Tiemr_FoodWithStatusEffect')),
      food_with_full_stomach_keep: readInt(buf, prop('Tiemr_FoodWithFullStomachKeep')),
    },
    food: {
      status_effect_item: readName(buf, prop('FoodWithStatusEffect')),
      full_stomach_keep_item: readName(buf, prop('FoodWithFullStomachKeep')),
    },
    work: {
      current_suitability: readEnum(buf, prop('CurrentWorkSuitability'), 'EPalWorkSuitability::'),
      off_suitability_list: (Array.isArray(offList) ? offList : []).map((value) => (enumShort(value) ?? null) as PropertyValue),
      add_ranks: addRanks,
      overflow_granted_ranks: suitabilityRankItems(readStructArrayProperty(buf, prop('WorkSuitabilityOverflowGrantedRankList'))),
    },
    elements: traits?.e ?? [],
    work_ranks: workRanks,
    work_bonus_ranks: workBonus,
    location: { last_jumped: readVector(buf, prop('LastJumpedLocation')) },
    migration: { exp_table_version: readByte(buf, prop('ExpTableMigrationVersion')) },
    raw_property_names: validatedPropertyNames(buf, start, end),
  };
}

