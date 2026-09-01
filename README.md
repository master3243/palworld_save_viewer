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
