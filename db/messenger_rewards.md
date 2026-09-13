# Messenger of Love: denominator 17

The current checklist contains **17 placed, one-time Messenger rewards**.
The count comes from game assets, without using player saves to define it.

- 18 fixed NPC Blueprints explicitly set `bOneShot = true`, each with a distinct
  `CompletedFlagId`.
- 17 of these have an actual `BP_MonoNPCSpawner_C` in the cooked world map.
- `U_Emote_location_G_02` has a one-time definition but no world placement.
  Its ID (`9ca7bee3-4df4-3151-dce7-1c9ab6d71aaf`) is excluded from the denominator.
- The nine `GeneralRnd_A` through `GeneralRnd_I` variants inherit the repeatable
  component defaults and do not define one-time completion IDs. They are not
  nine extra checklist objectives.

This accounts for the different numbers online: 27 NPC variants, 18 fixed
Blueprint definitions, and 17 placed NPCs. The [OP.GG map list](https://op.gg/palworld/npcs/messenger-of-love)
independently lists those same 17 locations. The app uses the actual placed
reward GUIDs, not the number of NPC variants or reward lottery entries.

## Primary source

Downloaded the free [official dedicated-server package](https://docs.palworldgame.com/getting-started/deploy-dedicated-server/)
anonymously from Steam on September 13, 2026:

| Field | Value |
| --- | --- |
| App | 2394010 |
| Linux depot | 2394012 |
| Manifest | 1125678324530723107 |
| Build | 25080279 |
| Archive | `Pal/Content/Paks/Pal-LinuxServer.pak` |
| Archive SHA-1 | `8b09f495efb9837da80cd2a05884aad1ed90d5fa` |
| Reader | CUE4Parse 1.2.2.202607, UE 5.1 |

The archive was read with CUE4Parse; the server was not started. No external
mappings or Oodle library were needed. The source declarations are in
`Pal/Content/Pal/Blueprint/Character/NPC/Normal/Emote/`; each fixed Blueprint's
`BP_NPCEmoteDetectionComponent_GEN_VARIABLE` supplies the reward ID.

A scan of all 77,031 `.uasset` and `.umap` package headers found 40 packages
referencing `Emote_location`. The matching world packages contain exactly 17
Messenger spawners. For each, `UniqueName.Key` identifies the NPC and
`RootComponent` resolves to the scene component with its world position.
The full reference list, original Blueprint exports, relevant spawner/scene
exports, source hashes, and extractor code are preserved in
[raw/messengers.db](../completion_sources/raw/messengers.db), a ZIP archive.
`placements.json` contains the selected spawner/scene exports plus the hash of
the full map JSON they were selected from.

## Rebuilding

[build_messenger_rewards.py](build_messenger_rewards.py) verifies the preserved
source hashes and joins each placed NPC to its one-time Blueprint GUID.
It is called by `build_completion_data.py` and generates `messengers` in
[completion-data.json](../resources/completion/completion-data.json).

To repeat the asset extraction, obtain the pinned depot with DepotDownloader
using `-app 2394010 -depot 2394012 -manifest 1125678324530723107`, restricting
`-filelist` to `Pal/Content/Paks/Pal-LinuxServer.pak`. Extract `extractor/` from
`messengers.db`, build its .NET project, and run:

```text
dotnet Extract.dll <PAK directory> <Blueprint export directory>
dotnet Extract.dll <PAK directory> <map export directory> scan
```

## Save matching and validation

The app reads `RecordData.CompletedEmoteNPCIDArray`, declared `TArray<FGuid>`
in the [public SDK](https://github.com/skript023/Palworld-SDK/blob/16063fcf300da6cfc1e52c7555819382915229e9/SDK/Pal_structs.hpp#L9649).
CUE4Parse's four-word GUID format is regrouped into the app's conventional
8-4-4-4-12 form. Claims are matched case-insensitively to the 17 catalog IDs;
duplicates or unrecognized IDs cannot increase completion. Missing or malformed
data shows `?`, while a recorded empty array means zero claims.

After constructing the catalog, 107 player completion records were checked:
38 contained Messenger rewards and 69 omitted this field. Every recorded reward
ID matched this catalog, with no unknown IDs. One additional file had no player
completion record. Saves were used only for this final validation.

The card now contributes to overall completion and provides claimed/unclaimed
rows, region filters, coordinates, and heart markers on the map. The catalog is
specific to the downloaded build; new game builds should repeat the placement
and Blueprint checks rather than automatically counting every definition.
