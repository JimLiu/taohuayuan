#!/usr/bin/env python3
"""Fetch CC0 assets from Poly Haven (https://polyhaven.com, all assets CC0) into assets-src/polyhaven.

  python3 tools/polyhaven.py

Models come as glTF (1k textures), textures as 1k jpg maps (diffuse, GL normal, roughness, and
arm = AO/rough/metal where offered). Each asset is recorded in assets-src/LICENSES.md.
"""
import json, os, pathlib, sys, urllib.request, datetime

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / 'assets-src' / 'polyhaven'
RES = '1k'
MODELS = ['rock_moss_set_01', 'rock_moss_set_02', 'rock_face_01', 'rock_face_02', 'rock_07', 'rock_09', 'stone_01',
          'boulder_01', 'fern_02', 'root_cluster_01', 'shrub_03', 'shrub_04', 'tree_stump_01', 'weed_plant_02',
          'dead_tree_trunk', 'mountainside']
TEXTURES = ['ganges_river_pebbles', 'clean_pebbles', 'dry_river_pebbles', 'forest_ground_04', 'forrest_ground_01',
            'forest_leaves_02', 'brown_mud_leaves_01', 'lichen_rock', 'mossy_rock', 'cliff_side', 'aerial_rocks_02',
            'pine_bark', 'chinese_hackberry_bark', 'reed_roof_04', 'brown_planks_09', 'weathered_planks', 'grass_path_2']
MAPS = ['Diffuse', 'nor_gl', 'Rough', 'arm']


def get(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'taohuayuan-asset-fetch/1.0'})
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read()


def save(url, path):
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists() and path.stat().st_size > 0: return path.stat().st_size
    data = get(url)
    path.write_bytes(data)
    return len(data)


def main():
    lic = []
    total = 0
    for kind, ids in (('model', MODELS), ('texture', TEXTURES)):
        for aid in ids:
            try:
                info = json.loads(get(f'https://api.polyhaven.com/info/{aid}'))
                files = json.loads(get(f'https://api.polyhaven.com/files/{aid}'))
            except Exception as e:
                print('skip', aid, e); continue
            d = OUT / aid
            got = []
            if kind == 'model':
                g = files['gltf'][RES]['gltf']
                total += save(g['url'], d / f'{aid}.gltf'); got.append(f'{aid}.gltf')
                for rel, f in g['include'].items():
                    total += save(f['url'], d / rel); got.append(rel)
            else:
                for m in MAPS:
                    if m in files and RES in files[m]:
                        f = files[m][RES]['jpg']
                        name = pathlib.Path(f['url']).name
                        total += save(f['url'], d / name); got.append(name)
            authors = ', '.join(info.get('authors', {}).keys())
            lic.append(f"| {info.get('name', aid)} | {kind} | https://polyhaven.com/a/{aid} | {authors} | CC0 1.0 | assets-src/polyhaven/{aid}/ ({len(got)} files) |")
            print(f'{aid}: {len(got)} files, running total {total / 1e6:.1f} MB', flush=True)
    today = datetime.date.today().isoformat()
    head = ['# Third-party assets', '',
            f'## Poly Haven (downloaded {today}; every Poly Haven asset is CC0 1.0 Universal, public domain, no attribution required)', '',
            '| asset | kind | page | author(s) | license | local |', '|---|---|---|---|---|---|']
    p = ROOT / 'assets-src' / 'LICENSES.md'
    old = p.read_text(encoding='utf-8') if p.exists() else ''
    keep = old.split('## Poly Haven')[0].replace('# Third-party assets', '').strip() if old else ''
    p.write_text('\n'.join(head + lic) + ('\n\n' + keep if keep else '') + '\n', encoding='utf-8')
    print('done', f'{total / 1e6:.1f} MB')


if __name__ == '__main__':
    main()
