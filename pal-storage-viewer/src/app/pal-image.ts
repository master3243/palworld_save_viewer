/** Path of the offline portrait for a Pal; the backend's canonical id wins over the raw save id. */
export function palImagePath(speciesBaseId: string, speciesId: string): string {
  const id = speciesBaseId || imageSpeciesId(speciesId);
  // The completion catalog uses different casing for this one portrait filename.
  const filename = id === 'Blueplatypus' ? 'BluePlatypus' : id;
  return filename ? `assets/pals/${encodeURIComponent(filename)}.pog` : '';
}

/** Strip the boss/quest/summon prefixes and suffixes a save can wrap around a species id. */
export function imageSpeciesId(value: string): string {
  return value
    .replace(/^(?:BOSS_|Boss_|PREDATOR_|POLICE_|RAID_|SUMMON_)/, '')
    .replace(/^Quest_Farmer03_/, '')
    .replace(/_(?:BossRush|Oilrig|Tower|otomo|MAX)$/, '')
    .replace(/_Quest(?:_Enemy|_Friend)?$/, '')
    .replace(/_2$/, '');
}
