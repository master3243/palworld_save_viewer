"""Reduce a paldb.cc map data to the few marker kinds the 100% tracker uses.

Usage:  python3 clean_paldb_map_dump.py            (every completion_sources/raw/paldb_map_*.js)
        python3 clean_paldb_map_dump.py <dump.js> [out.json]
"""
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent


def grab(src: str, name: str):
    """Parse the JSON literal assigned to `var <name> = ...;`."""
    match = re.search(r"var\s+" + re.escape(name) + r"\s*=\s*", src)
    if not match:
        return None
    start = match.end()
    depth = 0
    in_string = False
    escaped = False
    i = start
    while i < len(src):
        char = src[i]
        if in_string:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_string = False
        elif char == '"':
            in_string = True
        elif char in "[{":
            depth += 1
        elif char in "]}":
            depth -= 1
            if depth == 0:
                i += 1
                break
        i += 1
    return json.loads(src[start:i])


def to_map(pos: dict) -> list[int]:
    """Unreal world position -> in-game map coordinates."""
    return [round((pos["Y"] - 157935) / 459), round((pos["X"] + 123930) / 459)]


def strip_html(text: str) -> str:
    return re.sub(r"<[^>]+>", "", text).strip()


def reduce_dump(dump: Path) -> dict:
    src = dump.read_text(encoding="utf-8")
    markers = grab(src, "fixedDungeon") or []
    extras = grab(src, "extrasIngame") or []
    regions = grab(src, "regionData") or []
    return {
        "source": f"paldb.cc map data ({dump.name}, https://paldb.cc/en/Map), reduced by clean_paldb_map_dump.py; map = in-game map coordinates",
        "ruins": sorted(
            ({"map": to_map(m["pos"]), "item": strip_html(m.get("comment") or "")} for m in markers if m.get("type") == "Ancient Ruin"),
            key=lambda r: r["map"],
        ),
        "journals": sorted(
            ({"map": to_map(m["pos"]), "title": strip_html(m["item"])} for m in markers if m.get("type") == "Journals"),
            key=lambda r: r["map"],
        ),
        "regions": sorted(
            ({"id": r["id"], "name": strip_html(r["item"]), "map": [r["ipos"]["X"], r["ipos"]["Y"]]} for r in regions),
            key=lambda r: r["id"],
        ),
        "palCritics": sorted([e["ipos"]["X"], e["ipos"]["Y"]] for e in extras if e.get("type") == "Arrogant Pal Critic"),
    }


def write_reduced(data: dict, out: Path) -> None:
    """One entry per line so git diffs show exactly which markers changed."""
    keys = ("ruins", "journals", "regions", "palCritics")
    lines = ["{", f'"source":{json.dumps(data["source"])},']
    for index, key in enumerate(keys):
        entries = data[key]
        lines.append(f'"{key}":[')
        for i, entry in enumerate(entries):
            lines.append(json.dumps(entry, separators=(",", ":"), ensure_ascii=False) + ("," if i < len(entries) - 1 else ""))
        lines.append("]" + ("," if index < len(keys) - 1 else ""))
    lines.append("}")
    out.write_text("\n".join(lines) + "\n", encoding="utf-8")


def reduce_all(sources: Path = HERE / "completion_sources") -> dict[str, dict]:
    """Reduce every raw dump; returns {map name: data} and refreshes the reduced JSON files."""
    reduced = {}
    for dump in sorted((sources / "raw").glob("paldb_map_*.js")):
        map_name = dump.stem.removeprefix("paldb_map_")
        data = reduce_dump(dump)
        write_reduced(data, sources / f"paldb_map_{map_name}.json")
        reduced[map_name] = data
        print(f"  {dump.name}: {len(data['ruins'])} ruins, {len(data['journals'])} journals, {len(data['regions'])} regions, {len(data['palCritics'])} Pal Critics")
    return reduced


def main() -> None:
    if len(sys.argv) > 1:
        dump = Path(sys.argv[1])
        out = Path(sys.argv[2]) if len(sys.argv) > 2 else HERE / "completion_sources" / f"{dump.stem}.json"
        write_reduced(reduce_dump(dump), out)
        print(f"wrote {out}")
    else:
        reduce_all()


if __name__ == "__main__":
    main()
