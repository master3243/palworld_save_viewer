import csv
import json
import struct
from pathlib import Path

from data_manager import PalStorageDataManager


ROOT = Path(__file__).resolve().parent
SANDBOX_PATH = ROOT / "sandbox"
OUTPUT_PATH = SANDBOX_PATH / "output"
RESOURCES_PATH = ROOT / "resources"
SAVE_PATH = ROOT / "sandbox" / "save" / "world" / "Players" / "00000000000000000000000000000001_dps.sav"
GVAS_PATH = OUTPUT_PATH / "00000000000000000000000000000001_dps.sav.decoded.gvas"
JSON_PATH = OUTPUT_PATH / "pal_storage_pals.json"
CSV_PATH = OUTPUT_PATH / "pal_storage_pals.csv"
CSV_FALLBACK_PATH = OUTPUT_PATH / "pal_storage_pals_with_gender.csv"
ACTIVE_SKILL_LOOKUP_PATH = RESOURCES_PATH / "active_skills_lookup.json"
PASSIVE_SKILL_LOOKUP_PATH = RESOURCES_PATH / "passive_skills_lookup.json"
PASSIVE_RANK_LOOKUP_PATH = RESOURCES_PATH / "passive_ranks_lookup.lua"
PAL_NAME_LOOKUP_PATH = RESOURCES_PATH / "pal_names_lookup.lua"


CSV_FIELDS = [
    "storage_slot",
    "save_id",
    "location",
    "location_detail",
    "save",
    "source_file",
    "source_kind",
    "owner_name",
    "pal_box_slot_index",
    "instance_id",
    "pal_name",
    "pal_variant",
    "species_id",
    "species_base_id",
    "unique_npc_id",
    "gender",
    "nickname",
    "filtered_nickname",
    "level",
    "exp",
    "rank",
    "rank_up_exp",
    "unused_status_points",
    "hp",
    "shield_hp",
    "iv_hp",
    "iv_attack",
    "iv_defense",
    "soul_rank_hp",
    "soul_rank_attack",
    "soul_rank_defense",
    "soul_rank_craft_speed",
    "skills",
    "skill_colors",
    "skill_ranks",
    "passive_skill_ids",
    "combat_moves",
    "active_skill_ids",
    "learned_moves",
    "mastered_skill_ids",
    "full_stomach",
    "sanity",
    "hunger_type",
    "physical_health",
    "worker_sick",
    "is_lucky",
    "is_awakening",
    "is_player",
    "favorite_index",
    "voice_id",
    "skin_name",
    "allow_base_camp_battle",
    "applied_death_penalty",
    "apply_shield_damage",
    "enable_player_respawn_in_hardcore",
    "favorite_changed_by_friendship",
    "disable_sale_in_pal_lost",
    "excluded_from_team_mission",
    "imported_character",
    "friendship_points",
    "friendship_otomo_seconds",
    "friendship_active_otomo_seconds",
    "friendship_basecamp_seconds",
    "owned_time",
    "owner_player_uid",
    "last_nickname_modifier_player_uid",
    "arena_rank_points",
    "pal_revive_timer",
    "partner_skill_cooldown_max",
    "food_with_status_effect_timer",
    "food_with_full_stomach_keep_timer",
    "food_status_effect_item",
    "food_full_stomach_keep_item",
    "current_work_suitability",
    "last_jumped_x",
    "last_jumped_y",
    "last_jumped_z",
    "exp_table_migration_version",
    "instance_player_uid",
    "instance_debug_name",
    "old_owner_player_uids",
    "pal_box_container_id",
    "item_container_id",
    "base_camp_worker_event_type",
    "base_camp_worker_event_progress_time",
    "got_status_points",
    "got_ex_status_points",
    "food_regene_item_id",
    "food_regene_effect_time",
    "food_regene_remaining_time",
    "food_regene_effect_parameters",
    "off_work_suitability_list",
    "work_suitability_add_ranks",
    "work_suitability_overflow_ranks",
    "skin_applied_character_id",
    "expedition_map_object_instance_id",
    "partner_skill_last_used_time",
    "arena_restore_valid",
    "arena_restore_hp",
    "arena_restore_full_stomach",
    "arena_restore_sanity",
    "arena_restore_worker_sick",
    "arena_restore_food_status_effect_item",
    "arena_restore_food_status_effect_timer",
    "arena_restore_food_regene_item_id",
    "arena_restore_food_regene_effect_time",
    "arena_restore_food_regene_remaining_time",
    "arena_restore_food_full_stomach_keep_item",
    "arena_restore_food_full_stomach_keep_timer",
    "raw_property_names",
]


def decompress_save(path):
    raw = Path(path).read_bytes()
    if raw[:4] == b"GVAS":
        return raw
    uncompressed_len, compressed_len = struct.unpack_from("<II", raw, 0)
    if raw[8:12] != b"PlM1":
        raise ValueError(f"Expected PlM1 Oodle save, got {raw[8:12]!r}")

    import ooz

    data = ooz.decompress(raw[12 : 12 + compressed_len], uncompressed_len)
    if data[:4] != b"GVAS":
        raise ValueError("Decoded payload does not start with GVAS")
    return data


def build_manager(resources_path=RESOURCES_PATH):
    resources_path = Path(resources_path)
    return PalStorageDataManager(
        active_skill_lookup=PalStorageDataManager.load_active_skill_lookup(
            resources_path / "active_skills_lookup.json"
        ),
        passive_skill_lookup=PalStorageDataManager.load_passive_skill_lookup(
            resources_path / "passive_skills_lookup.json"
        ),
        passive_rank_lookup=PalStorageDataManager.load_passive_rank_lookup(
            resources_path / "passive_ranks_lookup.lua"
        ),
        pal_lookup=PalStorageDataManager.load_pal_name_lookup(
            resources_path / "pal_names_lookup.lua"
        ),
    )


def extract_decoded_save(decoded_save, resources_path=RESOURCES_PATH):
    manager = build_manager(resources_path)
    return manager.extract_records(decoded_save)


def extract_decoded_save_to_json(decoded_save_path, resources_path=RESOURCES_PATH, flattened=False):
    decoded_save = Path(decoded_save_path).read_bytes()
    result = extract_decoded_save(decoded_save, resources_path)
    records = result["records"]
    if flattened:
        records = [flatten_record(item) for item in records]
    return json.dumps(records)


def extract_save_to_json(save_path=SAVE_PATH, resources_path=RESOURCES_PATH, flattened=False):
    decoded_save = decompress_save(Path(save_path))
    result = extract_decoded_save(decoded_save, resources_path)
    records = result["records"]
    if flattened:
        records = [flatten_record(item) for item in records]
    return json.dumps(records)


PAL_BOX_PAGE_SIZE = 30
SOURCE_KIND_LABELS = {
    "dimensional_storage": "Dimensional storage",
    "level": "World (Level.sav)",
    "player": "Player",
    "level_meta": "World info",
    "world_option": "World options",
    "local_data": "Local data",
    "unknown": "Unknown",
}


def locate_level_record(record, save_set):
    """Decide where a Level.sav pal lives from its container id."""
    container_id = record["pal_box"]["container_id"]
    slot = record["pal_box"]["slot_index"]
    slot_label = f"slot {slot + 1}" if isinstance(slot, int) and slot >= 0 else ""
    if container_id is None:
        return "Unknown", ""
    if container_id in save_set["party_containers"]:
        return "Party", slot_label
    if container_id in save_set["pal_box_containers"]:
        if isinstance(slot, int) and slot >= 0:
            return "Pal Box", f"page {slot // PAL_BOX_PAGE_SIZE + 1}, slot {slot % PAL_BOX_PAGE_SIZE + 1}"
        return "Pal Box", ""
    base = save_set["base_containers"].get(container_id)
    if base:
        loc = base.get("location") or {}
        where = f"x {loc.get('x', 0):.0f}, y {loc.get('y', 0):.0f}" if loc else ""
        return f"Base {base['index']}", ", ".join(part for part in (slot_label, where) if part)
    info = save_set["containers"].get(container_id)
    if info:
        # No player save for this owner: guess from the container size.
        if info["slots"] <= 5:
            return "Party", slot_label
        if isinstance(slot, int) and slot >= 0:
            return "Pal Box", f"page {slot // PAL_BOX_PAGE_SIZE + 1}, slot {slot % PAL_BOX_PAGE_SIZE + 1}"
        return "Pal Box", ""
    return "Other container", slot_label


def save_letter(ordinal):
    """1 -> A, 26 -> Z, 27 -> AA: a short tag to tell saves apart in the table."""
    letters = ""
    while ordinal > 0:
        ordinal, remainder = divmod(ordinal - 1, 26)
        letters = chr(ord("A") + remainder) + letters
    return letters


def save_display_names(sets):
    """Short, distinct labels for each save set. Starts from the world name; only saves
    that would read the same (typical for backups of one world) get the in-game day,
    then the save time, then the folder name added, and only those saves."""

    def folder_tail(folder):
        return folder.rstrip("/").rsplit("/", 1)[-1] if folder else ""

    ordinals = {label: index for index, label in enumerate(sets, start=1)}

    def base_name(label, save_set):
        return save_set["world_name"] or folder_tail(label) or f"Save {ordinals[label]}"

    def level(label, save_set, depth):
        base = base_name(label, save_set)
        parts = [base]
        if depth >= 1 and save_set["in_game_day"] is not None:
            parts.append(f"day {save_set['in_game_day']}")
        if depth >= 2 and save_set["saved_at"]:
            parts.append(save_set["saved_at"].replace("T", " ")[:16])
        tail = folder_tail(label)
        if depth >= 3 and tail and tail != base:
            parts.append(tail)
        if depth >= 4 and label and label != tail:
            parts.append(label)
        return " · ".join(parts)

    depths = {label: 0 for label in sets}
    names = {label: level(label, sets[label], 0) for label in sets}
    for _ in range(5):
        counts = {}
        for name in names.values():
            counts[name] = counts.get(name, 0) + 1
        clashing = [label for label, name in names.items() if counts[name] > 1 and depths[label] < 4]
        if not clashing:
            break
        for label in clashing:
            depths[label] += 1
            names[label] = level(label, sets[label], depths[label])
    seen = {}
    for label, name in list(names.items()):
        seen[name] = seen.get(name, 0) + 1
        if seen[name] > 1:
            names[label] = f"{name} ({seen[name]})"
    return names


# Parsed files keyed by the caller's file key, so adding or removing one file in the
# browser does not re-parse the others. The worker sends a key per file; without keys
# nothing is cached.
PARSE_CACHE = {}
STALE_CACHE_LIMIT = 6


def parse_save_file(entry, manager, progress=None):
    """Decode one save file into a cacheable dict: kind, timestamp and its parsed payload."""
    try:
        data = decompress_save(Path(entry["path"]))
    except Exception as error:  # noqa: BLE001 - report per file, keep going
        return {"error": str(error)}
    kind, class_name = manager.detect_save_kind(data)
    parsed = {
        "kind": kind,
        "class_name": class_name,
        "saved_at": manager.read_save_timestamp(data),
        "payload": None,
    }
    if kind == "dimensional_storage":
        parsed["payload"] = manager.extract_records(data, progress)
    elif kind == "level":
        parsed["payload"] = manager.extract_level_records(data, progress)
    elif kind == "player":
        parsed["payload"] = manager.extract_player_save(data)
    elif kind == "level_meta":
        parsed["payload"] = manager.extract_level_meta(data)
    return parsed


def apply_parsed_file(parsed, source, save_set):
    """Fold one parsed file into its save set and describe it in `source`."""
    kind = parsed["kind"]
    payload = parsed["payload"]
    source["kind"] = kind
    source["class_name"] = parsed["class_name"]
    source["saved_at"] = parsed["saved_at"]
    # Level.sav is the authoritative world clock; other files only fill a gap.
    if source["saved_at"] and (kind == "level" or not save_set["saved_at"]):
        save_set["saved_at"] = source["saved_at"]
    if kind == "dimensional_storage":
        for record in payload["records"]:
            record["_source"] = source
        save_set["dps_records"].extend(payload["records"])
        source["pals"] = payload["occupied_slots"]
        source["total_slots"] = payload["total_storage_slots"]
    elif kind == "level":
        for record in payload["records"]:
            record["_source"] = source
        save_set["level_records"].extend(payload["records"])
        save_set["bases"].extend(payload["bases"])
        save_set["containers"].update(payload["containers"])
        for base in payload["bases"]:
            if base.get("worker_container_id"):
                save_set["base_containers"][base["worker_container_id"]] = base
        for player in payload["players"]:
            if player.get("player_uid"):
                save_set["player_names"][player["player_uid"]] = player.get("name") or ""
        source["pals"] = len(payload["records"])
        source["players"] = len(payload["players"])
        source["bases"] = len(payload["bases"])
        source["skipped"] = payload["skipped"]
    elif kind == "player":
        if payload.get("party_container_id"):
            save_set["party_containers"].add(payload["party_container_id"])
        if payload.get("pal_box_container_id"):
            save_set["pal_box_containers"].add(payload["pal_box_container_id"])
        if payload.get("player_uid"):
            save_set["players"][payload["player_uid"]] = payload
        source["player_uid"] = payload.get("player_uid")
    elif kind == "level_meta":
        save_set["world_name"] = payload.get("world_name") or ""
        save_set["host_player_name"] = payload.get("host_player_name") or ""
        save_set["in_game_day"] = payload.get("in_game_day")
        source.update(payload)
    else:
        source["note"] = "Contains no pals; ignored."


def combine_saves(files, resources_path=RESOURCES_PATH, progress=None):
    """Merge any number of decoded save files into one pal list with a location per pal.

    `files` is a list of {"path": ..., "name": ..., "set": ...}; files that share a `set`
    label (usually the save folder) are resolved against each other.
    `progress(stage, file_index, done, total, found, unit)` reports per-file parsing
    progress; `found` is the number of pals read so far, `unit` is "entries" or "bytes"."""

    def file_progress(index):
        if progress is None:
            return None
        return lambda done, total, found, unit: progress("parse", index, done, total, found, unit)
    manager = build_manager(resources_path)
    sets = {}
    sources = []

    def get_set(label, letter=""):
        save_set = sets.setdefault(label, {
            "label": label,
            "letter": "",
            "world_name": "",
            "host_player_name": "",
            "in_game_day": None,
            "saved_at": "",
            "players": {},
            "player_names": {},
            "party_containers": set(),
            "pal_box_containers": set(),
            "base_containers": {},
            "bases": [],
            "containers": {},
            "dps_records": [],
            "level_records": [],
        })
        if letter and not save_set["letter"]:
            save_set["letter"] = letter
        return save_set

    for file_index, entry in enumerate(files):
        name = entry.get("name") or Path(entry.get("path") or "").name
        save_set = get_set(entry.get("set") or "", entry.get("letter") or "")
        source = {"file": name, "set": save_set["label"], "kind": "unknown", "pals": 0, "note": ""}
        sources.append(source)
        key = entry.get("key")
        parsed = PARSE_CACHE.get(key) if key else None
        if parsed is None:
            if progress:
                progress("start", file_index, 0, 1, 0, "")
            parsed = parse_save_file(entry, manager, file_progress(file_index))
            if key:
                PARSE_CACHE[key] = parsed
        if parsed.get("error"):
            source["note"] = f"Could not decode: {parsed['error']}"
            continue
        apply_parsed_file(parsed, source, save_set)
        if progress:
            progress("done", file_index, 1, 1, source["pals"], "")

    # Keep a few recently removed files so re-adding them is instant, but bound memory.
    live_keys = {entry.get("key") for entry in files if entry.get("key")}
    stale = [key for key in PARSE_CACHE if key not in live_keys]
    for key in stale[: max(0, len(stale) - STALE_CACHE_LIMIT)]:
        del PARSE_CACHE[key]

    if progress:
        progress("combine", len(files), 0, 1, 0, "")
    records = []
    set_summaries = []
    displays = save_display_names(sets)
    for ordinal, (label, save_set) in enumerate(sets.items(), start=1):
        display = displays[label]
        # The browser assigns letters so they stay put when saves are added or removed.
        letter = save_set["letter"] or save_letter(ordinal)
        for record in save_set["level_records"]:
            location, detail = locate_level_record(record, save_set)
            record["placement"] = {"location": location, "detail": detail}
        for record in save_set["dps_records"]:
            record["placement"] = {
                "location": "Dimensional Storage",
                "detail": f"slot {record['storage_index']}",
            }
        for record in save_set["level_records"] + save_set["dps_records"]:
            owner = record["ownership"]["owner_player_uid"]
            record["owner_name"] = save_set["player_names"].get(owner, "") if owner else ""
            record["save"] = display
            record["save_id"] = letter
            record["source_file"] = record["_source"]["file"]
            record["source_kind"] = SOURCE_KIND_LABELS.get(record["_source"]["kind"], record["_source"]["kind"])
            del record["_source"]
            records.append(record)
        set_summaries.append({
            "label": display,
            "letter": letter,
            "folder": label,
            "world_name": save_set["world_name"],
            "host_player_name": save_set["host_player_name"],
            "in_game_day": save_set["in_game_day"],
            "saved_at": save_set["saved_at"],
            "pals": len(save_set["level_records"]) + len(save_set["dps_records"]),
            "bases": [
                {"index": b.get("index"), "location": b.get("location"), "workers": sum(
                    1 for r in save_set["level_records"]
                    if r["pal_box"]["container_id"] == b.get("worker_container_id")
                )}
                for b in save_set["bases"]
            ],
            "players": [
                {"uid": uid, "name": save_set["player_names"].get(uid, "")}
                for uid in sorted(set(save_set["players"]) | set(save_set["player_names"]))
            ],
            "has_level": bool(save_set["level_records"]) or any(
                s["kind"] == "level" and s["set"] == label for s in sources
            ),
            "has_dimensional_storage": any(
                s["kind"] == "dimensional_storage" and s["set"] == label for s in sources
            ),
        })
    for source in sources:
        source["kind_label"] = SOURCE_KIND_LABELS.get(source["kind"], source["kind"])
    return {"records": records, "sources": sources, "sets": set_summaries}


# Flattened keys that depend on which files are loaded together; everything else is
# a property of the pal itself and is encoded once per record, then reused.
DYNAMIC_ROW_KEYS = (
    "save_id",
    "location",
    "location_detail",
    "save",
    "source_file",
    "source_kind",
    "owner_name",
)


def encode_row(item):
    """JSON text for one flattened row. The static part is cached on the record so a
    re-combine (add/remove a file) costs a small dict dump per pal instead of a full one."""
    static = item.get("_flat_json")
    if static is None:
        flat = flatten_record(item)
        for key in DYNAMIC_ROW_KEYS:
            flat.pop(key, None)
        static = json.dumps(flat)[1:-1]
        item["_flat_json"] = static
    dynamic = json.dumps({
        "save_id": item.get("save_id"),
        "location": (item.get("placement") or {}).get("location"),
        "location_detail": (item.get("placement") or {}).get("detail"),
        "save": item.get("save"),
        "source_file": item.get("source_file"),
        "source_kind": item.get("source_kind"),
        "owner_name": item.get("owner_name"),
    })[1:-1]
    return "{" + dynamic + "," + static + "}"


def combine_decoded_saves_to_json(manifest_json, resources_path=RESOURCES_PATH, flattened=True, progress=None):
    import time

    stamps = {"start": time.perf_counter()}
    files = json.loads(manifest_json) if isinstance(manifest_json, str) else list(manifest_json)
    result = combine_saves(files, resources_path, progress)
    stamps["combine"] = time.perf_counter()
    records = result["records"]
    if not flattened:
        return json.dumps({"rows": records, "sources": result["sources"], "sets": result["sets"]})
    encoded = []
    for index, item in enumerate(records):
        if progress and index % 250 == 0:
            progress("flatten", len(files), index, len(records), index, "pals")
        encoded.append(encode_row(item))
    if progress:
        progress("flatten", len(files), len(records), len(records), len(records), "pals")
    stamps["encode"] = time.perf_counter()
    rows_json = ",".join(encoded)
    stamps["join"] = time.perf_counter()
    timing = {
        "combine_ms": round((stamps["combine"] - stamps["start"]) * 1000),
        "encode_ms": round((stamps["encode"] - stamps["combine"]) * 1000),
        "join_ms": round((stamps["join"] - stamps["encode"]) * 1000),
    }
    return (
        '{"rows":[' + rows_json + '],"sources":' + json.dumps(result["sources"])
        + ',"sets":' + json.dumps(result["sets"]) + ',"timing":' + json.dumps(timing) + "}"
    )


def combine_decoded_saves_to_json_bytes(manifest_json, resources_path=RESOURCES_PATH, progress=None):
    """Same as combine_decoded_saves_to_json but as UTF-8 bytes. Pyodide hands a bytes
    object to JavaScript as a zero-copy view, while converting a multi-megabyte str
    takes seconds."""
    return combine_decoded_saves_to_json(manifest_json, resources_path, True, progress).encode("utf-8")


def join_values(values):
    return ", ".join(str(value) for value in values if value is not None)


def join_pairs(mapping):
    return ", ".join(f"{key}={value}" for key, value in (mapping or {}).items())


def join_items(items):
    return ", ".join(
        "/".join(f"{key}={value}" for key, value in item.items()) if isinstance(item, dict) else str(item)
        for item in items or []
    )


def flatten_record(item):
    return {
        "storage_slot": item["storage_index"],
        "save_id": item.get("save_id"),
        "location": (item.get("placement") or {}).get("location"),
        "location_detail": (item.get("placement") or {}).get("detail"),
        "save": item.get("save"),
        "source_file": item.get("source_file"),
        "source_kind": item.get("source_kind"),
        "owner_name": item.get("owner_name"),
        "pal_box_slot_index": item["pal_box"]["slot_index"],
        "instance_id": item["identity"]["instance_id"],
        "pal_name": item["pal_name"],
        "pal_variant": item["pal_variant"],
        "species_id": item["species_id"],
        "species_base_id": item.get("species_base_id"),
        "unique_npc_id": item["unique_npc_id"],
        "gender": item["gender"],
        "nickname": item["nickname"],
        "filtered_nickname": item["filtered_nickname"],
        "level": item["level"],
        "exp": item["exp"],
        "rank": item["rank"],
        "rank_up_exp": item["rank_up_exp"],
        "unused_status_points": item["unused_status_points"],
        "hp": item["needs"]["hp"],
        "shield_hp": item["needs"]["shield_hp"],
        "iv_hp": item["ivs"]["hp"],
        "iv_attack": item["ivs"]["attack"],
        "iv_defense": item["ivs"]["defense"],
        "soul_rank_hp": item["soul_ranks"]["hp"],
        "soul_rank_attack": item["soul_ranks"]["attack"],
        "soul_rank_defense": item["soul_ranks"]["defense"],
        "soul_rank_craft_speed": item["soul_ranks"]["craft_speed"],
        "skills": join_values(item["skills"]),
        "skill_colors": join_values(item["skill_colors"]),
        "skill_ranks": join_values(item["skill_ranks"]),
        "passive_skill_ids": join_values(item["passive_skill_ids"]),
        "combat_moves": join_values(item["combat_moves"]),
        "active_skill_ids": join_values(item["active_skill_ids"]),
        "learned_moves": join_values(item["learned_moves"]),
        "mastered_skill_ids": join_values(item["mastered_skill_ids"]),
        "full_stomach": item["needs"]["full_stomach"],
        "sanity": item["needs"]["sanity"],
        "hunger_type": item["needs"]["hunger_type"],
        "physical_health": item["needs"]["physical_health"],
        "worker_sick": item["needs"]["worker_sick"],
        "is_lucky": item["flags"]["is_lucky"],
        "is_awakening": item["flags"]["is_awakening"],
        "is_player": item["flags"]["is_player"],
        "favorite_index": item["favorite_index"],
        "voice_id": item["voice_id"],
        "skin_name": item["skin_name"],
        "allow_base_camp_battle": item["flags"]["allow_base_camp_battle"],
        "applied_death_penalty": item["flags"]["applied_death_penalty"],
        "apply_shield_damage": item["flags"]["apply_shield_damage"],
        "enable_player_respawn_in_hardcore": item["flags"][
            "enable_player_respawn_in_hardcore"
        ],
        "favorite_changed_by_friendship": item["flags"][
            "favorite_changed_by_friendship"
        ],
        "disable_sale_in_pal_lost": item["flags"]["disable_sale_in_pal_lost"],
        "excluded_from_team_mission": item["flags"]["excluded_from_team_mission"],
        "imported_character": item["flags"]["imported_character"],
        "friendship_points": item["friendship"]["points"],
        "friendship_otomo_seconds": item["friendship"]["otomo_seconds"],
        "friendship_active_otomo_seconds": item["friendship"]["active_otomo_seconds"],
        "friendship_basecamp_seconds": item["friendship"]["basecamp_seconds"],
        "owned_time": item["ownership"]["owned_time"],
        "owner_player_uid": item["ownership"]["owner_player_uid"],
        "last_nickname_modifier_player_uid": item["ownership"][
            "last_nickname_modifier_player_uid"
        ],
        "arena_rank_points": item["arena"]["rank_points"],
        "pal_revive_timer": item["timers"]["pal_revive"],
        "partner_skill_cooldown_max": item["timers"]["partner_skill_cooldown_max"],
        "food_with_status_effect_timer": item["timers"]["food_with_status_effect"],
        "food_with_full_stomach_keep_timer": item["timers"][
            "food_with_full_stomach_keep"
        ],
        "food_status_effect_item": item["food"]["status_effect_item"],
        "food_full_stomach_keep_item": item["food"]["full_stomach_keep_item"],
        "current_work_suitability": item["work"]["current_suitability"],
        "last_jumped_x": (item["location"]["last_jumped"] or {}).get("x"),
        "last_jumped_y": (item["location"]["last_jumped"] or {}).get("y"),
        "last_jumped_z": (item["location"]["last_jumped"] or {}).get("z"),
        "exp_table_migration_version": item["migration"]["exp_table_version"],
        "instance_player_uid": item["identity"]["instance_player_uid"],
        "instance_debug_name": item["identity"]["debug_name"],
        "old_owner_player_uids": join_values(item["ownership"]["old_owner_player_uids"]),
        "pal_box_container_id": item["pal_box"]["container_id"],
        "item_container_id": item["item_container_id"],
        "base_camp_worker_event_type": item["base_camp_event"]["type"],
        "base_camp_worker_event_progress_time": item["base_camp_event"]["progress_time"],
        "got_status_points": join_pairs(item["status_points"]["got"]),
        "got_ex_status_points": join_pairs(item["status_points"]["got_ex"]),
        "food_regene_item_id": item["food_regene"]["item_id"],
        "food_regene_effect_time": item["food_regene"]["effect_time"],
        "food_regene_remaining_time": item["food_regene"]["remaining_time"],
        "food_regene_effect_parameters": join_items(item["food_regene"]["effect_parameters"]),
        "off_work_suitability_list": join_values(item["work"]["off_suitability_list"]),
        "work_suitability_add_ranks": join_items(item["work"]["add_ranks"]),
        "work_suitability_overflow_ranks": join_items(item["work"]["overflow_granted_ranks"]),
        "skin_applied_character_id": item["skin_applied_character_id"],
        "expedition_map_object_instance_id": item["expedition_map_object_instance_id"],
        "partner_skill_last_used_time": item["timers"]["partner_skill_last_used_time"],
        "arena_restore_valid": item["arena"]["restore"]["valid"],
        "arena_restore_hp": item["arena"]["restore"]["hp"],
        "arena_restore_full_stomach": item["arena"]["restore"]["full_stomach"],
        "arena_restore_sanity": item["arena"]["restore"]["sanity"],
        "arena_restore_worker_sick": item["arena"]["restore"]["worker_sick"],
        "arena_restore_food_status_effect_item": item["arena"]["restore"]["food_status_effect_item"],
        "arena_restore_food_status_effect_timer": item["arena"]["restore"]["food_status_effect_timer"],
        "arena_restore_food_regene_item_id": item["arena"]["restore"]["food_regene"]["item_id"],
        "arena_restore_food_regene_effect_time": item["arena"]["restore"]["food_regene"]["effect_time"],
        "arena_restore_food_regene_remaining_time": item["arena"]["restore"]["food_regene"]["remaining_time"],
        "arena_restore_food_full_stomach_keep_item": item["arena"]["restore"]["food_full_stomach_keep_item"],
        "arena_restore_food_full_stomach_keep_timer": item["arena"]["restore"]["food_full_stomach_keep_timer"],
        "raw_property_names": join_values(item["raw_property_names"]),
    }


def write_csv(records, csv_path=CSV_PATH):
    try:
        csv_file = csv_path.open("w", newline="", encoding="utf-8")
    except PermissionError:
        csv_path = CSV_FALLBACK_PATH
        csv_file = csv_path.open("w", newline="", encoding="utf-8")

    with csv_file as f:
        writer = csv.DictWriter(f, fieldnames=CSV_FIELDS)
        writer.writeheader()
        for item in records:
            writer.writerow(flatten_record(item))
    return csv_path


def main():
    OUTPUT_PATH.mkdir(parents=True, exist_ok=True)
    decoded_save = decompress_save(SAVE_PATH)
    GVAS_PATH.write_bytes(decoded_save)
    result = extract_decoded_save(decoded_save)
    records = result["records"]

    JSON_PATH.write_text(json.dumps(records, indent=2), encoding="utf-8")
    csv_path = write_csv(records)
    manager = build_manager()
    combined_summary = run_combined_sandbox()

    print(
        json.dumps(
            {
                "source": str(SAVE_PATH),
                "decoded_gvas": str(GVAS_PATH),
                "csv": str(csv_path),
                "json": str(JSON_PATH),
                "total_storage_slots": result["total_storage_slots"],
                "occupied_slots": result["occupied_slots"],
                "active_skill_lookup_entries": len(manager.active_skill_lookup),
                "passive_skill_lookup_entries": len(manager.passive_skill_lookup),
                "passive_rank_lookup_entries": len(manager.passive_rank_lookup),
                "pal_lookup_entries": len(manager.pal_lookup),
                "first_record": records[0] if records else None,
                "combined": combined_summary,
            },
            indent=2,
        )
    )


def run_combined_sandbox():
    """Combine every .sav under sandbox/save, one set per top-level folder."""
    files = []
    for path in sorted((SANDBOX_PATH / "save").rglob("*.sav")):
        top = path.relative_to(SANDBOX_PATH / "save").parts[0]
        files.append({"path": str(path), "name": path.name, "set": top})
    if not files:
        return None
    result = combine_saves(files)
    combined_csv = OUTPUT_PATH / "combined_pals.csv"
    write_csv(result["records"], combined_csv)
    (OUTPUT_PATH / "combined_pals.json").write_text(
        json.dumps(result["records"], indent=2), encoding="utf-8"
    )
    return {"csv": str(combined_csv), "sources": result["sources"], "sets": result["sets"]}


if __name__ == "__main__":
    main()
