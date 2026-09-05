"""Build resources/completion/completion-data.json: the master lists ("denominators")
for the 100% tracker, keyed by the same internal ids the player save uses.

Sources (game data extracted from the Palworld pak files by two save-editor projects):
  * oMaN-Rod/palworld-save-pal  data/json/*.json     (GPL-3.0; level objects, quests, pals)
  * deafdudecomputers/PalWorldSaveTools resources/game_data/*.json (MIT; areas, fast travel)
plus this repo's own pal name lookup. Every list was checked against a real save: every
obtained id in the save exists in the corresponding list here.

Usage:  python3 build_completion_data.py            (downloads pinned upstream files)
        python3 build_completion_data.py <cache_dir>  (reuse previously downloaded files)
"""
import json
import re
import sys
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent / "resources" / "completion"
OUT = HERE / "completion-data.json"
PAL_NAMES_LUA = HERE.parent / "pal_names_lookup.lua"

PSP = ("oMaN-Rod/palworld-save-pal", "2d244ae9ea12f2f70a66523bf83764185e22fa83", "data/json")
PWST = ("deafdudecomputers/PalWorldSaveTools", "1abd4b11756c9ca7774e9c35400fb8df4d12d966", "resources/game_data")

FILES = {
    "psp/relics.json": (PSP, "relics.json"),
    "psp/fast_travel_points.json": (PSP, "fast_travel_points.json"),
    "psp/notes.json": (PSP, "notes.json"),
    "psp/missions.json": (PSP, "missions.json"),
    "psp/bosses.json": (PSP, "bosses.json"),
    "psp/towers.json": (PSP, "towers.json"),
    "psp/ancient_ruins.json": (PSP, "ancient_ruins.json"),
    "psp/pals.json": (PSP, "pals.json"),
    "psp/l10n/missions.json": (PSP, "l10n/en/missions.json"),
    "psp/l10n/fast_travel_points.json": (PSP, "l10n/en/fast_travel_points.json"),
    "psp/l10n/relics.json": (PSP, "l10n/en/relics.json"),
    "psp/l10n/towers.json": (PSP, "l10n/en/towers.json"),
    "psp/l10n/pals.json": (PSP, "l10n/en/pals.json"),
    "pwst/world_map_areas.json": (PWST, "world_map_areas.json"),
    "pwst/fast_travel_points.json": (PWST, "fast_travel_points.json"),
}

# Journal owners, from the in-game journal titles.
NOTE_OWNERS = [
    ("WorldTreeBoss", "Zenara's Diary"),
    ("WorldTree", "World Tree Records"),
    ("GrassBoss", "Zoe Rayne's Diary"),
    ("ForestBoss", "Lily Everhart's Diary"),
    ("DesertBoss", "Marcus Dryden's Diary"),
    ("SnowBoss", "Victor Ashford's Diary"),
    ("VolcanoBoss", "Axel Travers' Diary"),
    ("SakurajimaBoss", "Saya Kurosaki's Diary"),
    ("VikingBoss", "Bjorn Seligsson's Diary"),
    ("SorajimaBoss", "Auri's Diary"),
    ("Day", "Castaway's Journal"),
]

# Tower flags the save records that have no tower object in the level data.
EXTRA_TOWERS = {
    "BOSS_BATTLE_NAME_KingWhaleBoss": ("Boss_KingWhale", "Panthalus (King Whale)"),
    "BOSS_BATTLE_NAME_WorldTreeMiddleBoss1": ("WorldTree_MiddleBoss_1", "World Tree: Rotmist Root"),
    "BOSS_BATTLE_NAME_WorldTreeMiddleBoss2": ("WorldTree_MiddleBoss_2", "World Tree: Shinespore Root"),
    "BOSS_BATTLE_NAME_WorldTreeMiddleBoss3": ("WorldTree_MiddleBoss_3", "World Tree: Forbidden Laboratory"),
}

# Pals the table marks disabled that the game still registers in the Paldeck.
DISABLED_BUT_IN_PALDECK = {"KingWhale"}

# EPalRelicType enum name for each snake_case relic type key.
RELIC_ENUM = {
    "capture_power": "CapturePower", "hunger_reduction": "HungerReduction", "swim_speed": "SwimSpeed",
    "food_decay_reduction": "FoodDecayReduction", "jump_power": "JumpPower", "glider_speed": "GliderSpeed",
    "climb_speed": "ClimbSpeed", "status_ailment_resist": "StatusAilmentResist",
    "stamina_reduction": "StaminaReduction", "sphere_homing": "SphereHoming", "exp_bonus": "ExpBonus",
    "rainbow_passive_rate": "RainbowPassiveRate", "move_speed": "MoveSpeed",
}


def fetch_all(cache: Path) -> None:
    for rel, ((repo, sha, base), name) in FILES.items():
        target = cache / rel
        if target.exists():
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        url = f"https://raw.githubusercontent.com/{repo}/{sha}/{base}/{name}"
        print("fetch", url)
        with urllib.request.urlopen(url) as response:
            target.write_bytes(response.read())


def load(cache: Path, rel: str):
    return json.loads((cache / rel).read_text(encoding="utf-8"))


def pal_names() -> dict[str, str]:
    text = PAL_NAMES_LUA.read_text(encoding="utf-8")
    return dict(re.findall(r'^\s*([A-Za-z0-9_]+)\s*=\s*"([^"]*)"', text, re.M))


def humanize(identifier: str) -> str:
    text = re.sub(r"([a-z0-9])([A-Z])", r"\1 \2", identifier.replace("_", " "))
    return re.sub(r"\s+", " ", text).strip()


def coords(entry: dict) -> list[int]:
    return [round(entry["x"]), round(entry["y"]), round(entry.get("z", 0))]


def note_name(note_id: str) -> str:
    for prefix, owner in NOTE_OWNERS:
        if note_id.startswith(prefix):
            rest = note_id[len(prefix):]
            if prefix == "Day":
                label = "day ??" if rest == "-xx" else f"day {rest.replace('-', ', part ')}"
                return f"{owner}, {label}"
            return f"{owner} {rest}" if rest else owner
    return humanize(note_id)


def build(cache: Path) -> dict:
    names = pal_names()
    l10n_pals = load(cache, "psp/l10n/pals.json")

    def pal_name(pal_id: str) -> str:
        base = pal_id
        for prefix in ("BOSS_", "Boss_", "PREDATOR_"):
            if base.startswith(prefix):
                base = base[len(prefix):]
        entry = l10n_pals.get(base) or l10n_pals.get(pal_id)
        if entry and entry.get("localized_name"):
            return entry["localized_name"]
        found = names.get(base) or names.get(pal_id)
        if found:
            return re.sub(r" \((Boss|Predator)\)$", "", found)
        return humanize(base)

    # Effigies: one entry per level object, typed.
    relics_raw = load(cache, "psp/relics.json")
    relic_l10n = load(cache, "psp/l10n/relics.json")
    type_order = [key for key in relic_l10n if any(v["relic_type"] == key for v in relics_raw.values())]
    class_pal = {}
    for value in relics_raw.values():
        match = re.match(r"BP_LevelObject_Relic_?([A-Za-z0-9]*)_C$", value["class"])
        class_pal.setdefault(value["relic_type"], match.group(1) if match and match.group(1) else "Carbunclo")
    relic_types = []
    for key in type_order:
        pal = class_pal[key]
        relic_types.append({
            "key": key,
            "enum": RELIC_ENUM[key],
            "name": relic_l10n[key]["localized_name"],
            "item": f"{pal_name(pal)} Effigy",
            "pal": pal,
        })
    type_index = {t["key"]: i for i, t in enumerate(relic_types)}
    relics = {guid: [type_index[v["relic_type"]], *coords(v)] for guid, v in sorted(relics_raw.items())}

    # Fast travel points (Great Eagle statues, plus map-unlock points).
    ft_raw = load(cache, "psp/fast_travel_points.json")
    ft_l10n = load(cache, "psp/l10n/fast_travel_points.json")
    ft_pwst = load(cache, "pwst/fast_travel_points.json")
    fast_travel = {}
    for guid, value in sorted(ft_raw.items()):
        name = (ft_l10n.get(guid) or {}).get("localized_name") or (ft_pwst.get(guid) or {}).get("localized_name") or humanize(value.get("id", ""))
        fast_travel[guid] = [name, *coords(value), value.get("id", "")]

    notes = {note_id: [note_name(note_id), *coords(v)] for note_id, v in sorted(load(cache, "psp/notes.json").items())}

    quests_raw = load(cache, "psp/missions.json")
    quests_l10n = load(cache, "psp/l10n/missions.json")
    quests = {}
    for quest_id, value in sorted(quests_raw.items()):
        kind = value["quest_type"].replace("EPalQuestType::", "")
        name = (quests_l10n.get(quest_id) or {}).get("localized_name") or humanize(quest_id)
        entry = [kind, name]
        if value.get("disabled"):
            entry.append(1)
        quests[quest_id] = entry

    bosses = []
    for value in load(cache, "psp/bosses.json").values():
        spawner = value.get("spawner_id")
        if not spawner or value.get("spawn_type") == "predator":
            continue
        character = value.get("character_id") or ""
        # Oil rig "REGION_" spawners pick their boss at runtime and never set a defeat flag
        # (a save with every rig cleared has none of them); they are counted by OilrigClearCount.
        if spawner.startswith("REGION_") or (value["spawn_type"] == "boss" and character in ("", "None")):
            continue
        if value["spawn_type"] == "bounty" or character in ("", "None"):
            name = pal_name(spawner) if spawner.startswith("BOSS_") else humanize(spawner)
        else:
            name = pal_name(character)
        bosses.append([spawner, name, value.get("level") or 0, value["spawn_type"], *coords(value)])
    bosses.sort(key=lambda b: (b[3], b[2], b[1], b[0]))

    towers_raw = load(cache, "psp/towers.json")
    towers_l10n = load(cache, "psp/l10n/towers.json")
    towers = {tid: [(towers_l10n.get(tid) or {}).get("localized_name") or humanize(v.get("boss_type", tid)), *coords(v)] for tid, v in towers_raw.items()}
    by_ft_id = {v["id"]: v for v in ft_pwst.values()}
    for tid, (ft_id, name) in EXTRA_TOWERS.items():
        point = by_ft_id.get(ft_id)
        towers[tid] = [name, *(coords(point) if point else [0, 0, 0])]

    areas = {area: humanize(area) for area in load(cache, "pwst/world_map_areas.json")["areas"]}

    ruins = {guid: coords(v) for guid, v in sorted(load(cache, "psp/ancient_ruins.json").items())}

    # Paldeck: one entry per species/variant. The pal table also holds encounter clones
    # (quest, summon, oil rig and tower copies) that share a deck number; skip those.
    pals = load(cache, "psp/pals.json")
    paldeck = []
    seen = set()
    for raw_id, value in pals.items():
        if not value.get("is_pal"):
            continue
        tribe = value.get("tribe") or raw_id
        index = value.get("pal_deck_index") or 0
        if index <= 0 or tribe.lower() in seen:
            continue
        if re.match(r"^(Quest_|SUMMON_|BOSS_|Boss_|GYM_|RAID_|PREDATOR_)", raw_id) or re.search(r"_(Oilrig|Tower|MAX)$", raw_id):
            continue
        if value.get("disabled") and tribe not in DISABLED_BUT_IN_PALDECK:
            print(f"  skipping disabled pal with deck number: {raw_id} #{index}")
            continue
        seen.add(tribe.lower())
        paldeck.append([tribe, index, pal_name(tribe)])
    paldeck.sort(key=lambda p: (p[1], p[0]))

    return {
        "generated": "2026-09-05",
        "sources": {
            "palworld-save-pal": f"https://github.com/{PSP[0]}/tree/{PSP[1]}/{PSP[2]}",
            "PalWorldSaveTools": f"https://github.com/{PWST[0]}/tree/{PWST[1]}/{PWST[2]}",
        },
        "relicTypes": relic_types,
        "relics": relics,
        "fastTravel": fast_travel,
        "notes": notes,
        "quests": quests,
        "bosses": bosses,
        "towers": towers,
        "areas": areas,
        "ruinPickups": ruins,
        "paldeck": paldeck,
    }


def main() -> None:
    cache = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parent / "sandbox" / "completion_upstream"
    fetch_all(cache)
    data = build(cache)
    OUT.write_text(json.dumps(data, separators=(",", ":"), ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {OUT} ({OUT.stat().st_size // 1024} KB)")
    for key in ("relics", "fastTravel", "notes", "quests", "bosses", "towers", "areas", "ruinPickups", "paldeck"):
        print(f"  {key}: {len(data[key])}")
    print("  relic types:", [(t['key'], sum(1 for r in data['relics'].values() if r[0] == i)) for i, t in enumerate(data['relicTypes'])])


if __name__ == "__main__":
    main()
