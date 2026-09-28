/**
 * common.js — konstanta + helper storage untuk service worker dan sidebar.
 * (Content script bukan module, jadi tidak memakai berkas ini.)
 */

import { NATIVE_HOST, TMP_SUBDIR, DEFAULTS } from './config.js';
export { NATIVE_HOST };

export const STORE = {
  settings: 'settings',
  log: 'log',
  nativeInfo: 'nativeInfo'
};

export const DEFAULT_SETTINGS = {
  /** Subfolder sementara di folder Download Chrome, dipakai kalau native host aktif. */
  tmpSubdir: TMP_SUBDIR,
  /** Jeda antar aksi (ms). */
  stepDelay: 500,
  /** Timeout menunggu satu berkas selesai terunduh (ms). */
  downloadTimeout: 240000,
  /** Berapa kali menggulung sebelum menyimpulkan daftar habis. */
  scrollRetries: 4,
  ...DEFAULTS
};

export async function getSettings() {
  const { [STORE.settings]: s } = await chrome.storage.local.get(STORE.settings);
  return { ...DEFAULT_SETTINGS, ...(s || {}) };
}

export async function setSettings(patch) {
  const next = { ...(await getSettings()), ...patch };
  await chrome.storage.local.set({ [STORE.settings]: next });
  return next;
}

/**
 * Nama berkas -> kunci (message-id / id gambar).
 * Mengenali salinan hasil uniquify Chrome ("123 (1).jpg"), kalau tidak berkas
 * yang sudah ada akan terunduh lagi setiap kali dijalankan ulang.
 */
export function keyFromFile(name) {
  return String(name || '')
    .replace(/ \(\d+\)(\.[^.]*)?$/, '$1')
    .replace(/\.[a-z0-9]{2,5}$/i, '')
    .trim();
}

/** "jfif"/"jpe"/"jpeg" = JPEG; hanya ".jpg" yang dikenali semua program. */
export function normalizeExt(ext) {
  const e = String(ext || '').toLowerCase();
  return (e === 'jfif' || e === 'jpe' || e === 'jpeg') ? 'jpg' : e;
}

/**
 * Nama berkas akhir untuk satu unduhan. `fixedExt` = ekstensinya sudah
 * ditentukan dari ISI berkas, jadi tebakan Chrome (image/jpeg -> ".jfif"
 * di Windows) tidak boleh menimpanya.
 */
export function finalRelPath(relPath, suggested, fixedExt) {
  if (fixedExt) return relPath;
  const ext = normalizeExt(String(suggested || '').split('?')[0].match(/\.([a-z0-9]{2,5})$/i)?.[1]);
  if (!ext || new RegExp(`\\.${ext}$`, 'i').test(relPath)) return relPath;
  return relPath.replace(/\.[a-z0-9]{2,5}$/i, '') + '.' + ext;
}

/** Subfolder jenis media: video/ atau image/, dari ekstensi berkas akhirnya. */
export const KIND_DIRS = ['image', 'video'];
export function kindDirOf(name) {
  return /\.(mp4|webm|mov|mkv|m4v)$/i.test(String(name || '')) ? 'video' : 'image';
}

/** Nama file aman untuk Windows. */
export function safeFileName(key, fallbackExt = '.png') {
  let base = String(key || '').split('/').pop() || '';
  base = base.split('?')[0].replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim();
  if (!base) base = `file_${Date.now()}${fallbackExt}`;
  if (!/\.[a-z0-9]{2,5}$/i.test(base)) base += fallbackExt;
  return base.slice(-150);
}

/** Nama folder aman untuk Windows. */
export function safeDirName(name) {
  return String(name || 'unknown').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim() || 'unknown';
}
