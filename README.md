# Palworld Save Viewer

## Resources Used

Rresources used while building the save decoder

- [palworld-plm-tools](https://github.com/DYSCreations/palworld-plm-tools)
  - Used as a reference for the Palworld `PlM1` save wrapper and Oodle-compressed `GVAS` payload shape.

- [pyooz](https://pypi.org/project/pyooz/)
  - Used by the Python extractor to decompress the Oodle/Kraken save payload locally.

- [Palworld Server Manager active skills data](https://github.com/amantu-qbit/palworld-server-manager/blob/main/bridge/data/active_skills.json)
  - Map internal combat move IDs to readable names.

- [Palworld Server Manager passive skills data](https://github.com/amantu-qbit/palworld-server-manager/blob/main/bridge/data/passive_skills.json)
  - Map internal passive skill IDs to in-game display names.

- [AdminCommands Pal data](https://github.com/dkoz/AdminCommands/blob/main/AdminCommands/Scripts/enums/paldata.lua)
  - Map internal Pal species IDs to in-game Pal names.

- [PalScouter passive ranks](https://github.com/tanguyannequin-dev/mod-palworld/blob/main/PalScouter/Scripts/passive_ranks.lua)
  - Map passive skill IDs to fixed rank/color tiers.

## Save files

Drop a whole world save folder (or single files) onto the viewer. Files are decoded in the browser; nothing is uploaded.

| File | Where it lives | What it contributes |
| --- | --- | --- |
| `Level.sav` | world folder | Every Pal in the world: party, Pal Box and base workers, plus base camps and player names |
| `Players/<uid>.sav` | world folder | Which container is that player's party and which is their Pal Box |
| `Players/<uid>_dps.sav` | world folder | Dimensional Pal Storage (up to 9,600 Pals) |
| `LevelMeta.sav` | world folder | World name (used to label the save) |
| `LocalData.sav`, `WorldOption.sav` | world folder | Skipped, they contain no Pals |

Files that share a folder are resolved together, so the `Where` column can say Party, Pal Box (page/slot), Base N, or Dimensional Storage. Files from different worlds can be loaded side by side; the `Save` column then shows which world each Pal belongs to.

The Steam save path is `%LOCALAPPDATA%\Pal\Saved\SaveGames\<profile>\<world>\`.
