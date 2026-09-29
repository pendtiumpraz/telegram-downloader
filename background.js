/**
 * background.js — service worker WAN Telegram Downloader.
 *
 * Inti unduhan (native host, slot unduhan, index, log) ada di dlcore.js.
 * Di sini hanya yang khusus Telegram: folder <grup>/<topik>/image|video,
 * pembacaan isi folder sebagai daftar "sudah diunduh", dan pengambilan
 * video lewat halaman Telegram sendiri.
 */

import { createCore, listen } from './dlcore.js';
import { safeDirName, keyFromFile, kindDirOf, KIND_DIRS } from './common.js';

const TG_PREFIX = 'tg:';
const CANDIDATES = ['D:/telegram', 'E:/telegram'];
const titleOf = (bucket) => String(bucket || '').slice(TG_PREFIX.length) || 'telegram';

/** Judul topik berbentuk "Grup/Topik" — tiap ruas jadi satu folder. */
const partsOf = (bucket) => {
  const parts = titleOf(bucket).split('/').filter(Boolean).map(safeDirName);
  return parts.length ? parts : ['telegram'];
};

let core;
const rootDir = () => core.resolvedRoot('tgRootDir', CANDIDATES);
const destDirFor = async (bucket) => [await rootDir(), ...partsOf(bucket)].join('/');

core = createCore({
  // Sumber sah: halaman / blob milik web.telegram.org (data: selalu boleh).
  allowUrl: (arm, item) => /^(blob:)?https?:\/\/[^/]*telegram\.org/i.test(item.url || ''),
  destDirFor,
  kindDir: (bucket, name) => kindDirOf(name),
  // Cadangan kalau folder utama gagal: kandidat drive lain.
  fallbackDirFor: async (bucket) => {
    const root = await rootDir();
    const other = CANDIDATES.find(c => c.toLowerCase() !== root.toLowerCase());
    return other ? [other, ...partsOf(bucket)].join('/') : null;
  }
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  core.probeNative();
});
chrome.runtime.onStartup.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  core.probeNative();
});
chrome.action.onClicked.addListener((tab) => chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {}));

const HANDLERS = {
  ...core.HANDLERS,

  /** Folder tujuan + berapa media yang sudah tercatat untuk satu chat. */
  async tgInfo({ bucket }) {
    const root = await rootDir();
    if (!bucket) return { root, dir: null, indexed: 0 };
    return { root, dir: await destDirFor(bucket), indexed: Object.keys(await core.getIndex(bucket)).length };
  },

  /**
   * Media yang SUDAH ada di folder chat ini: folder chat + image/ + video/.
   * Tiap berkas dinamai "<message-id>.<ext>", jadi isi folder sendiri sudah
   * merupakan daftarnya. Dibaca sekali di awal, bukan per media.
   */
  async tgScan({ bucket }) {
    const dir = await destDirFor(bucket);
    const info = await core.nativeInfo();
    if (!info.available) return { available: false, dir, mids: [] };
    try {
      const mids = [];
      for (const d of [dir, ...KIND_DIRS.map(k => `${dir}/${k}`)]) {
        mids.push(...(await core.nativeScan(d)).map(keyFromFile).filter(Boolean));
      }
      return { available: true, dir, mids: [...new Set(mids)] };
    } catch (e) {
      return { available: false, dir, mids: [], error: String(e?.message || e) };
    }
  },

  /** Sudah pernah diunduh menurut index? Kuncinya message-id, bukan URL blob. */
  async tgCheckDup({ bucket, mid }) {
    if (!bucket || !mid) return { dup: false };
    return { dup: !!(await core.getIndex(bucket))[mid], via: 'index' };
  },

  /**
   * Ambil video Telegram dari DALAM halaman (MAIN world).
   *
   * URL "stream/…" hanya dilayani service worker Telegram, dan service
   * worker itu hanya menjawab permintaan dari halamannya sendiri — dari
   * content script hasilnya "HTTP 302" atau halaman HTML. Di sini potongan
   * Range-nya diminta oleh halaman, dirakit jadi satu Blob, dan yang
   * dikembalikan cukup blob: URL-nya (origin-nya sama dengan content script,
   * jadi content script bisa membacanya). URL itu dilepas otomatis 10 menit
   * kemudian.
   */
  async tgMainFetch({ url, maxBytes = 0 }, sender) {
    const tabId = sender?.tab?.id;
    if (tabId == null) return { ok: false, error: 'tab pengirim tidak diketahui' };
    const [res] = await chrome.scripting.executeScript({
      target: { tabId }, world: 'MAIN', args: [url, maxBytes || 0],
      func: async (url, maxBytes) => {
        try {
          const abs = new URL(url, location.href).href;
          const parts = [];
          let type = '', offset = 0;
          for (let i = 0; i < 20000; i++) {
            // Pertama tanpa Range (dijawab utuh atau 206); Range hanya untuk lanjutan.
            const r = i === 0 ? await fetch(abs) : await fetch(abs, { headers: { Range: `bytes=${offset}-` } });
            if (!r.ok) return { ok: false, error: `HTTP ${r.status}` };
            const ct = r.headers.get('Content-Type') || '';
            if (/text\/html/i.test(ct)) return { ok: false, error: 'dijawab halaman HTML' };
            type = type || ct;
            const b = await r.blob();
            parts.push(b);
            const m = (r.headers.get('Content-Range') || '').match(/bytes\s+(\d+)-(\d+)\/(\d+|\*)/i);
            // Batas ukuran: berhenti begitu ketahuan terlalu besar.
            const total = m && m[3] !== '*' ? Number(m[3]) : parts.reduce((n, p) => n + p.size, 0);
            if (maxBytes && total > maxBytes) return { ok: false, tooBig: true, size: total };
            if (r.status !== 206 || !m || !b.size) break;
            offset = Number(m[2]) + 1;
            if (m[3] !== '*' && offset >= Number(m[3])) break;
          }
          const blob = new Blob(parts, { type: /^video\//i.test(type) ? type : 'video/mp4' });
          const blobUrl = URL.createObjectURL(blob);
          setTimeout(() => URL.revokeObjectURL(blobUrl), 10 * 60 * 1000);
          return { ok: true, blobUrl, size: blob.size, type: blob.type };
        } catch (e) {
          return { ok: false, error: String(e?.message || e) };
        }
      }
    });
    return res?.result || { ok: false, error: 'skrip halaman tidak mengembalikan hasil' };
  },


  async ensureTgContent({ tabId }) {
    try {
      await chrome.tabs.sendMessage(tabId, { cmd: 'tg.ping' });
      return { ok: true, injected: false };
    } catch {
      await chrome.scripting.executeScript({ target: { tabId }, files: ['tgcontent.js'] });
      return { ok: true, injected: true };
    }
  }
};

listen(HANDLERS);
