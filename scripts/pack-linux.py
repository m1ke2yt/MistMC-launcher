# Перепаковка linux-unpacked в tar.gz с корректными правами (electron-builder
# на Windows теряет бит +x). Запуск: python scripts/pack-linux.py
import tarfile, os, sys

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src = os.path.join(root, 'release', 'linux-unpacked')
out = os.path.join(root, 'release', 'MistMC-Launcher-linux-x64.tar.gz')
top = 'MistMC-Launcher-linux-x64'

EXEC_NAMES = {'mistmc-launcher', 'chrome-sandbox', 'chrome_crashpad_handler'}

def is_exec(rel):
    base = os.path.basename(rel)
    if base in EXEC_NAMES:
        return True
    # вся вшитая JRE: java, jspawnhelper, keytool и т.д.
    if rel.startswith('resources/jre/'):
        return True
    if rel.endswith('.sh'):
        return True
    return False

if not os.path.isdir(src):
    print('нет папки', src); sys.exit(1)

count = 0
with tarfile.open(out, 'w:gz', compresslevel=6) as tf:
    for cur, dirs, files in os.walk(src):
        for d in sorted(dirs):
            full = os.path.join(cur, d)
            rel = os.path.relpath(full, src).replace('\\', '/')
            ti = tarfile.TarInfo(top + '/' + rel)
            ti.type = tarfile.DIRTYPE
            ti.mode = 0o755
            ti.uid = ti.gid = 0
            ti.uname = ti.gname = ''
            tf.addfile(ti)
        for f in sorted(files):
            full = os.path.join(cur, f)
            rel = os.path.relpath(full, src).replace('\\', '/')
            ti = tarfile.TarInfo(top + '/' + rel)
            ti.size = os.path.getsize(full)
            ti.mode = 0o755 if is_exec(rel) else 0o644
            ti.uid = ti.gid = 0
            ti.uname = ti.gname = ''
            with open(full, 'rb') as fh:
                tf.addfile(ti, fh)
            count += 1

print('готово:', out, '| файлов:', count, '| размер:', round(os.path.getsize(out)/1048576, 1), 'МБ')
