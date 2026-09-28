#!/usr/bin/env python3
"""
wan_dl_host.py — Native Messaging Host untuk extension "WAN Studio RPA".

Tugasnya cuma satu: memindahkan file yang sudah diunduh Chrome ke path absolut
(mis. D:\\WAN\\pendtiumpraz@gmail.com\\foo.png), sesuatu yang tidak bisa
dilakukan chrome.downloads sendiri karena ia terkunci di dalam folder Download.

Protokol: 4 byte panjang (uint32 little-endian) + payload JSON UTF-8, via stdio.
PENTING: jangan pernah print() ke stdout — stdout adalah kanal protokol.
"""

import json
import os
import re
import shutil
import struct
import sys

VERSION = "1.0.0"

# Karakter yang ilegal di nama file Windows.
_BAD = re.compile(r'[<>:"|?*\x00-\x1f]')


def read_msg():
    raw = sys.stdin.buffer.read(4)
    if len(raw) < 4:
        return None
    (length,) = struct.unpack("<I", raw)
    if length == 0 or length > 64 * 1024 * 1024:
        return None
    data = sys.stdin.buffer.read(length)
    if len(data) < length:
        return None
    return json.loads(data.decode("utf-8"))


def send_msg(obj):
    body = json.dumps(obj).encode("utf-8")
    sys.stdout.buffer.write(struct.pack("<I", len(body)))
    sys.stdout.buffer.write(body)
    sys.stdout.buffer.flush()


def safe_name(s):
    s = _BAD.sub("_", str(s)).strip().strip(".")
    return s or "_"


def uniquify(path):
    if not os.path.exists(path):
        return path
    base, ext = os.path.splitext(path)
    i = 1
    while os.path.exists("%s (%d)%s" % (base, i, ext)):
        i += 1
    return "%s (%d)%s" % (base, i, ext)


def prune_empty(start, levels=3):
    """Bersihkan folder sementara yang jadi kosong setelah file dipindah."""
    p = start
    for _ in range(levels):
        try:
            if os.path.isdir(p) and not os.listdir(p):
                os.rmdir(p)
                p = os.path.dirname(p)
            else:
                return
        except OSError:
            return


def handle(msg):
    cmd = msg.get("cmd")

    if cmd == "ping":
        return {"ok": True, "version": VERSION, "python": sys.version.split()[0]}

    if cmd == "mkdir":
        d = os.path.normpath(msg["dir"])
        os.makedirs(d, exist_ok=True)
        return {"ok": True, "dir": d}

    if cmd == "exists":
        d = os.path.normpath(msg["dir"])
        name = safe_name(os.path.basename(msg["name"]))
        full = os.path.join(d, name)
        # Cocokkan juga varian "nama (1).png" hasil uniquify.
        found = os.path.isfile(full)
        if not found and os.path.isdir(d):
            base, ext = os.path.splitext(name)
            pat = re.compile(r"^%s(?: \(\d+\))?%s$" % (re.escape(base), re.escape(ext)), re.I)
            found = any(pat.match(f) for f in os.listdir(d))
        return {"ok": True, "exists": found, "path": full}

    if cmd == "scan":
        """Daftar nama file di dalam <root>/<email>/ — untuk rebuild index dari disk."""
        d = os.path.normpath(msg["dir"])
        if not os.path.isdir(d):
            return {"ok": True, "files": []}
        return {"ok": True, "files": sorted(
            f for f in os.listdir(d) if os.path.isfile(os.path.join(d, f))
        )}

    if cmd == "move":
        src = os.path.normpath(msg["src"])
        dest_dir = os.path.normpath(msg["destDir"])
        name = safe_name(os.path.basename(msg.get("destName") or os.path.basename(src)))

        if not os.path.isfile(src):
            return {"ok": False, "error": "file sumber tidak ada: %s" % src}

        os.makedirs(dest_dir, exist_ok=True)
        dst = uniquify(os.path.join(dest_dir, name))
        shutil.move(src, dst)
        prune_empty(os.path.dirname(src))
        return {"ok": True, "path": dst}

    return {"ok": False, "error": "perintah tidak dikenal: %r" % cmd}


def main():
    if sys.platform == "win32":
        import msvcrt
        msvcrt.setmode(sys.stdin.fileno(), os.O_BINARY)
        msvcrt.setmode(sys.stdout.fileno(), os.O_BINARY)

    while True:
        try:
            msg = read_msg()
        except Exception:
            break
        if msg is None:
            break
        try:
            send_msg(handle(msg))
        except Exception as e:
            send_msg({"ok": False, "error": "%s: %s" % (type(e).__name__, e)})


if __name__ == "__main__":
    main()
