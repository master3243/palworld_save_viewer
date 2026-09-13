"""Build the Messenger checklist from preserved game Blueprints and map placements.

No player saves are inputs. See messenger_rewards.md for source and extraction steps.
"""
import hashlib
import json
import re
from zipfile import ZipFile

REGIONS = {
    'Grass01_NPC': 'Grasslands', 'Forest01_NPC': 'Forest', 'Desert01_NPC': 'Desert',
    'Volcano01_NPC': 'Mount Obsidian', 'Snow01_NPC': 'Astral Mountains',
    'Sakurajima_Treasure_NPC': 'Sakurajima', 'DarkIsland_Treasure_NPC': 'Feybreak',
}


def build(cache):
    with ZipFile(cache / 'messengers.db') as archive:
        sources = json.loads(archive.read('sources.json'))
        for name, digest in sources['files'].items():
            if hashlib.sha256(archive.read(name)).hexdigest() != digest:
                raise ValueError(f'Messenger source hash mismatch: {name}')
        placements = json.loads(archive.read('placements.json'))
        rewards = []
        seen = set()
        for placement in sorted(placements, key=lambda p: p['npcId']):
            npc_id = placement['npcId']
            suffix = npc_id.removeprefix('U_Emote_location_')
            exports = json.loads(archive.read(f'blueprints/BP_NPC_Reward_Emote_location_{suffix}.json'))
            components = [e['Properties'] for e in exports if e['Type'] == 'BP_NPCEmoteDetectionComponent_C']
            if len(components) != 1 or components[0].get('bOneShot') is not True:
                raise ValueError(f'Expected one one-shot component for {npc_id}')
            component = components[0]
            raw_id = component['CompletedFlagId'].replace('-', '').lower()
            if not re.fullmatch(r'[0-9a-f]{32}', raw_id) or int(raw_id, 16) == 0 or raw_id in seen:
                raise ValueError(f'Invalid or duplicate reward ID for {npc_id}')
            seen.add(raw_id)
            # CUE4Parse prints four FGuid words; the app uses conventional 8-4-4-4-12 grouping.
            guid = f'{raw_id[:8]}-{raw_id[8:12]}-{raw_id[12:16]}-{raw_id[16:20]}-{raw_id[20:]}'
            point = placement['position']
            rewards.append({'id': guid, 'npcId': npc_id, 'region': REGIONS[component['FieldName']['Key']],
                            'x': point['X'], 'y': point['Y'], 'z': point['Z']})
        return rewards
