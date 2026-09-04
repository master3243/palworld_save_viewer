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
        return cls.format_guid(payload[:16])

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

    SCALAR_FORMATS = {
        "IntProperty": "<i",
        "Int64Property": "<q",
        "Int16Property": "<h",
        "Int8Property": "<b",
        "UInt16Property": "<H",
        "UInt32Property": "<I",
        "UInt64Property": "<Q",
        "FloatProperty": "<f",
        "DoubleProperty": "<d",
    }

    ZERO_GUID = "00000000-0000-0000-0000-000000000000"

    @staticmethod
    def format_guid(raw):
        # Unreal FGuid is four little-endian 32-bit words. Palworld tools (and the
        # player save file names) print each word big-endian, hyphenated 8-4-4-4-12.
        words = b"".join(raw[i : i + 4][::-1] for i in range(0, 16, 4)).hex()
        return f"{words[:8]}-{words[8:12]}-{words[12:16]}-{words[16:20]}-{words[20:]}"

    @classmethod
    def guid_or_none(cls, value):
        return None if value in (None, cls.ZERO_GUID) else value

    @staticmethod
    def enum_short(value):
        if isinstance(value, str) and "::" in value:
            return value.split("::", 1)[1]
        return value

    @classmethod
    def read_property_value(cls, data, offset):
        """Read one tagged property. Returns (name, value, next_offset); name is None at the
        'None' terminator. Struct and array payloads are decoded recursively."""
        name, prop_type, size, offset = cls.read_tag_header(data, offset)
        if name == "None":
            return None, None, offset
        if prop_type == "BoolProperty":
            return name, bool(data[offset]), offset + 2
        if prop_type == "ByteProperty":
            enum_name, offset = cls.read_fstring(data, offset)
            offset += 1
            if enum_name == "None" or size == 1:
                value = data[offset]
            else:
                value, _ = cls.read_fstring(data, offset)
            return name, value, offset + size
        if prop_type == "EnumProperty":
            _, offset = cls.read_fstring(data, offset)
            offset += 1
            value, _ = cls.read_fstring(data, offset)
            return name, value, offset + size
        if prop_type == "StructProperty":
            struct_type, offset = cls.read_fstring(data, offset)
            offset += 17
            return name, cls.decode_struct(struct_type, data[offset : offset + size]), offset + size
        if prop_type in ("ArrayProperty", "SetProperty"):
            inner_type, offset = cls.read_fstring(data, offset)
            offset += 1
            return name, cls.decode_array(inner_type, data[offset : offset + size]), offset + size
        if prop_type == "MapProperty":
            _, offset = cls.read_fstring(data, offset)
            _, offset = cls.read_fstring(data, offset)
            offset += 1
            return name, None, offset + size
        offset += 1
        fmt = cls.SCALAR_FORMATS.get(prop_type)
        if fmt:
            value = struct.unpack_from(fmt, data, offset)[0]
        elif prop_type in ("NameProperty", "StrProperty"):
            value, _ = cls.read_fstring(data, offset)
        else:
            value = None
        return name, value, offset + size

    @classmethod
    def read_property_list(cls, data, offset=0):
        """Read a 'None'-terminated list of tagged properties into a dict."""
        fields = {}
        while offset < len(data):
            name, value, offset = cls.read_property_value(data, offset)
            if name is None:
                break
            fields[name] = value
        return fields, offset

    @classmethod
    def decode_struct(cls, struct_type, payload):
        if struct_type == "Guid":
            return cls.format_guid(payload[:16]) if len(payload) >= 16 else None
        if struct_type == "DateTime":
            return struct.unpack_from("<q", payload, 0)[0] if len(payload) >= 8 else None
        if struct_type == "Vector":
            if len(payload) >= 24:
                x, y, z = struct.unpack_from("<ddd", payload, 0)
            elif len(payload) >= 12:
                x, y, z = struct.unpack_from("<fff", payload, 0)
            else:
                return None
            return {"x": x, "y": y, "z": z}
        fields, _ = cls.read_property_list(payload)
        if struct_type == "FixedPoint64":
            value = fields.get("Value")
            return None if value is None else value / 1000
        return fields

    @classmethod
    def decode_array(cls, inner_type, payload):
        (count,) = struct.unpack_from("<i", payload, 0)
        offset = 4
        if count < 0:
            return []
        values = []
        if inner_type == "StructProperty":
            _, offset = cls.read_fstring(payload, offset)  # item name
            _, offset = cls.read_fstring(payload, offset)  # "StructProperty"
            offset += 8  # size + array index
            struct_type, offset = cls.read_fstring(payload, offset)
            offset += 17  # struct guid + has-guid flag
            for _ in range(count):
                if struct_type == "Guid":
                    values.append(cls.format_guid(payload[offset : offset + 16]))
                    offset += 16
                elif struct_type == "DateTime":
                    values.append(struct.unpack_from("<q", payload, offset)[0])
                    offset += 8
                else:
                    fields, offset = cls.read_property_list(payload, offset)
                    values.append(fields)
            return values
        if inner_type in ("EnumProperty", "NameProperty", "StrProperty"):
            for _ in range(count):
                value, offset = cls.read_fstring(payload, offset)
                values.append(value)
            return values
        if inner_type == "BoolProperty":
            return [bool(b) for b in payload[offset : offset + count]]
        if inner_type == "ByteProperty":
            return list(payload[offset : offset + count])
        fmt = cls.SCALAR_FORMATS.get(inner_type)
        if fmt:
            step = struct.calcsize(fmt)
            for i in range(count):
                values.append(struct.unpack_from(fmt, payload, offset + i * step)[0])
        return values

    @classmethod
    def read_struct_property(cls, data, offset):
        """Decode a StructProperty at offset into a dict (or scalar for Guid/DateTime/Vector)."""
        if offset == -1:
            return None
        try:
            payload, struct_type = cls.read_struct_payload(data, offset)
            if payload is None:
                return None
            return cls.decode_struct(struct_type, payload)
        except (IndexError, struct.error, UnicodeDecodeError):
            return None

    @classmethod
    def read_struct_array_property(cls, data, offset):
        """Decode an ArrayProperty at offset into a list of decoded items."""
        if offset == -1:
            return []
        try:
            _, prop_type, size, offset = cls.read_tag_header(data, offset)
            if prop_type != "ArrayProperty":
                return []
            inner_type, offset = cls.read_fstring(data, offset)
            offset += 1
            return cls.decode_array(inner_type, data[offset : offset + size])
        except (IndexError, struct.error, UnicodeDecodeError):
            return []

    STATUS_POINT_NAMES = {
        "\u6700\u5927HP": "max_hp",
        "\u6700\u5927SP": "max_sp",
        "\u653b\u6483\u529b": "attack",
        "\u9632\u5fa1\u529b": "defense",
        "\u6240\u6301\u91cd\u91cf": "carry_weight",
        "\u6355\u7372\u7387": "capture_rate",
        "\u4f5c\u696d\u901f\u5ea6": "work_speed",
    }

    @classmethod
    def status_points_dict(cls, items):
        return {
            cls.STATUS_POINT_NAMES.get(item.get("StatusName"), item.get("StatusName")): item.get("StatusPoint")
            for item in items
            if isinstance(item, dict)
        }

    @classmethod
    def suitability_rank_items(cls, items):
        return [
            {key: cls.enum_short(value) for key, value in item.items()}
            for item in items
            if isinstance(item, dict)
        ]

    @classmethod
    def food_regene_info(cls, info):
        info = info or {}
        return {
            "item_id": info.get("ItemId"),
            "effect_time": info.get("EffectTime"),
            "remaining_time": info.get("RemainingTime"),
            "effect_parameters": info.get("RegeneEfectParameters") or [],
        }

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
            except (IndexError, OverflowError, struct.error, UnicodeDecodeError):
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

            instance = self.read_struct_property(block, prop("InstanceId")) or {}
            slot_id = self.read_struct_property(block, prop("SlotId")) or {}
            item_container = self.read_struct_property(block, prop("ItemContainerId")) or {}
            work_option = self.read_struct_property(block, prop("WorkSuitabilityOptionInfo")) or {}
            arena_restore = self.read_struct_property(block, prop("ArenaRestoreParameter")) or {}

            records.append(
                {
                    "storage_index": slot_number,
                    "identity": {
                        "instance_id": self.guid_or_none(instance.get("InstanceId")),
                        "instance_player_uid": self.guid_or_none(instance.get("PlayerUId")),
                        "debug_name": instance.get("DebugName") or "",
                    },
                    "pal_box": {
                        "container_id": self.guid_or_none(
                            (slot_id.get("ContainerId") or {}).get("ID")
                        ),
                        "slot_index": slot_id.get("SlotIndex"),
                    },
                    "item_container_id": self.guid_or_none(item_container.get("ID")),
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
                        "old_owner_player_uids": self.read_struct_array_property(
                            block, prop("OldOwnerPlayerUIds")
                        ),
                        "last_nickname_modifier_player_uid": self.read_guid_struct(
                            block, prop("LastNickNameModifierPlayerUid")
                        ),
                    },
                    "arena": {
                        "rank_points": self.read_int_property(block, prop("ArenaRankPoint")),
                        "restore": {
                            "valid": arena_restore.get("bValid"),
                            "hp": arena_restore.get("Hp"),
                            "full_stomach": arena_restore.get("FullStomach"),
                            "sanity": arena_restore.get("SanityValue"),
                            "worker_sick": self.enum_short(arena_restore.get("WorkerSick")),
                            "food_status_effect_item": arena_restore.get("FoodWithStatusEffect"),
                            "food_status_effect_timer": arena_restore.get(
                                "Tiemr_FoodWithStatusEffect"
                            ),
                            "food_regene": self.food_regene_info(
                                arena_restore.get("FoodRegeneEffectInfo")
                            ),
                            "food_full_stomach_keep_item": arena_restore.get(
                                "FoodWithFullStomachKeep"
                            ),
                            "food_full_stomach_keep_timer": arena_restore.get(
                                "Tiemr_FoodWithFullStomachKeep"
                            ),
                        },
                    },
                    "base_camp_event": {
                        "type": self.read_enum_property(
                            block, prop("BaseCampWorkerEventType"), "EPalBaseCampWorkerEventType::"
                        ),
                        "progress_time": self.read_float_property(
                            block, prop("BaseCampWorkerEventProgressTime")
                        ),
                    },
                    "status_points": {
                        "got": self.status_points_dict(
                            self.read_struct_array_property(block, prop("GotStatusPointList"))
                        ),
                        "got_ex": self.status_points_dict(
                            self.read_struct_array_property(block, prop("GotExStatusPointList"))
                        ),
                    },
                    "food_regene": self.food_regene_info(
                        self.read_struct_property(block, prop("FoodRegeneEffectInfo"))
                    ),
                    "skin_applied_character_id": self.guid_or_none(
                        self.read_guid_struct(block, prop("SkinAppliedCharacterId"))
                    ),
                    "expedition_map_object_instance_id": self.guid_or_none(
                        self.read_guid_struct(
                            block, prop("MapObjectConcreteInstanceIdAssignedToExpedition")
                        )
                    ),
                    "timers": {
                        "pal_revive": self.read_float_property(block, prop("PalReviveTimer")),
                        "partner_skill_cooldown_max": self.read_float_property(
                            block, prop("PartnerSkillCoolDownTimeMax")
                        ),
                        "partner_skill_last_used_time": self.read_datetime_struct(
                            block, prop("PartnerSkillLastUsedTime")
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
                        "off_suitability_list": [
                            self.enum_short(value)
                            for value in work_option.get("OffWorkSuitabilityList") or []
                        ],
                        "add_ranks": self.suitability_rank_items(
                            self.read_struct_array_property(
                                block, prop("GotWorkSuitabilityAddRankList")
                            )
                        ),
                        "overflow_granted_ranks": self.suitability_rank_items(
                            self.read_struct_array_property(
                                block, prop("WorkSuitabilityOverflowGrantedRankList")
                            )
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
