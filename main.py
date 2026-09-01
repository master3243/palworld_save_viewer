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
    "slot_index",
    "pal_name",
    "pal_variant",
    "species_id",
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
    "raw_property_names",
]


def decompress_save(path):
    raw = Path(path).read_bytes()
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


def join_values(values):
    return ";".join(str(value) for value in values if value is not None)


def flatten_record(item):
    return {
        "storage_slot": item["storage_index"],
        "slot_index": item["slot_index"],
        "pal_name": item["pal_name"],
        "pal_variant": item["pal_variant"],
        "species_id": item["species_id"],
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
        "raw_property_names": join_values(item["raw_property_names"]),
    }


def write_csv(records):
    csv_path = CSV_PATH
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
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
