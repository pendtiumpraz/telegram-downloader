/** Konfigurasi khusus extension ini. */
export const APP_NAME = 'WAN Telegram Downloader';
export const NATIVE_HOST = 'com.wan.tele.dlhost';
export const TMP_SUBDIR = '_tele_tmp';

export const DEFAULTS = {
  /** Folder induk. Kosong = otomatis: D:/telegram, kalau tidak bisa E:/telegram. */
  tgRootDir: '',
  /** Ikut unduh video (.mp4). */
  tgIncludeVideo: true,
  /** Periksa tiap chat untuk mencari sub-topik forum saat memuat daftar. */
  tgScanTopics: false,
  /** Berhenti setelah N media. 0 = tanpa batas. */
  tgMaxItems: 0,
  /** Lewati berkas yang lebih besar dari ini (MB). 0 = tanpa batas. */
  tgMaxSizeMB: 300
};
