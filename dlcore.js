/**
 * dlcore.js — inti unduhan yang dipakai service worker.
 *
 * Diturunkan dari background.js milik WAN Studio RPA (D:/AI/wan) dan dipakai
 * apa adanya oleh extension Telegram (D:/AI/tele) dan Dreamina
 * (D:/AI/dreamina). Isinya hanya yang sama untuk semuanya:
 *   - probe Native Messaging Host
 *   - slot unduhan ("arm") + catatan per downloadId
 *   - pemindahan berkas dari folder transit Chrome ke folder tujuan
 *   - index anti-duplikat per bucket
 *   - log
 *
 * Yang berbeda per extension (sumber unduhan yang sah, folder tujuan,
 * subfolder per jenis berkas) dioper lewat createCore({...}).
 */

import { NATIVE_HOST, STORE, getSettings, setSettings, safeFileName, safeDirName, finalRelPath } from './common.js';

export function createCore({ allowUrl, destDirFor, kindDir = () => '', fallbackDirFor = null }) {

  // ------------------------------------------------------------ native host

  async function probeNative() {
    let info;
    try {
      const res = await chrome.runtime.sendNativeMessage(NATIVE_HOST, { cmd: 'ping' });
      info = {
        available: !!res?.ok,
        version: res?.version || '?',
        runtime: res?.runtime || '',
        extRoot: res?.extRoot || '',   // folder source extension — terlarang jadi tujuan
        checkedAt: Date.now()
      };
    } catch (e) {
      info = { available: false, error: String(e?.message || e), checkedAt: Date.now() };
    }
    await chrome.storage.local.set({ [STORE.nativeInfo]: info });
    return info;
  }

  async function nativeInfo() {
    const { [STORE.nativeInfo]: i } = await chrome.storage.local.get(STORE.nativeInfo);
    return i || { available: false, error: 'belum diprobe' };
  }

  const normPath = (p) => String(p || '').replace(/[\\/]+/g, '/').replace(/\/+$/, '').toLowerCase();
  function insideExtension(dir, extRoot) {
    if (!extRoot) return false;
    const ext = normPath(extRoot), cur = normPath(dir);
    return cur === ext || cur.startsWith(ext + '/');
  }
  const stripTrailing = (p) => String(p).replace(/[\\/]+$/, '');

  /**
   * Folder induk: isian manual di setelan, atau kandidat pertama yang BISA
   * dibuat (mkdir yang berhasil adalah satu-satunya bukti drive-nya ada dan
   * bisa ditulis). Di-cache karena dipanggil sekali per berkas.
   */
  const rootCache = {};
  async function resolvedRoot(settingKey, candidates) {
    const s = await getSettings();
    const manual = stripTrailing(String(s[settingKey] || '').trim());
    if (manual) {
      const info = await nativeInfo();
      return insideExtension(manual, info.extRoot) ? candidates[0] : manual;
    }
    if (rootCache[settingKey]) return rootCache[settingKey];
    const info = await nativeInfo();
    if (!info.available) return candidates[0];
    for (const dir of candidates) {
      try {
        const res = await chrome.runtime.sendNativeMessage(NATIVE_HOST, { cmd: 'mkdir', dir });
        if (res?.ok) { rootCache[settingKey] = dir; return dir; }
      } catch { /* drive tidak ada / tidak bisa ditulis: coba kandidat berikutnya */ }
    }
    return candidates[0];
  }

  async function nativeScan(dir) {
    const res = await chrome.runtime.sendNativeMessage(NATIVE_HOST, { cmd: 'scan', dir });
    return res?.files || [];
  }

  /**
   * Batas atas pembersihan folder sementara: folder <tmpSubdir> itu sendiri.
   * Host menolak `move` tanpa pruneRoot — itulah jaminan sumbernya berkas
   * transit, bukan hasil unduhan yang sudah tersimpan.
   */
  function tmpRootOf(fullPath, tmpSubdir) {
    const marker = String(tmpSubdir || '').toLowerCase();
    if (!marker) return null;
    const lower = fullPath.toLowerCase();
    for (const sep of ['\\', '/']) {
      const i = lower.lastIndexOf(sep + marker + sep);
      if (i >= 0) return fullPath.slice(0, i + 1 + marker.length);
    }
    return null;
  }

  // ------------------------------------------------------------------ index

  /* Index anti-duplikat, satu kunci storage per bucket ("dlidx:<bucket>"). */
  const IDX_PREFIX = 'dlidx:';
  const idxKeyFor = (b) => IDX_PREFIX + b;

  async function getIndex(bucket) {
    const k = idxKeyFor(bucket);
    const o = await chrome.storage.local.get(k);
    return o[k] && typeof o[k] === 'object' ? o[k] : {};
  }
  async function addKey(bucket, key) {
    if (!bucket || !key) return;
    const map = await getIndex(bucket);
    if (map[key]) return;
    map[key] = Date.now();
    await chrome.storage.local.set({ [idxKeyFor(bucket)]: map });
  }
  async function indexStats() {
    const all = await chrome.storage.local.get(null);
    const out = {};
    for (const [k, v] of Object.entries(all)) {
      if (k.startsWith(IDX_PREFIX)) out[k.slice(IDX_PREFIX.length)] = Object.keys(v || {}).length;
    }
    return out;
  }
  async function clearIndex(bucket) {
    if (bucket) { await chrome.storage.local.remove(idxKeyFor(bucket)); return; }
    const all = await chrome.storage.local.get(null);
    const keys = Object.keys(all).filter(k => k.startsWith(IDX_PREFIX));
    if (keys.length) await chrome.storage.local.remove(keys);
  }

  // -------------------------------------------------------------------- log

  const LOG_MAX = 400;
  async function pushLog(level, msg, extra) {
    const { [STORE.log]: log } = await chrome.storage.local.get(STORE.log);
    const arr = Array.isArray(log) ? log : [];
    arr.push({ t: Date.now(), level, msg: String(msg), extra: extra ?? null });
    while (arr.length > LOG_MAX) arr.shift();
    await chrome.storage.local.set({ [STORE.log]: arr });
  }

  // ---------------------------------------------------------- slot unduhan

  /*
   * "arm" = satu slot unduhan yang sedang ditunggu. Disimpan di
   * storage.session supaya selamat kalau service worker sempat di-suspend.
   * "pending" = catatan per downloadId, supaya unduhan yang selesai
   * terlambat tetap dipindah dan dicatat walau slotnya sudah ditimpa.
   */
  const getArm = async () => (await chrome.storage.session.get('arm')).arm || null;
  const setArm = async (arm) => { await chrome.storage.session.set({ arm }); return arm; };
  const patchArm = async (patch) => { const a = await getArm(); return a ? setArm({ ...a, ...patch }) : null; };

  async function getPending() {
    const { pending } = await chrome.storage.session.get('pending');
    return pending && typeof pending === 'object' ? pending : {};
  }
  async function addPending(id, rec) {
    const p = await getPending();
    p[id] = { ...rec, ts: Date.now() };
    for (const [k, v] of Object.entries(p)) if (Date.now() - (v.ts || 0) > 30 * 60 * 1000) delete p[k];
    await chrome.storage.session.set({ pending: p });
  }
  async function takePending(id) {
    const p = await getPending();
    const rec = p[id];
    if (rec) { delete p[id]; await chrome.storage.session.set({ pending: p }); }
    return rec || null;
  }

  let armSeq = 0;
  let lastDownloadUrl = null;

  async function armDownload(bucket, key, { fixedExt = false } = {}) {
    const s = await getSettings();
    const info = await nativeInfo();
    const dir = safeDirName(bucket);
    const name = safeFileName(key);
    // Tanpa native host berkasnya berhenti di folder Download Chrome, jadi
    // subfolder jenis berkas (image/ video/) dibuat di sini.
    const kind = kindDir(bucket, name);
    const relPath = info.available
      ? `${s.tmpSubdir}/${dir}/${name}`
      : `${dir}/${kind ? kind + '/' : ''}${name}`;

    const arm = {
      id: `arm_${Date.now()}_${++armSeq}`,
      email: bucket, key, relPath,
      fixedExt: !!fixedExt,
      useNative: !!info.available,
      state: 'armed', downloadId: null, finalPath: null, error: null,
      ts: Date.now()
    };
    await setArm(arm);
    return { armId: arm.id, relPath, useNative: arm.useNative };
  }

  chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
    (async () => {
      const arm = await getArm();
      if (!arm || arm.state !== 'armed') { suggest(); return; }
      // Jangan membajak unduhan lain milik pengguna: slot harus segar DAN
      // sumbernya harus sah untuk extension ini.
      if (Date.now() - arm.ts > 120000) { suggest(); return; }
      const u = item.url || '';
      if (!(u.startsWith('data:') || allowUrl(arm, item))) { suggest(); return; }

      const rel = finalRelPath(arm.relPath, item.filename || item.url, arm.fixedExt);
      await patchArm({ state: 'downloading', downloadId: item.id, relPath: rel });
      await addPending(item.id, { email: arm.email, key: arm.key, useNative: arm.useNative });
      suggest({ filename: rel, conflictAction: 'uniquify' });
    })();
    return true; // wajib: suggest() dipanggil asinkron
  });

  async function finalizeDownload(downloadId, rec, state) {
    const arm = await getArm();
    const isCurrent = arm && arm.downloadId === downloadId;
    const patchIfCurrent = (p) => (isCurrent ? patchArm(p) : Promise.resolve());

    if (state !== 'complete') {
      await patchIfCurrent({ state: 'failed', error: state });
      await pushLog('err', `Unduhan gagal: ${state}`, { key: rec.key });
      return;
    }

    const [item] = await chrome.downloads.search({ id: downloadId });
    let finalPath = item?.filename || '';
    const s = await getSettings();
    const pruneRoot = rec.useNative ? tmpRootOf(finalPath, s.tmpSubdir) : null;

    if (rec.useNative && finalPath && !pruneRoot) {
      await pushLog('err', `Tidak menemukan folder transit "${s.tmpSubdir}" di ${finalPath} — file dibiarkan di tempatnya.`);
    }

    if (rec.useNative && finalPath && pruneRoot) {
      const destName = finalPath.split(/[\\/]/).pop();
      const kind = kindDir(rec.email, destName);
      const sub = kind ? `/${kind}` : '';
      const targets = [`${await destDirFor(rec.email)}${sub}`];
      const fb = fallbackDirFor ? await fallbackDirFor(rec.email) : null;
      if (fb && `${fb}${sub}` !== targets[0]) targets.push(`${fb}${sub}`);

      let moved = false, lastErr = '';
      for (const destDir of targets) {
        try {
          const res = await chrome.runtime.sendNativeMessage(NATIVE_HOST,
            { cmd: 'move', src: finalPath, destDir, destName, pruneRoot });
          if (res?.ok) {
            finalPath = res.path || `${destDir}/${destName}`;
            moved = true;
            if (res.duplicate) await pushLog('warn', `Sudah ada di disk, salinan baru dibuang: ${finalPath}`);
            break;
          }
          lastErr = res?.error || 'unknown';
        } catch (e) {
          lastErr = String(e?.message || e);
        }
        await pushLog('warn', `Gagal memindahkan ke ${destDir}: ${lastErr}`);
      }
      if (moved && targets.length > 1 && finalPath.startsWith(targets[1])) {
        await pushLog('err', `PERHATIAN: folder tujuan (${targets[0]}) tidak bisa dipakai, file dialihkan ke ${targets[1]}.`);
      }
      if (!moved) await pushLog('err', `FILE MASIH DI FOLDER DOWNLOAD: ${finalPath} (${lastErr})`);
    }

    await addKey(rec.email, rec.key);
    await patchIfCurrent({ state: 'done', finalPath });
    if (lastDownloadUrl && item?.url && item.url === lastDownloadUrl && /^https?:/i.test(item.url)) {
      await pushLog('err', 'URL SAMA PERSIS dengan unduhan sebelumnya — situs mengulang file yang sama.');
    }
    lastDownloadUrl = item?.url || null;
    await pushLog('ok', `Tersimpan: ${finalPath}`, { bucket: rec.email, key: rec.key });
  }

  chrome.downloads.onChanged.addListener((delta) => {
    (async () => {
      // onChanged menyala banyak kali per unduhan; hanya state final yang dipakai.
      const state = delta.state?.current;
      if (state !== 'complete' && state !== 'interrupted') return;
      const rec = await takePending(delta.id);
      if (rec) await finalizeDownload(delta.id, rec, state);
    })();
  });

  // --------------------------------------------------------- handler umum

  const HANDLERS = {
    async ping() { return { ok: true }; },
    async probeNative() { return probeNative(); },
    async getState() {
      const [settings, info, stats, { [STORE.log]: log }] = await Promise.all([
        getSettings(), nativeInfo(), indexStats(), chrome.storage.local.get(STORE.log)
      ]);
      return { settings, native: info, indexStats: stats, log: log || [] };
    },
    async setSettings({ patch }) { return { settings: await setSettings(patch || {}) }; },

    async armDownload({ email, key, fixedExt }) { return armDownload(email, key, { fixedExt }); },

    /** Unduhan oleh extension sendiri (data: URL) — tidak memicu izin Chrome. */
    async directDownload({ email, key, url, fixedExt }) {
      if (!url) throw new Error('URL kosong');
      const { armId, useNative } = await armDownload(email, key, { fixedExt });
      const cur0 = await getArm();
      const downloadId = await chrome.downloads.download({
        url, filename: cur0.relPath, conflictAction: 'uniquify', saveAs: false
      });
      await addPending(downloadId, { email, key, useNative });
      const cur = await getArm();
      if (cur && cur.id === armId && cur.downloadId == null) await patchArm({ state: 'downloading', downloadId });
      try {
        const [it] = await chrome.downloads.search({ id: downloadId });
        if (it && (it.state === 'complete' || it.state === 'interrupted')) {
          const rec = await takePending(downloadId);
          if (rec) await finalizeDownload(downloadId, rec, it.state);
        }
      } catch { /* poll downloadStatus akan menyusul */ }
      return { armId, downloadId };
    },

    async downloadStatus({ armId }) {
      let arm = await getArm();
      if (!arm || arm.id !== armId) return { state: 'gone' };
      // Jaring pengaman: tanya Chrome langsung, jangan cuma percaya event.
      if (arm.state === 'downloading' && arm.downloadId != null) {
        try {
          const [it] = await chrome.downloads.search({ id: arm.downloadId });
          if (it && (it.state === 'complete' || it.state === 'interrupted')) {
            const rec = await takePending(arm.downloadId);
            if (rec) await finalizeDownload(arm.downloadId, rec, it.state);
            else if (it.state === 'complete') await patchArm({ state: 'done', finalPath: it.filename || arm.finalPath });
            else await patchArm({ state: 'failed', error: it.error || 'interrupted' });
            arm = await getArm();
          }
        } catch { /* poll berikutnya mencoba lagi */ }
      }
      return { state: arm.state, finalPath: arm.finalPath, error: arm.error, ageMs: Date.now() - arm.ts };
    },

    async cancelArm() { await chrome.storage.session.remove('arm'); return { ok: true }; },
    async markKey({ email, key }) { await addKey(email, key); return { ok: true }; },
    async clearIndex({ bucket }) { await clearIndex(bucket); return { stats: await indexStats() }; },
    async log({ level, msg, extra }) { await pushLog(level || 'info', msg, extra); return { ok: true }; },
    async clearLog() { await chrome.storage.local.set({ [STORE.log]: [] }); return { ok: true }; }
  };

  return {
    HANDLERS, probeNative, nativeInfo, resolvedRoot, nativeScan, insideExtension,
    getIndex, addKey, indexStats, pushLog
  };
}

/** Pasang router pesan: HANDLERS umum + khusus extension. */
export function listen(handlers) {
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    const fn = handlers[msg?.cmd];
    if (!fn) return false;
    Promise.resolve(fn(msg, sender))
      .then(r => sendResponse({ ok: true, ...r }))
      .catch(e => sendResponse({ ok: false, error: String(e?.message || e) }));
    return true;
  });
}
