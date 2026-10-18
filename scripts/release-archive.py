#!/usr/bin/env python3
"""Assemble an account-free source + ARM64 runtime release archive."""
from pathlib import Path
import hashlib
import json
import subprocess
import tarfile

root = Path(__file__).resolve().parent.parent
version = json.loads((root / 'webos/appinfo.json').read_text())['version']
revision = subprocess.check_output(['git', '-C', str(root), 'rev-parse', 'HEAD'], text=True).strip()
if subprocess.check_output(['git', '-C', str(root), 'status', '--porcelain'], text=True).strip():
    raise SystemExit('Release requires a clean, committed checkout')
tracked = subprocess.check_output(['git', '-C', str(root), 'ls-files', '-z']).decode().split('\0')
output = root / 'dist' / ('telesera-' + version + '-arm64.tar.gz')
prefix = 'telesera-' + version
binary = root / 'dist/telesera-engine'
if not binary.exists():
    raise SystemExit('Build dist/telesera-engine first')
with tarfile.open(output, 'w:gz') as archive:
    for name in tracked:
        if name and not name.startswith('.github/'):
            archive.add(root / name, arcname=prefix + '/' + name, recursive=False)
    archive.add(binary, arcname=prefix + '/dist/telesera-engine')
    import io
    info = tarfile.TarInfo(prefix + '/REVISION')
    data = (revision + '\n').encode()
    info.size = len(data)
    archive.addfile(info, io.BytesIO(data))
sha = hashlib.sha256(output.read_bytes()).hexdigest()
(root / 'dist/SHA256SUMS').write_text(sha + '  ' + output.name + '\n')
print(output.name, sha, revision)
