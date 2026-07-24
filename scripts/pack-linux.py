# Repacks release/linux-unpacked into a tar.gz with correct file modes.
# electron-builder run on Windows drops the executable bit, so we set it here.
# Usage: python scripts/pack-linux.py
import tarfile, os, sys

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src = os.path.join(root, 'release', 'linux-unpacked')
out = os.path.join(root, 'release', 'MistMC-Launcher-linux-x64.tar.gz')
top = 'MistMC-Launcher-linux-x64'

EXEC_NAMES = {'mistmc-launcher', 'chrome-sandbox', 'chrome_crashpad_handler'}

def is_exec(rel):
    if os.path.basename(rel) in EXEC_NAMES:
        return True
    if rel.startswith('resources/jre/'):
        return True
    return rel.endswith('.sh')

if not os.path.isdir(src):
    print('missing', src); sys.exit(1)

count = 0
with tarfile.open(out, 'w:gz', compresslevel=6) as tf:
    for cur, dirs, files in os.walk(src):
        for d in sorted(dirs):
            rel = os.path.relpath(os.path.join(cur, d), src).replace('\\', '/')
            ti = tarfile.TarInfo(top + '/' + rel)
            ti.type = tarfile.DIRTYPE
            ti.mode = 0o755
            ti.uid = ti.gid = 0
            tf.addfile(ti)
        for f in sorted(files):
            full = os.path.join(cur, f)
            rel = os.path.relpath(full, src).replace('\\', '/')
            ti = tarfile.TarInfo(top + '/' + rel)
            ti.size = os.path.getsize(full)
            ti.mode = 0o755 if is_exec(rel) else 0o644
            ti.uid = ti.gid = 0
            with open(full, 'rb') as fh:
                tf.addfile(ti, fh)
            count += 1

print('done:', out, '| files:', count, '| size:', round(os.path.getsize(out) / 1048576, 1), 'MB')
