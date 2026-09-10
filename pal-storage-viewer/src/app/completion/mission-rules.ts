/**
 * Entries outside the tracked 1.0 main chain. Keep them in the raw catalog so
 * older save flags remain recognized, but do not mix them into story completion.
 * Quest-manager extraction: https://www.palworld.tools/quests
 * Main_DefeatWorldTreeMiddleBoss remains counted: absence in our sample does not
 * establish that "Path to the Abyss" is obsolete or completed by another mission.
 */
export const UNTRACKED_MAIN_QUESTS = new Set([
  'Main_BaseCampLevel', 'Main_BeginAdventure', 'Main_BuildHatchingMachine',
  'Main_BuildPalBox', 'Main_BuildWorkBench_Old', 'Main_Capture30Pal',
  'Main_CaptureDeerGround', 'Main_CapturePal', 'Main_CaptureSheepBall_Old',
  'Main_CollectCrystal', 'Main_CraftMealPouch', 'Main_CraftPalSphere',
  'Main_CraftShield', 'Main_Craft_PalGear', 'Main_DefeatDungeonBoss',
  'Main_DefeatGrassBoss', 'Main_DefeatWildBoss', 'Main_EquipClothArmor',
  'Main_GainStatus', 'Main_Meal', 'Main_PickupWood', 'Main_UnlockPalBox',
  'Main_UnlockPalSphere', 'Main_UseGlider', 'Main_WorkerPal',
].map(id => id.toLowerCase()));

/**
 * Finite reward series, counted once all their individual rewards are claimed.
 * NPC milestones: https://palworld.gamevault.in/missions/#npc-rewards
 * Critic stages (54 across nine regions): https://paldb.cc/en/Arrogant_Pal_Critic
 * Foodie requests are repeatable and have no corresponding flag series here;
 * their completion continues to require an explicit completed mission flag.
 */
export const QUEST_REWARDS = new Map<string, { field: 'npc_achievements' | 'pal_display'; ids: string[] }>();
for (const [quest, prefix, stages] of [
  ['Sub_BossDefeatReward', 'BossDefeat', 6],
  ['Sub_PalCaptureCountReward', 'PalCapture', 10],
  ['Sub_PaldexReward', 'PalDex', 10],
] as const) {
  QUEST_REWARDS.set(quest.toLowerCase(), {
    field: 'npc_achievements',
    ids: Array.from({ length: stages }, (_, i) => `${prefix}_${i + 1}`.toLowerCase()),
  });
}
for (const area of 'ABCDEFGHI') {
  QUEST_REWARDS.set(`sub_paldisplay_${area.toLowerCase()}_01`, {
    field: 'pal_display',
    ids: Array.from({ length: 6 }, (_, i) => `area_${area.toLowerCase()}1_${i + 1}`),
  });
}
