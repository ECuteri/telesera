#!/usr/bin/env python3
"""Collect notices from the exact Cargo-locked runtime dependency graph."""
import json
from pathlib import Path
import subprocess

root = Path(__file__).resolve().parent.parent
metadata = json.loads(subprocess.check_output([
    'cargo', 'metadata', '--manifest-path', str(root / 'engine/Cargo.toml'),
    '--locked', '--format-version', '1', '--filter-platform', 'aarch64-unknown-linux-musl'
], text=True))
used = {node['id'] for node in metadata['resolve']['nodes']}
chunks = ['# Third-party notices\n\nGenerated from engine/Cargo.lock. Telesera is copyright Ennio Cuteri; the following components retain their own notices.\n']
missing = []
for package in sorted(metadata['packages'], key=lambda p: (p['name'], p['version'])):
    if package['id'] not in used or package['source'] is None:
        continue
    directory = Path(package['manifest_path']).parent
    files = sorted(p for p in directory.iterdir() if p.is_file() and p.name.lower().startswith(('license', 'licence', 'copying', 'copyright', 'notice')))
    if not files and (package.get('repository') or '').rstrip('/').endswith('/Lonami/grammers'):
        files = [root / 'docs/licenses/grammers-MIT.txt']
    if not files:
        missing.append(package['name'] + '@' + package['version'])
    chunks.append('\n## ' + package['name'] + ' ' + package['version'] + '\n\nLicense: ' + (package.get('license') or 'See package license') + '\n\nSource: ' + (package.get('repository') or 'https://crates.io/crates/' + package['name']) + '\n')
    for path in files:
        chunks.append('\n### ' + path.name + '\n\n```text\n' + '\n'.join(line.rstrip() for line in path.read_text(errors='replace').splitlines()) + '\n```\n')
if missing:
    raise SystemExit('Review missing notice files: ' + ', '.join(missing))
(root / 'THIRD_PARTY.md').write_text(''.join(chunks))
print('Collected notices for', len(used) - 1, 'locked dependency nodes')
