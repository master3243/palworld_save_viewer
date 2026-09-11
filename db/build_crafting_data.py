"""Build the crafting catalog from pinned game tables, without player access filters."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def build(cache: Path) -> list[dict]:
    def read(path):
        return json.loads((cache / path).read_text())

    recipes = read('crafting/recipes.json')
    items = {key.lower(): (key, value) for key, value in read('crafting/items.json').items()}
    icons = {key.lower(): value for key, value in read('crafting/icons.json').items()}
    names = {key.lower(): value['localized_name'] for key, value in read('psp/l10n/items.json').items()}
    tech_names = read('psp/l10n/technologies.json')
    technologies = {}
    technology_levels = {}
    for key, value in read('psp/technologies.json').items():
        for recipe in value['unlock_item_recipes']:
            technology_levels.setdefault(recipe.lower(), []).append(value['level_cap'])
            technologies.setdefault(recipe.lower(), []).append(
                ('Ancient technology: ' if value['is_boss_technology'] else 'Technology: ')
                + tech_names.get(key, {}).get('localized_name', key))

    groups = {
        'Weapon': 'Weapons', 'Armor': 'Armor', 'Accessory': 'Accessories',
        'SpecialWeapon': 'Spheres', 'Material': 'Materials', 'Consume': 'Consumables',
        'Ammo': 'Ammunition', 'Food': 'Food', 'Essential': 'Key items',
        'Blueprint': 'Schematics',
    }
    stat_fields = [
        ('PhysicalAttackValue', 'Attack'), ('PhysicalDefenseValue', 'Defense'),
        ('HPValue', 'HP'), ('ShieldValue', 'Shield'), ('Durability', 'Durability'),
        ('MagazineSize', 'Magazine'), ('RestoreSatiety', 'Nutrition'), ('RestoreSanity', 'SAN'),
    ]
    outputs = {}
    for recipe_id, recipe in recipes.items():
        item_id, item = items[recipe['Product_Id'].lower()]
        if not item['bLegalInGame']:
            continue
        icon_key = item['IconName'].lower()
        entry = outputs.setdefault(item_id, {
            'id': item_id, 'name': names[item_id.lower()], 'rarity': item['Rarity'],
            'group': groups.get(item['TypeA'], 'Other'),
            'weight': item['Weight'], 'baseValue': item['Price'], 'stackLimit': item['MaxStackCount'],
            'technologyLevels': [],
            'stats': [[label, item[field]] for field, label in stat_fields if item[field] != 0],
            'icon': f'resources/completion/crafting-icons/{icon_key}.pog' if icon_key in icons else '',
            'recipes': [],
        })
        sources = list(technologies.get(recipe_id.lower(), []))
        entry['technologyLevels'] = sorted(set(entry['technologyLevels'] + technology_levels.get(recipe_id.lower(), [])))
        if recipe['UnlockItemID']:
            sources.append(names.get(recipe['UnlockItemID'].lower(), 'Schematic'))
        ingredients = []
        for slot in range(1, 6):
            material, count = recipe[f'Material{slot}_Id'], recipe[f'Material{slot}_Count']
            if material and count > 0:
                ingredients.append([items[material.lower()][0], names[material.lower()], count])
        entry['recipes'].append({'id': recipe_id, 'quantity': recipe['Product_Count'],
                                 'workAmount': recipe['WorkAmount'],
                                 'sources': sources, 'ingredients': ingredients})
    return sorted(outputs.values(), key=lambda entry: (entry['name'].lower(), entry['rarity'], entry['id']))


if __name__ == '__main__':
    data = build(ROOT / 'completion_sources/raw')
    print(f'{len(data)} distinct available crafting outputs')
