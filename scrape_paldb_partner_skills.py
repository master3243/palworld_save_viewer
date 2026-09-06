"""
Partner skill text per species from paldb.cc (no extraction project ships the partner skill
parameter table). Pages are cached under sandbox/paldb_pals/ (gitignored); the reduced result
is completion_sources/paldb_partner_skills.json (tracked), keyed by the in-game Pal name:

  { "Gumoss": { "skill": "Logging Assistance",
                "text": "While in party, improves logging efficiency by {0}% and reduces weight of all types of wood by {1}%. (Does not stack)",
                "levels": [["30", "40"], ["35", "45"], ...],      # one list per partner skill level 1..5
                "extra": ["", "(Damage Up: S)", ...] } }         # optional per-level suffix (awakening text)

Usage: python3 scrape_paldb_partner_skills.py [--refresh]
"""
import html
import json
import re
import sys
import time
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
CACHE = HERE / "sandbox" / "paldb_pals"
OUT = HERE / "completion_sources" / "paldb_partner_skills.json"
NAMES_LUA = HERE / "resources" / "pal_names_lookup.lua"
UPSTREAM_NAMES = HERE / "sandbox" / "completion_upstream" / "psp" / "l10n" / "pals.json"

RANGE = re.compile(r"\((\d+(?:\.\d+)?)~(\d+(?:\.\d+)?)(%?)\)")


def fetch(name: str, refresh: bool) -> str | None:
    CACHE.mkdir(parents=True, exist_ok=True)
    slug = name.replace(" ", "_")
    target = CACHE / f"{slug}.html"
    if target.exists() and not refresh:
        return target.read_text(encoding="utf-8")
    request = urllib.request.Request(f"https://paldb.cc/en/{urllib.request.quote(slug)}", headers={"User-Agent": "Mozilla/5.0"})
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            page = response.read().decode("utf-8", "replace")
    except Exception as error:  # noqa: BLE001 - a missing page is data, not a crash
        print(f"  {name}: {error}")
        return None
    target.write_text(page, encoding="utf-8")
    time.sleep(0.4)
    return page


def text_of(fragment: str) -> str:
    fragment = re.sub(r"<img[^>]*>", "", fragment)
    fragment = re.sub(r"<br\s*/?>", " ", fragment)
    fragment = re.sub(r"<[^>]+>", "", fragment)
    return re.sub(r"\s+", " ", html.unescape(fragment)).strip()


def parse(page: str) -> dict | None:
    block = re.search(r'<span data-i18n="common_coop_action">Partner Skill</span>:\s*(.*?)</h5>(.*?)<div class="card mt-3">', page, re.S)
    if not block:
        return None
    skill = text_of(block.group(1))
    body = block.group(2)
    description = re.search(r'<div class="flex-grow-1">(.*)', body, re.S)
    desc_html = description.group(1) if description else ""
    # The text ends where the next block element (item icons, tables) begins.
    cut = re.search(r"<div|<table", desc_html)
    text = text_of(desc_html[: cut.start()] if cut else desc_html)
    table = re.search(r"<table class=\"table\">(.*?)</table>", body, re.S)
    rows = re.findall(r"<tr><td>(\d+)<td>(.*?)(?=<tr>|$)", table.group(1), re.S) if table else []
    per_level: dict[int, list[str]] = {}
    extra: dict[int, str] = {}
    for level, cell in rows:
        values: list[str] = []
        for chunk in re.findall(r"<div>(.*?)</div>", cell, re.S):
            plain = text_of(chunk)
            if plain.startswith("Awakening"):
                extra[int(level)] = plain.split(":", 1)[1].strip()
                continue
            values += re.findall(r"[-+]?\d+(?:\.\d+)?", plain)
        per_level[int(level)] = values
    return {"skill": skill, "text": text, "raw_levels": per_level, "extra": extra}


def resolve(entry: dict) -> dict:
    """Turn "(30~50)%" ranges into {k} placeholders with one value per level, matched by endpoints."""
    levels = entry["raw_levels"]
    top = max(levels) if levels else 0
    columns: list[list[str]] = []
    template = entry["text"]

    def replace(match: re.Match) -> str:
        low, high, pct = match.group(1), match.group(2), match.group(3)
        first = levels.get(1, [])
        last = levels.get(top, [])
        for index, value in enumerate(first):
            if index < len(last) and float(value) == float(low) and float(last[index]) == float(high):
                columns.append([levels.get(level, [None] * (index + 1))[index] if index < len(levels.get(level, [])) else None for level in range(1, top + 1)])
                return "{" + str(len(columns) - 1) + "}" + pct
        return match.group(0)

    template = RANGE.sub(replace, template)
    resolved = [[column[level] for column in columns] for level in range(top)] if columns else []
    out = {"skill": entry["skill"], "text": template, "levels": resolved}
    if entry["extra"]:
        out["extra"] = [entry["extra"].get(level, "") for level in range(1, top + 1)]
    return out


def pal_names() -> list[str]:
    names = set()
    if UPSTREAM_NAMES.exists():
        for key, value in json.loads(UPSTREAM_NAMES.read_text(encoding="utf-8")).items():
            if value.get("localized_name") and not key.startswith(("BOSS_", "RAID_", "PREDATOR_", "GYM_", "SUMMON_", "Quest_", "Arena_")):
                names.add(value["localized_name"])
    for _, name in re.findall(r'^\s*([A-Za-z0-9_]+)\s*=\s*"([^"]*)"', NAMES_LUA.read_text(encoding="utf-8"), re.M):
        if not name.endswith((" (Boss)", " (Predator)")):
            names.add(name)
    return sorted(names)


def main() -> None:
    refresh = "--refresh" in sys.argv
    result = json.loads(OUT.read_text(encoding="utf-8")) if OUT.exists() and not refresh else {}
    names = pal_names()
    print(f"{len(names)} names")
    missing = []
    for name in names:
        if name in result and not refresh:
            continue
        page = fetch(name, refresh)
        parsed = parse(page) if page else None
        if not parsed:
            missing.append(name)
            continue
        result[name] = resolve(parsed)
    OUT.write_text(json.dumps(result, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {OUT} ({len(result)} pals, {sum(1 for v in result.values() if v['levels'])} with per-level values)")
    print("no partner skill block:", missing)


if __name__ == "__main__":
    main()
