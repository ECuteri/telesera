#!/usr/bin/env python3
"""Install a locally built release on a rooted webOS TV over authenticated SSH."""
import argparse
import hashlib
import json
import os
import re
from pathlib import Path
import secrets
import selectors
import shlex
import shutil
import subprocess
import tarfile
import tempfile
import time

ROOT = '/media/developer/telesera'

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--host', required=True, help='SSH destination, preferably an existing SSH host alias')
    parser.add_argument('--config', required=True, type=Path, help='Private JSON with api_id and api_hash')
    parser.add_argument('--identity', type=Path)
    parser.add_argument('--known-hosts', type=Path)
    parser.add_argument('--ares-package', default='ares-package')
    parser.add_argument('--binary', type=Path, default=Path('dist/telesera-engine'))
    args = parser.parse_args()
    repo = Path(__file__).resolve().parent.parent
    raw = json.loads(args.config.read_text())
    if not isinstance(raw.get('api_id'), int) or raw['api_id'] <= 0 or len(raw.get('api_hash', '')) != 32:
        raise SystemExit('Invalid Telegram API configuration')
    token = raw.get('token') or secrets.token_urlsafe(32)
    if not isinstance(token, str) or len(token) < 32:
        raise SystemExit('Local token must contain at least 32 characters')
    binary = args.binary.resolve()
    if (repo / '.git').exists():
        commit = subprocess.check_output(['git', '-C', str(repo), 'rev-parse', 'HEAD'], text=True).strip()
        if subprocess.check_output(['git', '-C', str(repo), 'status', '--porcelain'], text=True).strip():
            raise SystemExit('Commit the reviewed release before installing it')
    else:
        commit = (repo / 'REVISION').read_text().strip()
    if not re.fullmatch(r'[0-9a-f]{40}', commit):
        raise SystemExit('Invalid release revision')
    options = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', '-o', 'StrictHostKeyChecking=yes']
    if args.identity:
        options += ['-i', str(args.identity.expanduser())]
    if args.known_hosts:
        options += ['-o', 'UserKnownHostsFile=' + str(args.known_hosts.expanduser())]
    def remote(command):
        return subprocess.check_output(['ssh', *options, args.host, command], text=True)
    if remote('uname -m').strip() != 'aarch64':
        raise SystemExit('This artifact requires a Linux ARM64 kernel')
    previous = remote('if [ -f ' + ROOT + '/private/config.json ]; then cat ' + ROOT + '/private/config.json; fi')
    if previous and not raw.get('token'):
        token = json.loads(previous)['token']
    digest = hashlib.sha256(binary.read_bytes()).hexdigest()
    with tempfile.TemporaryDirectory(prefix='telesera-install-') as tmp:
        tmp = Path(tmp)
        stage = tmp / 'release'
        stage.mkdir()
        shutil.copy2(binary, stage / 'engine')
        (stage / 'engine').chmod(0o755)
        shutil.copytree(repo / 'ui', stage / 'ui')
        (stage / 'revision').write_text(commit + '\n')
        (stage / 'engine.sha256').write_text(digest + '  engine\n')
        app = tmp / 'app'
        shutil.copytree(repo / 'webos', app, ignore=shutil.ignore_patterns('bootstrap.js', 'bootstrap.example.js'))
        shutil.copy2(repo / 'ui/i18n.js', app / 'i18n.js')
        url = 'http://127.0.0.1:3190/#token=' + __import__('urllib.parse', fromlist=['quote']).quote(token, safe='')
        bootstrap = "window.TeleseraTarget=" + json.dumps(url) + ";"
        (app / 'bootstrap.js').write_text(bootstrap)
        subprocess.run([args.ares_package, str(app), '-o', str(tmp)], check=True, stdout=subprocess.DEVNULL)
        package = next(tmp.glob('*.ipk'))
        config = dict(api_id=raw['api_id'], api_hash=raw['api_hash'], token=token,
                      data_dir=ROOT + '/private', ui_dir=ROOT + '/current/ui', port=3190)
        configfile = tmp / 'config.json'
        configfile.write_text(json.dumps(config))
        configfile.chmod(0o600)
        archive = tmp / 'release.tar.gz'
        with tarfile.open(archive, 'w:gz') as tf:
            tf.add(stage, arcname='release')
            tf.add(configfile, arcname='config.json')
            tf.add(package, arcname='app.ipk')
            tf.add(repo / 'scripts/25-telesera', arcname='25-telesera')
        dest = ROOT + '/incoming-' + commit[:12]
        remote('umask 077; mkdir -p ' + shlex.quote(dest))
        subprocess.run(['scp', '-q', *options, str(archive), args.host + ':' + dest + '/bundle.tar.gz'], check=True)
        # The old version and account directory are retained. No TV reboot or audio/picture change.
        command = '''set -eu
umask 077
[ ! -d {root}/releases/{revision} ] || {{ echo 'Revision already installed; inspect it before reinstalling.' >&2; exit 1; }}
cd {dest}
tar -xzf bundle.tar.gz
cd release
sha256sum -c engine.sha256
cd ..
mkdir -p {root}/releases {root}/private
chmod 700 {root}/private
cp 25-telesera /var/lib/webosbrew/init.d/25-telesera
chmod 755 /var/lib/webosbrew/init.d/25-telesera
/var/lib/webosbrew/init.d/25-telesera stop
if [ -e {root}/private/config.json ]; then cp {root}/private/config.json {root}/private/config.previous.json; fi
cp config.json {root}/private/config.json
chmod 600 {root}/private/config.json
if [ -L {root}/current ]; then readlink {root}/current > {root}/private/previous-release; fi
mv release {root}/releases/{revision}
ln -sfn {root}/releases/{revision} {root}/current
/var/lib/webosbrew/init.d/25-telesera
'''.format(dest=shlex.quote(dest), root=ROOT, revision=commit)
        # A subscription needs an open input/PTY on webOS. Three replies only
        # reach package verification, not installation completion.
        remote(command)
        request = json.dumps(dict(id='it.ennio.telesera', ipkUrl=dest + '/app.ipk', subscribe=True))
        install = 'luna-send -i -w 30000 luna://com.webos.appInstallService/dev/install ' + shlex.quote(request)
        process = subprocess.Popen(['ssh', '-tt', *options, args.host, install],
                                   stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        installed = False
        selector = selectors.DefaultSelector()
        selector.register(process.stdout, selectors.EVENT_READ)
        pending = b''
        deadline = time.monotonic() + 50
        try:
            while time.monotonic() < deadline:
                if not selector.select(timeout=min(1, max(0, deadline - time.monotonic()))):
                    if process.poll() is not None:
                        break
                    continue
                chunk = os.read(process.stdout.fileno(), 8192)
                if not chunk:
                    break
                pending += chunk
                while b'\n' in pending:
                    line, pending = pending.split(b'\n', 1)
                    try:
                        event = json.loads(line)
                    except ValueError:
                        continue
                    if event.get('returnValue') is False or 'FAILED' in str(event.get('statusValue', '')).upper():
                        raise RuntimeError('TV rejected the package: ' + str(event.get('errorText') or event.get('details')))
                    if event.get('id') == 'it.ennio.telesera' and event.get('details', {}).get('state') == 'installed':
                        installed = True
                        break
                if installed:
                    break
        finally:
            selector.close()
            process.terminate()
            try:
                process.communicate(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.communicate()
        if not installed:
            raise RuntimeError('TV did not confirm installation; staging files and rollback are retained')
        remote('rm -f ' + dest + '/bundle.tar.gz ' + dest + '/config.json ' + dest + '/app.ipk')
        print('Installed revision', commit, 'engine SHA256', digest)
        print('Check the installer result, then verify /api/status and the TV workflow before declaring success.')

if __name__ == '__main__':
    main()
