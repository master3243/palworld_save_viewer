"""Download the crafting catalog's item icons for offline use."""
import base64
import concurrent.futures
import hashlib
import json
from pathlib import Path
import urllib.request

ROOT = Path(__file__).resolve().parent.parent


def main():
    catalog = json.loads((ROOT / 'resources/completion/completion-data.json').read_text())['crafting']
    icons = {key.lower(): value['Icon'] for key, value in json.loads(
        (ROOT / 'completion_sources/raw/crafting/icons.json').read_text()).items()}
    targets = sorted({entry['icon'] for entry in catalog if entry['icon']})
    manifest = ROOT / 'completion_sources/raw/crafting/icon-sources.json'
    previous = json.loads(manifest.read_text())['files'] if manifest.exists() else {}

    def download(target):
        path = ROOT / target
        key = path.stem
        asset = icons[key].split('.')[0].removeprefix('/Game/')
        url = previous.get(target, {}).get('url', f'https://raw.githubusercontent.com/oMaN-Rod/palworld-save-pal/2d244ae9ea12f2f70a66523bf83764185e22fa83/psp-ui/src/lib/assets/img/{asset.rsplit("/", 1)[-1].lower()}.webp')
        if not path.exists():
            request = urllib.request.Request(url, headers={'User-Agent': 'pw-save-viewer'})
            payload = urllib.request.urlopen(request, timeout=40).read()
            if payload[:4] != b'RIFF' or payload[8:12] != b'WEBP':
                raise ValueError(f'Not a WebP image: {url}')
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text('data:image/webp;base64,' + base64.b64encode(payload).decode('ascii') + '\n')
        encoded = path.read_text().strip()
        if not encoded.startswith('data:image/webp;base64,'):
            raise ValueError(f'Not a base64 WebP icon: {target}')
        payload = base64.b64decode(encoded.split(',', 1)[1], validate=True)
        return target, {'url': url, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
                        'image_sha256': hashlib.sha256(payload).hexdigest()}

    sources, failures = {}, []
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        jobs = {pool.submit(download, target): target for target in targets}
        for job in concurrent.futures.as_completed(jobs):
            try:
                target, source = job.result()
                sources[target] = source
            except Exception as error:
                failures.append([jobs[job], str(error)])
    manifest.write_text(
        json.dumps({'files': dict(sorted(sources.items()))}, indent=2) + '\n')
    print(f'{len(sources)}/{len(targets)} icons available locally; failures: {failures[:10]}')
    if failures:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
