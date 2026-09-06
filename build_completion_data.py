"""Build resources/completion/completion-data.json: the master lists ("denominators")
for the 100% tracker, keyed by the same internal ids the player save uses.

Sources (game data extracted from the Palworld pak files by three save-editor projects):
  * oMaN-Rod/palworld-save-pal  data/json/*.json     (GPL-3.0; level objects, quests, pals,
    technologies, lab research, items)
  * deafdudecomputers/PalWorldSaveTools resources/game_data/*.json (MIT; areas, fast travel
    names, Statue of Power rank table)
  * KrisCris/Palworld-Pal-Editor assets/data/skin_data.json (GPL-3.0; pal skins)
plus this repo's own pal name lookup and the paldb.cc map dumps. Every list was checked against a real save: every
obtained id in the save exists in the corresponding list here.

Usage:  python3 build_completion_data.py            (downloads pinned upstream files)
        python3 build_completion_data.py <cache_dir>  (reuse previously downloaded files)
"""
import json
import re
import sys
import urllib.request
from pathlib import Path

from clean_paldb_map_dump import reduce_all

HERE = Path(__file__).resolve().parent / "resources" / "completion"
# Hand-collected lists that no extraction project provides
EXTRA_SOURCES = Path(__file__).resolve().parent / "completion_sources"
OUT = HERE / "completion-data.json"
PAL_NAMES_LUA = HERE.parent / "pal_names_lookup.lua"

PSP = ("oMaN-Rod/palworld-save-pal", "2d244ae9ea12f2f70a66523bf83764185e22fa83", "data/json")
PWST = ("deafdudecomputers/PalWorldSaveTools", "1abd4b11756c9ca7774e9c35400fb8df4d12d966", "resources/game_data")
KC = ("KrisCris/Palworld-Pal-Editor", "3efb2d4b5d1f5710ee672d449b5162fe63745229", "src/palworld_pal_editor/assets/data")
UPSTREAMS = {"palworld-save-pal": PSP, "PalWorldSaveTools": PWST, "Palworld-Pal-Editor": KC}

FILES = {
    "psp/ancient_ruins.json": (PSP, "ancient_ruins.json"),
    "psp/bosses.json": (PSP, "bosses.json"),
    "psp/fast_travel_points.json": (PSP, "fast_travel_points.json"),
    "psp/items.json": (PSP, "items.json"),
    "psp/l10n/fast_travel_points.json": (PSP, "l10n/en/fast_travel_points.json"),
    "psp/l10n/items.json": (PSP, "l10n/en/items.json"),
    "psp/l10n/lab_research.json": (PSP, "l10n/en/lab_research.json"),
    "psp/l10n/missions.json": (PSP, "l10n/en/missions.json"),
    "psp/l10n/pals.json": (PSP, "l10n/en/pals.json"),
    "psp/l10n/relics.json": (PSP, "l10n/en/relics.json"),
    "psp/l10n/technologies.json": (PSP, "l10n/en/technologies.json"),
    "psp/l10n/towers.json": (PSP, "l10n/en/towers.json"),
    "psp/lab_research.json": (PSP, "lab_research.json"),
    "psp/missions.json": (PSP, "missions.json"),
    "psp/notes.json": (PSP, "notes.json"),
    "psp/pals.json": (PSP, "pals.json"),
    "psp/relics.json": (PSP, "relics.json"),
    "psp/technologies.json": (PSP, "technologies.json"),
    "psp/towers.json": (PSP, "towers.json"),
    "psp/active_skills.json": (PSP, "active_skills.json"),
    "psp/passive_skills.json": (PSP, "passive_skills.json"),
    "psp/l10n/active_skills.json": (PSP, "l10n/en/active_skills.json"),
    "psp/l10n/passive_skills.json": (PSP, "l10n/en/passive_skills.json"),
    "psp/friendship.json": (PSP, "friendship.json"),
    "psp/exp.json": (PSP, "exp.json"),
    "pwst/characters.json": (PWST, "characters.json"),
    "pwst/foodbuffdata.json": (PWST, "foodbuffdata.json"),
    "pwst/fast_travel_points.json": (PWST, "fast_travel_points.json"),
    "pwst/relic_data.json": (PWST, "relic_data.json"),
    "pwst/world_map_areas.json": (PWST, "world_map_areas.json"),
    "kc/skin_data.json": (KC, "skin_data.json"),
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
    # Final World Tree boss (EPalBossType::WorldTreeBoss); no warp point of its own.
    "BOSS_BATTLE_NAME_WorldTreeBoss": ("", "World Tree: final boss"),
}

# Pals the table marks disabled that the game still registers in the Paldeck.
DISABLED_BUT_IN_PALDECK = {"KingWhale"}

def world_to_map(x: int, y: int) -> list[int]:
    return [round((y - 157935) / 459), round((x + 123930) / 459)]


def map_to_world(map_x: int, map_y: int) -> tuple[int, int]:
    """Inverse of the in-game map readout (map x = (world y - 157935) / 459, map y = (world x + 123930) / 459)."""
    return (map_y * 459 - 123930, map_x * 459 + 157935)


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
                return f"{owner} - Day {'XX' if rest == '-xx' else rest}"
            return f"{owner} - {rest}" if rest else owner
    return humanize(note_id)


def region_key(identifier: str) -> frozenset[str]:
    """Tokens that identify a region in both the game's area ids and paldb's REGION_ ids
    (Grass_001_Crunch vs REGION_Grass_1_Church, PvPIsland_001 vs REGION_PvP_1)."""
    text = identifier.lower().removeprefix("region_")
    for old, new in (("pvpisland", "pvp"), ("crunch", "church"), ("sakurajima_", ""), ("sakurajim_", "")):
        text = text.replace(old, new)
    return frozenset(token.lstrip("0") or "0" for token in re.findall(r"[a-z]+|\d+", text))


def build(cache: Path) -> dict:
    names = pal_names()
    # paldb map markers for every map, merged (ruins, journals and regions never overlap between maps).
    paldb = {"ruins": [], "journals": [], "regions": [], "palCritics": []}
    for data in reduce_all(EXTRA_SOURCES).values():
        for key in paldb:
            paldb[key].extend(data[key])
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
        statue = 1 if "TowerFastTravelPoint" in value.get("class", "") else 0
        fast_travel[guid] = [name, *coords(value), value.get("id", ""), statue]

    # Journals: official titles from the paldb map where it has them (Palpagos), else built from the id.
    journal_titles = {tuple(j["map"]): j["title"] for j in paldb["journals"]}
    notes = {}
    for note_id, value in sorted(load(cache, "psp/notes.json").items()):
        x, y, z = coords(value)
        notes[note_id] = [journal_titles.get(tuple(world_to_map(x, y))) or note_name(note_id), x, y, z]

    quests_raw = load(cache, "psp/missions.json")
    quests_l10n = load(cache, "psp/l10n/missions.json")
    quests = {}
    for quest_id, value in sorted(quests_raw.items()):
        kind = value["quest_type"].replace("EPalQuestType::", "")
        name = (quests_l10n.get(quest_id) or {}).get("localized_name") or humanize(quest_id)
        # Replays repeat an already counted quest; disabled ones never appear in a save.
        disabled = 1 if value.get("disabled") or quest_id.endswith("_Replay") else 0
        location = value.get("location") or {}
        quests[quest_id] = [kind, name, disabled, round(location.get("x") or 0), round(location.get("y") or 0)]

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
        if tid == "BOSS_BATTLE_NAME_WorldTreeBoss":
            name = f"World Tree: {pal_name('GYM_WorldTreeDragon')}"
        towers[tid] = [name, *(coords(point) if point else [0, 0, 0])]

    # Regions: ids from the area table; names and positions from the paldb map where the ids match.
    paldb_regions = {region_key(r["id"]): r for r in paldb["regions"] if r["name"] and r["name"] != "-"}
    areas = {}
    for area in load(cache, "pwst/world_map_areas.json")["areas"]:
        match = paldb_regions.get(region_key(area))
        if match:
            x, y = map_to_world(*match["map"])
            areas[area] = [match["name"], x, y]
        else:
            areas[area] = [humanize(area), 0, 0]
    print(f"  regions named from paldb: {sum(1 for v in areas.values() if v[1] or v[2])} / {len(areas)}")
    print("  paldb regions without an area id:", [r["id"] for k, r in paldb_regions.items() if k not in {region_key(a) for a in areas}])

    # Ruin pickups: coordinates from the level data; what each one holds from the paldb map.
    ruin_items = {tuple(r["map"]): r["item"] for r in paldb["ruins"]}
    ruins = {}
    for guid, value in sorted(load(cache, "psp/ancient_ruins.json").items()):
        x, y, z = coords(value)
        ruins[guid] = [x, y, z, ruin_items.get(tuple(world_to_map(x, y)), "")]

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

    # Technologies: [id, name, required level, ancient?]; the save lists unlocked ids by name.
    tech_raw = load(cache, "psp/technologies.json")
    tech_l10n = load(cache, "psp/l10n/technologies.json")
    technologies = []
    for tech_id, value in tech_raw.items():
        if value.get("disabled"):
            continue
        name = (tech_l10n.get(tech_id) or {}).get("localized_name") or humanize(tech_id)
        technologies.append([tech_id, name, value.get("level_cap") or 0, 1 if value.get("is_boss_technology") else 0])
    technologies.sort(key=lambda t: (t[2], t[3], t[1]))

    # Raid bosses: one entry per summoning slab; the save counts defeats under the slab's item id.
    items_raw = load(cache, "psp/items.json")
    items_l10n = load(cache, "psp/l10n/items.json")
    raids = []
    for item_id, value in items_raw.items():
        if not item_id.startswith("PalSummon_") or value.get("type_a") != "Consume" or value.get("disabled"):
            continue
        ultra = item_id.endswith("_2")
        tribe = item_id[len("PalSummon_"):-2 if ultra else None]
        l10n_entry = l10n_pals.get("RAID_" + tribe) or l10n_pals.get(tribe)
        name = l10n_entry["localized_name"] if l10n_entry and l10n_entry.get("localized_name") else pal_name(tribe)
        if name == humanize(tribe):
            item_name = (items_l10n.get(item_id) or {}).get("localized_name") or name
            name = re.sub(r"(\'s)? ?(Slab|Sigil)( \[Master\])?$", "", item_name).replace(" (Ultra)", "")
        raids.append([item_id, f"{name} (Ultra)" if ultra else name, 1 if ultra else 0])
    raids.sort(key=lambda r: (r[2], r[1]))

    # Statue of Power: effigies needed per rank for each relic type (DT_PlayerStatusRankMasterDataTable).
    statue = {}
    for enum_name, value in load(cache, "pwst/relic_data.json").items():
        statue[enum_name.replace("EPalRelicType::", "")] = value["per_rank"]

    # Guild lab research: [id, name, category, work amount needed]; Level.sav stores work done per id.
    lab_raw = load(cache, "psp/lab_research.json")
    lab_l10n = load(cache, "psp/l10n/lab_research.json")
    research = []
    for research_id, value in lab_raw.items():
        name = (lab_l10n.get(research_id) or {}).get("localized_name") or humanize(research_id)
        research.append([research_id, name, value.get("category") or "", value.get("work_amount") or 0])
    research.sort(key=lambda r: (r[2], r[0]))

    # Pal skins: [id, name, paid?]. Paid ones are tied to a Steam DLC id; invalid rows are placeholders.
    skins = []
    for skin_id, value in load(cache, "kc/skin_data.json").items():
        if value.get("Invalid"):
            continue
        name = (value.get("I18n") or {}).get("en") or humanize(skin_id)
        skins.append([skin_id, name, 1 if value.get("PlatformItemID_Steam", -1) != -1 else 0])
    skins.sort(key=lambda r: (r[2], r[1]))

    # Player level cap: the exp table runs to 100 with placeholder rows past the cap (its
    # curve restarts after 80), so the cap is taken as the highest level a technology needs.
    max_level = max(value.get("level_cap") or 0 for value in tech_raw.values())

    return {
        "generated": "2026-09-05",
        "sources": {name: f"https://github.com/{repo}/tree/{sha}/{folder}" for name, (repo, sha, folder) in UPSTREAMS.items()},
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
        "technologies": technologies,
        "raids": raids,
        "statueRanks": statue,
        "research": research,
        "skins": skins,
        "maxLevel": max_level,
        "palCritics": paldb["palCritics"],
    }


def dump_line_per_entry(data: dict) -> str:
    """JSON with one list/dict entry per line, so git diffs show exactly which entries changed."""
    compact = lambda value: json.dumps(value, separators=(",", ":"), ensure_ascii=False)  # noqa: E731
    lines = ["{"]
    sections = list(data.items())
    for index, (key, value) in enumerate(sections):
        comma = "," if index < len(sections) - 1 else ""
        if isinstance(value, dict) and value and all(isinstance(v, (list, dict)) for v in value.values()):
            entries = list(value.items())
            lines.append(f"{compact(key)}:{{")
            for i, (k, v) in enumerate(entries):
                lines.append(f"{compact(k)}:{compact(v)}{',' if i < len(entries) - 1 else ''}")
            lines.append(f"}}{comma}")
        elif isinstance(value, list) and value and all(isinstance(v, (list, dict)) for v in value):
            lines.append(f"{compact(key)}:[")
            for i, v in enumerate(value):
                lines.append(f"{compact(v)}{',' if i < len(value) - 1 else ''}")
            lines.append(f"]{comma}")
        else:
            lines.append(f"{compact(key)}:{compact(value)}{comma}")
    lines.append("}")
    return "\n".join(lines) + "\n"


# Element order of the game's icon set (T_Icon_element_s_00..08) and work suitability order
# (EPalWorkSuitability, T_icon_palwork_00..12).
ELEMENTS = ["Normal", "Fire", "Water", "Electricity", "Leaf", "Dark", "Dragon", "Earth", "Ice"]
# OilExtraction is still in the enum but no longer in the game, so it is left out.
WORK_KEYS = ["EmitFlame", "Watering", "Seeding", "GenerateElectricity", "Handcraft", "Collection", "Deforest",
             "Mining", "ProductMedicine", "Cool", "Transport", "MonsterFarm"]
TRAITS_OUT = HERE.parent / "pal_traits_lookup.json"


SKILLS_OUT = HERE.parent / "skill_details_lookup.json"

# Placeholders the partner skill text can carry; only the per-rank one can be filled in at runtime.
PARTNER_PLACEHOLDER = re.compile(r"\{([^}]+)\}")
PARTNER_TAG = re.compile(r"\[(?:ICON:[^\]]*|ELEM:([^\]]*)|EFFECT:([^\]]*))\]")


def max_pal_level(cache: Path) -> int:
    return max(value.get("level_cap") or 0 for value in load(cache, "psp/technologies.json").values())


def partner_skill(entry: dict) -> list | None:
    """[name, description or None, per-rank main values or None] from a PalWorldSaveTools character row."""
    name = entry.get("partner_skill")
    if not name:
        return None
    text = PARTNER_TAG.sub(lambda m: m.group(1) or m.group(2) or "", entry.get("description") or "")
    text = re.sub(r"\s+", " ", text).strip()
    values = entry.get("active_skill_main_value") or None
    unresolved = [m for m in PARTNER_PLACEHOLDER.findall(text) if m != "ActiveSkillMainValueByRank" or not values]
    return [name, text if text and not unresolved else None, values]


def build_pal_traits(cache: Path) -> None:
    """resources/pal_traits_lookup.json: per species elements, base work ranks, stat scaling, hunger,
    trust bonus rates and partner skill; plus the trust rank thresholds and the Pal exp table."""
    pals = load(cache, "psp/pals.json")
    characters = {row["asset"]: row for row in load(cache, "pwst/characters.json")["pals"]}
    by_lower = {key.lower(): key for key in characters}
    traits = {}
    for pal_id, value in sorted(pals.items()):
        if not value.get("is_pal"):
            continue
        elements = [ELEMENTS.index(e) for e in value.get("element_types") or [] if e in ELEMENTS]
        work = [(value.get("work_suitability") or {}).get(key) or 0 for key in WORK_KEYS]
        if not elements and not any(work):
            continue
        scaling = value["scaling"]
        entry = {"e": elements, "w": work, "s": [scaling["hp"], scaling["attack"], scaling["defense"]],
                 "f": value.get("max_full_stomach") or 0,
                 "t": [value.get("friendship_hp") or 0, value.get("friendship_shotattack") or 0, value.get("friendship_defense") or 0],
                 "a": value.get("food_amount") or 0,
                 "k": {skill: level for skill, level in (value.get("skill_set") or {}).items()}}
        character = characters.get(by_lower.get(pal_id.lower(), ""))
        if character:
            stats = character["stats"]
            if [stats["hp"], stats["shot_attack"], stats["defense"]] != entry["s"]:
                print(f"  stat scaling differs for {pal_id}: psp {entry['s']} vs pwst {[stats['hp'], stats['shot_attack'], stats['defense']]} (keeping psp)")
            skill = partner_skill(character)
            if skill:
                entry["p"] = skill
        traits[pal_id] = entry
    # Alpha (BOSS_) and other variants only the PalWorldSaveTools table carries; they have their own HP scaling.
    known = {key.lower() for key in traits}
    for asset, character in sorted(characters.items()):
        if asset.lower() in known or not character.get("stats"):
            continue
        stats = character["stats"]
        elements = [ELEMENTS.index(e) for e in (character.get("elements") or {}) if e in ELEMENTS]
        work = [(character.get("work_suitabilities") or {}).get(key) or 0 for key in WORK_KEYS]
        if not elements and not any(work):
            continue
        entry = {"e": elements, "w": work, "s": [stats["hp"], stats["shot_attack"], stats["defense"]],
                 "f": stats.get("max_full_stomach") or 0,
                 "t": [character.get("friendship_hp") or 0, character.get("friendship_shotattack") or 0, character.get("friendship_defense") or 0]}
        skill = partner_skill(character)
        if skill:
            entry["p"] = skill
        traits[asset] = entry
    friendship = sorted((v["rank"], v["required_point"]) for v in load(cache, "psp/friendship.json").values())
    # Food status effects that change the stats the card computes (the save names the dish the Pal ate).
    item_names = load(cache, "psp/l10n/items.json")
    food = {}
    for item_id, value in sorted(load(cache, "pwst/foodbuffdata.json")["food_buffs"].items()):
        effects = [[e["type"], e["value"]] for e in value.get("effects") or [] if e["type"] in ("Attack", "Defense", "WorkSpeed")]
        if effects:
            food[item_id] = [(item_names.get(item_id) or {}).get("localized_name") or item_id, effects]
    exp_table = load(cache, "psp/exp.json")
    exp_totals = [exp_table[str(level)]["PalTotalEXP"] for level in range(1, len(exp_table) + 1)]
    lines = ["{", f'"elements":{json.dumps(ELEMENTS)},', f'"work":{json.dumps(WORK_KEYS)},',
             f'"maxLevel":{max_pal_level(cache)},', f'"friendship":{json.dumps(friendship, separators=(",", ":"))},',
             f'"exp":{json.dumps(exp_totals, separators=(",", ":"))},',
             f'"food":{json.dumps(food, separators=(",", ":"), ensure_ascii=False)},', '"pals":{']
    items = list(traits.items())
    for i, (pal_id, value) in enumerate(items):
        lines.append(f'{json.dumps(pal_id)}:{json.dumps(value, separators=(",", ":"), ensure_ascii=False)}{"," if i < len(items) - 1 else ""}')
    lines += ["}", "}"]
    TRAITS_OUT.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"wrote {TRAITS_OUT} ({len(traits)} pals, {sum(1 for v in traits.values() if v.get('p'))} with partner skill, "
          f"{sum(1 for v in traits.values() if v.get('p') and v['p'][1])} with partner text)")


def build_skill_details(cache: Path) -> None:
    """resources/skill_details_lookup.json: what the in-game skill cards show for active and passive skills."""
    active = {}
    names = load(cache, "psp/l10n/active_skills.json")
    for skill_id, value in sorted(load(cache, "psp/active_skills.json").items()):
        key = skill_id.replace("EPalWazaID::", "")
        effects = [[e["type"], e["value"]] for e in value.get("effects") or [] if e.get("value")]
        text = names.get(skill_id) or {}
        active[key] = [text.get("localized_name") or key, ELEMENTS.index(value["element"]) if value.get("element") in ELEMENTS else -1,
                       value.get("power") or 0, value.get("cool_time") or 0, "M" if value.get("type") == "Melee" else "S", effects,
                       value.get("min_range") or 0, value.get("max_range") or 0, text.get("description") or ""]
    passive = {}
    passive_names = load(cache, "psp/l10n/passive_skills.json")
    for skill_id, value in sorted(load(cache, "psp/passive_skills.json").items()):
        effects = [[e["type"], e["value"]] for e in value.get("effects") or []]
        description = (passive_names.get(skill_id) or {}).get("description") or ""
        if effects or description:
            passive[skill_id] = [effects, description]
    lines = ['{', '"active":{']
    items = list(active.items())
    for i, (key, value) in enumerate(items):
        lines.append(f'{json.dumps(key)}:{json.dumps(value, separators=(",", ":"), ensure_ascii=False)}{"," if i < len(items) - 1 else ""}')
    lines += ['},', '"passive":{']
    items = list(passive.items())
    for i, (key, value) in enumerate(items):
        lines.append(f'{json.dumps(key)}:{json.dumps(value, separators=(",", ":"))}{"," if i < len(items) - 1 else ""}')
    lines += ['}', '}']
    SKILLS_OUT.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"wrote {SKILLS_OUT} ({len(active)} active, {len(passive)} passive)")


def main() -> None:
    cache = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parent / "sandbox" / "completion_upstream"
    fetch_all(cache)
    build_pal_traits(cache)
    build_skill_details(cache)
    data = build(cache)
    OUT.write_text(dump_line_per_entry(data), encoding="utf-8")
    print(f"wrote {OUT} ({OUT.stat().st_size // 1024} KB)")
    for key in ("relics", "fastTravel", "notes", "quests", "bosses", "towers", "areas", "ruinPickups", "paldeck", "technologies", "raids", "research", "skins"):
        print(f"  {key}: {len(data[key])}")
    print("  max level:", data["maxLevel"])
    print("  relic types:", [(t['key'], sum(1 for r in data['relics'].values() if r[0] == i)) for i, t in enumerate(data['relicTypes'])])


if __name__ == "__main__":
    main()
