import json
import re
import struct
from pathlib import Path


class PalStorageDataManager:
    def __init__(
        self,
        active_skill_lookup=None,
        passive_skill_lookup=None,
        passive_rank_lookup=None,
        pal_lookup=None,
    ):
        self.active_skill_lookup = active_skill_lookup or {}
        self.passive_skill_lookup = passive_skill_lookup or {}
        self.passive_rank_lookup = passive_rank_lookup or {}
        self.pal_lookup = pal_lookup or {}

    @staticmethod
    def load_active_skill_lookup(path):
        path = Path(path)
        if not path.exists():
            return {}
        raw = json.loads(path.read_text(encoding="utf-8"))
        return {
            key.removeprefix("EPalWazaID::"): value.get("localized_name", "")
            for key, value in raw.items()
        }

    @staticmethod
    def load_passive_skill_lookup(path):
        path = Path(path)
        if not path.exists():
            return {}
        raw = json.loads(path.read_text(encoding="utf-8"))
        return {key: value.get("localized_name", "") for key, value in raw.items()}

    @staticmethod
    def load_passive_rank_lookup(path):
        path = Path(path)
        if not path.exists():
            return {}
        lookup = {}
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip().rstrip(",")
            if not line.startswith("[") or "=" not in line:
                continue
            key_part, value_part = line.split("=", 1)
            key = key_part.strip().strip("[]").strip('"').lower()
            try:
                rank = int(value_part.strip())
            except ValueError:
                continue
            lookup[key] = rank
        return lookup

    @staticmethod
    def passive_color_from_rank(rank):
        if rank is None:
            return ""
        if rank < 0:
            return "negative"
        if rank >= 4:
            return "platinum"
        if rank == 3:
            return "gold"
        return "regular"

    @staticmethod
    def load_pal_name_lookup(path):
        path = Path(path)
        if not path.exists():
            return {}
        lookup = {}
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip().rstrip(",")
            if "=" not in line or '"' not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            value = value.strip().strip('"')
            if key and value:
                lookup[key] = value
                lookup[key.lower()] = value
        return lookup

    @staticmethod
    def read_fstring(data, offset):
        (length,) = struct.unpack_from("<i", data, offset)
        offset += 4
        if length == 0:
            return "", offset
        if length < 0:
            chars = -length
            raw = data[offset : offset + chars * 2]
            offset += chars * 2
            return raw[:-2].decode("utf-16le", "replace"), offset
        raw = data[offset : offset + length]
        offset += length
        return raw[:-1].decode("utf-8", "replace"), offset

    @classmethod
    def read_tag_header(cls, data, offset):
        name, offset = cls.read_fstring(data, offset)
        if name == "None":
            return name, None, 0, offset
        prop_type, offset = cls.read_fstring(data, offset)
        (size,) = struct.unpack_from("<q", data, offset)
        offset += 8
        return name, prop_type, size, offset

    @staticmethod
    def find_property_start(data, label, start=0, end=None):
        if end is None:
            end = len(data)
        pos = data.find(label.encode("utf-8") + b"\x00", start, end)
        if pos < 4:
            return -1
        expected_len = len(label) + 1
        while pos != -1 and pos >= 4:
            (actual_len,) = struct.unpack_from("<i", data, pos - 4)
            if actual_len == expected_len:
                return pos - 4
            pos = data.find(label.encode("utf-8") + b"\x00", pos + 1, end)
        return -1

    @classmethod
    def _read_scalar(cls, data, offset, expected_type, fmt=None):
        if offset == -1:
            return None
        try:
            _, prop_type, _, offset = cls.read_tag_header(data, offset)
            if prop_type != expected_type:
                return None
            offset += 1
            if fmt is None:
                return data[offset]
            return struct.unpack_from(fmt, data, offset)[0]
        except (IndexError, struct.error, UnicodeDecodeError):
            return None

    @classmethod
    def read_bool_property(cls, data, offset):
        if offset == -1:
            return None
        try:
            _, prop_type, _, offset = cls.read_tag_header(data, offset)
            if prop_type != "BoolProperty":
                return None
            return bool(data[offset])
        except (IndexError, struct.error, UnicodeDecodeError):
            return None

    @classmethod
    def read_byte_property(cls, data, offset):
        if offset == -1:
            return None
        try:
            _, prop_type, _, offset = cls.read_tag_header(data, offset)
            if prop_type != "ByteProperty":
                return None
            _, offset = cls.read_fstring(data, offset)
            offset += 1
            return data[offset]
        except (IndexError, struct.error, UnicodeDecodeError):
            return None

    @classmethod
    def read_int_property(cls, data, offset):
        return cls._read_scalar(data, offset, "IntProperty", "<i")

    @classmethod
    def read_uint16_property(cls, data, offset):
        return cls._read_scalar(data, offset, "UInt16Property", "<H")

    @classmethod
    def read_int64_property(cls, data, offset):
        return cls._read_scalar(data, offset, "Int64Property", "<q")

    @classmethod
    def read_float_property(cls, data, offset):
        return cls._read_scalar(data, offset, "FloatProperty", "<f")

    @classmethod
    def read_name_property(cls, data, offset):
        if offset == -1:
            return None
        try:
            _, prop_type, _, offset = cls.read_tag_header(data, offset)
            if prop_type != "NameProperty":
                return None
            offset += 1
            value, _ = cls.read_fstring(data, offset)
            return value
        except (IndexError, struct.error, UnicodeDecodeError):
            return None

    @classmethod
    def read_str_property(cls, data, offset):
        if offset == -1:
            return ""
        try:
            _, prop_type, _, offset = cls.read_tag_header(data, offset)
            if prop_type != "StrProperty":
                return ""
            offset += 1
            value, _ = cls.read_fstring(data, offset)
            return value
        except (IndexError, struct.error, UnicodeDecodeError):
            return ""

    @classmethod
    def read_enum_property(cls, data, offset, prefix=""):
        if offset == -1:
            return ""
        try:
            _, prop_type, _, offset = cls.read_tag_header(data, offset)
            if prop_type != "EnumProperty":
                return ""
            _, offset = cls.read_fstring(data, offset)
            offset += 1
            value, _ = cls.read_fstring(data, offset)
            return value.removeprefix(prefix)
        except (IndexError, struct.error, UnicodeDecodeError):
            return ""

    @classmethod
    def read_enum_array_property(cls, data, offset, prefix=""):
        if offset == -1:
            return []
        try:
            _, prop_type, _, offset = cls.read_tag_header(data, offset)
            if prop_type != "ArrayProperty":
                return []
            inner_type, offset = cls.read_fstring(data, offset)
            offset += 1
            (count,) = struct.unpack_from("<i", data, offset)
            offset += 4
            if count < 0 or count > 128:
                return []
            values = []
            if inner_type != "EnumProperty":
                return values
            for _ in range(count):
                value, offset = cls.read_fstring(data, offset)
                values.append(value.removeprefix(prefix))
            return values
        except (IndexError, struct.error, UnicodeDecodeError):
            return []

    @classmethod
    def read_name_array_property(cls, data, offset):
        if offset == -1:
            return []
        try:
            _, prop_type, _, offset = cls.read_tag_header(data, offset)
            if prop_type != "ArrayProperty":
                return []
            inner_type, offset = cls.read_fstring(data, offset)
            offset += 1
            (count,) = struct.unpack_from("<i", data, offset)
            offset += 4
            if count < 0 or count > 128:
                return []
            values = []
            if inner_type != "NameProperty":
                return values
            for _ in range(count):
                value, offset = cls.read_fstring(data, offset)
                values.append(value)
            return values
        except (IndexError, struct.error, UnicodeDecodeError):
            return []

    @classmethod
    def read_struct_payload(cls, data, offset, expected_struct_type=None):
        if offset == -1:
            return None, None
        try:
            _, prop_type, size, offset = cls.read_tag_header(data, offset)
            if prop_type != "StructProperty":
                return None, None
            struct_type, offset = cls.read_fstring(data, offset)
            if expected_struct_type and struct_type != expected_struct_type:
                return None, None
            offset += 17
            return data[offset : offset + size], struct_type
        except (IndexError, struct.error, UnicodeDecodeError):
            return None, None

    @classmethod
    def read_fixed_point64_struct(cls, data, offset):
        payload, _ = cls.read_struct_payload(data, offset, "FixedPoint64")
        if not payload:
            return None
        value_offset = cls.find_property_start(payload, "Value")
        raw_value = cls.read_int64_property(payload, value_offset)
        if raw_value is None:
            return None
        return raw_value / 1000

    @classmethod
    def read_guid_struct(cls, data, offset):
        payload, _ = cls.read_struct_payload(data, offset, "Guid")
        if not payload or len(payload) < 16:
            return None
        raw = payload[:16]
        return (
            raw[0:4][::-1].hex()
            + "-"
            + raw[4:6][::-1].hex()
            + "-"
            + raw[6:8][::-1].hex()
            + "-"
            + raw[8:10].hex()
            + "-"
            + raw[10:16].hex()
        )

    @classmethod
    def read_datetime_struct(cls, data, offset):
        payload, _ = cls.read_struct_payload(data, offset, "DateTime")
        if not payload or len(payload) < 8:
            return None
        return struct.unpack_from("<q", payload, 0)[0]

    @classmethod
    def read_vector_struct(cls, data, offset):
        payload, _ = cls.read_struct_payload(data, offset, "Vector")
        if not payload:
            return None
        if len(payload) >= 24:
            x, y, z = struct.unpack_from("<ddd", payload, 0)
        elif len(payload) >= 12:
            x, y, z = struct.unpack_from("<fff", payload, 0)
        else:
            return None
        return {"x": x, "y": y, "z": z}

    @classmethod
    def validated_property_names(cls, data):
        names = []
        seen = set()
        for match in re.finditer(rb"[A-Za-z][A-Za-z0-9_]{2,64}\x00", data):
            pos = match.start()
            if pos < 4:
                continue
            try:
                name, prop_type, _, _ = cls.read_tag_header(data, pos - 4)
            except (IndexError, struct.error, UnicodeDecodeError):
                continue
            if not prop_type or not prop_type.endswith("Property"):
                continue
            if name not in seen:
                seen.add(name)
                names.append(name)
        return names

    def pal_display_name(self, species_id):
        variant = ""
        base_id = species_id
        if base_id.startswith("BOSS_"):
            variant = "Alpha"
            base_id = base_id.removeprefix("BOSS_")
        elif base_id.startswith("PREDATOR_"):
            variant = "Predator"
            base_id = base_id.removeprefix("PREDATOR_")

        display = (
            self.pal_lookup.get(base_id)
            or self.pal_lookup.get(base_id.lower())
            or self.pal_lookup.get(species_id)
            or self.pal_lookup.get(species_id.lower())
            or base_id
        )
        for suffix in (" (Boss)", " (Predator)"):
            if display.endswith(suffix):
                display = display[: -len(suffix)]
        return display, variant

    def extract_records(self, save_data):
        marker = b"PalIndividualCharacterSaveParameter\x00"
        offsets = []
        search = 0
        while True:
            pos = save_data.find(marker, search)
            if pos == -1:
                break
            offsets.append(pos)
            search = pos + 1

        records = []
        for slot_number, pos in enumerate(offsets):
            end = offsets[slot_number + 1] if slot_number + 1 < len(offsets) else len(save_data)
            block = save_data[pos:end]

            def prop(label):
                return self.find_property_start(block, label)

            character_id = self.read_name_property(block, prop("CharacterID")) or ""
            if not character_id or character_id == "None":
                continue

            pal_name, pal_variant = self.pal_display_name(character_id)
            active_skill_ids = self.read_enum_array_property(
                block, prop("EquipWaza"), "EPalWazaID::"
            )
            mastered_skill_ids = self.read_enum_array_property(
                block, prop("MasteredWaza"), "EPalWazaID::"
            )
            passive_skill_ids = self.read_name_array_property(block, prop("PassiveSkillList"))
            passive_skill_ranks = [
                self.passive_rank_lookup.get(skill_id.lower())
                for skill_id in passive_skill_ids
            ]

            records.append(
                {
                    "storage_index": slot_number,
                    "slot_index": self.read_int_property(block, prop("SlotIndex")),
                    "pal_name": pal_name,
                    "pal_variant": pal_variant,
                    "species_id": character_id,
                    "unique_npc_id": self.read_name_property(block, prop("UniqueNPCID")),
                    "gender": self.read_enum_property(block, prop("Gender"), "EPalGenderType::"),
                    "nickname": self.read_str_property(block, prop("NickName")),
                    "filtered_nickname": self.read_str_property(block, prop("FilteredNickName")),
                    "level": self.read_byte_property(block, prop("Level")),
                    "exp": self.read_int64_property(block, prop("Exp")),
                    "rank": self.read_byte_property(block, prop("Rank")),
                    "rank_up_exp": self.read_uint16_property(block, prop("RankUpExp")),
                    "unused_status_points": self.read_uint16_property(
                        block, prop("UnusedStatusPoint")
                    ),
                    "soul_ranks": {
                        "hp": self.read_byte_property(block, prop("Rank_HP")),
                        "attack": self.read_byte_property(block, prop("Rank_Attack")),
                        "defense": self.read_byte_property(block, prop("Rank_Defence")),
                        "craft_speed": self.read_byte_property(block, prop("Rank_CraftSpeed")),
                    },
                    "ivs": {
                        "hp": self.read_byte_property(block, prop("Talent_HP")),
                        "attack": self.read_byte_property(block, prop("Talent_Shot")),
                        "defense": self.read_byte_property(block, prop("Talent_Defense")),
                    },
                    "needs": {
                        "hp": self.read_fixed_point64_struct(block, prop("Hp")),
                        "shield_hp": self.read_fixed_point64_struct(block, prop("ShieldHP")),
                        "full_stomach": self.read_float_property(block, prop("FullStomach")),
                        "sanity": self.read_float_property(block, prop("SanityValue")),
                        "hunger_type": self.read_enum_property(
                            block, prop("HungerType"), "EPalStatusHungerType::"
                        ),
                        "physical_health": self.read_enum_property(
                            block,
                            prop("PhysicalHealth"),
                            "EPalStatusPhysicalHealthType::",
                        ),
                        "worker_sick": self.read_enum_property(
                            block, prop("WorkerSick"), "EPalBaseCampWorkerSickType::"
                        ),
                    },
                    "flags": {
                        "is_lucky": self.read_bool_property(block, prop("IsRarePal")),
                        "is_awakening": self.read_bool_property(block, prop("bIsAwakening")),
                        "is_player": self.read_bool_property(block, prop("IsPlayer")),
                        "allow_base_camp_battle": self.read_bool_property(
                            block, prop("bAllowBaseCampBattle")
                        ),
                        "applied_death_penalty": self.read_bool_property(
                            block, prop("bAppliedDeathPenarty")
                        ),
                        "apply_shield_damage": self.read_bool_property(
                            block, prop("bApplyShieldDamage")
                        ),
                        "enable_player_respawn_in_hardcore": self.read_bool_property(
                            block, prop("bEnablePlayerRespawnInHardcore")
                        ),
                        "favorite_changed_by_friendship": self.read_bool_property(
                            block, prop("bFavoriteChangedByFriendship")
                        ),
                        "disable_sale_in_pal_lost": self.read_bool_property(
                            block, prop("bDisableSaleInPalLost")
                        ),
                        "excluded_from_team_mission": self.read_bool_property(
                            block, prop("bIsExcludedFromTeamMission")
                        ),
                        "imported_character": self.read_bool_property(
                            block, prop("bImportedCharacter")
                        ),
                    },
                    "favorite_index": self.read_byte_property(block, prop("FavoriteIndex")),
                    "voice_id": self.read_byte_property(block, prop("VoiceID")),
                    "skin_name": self.read_name_property(block, prop("SkinName")),
                    "passive_skill_ids": passive_skill_ids,
                    "skills": [
                        self.passive_skill_lookup.get(skill_id, skill_id)
                        for skill_id in passive_skill_ids
                    ],
                    "skill_ranks": passive_skill_ranks,
                    "skill_colors": [
                        self.passive_color_from_rank(rank)
                        for rank in passive_skill_ranks
                    ],
                    "active_skill_ids": active_skill_ids,
                    "combat_moves": [
                        self.active_skill_lookup.get(skill_id, skill_id)
                        for skill_id in active_skill_ids
                    ],
                    "mastered_skill_ids": mastered_skill_ids,
                    "learned_moves": [
                        self.active_skill_lookup.get(skill_id, skill_id)
                        for skill_id in mastered_skill_ids
                    ],
                    "friendship": {
                        "points": self.read_int_property(block, prop("FriendshipPoint")),
                        "otomo_seconds": self.read_int_property(block, prop("FriendshipOtomoSec")),
                        "active_otomo_seconds": self.read_int_property(
                            block, prop("FriendshipActiveOtomoSec")
                        ),
                        "basecamp_seconds": self.read_int_property(
                            block, prop("FriendshipBasecampSec")
                        ),
                    },
                    "ownership": {
                        "owned_time": self.read_datetime_struct(block, prop("OwnedTime")),
                        "owner_player_uid": self.read_guid_struct(
                            block, prop("OwnerPlayerUId")
                        ),
                        "last_nickname_modifier_player_uid": self.read_guid_struct(
                            block, prop("LastNickNameModifierPlayerUid")
                        ),
                    },
                    "arena": {
                        "rank_points": self.read_int_property(block, prop("ArenaRankPoint")),
                    },
                    "timers": {
                        "pal_revive": self.read_float_property(block, prop("PalReviveTimer")),
                        "partner_skill_cooldown_max": self.read_float_property(
                            block, prop("PartnerSkillCoolDownTimeMax")
                        ),
                        "food_with_status_effect": self.read_int_property(
                            block, prop("Tiemr_FoodWithStatusEffect")
                        ),
                        "food_with_full_stomach_keep": self.read_int_property(
                            block, prop("Tiemr_FoodWithFullStomachKeep")
                        ),
                    },
                    "food": {
                        "status_effect_item": self.read_name_property(
                            block, prop("FoodWithStatusEffect")
                        ),
                        "full_stomach_keep_item": self.read_name_property(
                            block, prop("FoodWithFullStomachKeep")
                        ),
                    },
                    "work": {
                        "current_suitability": self.read_enum_property(
                            block, prop("CurrentWorkSuitability"), "EPalWorkSuitability::"
                        ),
                    },
                    "location": {
                        "last_jumped": self.read_vector_struct(
                            block, prop("LastJumpedLocation")
                        ),
                    },
                    "migration": {
                        "exp_table_version": self.read_byte_property(
                            block, prop("ExpTableMigrationVersion")
                        ),
                    },
                    "raw_property_names": self.validated_property_names(block),
                }
            )

        records.sort(key=lambda item: item["storage_index"])
        return {
            "total_storage_slots": len(offsets),
            "occupied_slots": len(records),
            "records": records,
        }
