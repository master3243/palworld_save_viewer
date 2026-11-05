# Live mode

Keeps the app open in a browser tab while you play. Your saves load automatically, the
tracker map shows where you are (an arrow pointing the way you face) and follows you, and
everything you collect is ticked off as the game saves.

A web page cannot keep reading a folder on its own, so a small helper runs on the PC that
has the game. It serves the app and a read-only view of the save folder from one
`http://127.0.0.1` address, so there are no cross-origin or permission problems.

## Run it

Needs [Node.js](https://nodejs.org) 18 or newer. Nothing else to install.

Double-click **`Start live mode.bat`**. It starts the helper and opens the tracker in your
browser; go to **Map**. Keep the black window open while you play and close it to stop.
Double-clicking again while it runs just reopens the page.

From a terminal the same thing is `node live-server.mjs --open` (leave out `--open` to only
print the link, `http://127.0.0.1:8765/`). The options below also work on the `.bat`
(from a terminal, or in a shortcut's Target field).

- With no folder given it uses the most recently saved Steam world under
  `%LOCALAPPDATA%\Pal\Saved\SaveGames`, and switches if another world saves later.
  To pin one world, pass its folder (the one with `Level.sav` and `Players`):
  `node live-server.mjs "C:\Users\you\AppData\Local\Pal\Saved\SaveGames\<id>\<world>"`
- `--port 9000` picks another port.
- `--app <url or folder>` picks which copy of the app to serve. The default is the published
  site, https://master3243.github.io/palworld_save_viewer/. A dev server
  (`--app http://localhost:4200/`) or a build folder (`--app ../dist/pal-storage-viewer/browser`)
  also works. Live mode needs a version of the app that includes `local/live-link.ts`.

## What updates when

Everything follows the game's saves (Palworld autosaves on a timer; the pill in the corner
says how old your position is):

- **Your position** comes from `Players/<uid>.sav` and moves a couple of seconds after each save.
- **The tracker and map icons** (and the Pal list) reload quietly in the background a few
  seconds after each save, with no loading screen. The map keeps its zoom, follow and trip.
- While the **Pal table** is open the reload waits, because it would reset the table's scroll.
  The pill shows **Reload saves** instead; click it, or switch back to the tracker and it
  catches up by itself.
- The crosshair map button turns following on or off. While it is on you can still drag the
  map to look around; it jumps back to you at the next save.

The helper only listens on 127.0.0.1, only serves `Level.sav`, `LevelMeta.sav`,
`LocalData.sav` and `Players/*.sav`, and never writes anything. Game Pass saves (`wgs`) are
not supported yet.

## Files

- `live-server.mjs`: the helper (Node, no dependencies).
- `live-link.ts`: the browser side, built into the app. It is inert unless the URL has
  `?live`. The app only calls `startLiveLink` (app.component.ts) and draws the
  positions (`onLivePlayers` in tracker-map.component.ts).
