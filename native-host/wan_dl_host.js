/**
 * wan_dl_host.js — Native Messaging Host untuk extension "WAN Studio RPA".
 * Versi Node.js (dipakai kalau Python tidak terpasang).
 *
 * Tugasnya cuma satu: memindahkan file yang sudah diunduh Chrome ke path absolut
 * (mis. D:\AI\WAN\pendtiumpraz@gmail.com\foo.png) — sesuatu yang tidak bisa
 * dilakukan chrome.downloads sendiri karena ia terkunci di folder Download.
 *
 * Protokol: 4 byte panjang (uint32 LE) + payload JSON UTF-8, lewat stdio.
 * PENTING: jangan pernah menulis apa pun ke stdout selain pesan protokol.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const VERSION = '1.2.0';

/**
 * Folder source extension (induk dari native-host/). Menulis hasil unduhan ke
 * dalam sini akan mencampur ribuan gambar dengan kode extension dan memicu
 * Chrome me-reload extension terus-menerus. Dilarang di lapisan yang benar-benar
 * menulis file, bukan sekadar diperingatkan di UI.
 */
const EXT_ROOT = path.dirname(__dirname);

function isInside(child, parent) {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function assertSafeDest(dir) {
  if (isInside(path.resolve(dir), path.resolve(EXT_ROOT))) {
    throw new Error(
      `folder tujuan "${dir}" ada di dalam folder extension (${EXT_ROOT}) — ` +
      `itu akan mengotori kode extension. Pakai path lain, mis. D:\\WAN`
    );
  }
}

const BAD = /[<>:"|?*\u0000-\u001f]/g;

// ------------------------------------------------------------------ protokol

function send(obj) {
  const body = Buffer.from(JSON.stringify(obj), 'utf8');
  const head = Buffer.alloc(4);
  head.writeUInt32LE(body.length, 0);
  process.stdout.write(Buffer.concat([head, body]));
}

let buf = Buffer.alloc(0);

process.stdin.on('data', (chunk) => {
  buf = Buffer.concat([buf, chunk]);
  for (;;) {
    if (buf.length < 4) return;
    const len = buf.readUInt32LE(0);
    if (len === 0 || len > 64 * 1024 * 1024) { process.exit(1); }
    if (buf.length < 4 + len) return;

    const body = buf.subarray(4, 4 + len);
    buf = buf.subarray(4 + len);

    let msg;
    try { msg = JSON.parse(body.toString('utf8')); }
    catch (e) { send({ ok: false, error: 'JSON tidak valid: ' + e.message }); continue; }

    try { send(handle(msg)); }
    catch (e) { send({ ok: false, error: `${e.name}: ${e.message}` }); }
  }
});

process.stdin.on('end', () => process.exit(0));
process.stdin.on('error', () => process.exit(0));

// ------------------------------------------------------------------- helper

function safeName(s) {
  const out = String(s).replace(BAD, '_').trim().replace(/\.+$/, '');
  return out || '_';
}

function uniquify(p) {
  if (!fs.existsSync(p)) return p;
  const ext = path.extname(p);
  const base = p.slice(0, p.length - ext.length);
  let i = 1;
  while (fs.existsSync(`${base} (${i})${ext}`)) i++;
  return `${base} (${i})${ext}`;
}

/**
 * Folder yang TIDAK BOLEH dihapus dalam keadaan apa pun, walaupun kosong.
 * Versi sebelumnya naik 3 tingkat tanpa batas dari folder sementara:
 *   <email>  ->  _wanstudio_tmp  ->  C:\Users\<kamu>\Downloads
 * yang berarti folder Downloads ikut terhapus kalau kebetulan kosong.
 */
const HOME = process.env.USERPROFILE || process.env.HOME || '';
const PROTECTED = new Set(
  [HOME, 'Downloads', 'Desktop', 'Documents', 'Pictures', 'Videos', 'Music', 'OneDrive']
    .map((d) => (d === HOME ? d : path.join(HOME, d)))
    .filter(Boolean)
    .map((d) => path.resolve(d).toLowerCase())
);

function isProtectedDir(dir) {
  const r = path.resolve(dir);
  if (PROTECTED.has(r.toLowerCase())) return true;
  return path.dirname(r) === r;           // akar drive, mis. "D:\"
}

/**
 * Bersihkan folder sementara yang jadi kosong setelah file dipindah.
 * Hanya menghapus folder DI DALAM (atau sama dengan) `root`, dan tidak pernah
 * menyentuh folder terlindungi. Tanpa `root` yang sah, tidak menghapus apa pun.
 */
function pruneEmpty(start, root) {
  if (!root) return;
  const stop = path.resolve(root);
  if (isProtectedDir(stop)) return;

  let p = path.resolve(start);
  for (let i = 0; i < 6; i++) {
    if (!isInside(p, stop)) return;       // sudah keluar dari folder sementara
    if (isProtectedDir(p)) return;
    try {
      if (!fs.statSync(p).isDirectory() || fs.readdirSync(p).length) return;
      fs.rmdirSync(p);
    } catch { return; }
    if (p === stop) return;               // root sementara sudah ikut terhapus
    p = path.dirname(p);
  }
}

/** Pindah lintas-volume (C: -> D:) butuh copy+unlink, rename saja tidak cukup. */
function moveFile(src, dst) {
  try {
    fs.renameSync(src, dst);
  } catch (e) {
    if (e.code !== 'EXDEV' && e.code !== 'EPERM') throw e;
    fs.copyFileSync(src, dst);
    fs.unlinkSync(src);
  }
}

// ------------------------------------------------------------------ perintah

function handle(msg) {
  switch (msg.cmd) {

    case 'ping':
      // extRoot dilaporkan supaya sidebar bisa memperingatkan lebih awal,
      // sebelum kamu sempat menyimpan folder tujuan yang terlarang.
      return { ok: true, version: VERSION, runtime: 'node ' + process.versions.node, extRoot: EXT_ROOT };

    case 'mkdir': {
      const dir = path.normalize(msg.dir);
      assertSafeDest(dir);
      fs.mkdirSync(dir, { recursive: true });
      return { ok: true, dir };
    }

    case 'exists': {
      const dir = path.normalize(msg.dir);
      const name = safeName(path.basename(msg.name));
      const full = path.join(dir, name);
      if (fs.existsSync(full)) return { ok: true, exists: true, path: full };

      // Cocokkan juga varian "nama (1).png" hasil uniquify.
      if (!fs.existsSync(dir)) return { ok: true, exists: false, path: full };
      const ext = path.extname(name);
      const base = name.slice(0, name.length - ext.length);
      const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`^${esc(base)}(?: \\(\\d+\\))?${esc(ext)}$`, 'i');
      const hit = fs.readdirSync(dir).some((f) => re.test(f));
      return { ok: true, exists: hit, path: full };
    }

    case 'scan': {
      const dir = path.normalize(msg.dir);
      if (!fs.existsSync(dir)) return { ok: true, files: [] };
      const files = fs.readdirSync(dir, { withFileTypes: true })
        .filter((d) => d.isFile()).map((d) => d.name).sort();
      return { ok: true, files };
    }

    case 'move': {
      const src = path.normalize(msg.src);
      const destDir = path.normalize(msg.destDir);
      const name = safeName(path.basename(msg.destName || path.basename(src)));
      assertSafeDest(destDir);

      if (!fs.existsSync(src) || !fs.statSync(src).isFile()) {
        return { ok: false, error: 'file sumber tidak ada: ' + src };
      }

      /*
       * PENGAMAN INTI — `move` selalu menghapus sumbernya (rename, atau
       * copy+unlink lintas drive). Supaya hasil unduhan yang sudah tersimpan
       * MUSTAHIL terhapus, aturannya dibalik: bukan "sumber tidak boleh di
       * pustaka", melainkan **sumber WAJIB berada di dalam folder transit**.
       *
       * Daftar-larangan bocor (tujuan bisa di mana saja); daftar-izin tidak.
       */
      const prune = msg.pruneRoot ? path.resolve(msg.pruneRoot) : null;
      if (!prune) {
        return { ok: false, error: 'menolak: pruneRoot (folder transit) wajib diisi untuk move' };
      }
      if (!isInside(path.resolve(src), prune)) {
        return {
          ok: false,
          error: `menolak: sumber "${src}" bukan file transit (di luar ${prune}). ` +
                 `Hanya file hasil unduhan Chrome yang boleh dipindah.`
        };
      }
      if (isInside(path.resolve(destDir), prune)) {
        return { ok: false, error: `menolak: tujuan "${destDir}" berada di dalam folder transit` };
      }
      fs.mkdirSync(destDir, { recursive: true });
      const target = path.join(destDir, name);

      /*
       * Nama file diturunkan dari path CDN, jadi nama yang sama berarti gambar
       * yang sama. Kalau sudah ada, JANGAN dibuat "nama (1).png" — itu justru
       * menghasilkan duplikat yang seharusnya dicegah. Buang salinan sementara
       * dan laporkan file yang sudah ada.
       */
      if (msg.onExisting !== 'uniquify' && fs.existsSync(target)) {
        try { fs.unlinkSync(src); } catch {}
        pruneEmpty(path.dirname(src), msg.pruneRoot);
        return { ok: true, path: target, duplicate: true };
      }

      const dst = msg.onExisting === 'uniquify' ? uniquify(target) : target;
      moveFile(src, dst);
      // pruneRoot dikirim background = folder _wanstudio_tmp. Tanpa itu,
      // tidak ada folder yang dihapus sama sekali.
      pruneEmpty(path.dirname(src), msg.pruneRoot);
      return { ok: true, path: dst };
    }

    default:
      return { ok: false, error: 'perintah tidak dikenal: ' + JSON.stringify(msg.cmd) };
  }
}
