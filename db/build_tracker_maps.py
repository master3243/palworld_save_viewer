"""Build local tracker terrain and calibration from preserved sources, offline.

Run: python3 -m pip install -r db/requirements-build.txt; python3 db/build_tracker_maps.py
maps.db preserves original game textures and map icons with individual source hashes.
The existing map JavaScript supplies world bounds. No upstream code is executed.
"""
import base64
import hashlib
import io
import json
import re
from pathlib import Path
from zipfile import ZipFile

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "completion_sources" / "raw"
OUT = ROOT / "resources" / "completion" / "maps"


def write_pog(path, payload, mime):
    path.write_text(f"data:{mime};base64," + base64.b64encode(payload).decode("ascii"))


def save_image(image, path, **options):
    payload = io.BytesIO()
    image.save(payload, format="WEBP", **options)
    write_pog(path, payload.getvalue(), "image/webp")


def build():
    OUT.mkdir(parents=True, exist_ok=True)
    maps = []
    with ZipFile(RAW / "maps.db") as archive:
        sources = json.loads(archive.read("sources.json"))["files"]
        for name, source in sources.items():
            if hashlib.sha256(archive.read(name)).hexdigest() != source["sha256"]:
                raise ValueError(f"Source hash mismatch: {name}")
        for key, title in (("palpagos", "Palpagos Islands"), ("tree", "World Tree")):
            src = (RAW / f"paldb_map_{key}.js").read_text()
            match = re.search(r"var config\s*=\s*", src)
            config = json.JSONDecoder().raw_decode(src, match.end())[0]
            lo, hi = config["landScapeRealPositionMin"], config["landScapeRealPositionMax"]
            texture = "T_WorldMap.png" if key == "palpagos" else "T_TreeMap.png"
            original = Image.open(io.BytesIO(archive.read(texture))).convert("RGBA")
            if original.size != (8192, 8192):
                raise ValueError(f"Unexpected terrain size: {texture} {original.size}")
            atlas = Image.new("RGBA", original.size, "#0b161c")
            atlas.alpha_composite(original)
            atlas = atlas.convert("RGB")
            save_image(atlas.resize((2048, 2048), Image.Resampling.LANCZOS), OUT / f"{key}.pog", quality=90, method=6)
            detail = OUT / key
            detail.mkdir(exist_ok=True)
            for y in range(4):
                for x in range(4):
                    save_image(atlas.crop((x*2048, y*2048, (x+1)*2048, (y+1)*2048)), detail / f"{x}-{y}.pog", quality=90, method=6)
            maps.append({"key": key, "name": title, "image": f"resources/completion/maps/{key}.pog", "detail": f"resources/completion/maps/{key}",
                         "minX": (lo["Y"] - 157935) / 459, "maxX": (hi["Y"] - 157935) / 459,
                         "minY": (lo["X"] + 123930) / 459, "maxY": (hi["X"] + 123930) / 459})
            if key == "tree":
                page = archive.read("tree.html").decode()
                per_pixel = float(re.search(r"const perPixel = ([\d.]+)", page)[1])
                start_x = float(re.search(r"ingame_y_start: ([-\d.]+)", page)[1])
                start_y = float(re.search(r"ingame_x_start: ([-\d.]+)", page)[1])
                maps[-1].update(minX=-start_x, maxX=(hi["Y"]-lo["Y"])/per_pixel-start_x,
                                minY=-start_y, maxY=(hi["X"]-lo["X"])/per_pixel-start_y)
        icons = {}
        icon_dir = OUT / "icons"
        icon_dir.mkdir(exist_ok=True)
        for name in sorted(sources):
            if not name.startswith("icons/"):
                continue
            label = Path(name).stem
            filename = label.lower().replace(" ", "-") + ".pog"
            icon = Image.open(io.BytesIO(archive.read(name))).convert("RGBA")
            bounds = icon.getchannel("A").point(lambda alpha: 255 if alpha > 16 else 0).getbbox()
            if bounds:
                icon = icon.crop(bounds)
            icon.thumbnail((48, 48), Image.Resampling.LANCZOS)
            save_image(icon, icon_dir / filename, lossless=True)
            icons[label] = f"resources/completion/maps/icons/{filename}"
        # Simple map conventions for categories without an available game texture.
        symbols = {
            "Main Mission": '<path fill="#ffd779" d="M12 1 23 12 12 23 1 12Z"/><path stroke="#18202b" stroke-width="2.5" d="M12 6v8m0 2v2"/>',
            "Sub Mission": '<path fill="#b4c2ff" d="M12 1 23 12 12 23 1 12Z"/><path stroke="#18202b" stroke-width="2.5" d="M12 6v8m0 2v2"/>',
            "Region": '<path fill="#cce8ec" stroke="#122c3b" stroke-width="1" d="m1 20 8-15 5 8 3-5 6 12Zm5-4h6l-3-5Zm10 0h4l-2-4Z"/>',
        }
        for label, shape in symbols.items():
            filename = label.lower().replace(" ", "-") + ".pog"
            write_pog(icon_dir / filename, f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">{shape}</svg>\n'.encode(), "image/svg+xml")
            icons[label] = f"resources/completion/maps/icons/{filename}"
        (OUT / "icons.json").write_text(json.dumps(icons, indent=2) + "\n")
    (OUT / "maps.json").write_text(json.dumps(maps, indent=2) + "\n")
    # Remove superseded generated images; original source files stay in maps.db.
    for path in OUT.rglob("*"):
        if path.suffix in {".webp", ".svg"}:
            path.unlink()
    print(f"Built {len(maps)} tracker maps in {OUT}")


if __name__ == "__main__":
    build()
