import json
import unittest
from unittest.mock import patch

import build_completion_data as builder


class QuestLocationsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.maps = builder.map_data()
        cls.starts = builder.quest_start_locations(cls.maps)
        cls.generated = builder.build(builder.RAW)
        cls.original = builder.load(builder.RAW, "psp/missions.json")

    def test_only_missing_enabled_side_locations_are_filled(self):
        added = []
        for quest_id, original in self.original.items():
            location = original.get("location") or {}
            before = [round(location.get(axis) or 0) for axis in ("x", "y")]
            after = self.generated["quests"][quest_id]
            if after[3:] != before:
                self.assertEqual(after[0], "Sub")
                self.assertEqual(after[2], 0)
                self.assertEqual(before, [0, 0])
                added.append(quest_id)
        self.assertEqual(set(added), set(self.starts))
        self.assertEqual(len(added), 36)

    def test_rebuild_matches_shipped_data(self):
        self.assertEqual(self.generated, json.loads(builder.OUT.read_text()))

    def test_ambiguous_or_missing_npc_is_rejected(self):
        key = ("palpagos", "U_Reward_PalDisplay_A_01")
        for positions in (set(), {(1, 2), (3, 4)}):
            with self.subTest(positions=positions), patch.dict(self.maps["npcs"], {key: positions}):
                with self.assertRaisesRegex(ValueError, "Missing or ambiguous quest NPC"):
                    builder.quest_start_locations(self.maps)


if __name__ == "__main__":
    unittest.main()
