# Palworld Save Viewer

A local viewer for your Palworld save files that lists every Pal you own with all their stats in one searchable table.

Drop a save file/folder to see all owned Pals: party Pals, Pal Box, base Pals, and dimensional storage.

# BROWSER VERSION: https://master3243.github.io/palworld_save_viewer/

## How do I use it?

Simply open the browser a click the "demo" button (to load my personal save file).

If you want to actually use it, drop your save file/folder to see all the Pals with their stats.

For Steam: the save folder is located at:

```
%LOCALAPPDATA%\Pal\Saved\SaveGames\IDprofile\IDworld\
```

Where `IDprofile` and `IDworld` are long random numbers. Inside it, `Level.sav` holds party, Pal Box and base Pals, `Players\xxx.sav` tells which container is whose, and `Players\xxx_dps.sav` is the dimensional storage.

You can also drop single files, and add files from other worlds later to compare them in one table. Or choose the demo save file (my personal dimensional storage).

## Can you fix X bug or implement Y feature?

The project is open source here. Open an issue there and I will take a look. It also helps to include the save file that shows the bug/feature (if the my demo save file does not already do so).

## Will this steal my save data?

No, that's impossible. The website runs completely inside your browser and there is no backend (check the network traffic yourself).

The codebase is open source here. It is hosted on GitHub Pages, which can only serve static websites that run entirely in your browser.

## Will this corrupt my save file?

No, that's impossible. The browser can only read files, it can't edit/write files.

The tool is read-only, you can download a .csv if you want a local csv copy of what the website shows.

## Can I contribute a bug fix or a new feature?

The project is open source here and I welcome fixes and features (please no AI slop).

## Can I donate?

No. Donate to a charity instead.

I only created this tool for my own use, but I was told it was useful, so now it is public.

## Why did you make this?

I was extremely frustrated with the in-game search lacking many criteria I needed, and I also wanted to search across multiple save files at once so I made this tool.

I reached a tipping point when I was farming a specific endgame party with perfect stats, accidentally sent a perfect Pal to the dimensional storage, and then wasted an hour going insane trying to find it (never again...)

It also literally took less time to make the first version of this tool than it took to find that one Pal.

## Resources Used

Resources used while building the save decoder

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

## Save files supported

Dropping a whole world save folder onto the viewer provides the most complete view as it automatically decodes all relevant files (everything is decoded in the browser, nothing is uploaded).

| File | Where it lives | What it contributes |
| --- | --- | --- |
| `Level.sav` | world folder | Every Pal in the world: party, Pal Box and base workers, plus base camps and player names |
| `Players/<uid>.sav` | world folder | Which container is that player's party and which is their Pal Box |
| `Players/<uid>_dps.sav` | world folder | Dimensional Pal Storage (up to 9,600 Pals) |
| `LevelMeta.sav` | world folder | World name (used to label the save) |
| `LocalData.sav`, `WorldOption.sav` | world folder | Skipped, they contain no Pals |

Files from different worlds can be loaded side by side and the table will show which save file each Pal belongs to.
