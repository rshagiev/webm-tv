#!/usr/bin/python3
"""Forced SSH command. Accept only a bounded release archive on stdin."""
import fcntl, json, os, pathlib, re, shutil, subprocess, sys, tarfile, tempfile, time, urllib.request
root = pathlib.Path('/srv/webmtv')
lock = open(root / '.deploy.lock', 'w')
fcntl.flock(lock, fcntl.LOCK_EX)
with tempfile.TemporaryDirectory(dir=root) as temp:
    archive = pathlib.Path(temp) / 'release.tar.gz'
    with archive.open('wb') as out:
        total = 0
        while chunk := sys.stdin.buffer.read(65536):
            total += len(chunk)
            if total > 150 * 1024 * 1024: raise ValueError('Archive exceeds limit')
            out.write(chunk)
    stage = pathlib.Path(temp) / 'release'
    stage.mkdir()
    with tarfile.open(archive) as tar:
        members = tar.getmembers()
        if sum(m.size for m in members) > 400 * 1024 * 1024 or len(members) > 20000:
            raise ValueError('Expanded archive exceeds limit')
        for m in members:
            p = pathlib.PurePosixPath(m.name)
            if p.is_absolute() or '..' in p.parts or not (m.isfile() or m.isdir()):
                raise ValueError('Unsafe archive member')
            m.mode = 0o755 if m.isdir() or m.mode & 0o111 else 0o644
        tar.extractall(stage, members=members)
    revision = json.loads((stage / 'build.json').read_text())['revision']
    if not re.fullmatch('[0-9a-f]{40}', revision): raise ValueError('Invalid revision')
    for needed in ['dist/index.html', 'server/index.ts', 'node_modules/tsx/package.json']:
        if not (stage / needed).is_file(): raise ValueError('Incomplete release')
    if (stage / 'data').exists(): raise ValueError('Data must not be included in release')
    (stage / 'data').symlink_to('/var/lib/webmtv/data')
    release = root / 'releases' / revision
    if not release.exists(): shutil.move(stage, release)
    current = root / 'current'
    previous = current.resolve() if current.is_symlink() else None
    def activate(target):
        link = root / '.next'
        link.unlink(missing_ok=True)
        link.symlink_to(target)
        link.replace(current)
        subprocess.run(['sudo', '/usr/bin/systemctl', 'restart', 'webmtv.service'], check=True)
    activate(release)
    healthy = False
    for attempt in range(30):
        try:
            with urllib.request.urlopen('http://127.0.0.1:4173/api/health', timeout=3) as r:
                data = json.load(r)
                if data.get('revision') == revision and data.get('ok'):
                    healthy = True
                    break
        except Exception: pass
        time.sleep(1)
    if not healthy:
        if previous: activate(previous)
        raise RuntimeError('Health check failed; previous release restored when available')
    keep = {release, previous}
    candidates = sorted((root / 'releases').iterdir(), key=lambda p: p.stat().st_mtime, reverse=True)
    keep.update(candidates[:3])
    for candidate in candidates:
        if candidate not in keep and candidate.is_dir(): shutil.rmtree(candidate)
    print(json.dumps({'deployed': revision, 'health': data}))
