/**
 * tgcontent.js — pengunduh media yang berjalan di dalam https://web.telegram.org/*
 *
 * Bukan module (content script MV3 classic). Dikendalikan dari sidepanel lewat
 * chrome.tabs.sendMessage({cmd:'tg.*'}).
 *
 * Kenapa harus di dalam halaman: media Telegram tidak punya URL HTTP. Yang ada
 * di DOM adalah blob: milik origin web.telegram.org, dan blob hanya bisa
 * dibaca oleh kode yang berjalan di origin itu. Service worker extension tidak
 * bisa menyentuhnya sama sekali.
 */

(() => {
const TG_VERSION = '1.20.0';

if (typeof window.__WAN_TG_TEARDOWN__ === 'function') {
  try { window.__WAN_TG_TEARDOWN__(); } catch {}
}
window.__WAN_TG_CS__ = TG_VERSION;

// ================================================================ keadaan

let RUNNING = null;
let ABORT = false;
let CONTEXT_DEAD = false;

class Abort extends Error { constructor() { super('Dihentikan'); this.name = 'Abort'; } }

/**
 * Lewati chat/topik yang sedang jalan, JANGAN hentikan antreannya.
 *
 * Dipasang di guard() yang sama dengan Abort supaya bisa memotong dari titik
 * tunggu mana pun — termasuk saat sedang menunggu unduhan atau scroll. Tanpa
 * itu, "skip" baru terasa setelah item yang sedang jalan selesai, dan pada
 * chat besar itu bisa menit-menitan.
 */
class SkipChat extends Error { constructor() { super('Dilewati'); this.name = 'SkipChat'; } }

/** Berkas melebihi batas ukuran di setelan — dilewati, bukan gagal. */
class TooBig extends Error { constructor(msg) { super(msg); this.name = 'TooBig'; } }

const fmtMB = (b) => `${(b / 1048576).toFixed(b >= 1048576 * 10 ? 0 : 1)} MB`;

/**
 * Ukuran video dari URL "stream/…" Telegram — tanpa mengunduh apa pun.
 * URL itu berisi JSON lokasi berkasnya, termasuk "size":1098299.
 */
function streamSize(url) {
  try {
    const m = decodeURIComponent(String(url || '')).match(/"size"\s*:\s*(\d+)/);
    return m ? Number(m[1]) : null;
  } catch { return null; }
}

/** Lempar TooBig kalau ukuran (yang diketahui) melewati batas. 0 = tanpa batas. */
function assertSize(bytes, maxBytes, what = 'berkas') {
  if (maxBytes && bytes && bytes > maxBytes) {
    throw new TooBig(`${what} ${fmtMB(bytes)} melebihi batas ${fmtMB(maxBytes)}, dilewati`);
  }
}
let SKIP = false;

const guard = () => {
  if (ABORT) throw new Abort();
  if (SKIP) { SKIP = false; throw new SkipChat(); }
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const pause = async (mult = 1) => { guard(); await sleep(Math.round(STEP * mult)); guard(); };

let STEP = 500;

// ============================================================ lapor progres

function safeSend(msg) {
  if (CONTEXT_DEAD) return;
  try {
    const p = chrome.runtime?.sendMessage?.(msg);
    if (p && typeof p.catch === 'function') p.catch(() => {});
  } catch (e) {
    if (/context invalidated|Extension context/i.test(String(e?.message))) {
      CONTEXT_DEAD = true;
      ABORT = true;
      console.debug('[WAN Studio TG] instans lama berhenti (extension di-reload).');
    }
  }
}

function report(type, payload) { safeSend({ cmd: 'progress', type, ...payload }); }

function log(level, msg) {
  safeSend({ cmd: 'log', level, msg });
  report('log', { level, msg });
}

async function bg(cmd, payload = {}, { retries = 3 } = {}) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    guard();
    try {
      return await chrome.runtime.sendMessage({ cmd, ...payload });
    } catch (e) {
      lastErr = e;
      if (/context invalidated|Extension context/i.test(String(e?.message))) {
        CONTEXT_DEAD = true; ABORT = true;
        throw e;
      }
      await sleep(250 * (i + 1));   // beri waktu service worker bangun
    }
  }
  throw new Error(`background tidak merespons (${cmd}): ${lastErr?.message || lastErr}`);
}

// =============================================================== DOM helper

const txt = (el) => (el?.textContent || '').replace(/\s+/g, ' ').trim();

/**
 * Judul channel — untuk nama folder.
 *
 * Tidak bisa asal ambil `.peer-title` pertama: label "Forwarded from" di dalam
 * bubble juga memakai class itu, dan memakainya berarti foto satu channel
 * tersebar ke folder bernama channel-channel asalnya.
 */
function detectTitle(peerId) {
  /*
   * Topik forum: header menampilkan NAMA TOPIK sebagai judul dan nama grupnya
   * di baris bawah ("In Fotoku"). Foldernya harus <grup>/<topik>, jadi
   * keduanya digabung — kalau hanya judul yang diambil, isi topik tersimpan
   * ke folder bernama topik di akar, terpisah dari grupnya.
   */
  const info = document.querySelector('.chat-info-container .chat-info, .chat-info');
  if (info && info.querySelector('.person-avatar.is-topic, .user-title .peer-title[data-thread-id]')) {
    const topic = txt(info.querySelector('.user-title .peer-title'));
    const group = txt(info.querySelector('.bottom .info .peer-title'));
    if (topic && group) return `${group}/${topic}`;
  }

  const header = document.querySelector(
    '#column-center .chat-info .peer-title, #column-center .topbar .peer-title, .chat-info .peer-title');
  const fromHeader = txt(header);
  if (fromHeader) return fromHeader;

  if (peerId) {
    for (const el of document.querySelectorAll(`.peer-title[data-peer-id="${peerId}"]`)) {
      if (el.closest('.bubble .name')) continue;        // itu label "Forwarded from"
      const t = txt(el);
      if (t) return t;
    }
  }
  return peerId ? `peer_${peerId.replace(/^-/, '')}` : 'telegram';
}

function detectPeer() {
  const b = document.querySelector('[data-peer-id][data-mid]');
  const peerId = b?.getAttribute('data-peer-id') || '';
  return { peerId, title: detectTitle(peerId) };
}

/**
 * Wadah yang bisa di-scroll berisi daftar pesan.
 *
 * Dicari lewat ancestor yang benar-benar punya overflow, bukan lewat nama
 * class: nama class Telegram Web berubah antar rilis, tapi "elemen yang
 * scrollHeight-nya lebih besar dari clientHeight" selalu benar.
 */
function scrollBox(anchor) {
  const start = anchor
    || document.querySelector('.bubble[data-mid]')
    || document.querySelector('img.media-photo');
  for (let el = start?.parentElement; el; el = el.parentElement) {
    const st = getComputedStyle(el);
    if (/(auto|scroll)/.test(st.overflowY) && el.scrollHeight > el.clientHeight + 40) return el;
  }
  return document.scrollingElement || document.documentElement;
}

// ============================================================= daftar chat

/**
 * Satu baris di daftar chat kiri.
 *
 * Judulnya diambil dari `.user-title .peer-title`, bukan `.peer-title` mana
 * pun: baris yang sama juga memuat `.peer-title` untuk NAMA PENGIRIM pesan
 * terakhir di bagian subtitle, dan memakai itu berarti foldernya dinamai
 * menurut siapa yang kebetulan terakhir mengirim pesan.
 */
function chatRows() {
  const out = [];
  for (const a of document.querySelectorAll('a.chatlist-chat[data-peer-id]')) {
    // Baris TOPIK (data-thread-id) bukan chat di daftar utama — href-nya sama
    // persis dengan grupnya, jadi kalau ikut, grupnya tertimpa oleh topiknya.
    if (a.hasAttribute('data-thread-id')) continue;
    const peerId = a.getAttribute('data-peer-id');
    const title = txt(a.querySelector('.user-title .peer-title')) || txt(a.querySelector('.user-title'));
    if (!peerId || !title) continue;
    out.push({
      peerId,
      title,
      hash: a.getAttribute('href') || `#${peerId}`,
      /*
       * Penanda forum dicari di barisnya DAN di dalamnya.
       *
       * Catatan strukturmu menyebutkan dua tempat: `a.chatlist-chat.is-forum`
       * di satu bagian, dan penanda `is-forum` pada avatar di bagian lain.
       * Memeriksa satu saja berarti separuh kemungkinan tidak terdeteksi sama
       * sekali — dan grup forum yang tidak terdeteksi berarti topiknya tidak
       * pernah didata.
       */
      // Sekadar petunjuk untuk label di panel; yang menentukan adalah hasil
      // pemeriksaan sungguhan di taskChats, bukan class ini.
      isForum: a.classList.contains('is-forum')
    });
  }
  return out;
}

/** peer-id chat yang sedang terbuka, dibaca dari bubble-nya. */
const currentPeerId = () =>
  document.querySelector('[data-peer-id][data-mid]')?.getAttribute('data-peer-id') || '';

/**
 * Data seluruh chat di daftar kiri.
 *
 * Daftarnya virtual — hanya baris yang terlihat yang ada di DOM, jadi harus
 * digulung sampai habis. Berhentinya sama seperti daftar pesan: bukan saat
 * "tidak ada chat baru", tapi saat daftarnya benar-benar tidak bergerak lagi.
 */
async function taskChats({ settings, withTopics }) {
  const s = settings || {};
  STEP = Math.max(120, Number(s.stepDelay) || 500);
  const retries = Math.max(1, Number(s.scrollRetries) || 4);

  const anchor = document.querySelector('a.chatlist-chat[data-peer-id]');
  if (!anchor) throw new Error('Daftar chat tidak terlihat — buka Telegram Web dengan sidebar kiri tampil.');

  const box = scrollBox(anchor);
  box.scrollTop = 0;
  await pause(1.5);

  const found = new Map();
  const take = () => { for (const r of chatRows()) if (!found.has(r.peerId)) found.set(r.peerId, r); };
  take();

  let idle = 0, steps = 0;
  const MAX_STEPS = 1000;
  while (idle < retries && steps++ < MAX_STEPS) {
    guard();
    const before = { top: box.scrollTop, n: found.size, rows: document.querySelectorAll('a.chatlist-chat').length };

    box.scrollTop = Math.min(box.scrollHeight, before.top + Math.round(box.clientHeight * 0.85));
    box.dispatchEvent(new Event('scroll', { bubbles: true }));
    await pause(1.6);
    take();

    const moved = box.scrollTop !== before.top
      || found.size !== before.n
      || document.querySelectorAll('a.chatlist-chat').length !== before.rows;
    idle = moved ? 0 : idle + 1;
  }

  const chats = [...found.values()];
  log('ok', `${chats.length} chat terdata.`);
  if (!withTopics) return { ok: true, chats };

  /*
   * Grup forum TIDAK ditebak dari penanda class.
   *
   * Dua kali ditebak, dua kali meleset: sekali tidak ada satu pun yang
   * terdeteksi, sekali SEMUANYA terdeteksi. Penandanya jelas tidak di tempat
   * yang tertulis di dokumentasi mana pun yang kupunya.
   *
   * Yang tidak bisa meleset: buka chatnya, lalu lihat apakah kolom kiri
   * berganti jadi baris-baris yang tidak ada di daftar utama. Kalau ya, itu
   * topik. Lebih lambat — karena itu jadi pilihan, bukan bawaan — tapi
   * jawabannya datang dari halamannya sendiri.
   */
  const mainHrefs = new Set(chats.map(c => c.hash));
  const out = [];
  let n = 0;

  for (const c of chats) {
    guard();
    out.push(c);
    n++;
    report('tgstep', { index: n, total: chats.length, title: c.title, phase: 'buka' });

    const topics = await topicsOf(c, mainHrefs, 5000);
    if (topics.length) {
      log('ok', `${c.title}: ${topics.length} topik.`);
      c.hasTopics = true;      // barisnya sendiri jadi wadah, bukan tujuan unduh
      c.isForum = true;
      out.push(...topics);
    } else {
      c.isForum = false;       // bukan forum, atau memang tidak punya topik
    }
  }

  const topikCount = out.length - chats.length;
  log('ok', `Total ${out.length} tujuan (${chats.length} chat + ${topikCount} topik).`);
  if (!topikCount) log('info', 'Tidak ada grup ber-topik yang ditemukan.');
  return { ok: true, chats: out };
}

/**
 * Pindah ke satu chat.
 *
 * Lewat hash, bukan klik: daftarnya virtual, jadi baris chat yang dituju
 * belum tentu ada di DOM saat gilirannya tiba. Hash-nya diambil dari atribut
 * href baris itu sendiri waktu pendataan, jadi formatnya persis seperti yang
 * dipakai Telegram.
 */
const firstMid = () => document.querySelector('[data-mid]')?.getAttribute('data-mid') || '';

/** Klik sungguhan: beberapa handler menunggu mousedown/mouseup, bukan click saja. */
function realClick(el) {
  const o = { bubbles: true, cancelable: true, view: window };
  for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup']) {
    try { el.dispatchEvent(new MouseEvent(type, o)); } catch { /* pointer event lama */ }
  }
  /*
   * SATU event click saja. Dulu "click" dikirim lewat dispatchEvent DAN
   * el.click() — dua klik per panggilan. Di grid Media itu membuka viewer
   * DUA kali, saling tumpuk.
   */
  try { el.click(); } catch { el.dispatchEvent(new MouseEvent('click', o)); }
}

/**
 * Cari baris chat, gulung daftarnya kalau belum kelihatan, lalu klik.
 *
 * Daftar chat itu virtual: hanya baris yang terlihat yang ada di DOM. Chat
 * urutan ke-30 tidak bisa diklik sebelum daftarnya digulung sampai ke sana,
 * dan querySelector yang mengembalikan null itulah yang bikin semua chat
 * selain yang pertama gagal dibuka.
 */
/**
 * Selector baris untuk satu chat atau topik.
 *
 * Baris topik memakai href YANG SAMA dengan grupnya ("#-3739847319"); yang
 * membedakannya hanya data-thread-id. Jadi topik dicari lewat peer-id +
 * thread-id, dan grup lewat href TANPA thread-id — kalau tidak, "klik grup"
 * bisa mendarat di topik pertama, dan "klik topik" di grupnya.
 */
function rowSelector(p) {
  return p.threadId
    ? `a.chatlist-chat[data-peer-id="${p.peerId}"][data-thread-id="${p.threadId}"]`
    : `a.chatlist-chat[href="${p.hash || '#' + p.peerId}"]:not([data-thread-id])`;
}

async function clickRow(selector, fallbackSelector, budgetMs) {
  const find = () => document.querySelector(selector)
    || (fallbackSelector ? document.querySelector(fallbackSelector) : null);

  let row = find();
  if (!row) {
    const anchor = document.querySelector('a.chatlist-chat');
    if (!anchor) return false;
    const box = scrollBox(anchor);
    box.scrollTop = 0;
    await pause(1);

    const t0 = Date.now();
    while (!(row = find()) && Date.now() - t0 < budgetMs) {
      guard();
      const before = box.scrollTop;
      box.scrollTop = before + Math.round(box.clientHeight * 0.8);
      box.dispatchEvent(new Event('scroll', { bubbles: true }));
      await pause(1.2);
      if (box.scrollTop === before) break;      // daftarnya sudah mentok
    }
  }
  if (!row) return false;
  row.scrollIntoView({ block: 'center' });
  realClick(row);
  return true;
}

/**
 * Pindah ke satu chat atau topik.
 *
 * DIKLIK, bukan lewat URL. Telegram Web K menulis hash-nya sendiri tapi tidak
 * mendengarkannya: mengubah location.hash memang mengganti URL di bilang
 * alamat, dan aplikasinya diam saja. Itulah kenapa versi sebelumnya cuma
 * berhasil membuka chat pertama — yang memang sudah terbuka sejak awal.
 * URL hanya dipakai sebagai upaya terakhir kalau barisnya benar-benar tidak
 * ditemukan.
 */
async function openChat(p, timeout = 20000, { beforeRows = null } = {}) {
  const want = p.hash || `#${p.peerId}`;
  const before = firstMid();

  const ready = () => {
    if (!document.querySelector('[data-mid]')) return false;
    // Hash saja tidak cukup: grup ber-topik menulis hash-nya tapi yang tampil
    // masih pesan chat SEBELUMNYA, dan isinya akan tersimpan ke folder grup ini.
    if (location.hash === want && currentPeerId() === p.peerId && !p.parentHash) return true;
    /*
     * Dua topik dalam satu forum punya peer-id yang SAMA, jadi peer-id saja
     * tidak cukup: pindah topik akan langsung dianggap selesai padahal yang
     * terpampang masih pesan topik sebelumnya, dan isinya tersimpan ke folder
     * yang salah. Karena itu pesan pertamanya harus benar-benar berganti.
     */
    return currentPeerId() === p.peerId && firstMid() !== before;
  };

  if (!p.parentHash && location.hash === want && currentPeerId() === p.peerId && document.querySelector('[data-mid]')) return true;

  const t0 = Date.now();
  const half = Math.max(4000, Math.round(timeout / 2));

  // Topik hanya muncul di kolom kiri SETELAH grup induknya dibuka. Kalau
  // daftar topiknya SUDAH terbuka (topik kedua dst.), grupnya jangan diklik
  // lagi — klik ulang bisa menutup daftar topik itu dan barisnya hilang.
  const topicRowShown = () => document.querySelector(rowSelector(p));
  if (p.parentHash && !topicRowShown()) {
    await clickRow(`a.chatlist-chat[href="${p.parentHash}"]:not([data-thread-id])`, null, half);
    await pause(3);
  }

  // Untuk topik, jangan jatuh ke peer-id: yang cocok justru baris grupnya.
  const clicked = await clickRow(rowSelector(p),
    p.parentHash ? null : `a.chatlist-chat[data-peer-id="${p.peerId}"]:not([data-thread-id])`, half);
  if (!clicked) {
    log('warn', `${p.title}: barisnya tidak ketemu di daftar, mencoba lewat URL.`);
    location.hash = want;
  }

  while (Date.now() - t0 < timeout) {
    guard();
    await sleep(300);
    /*
     * Grup ber-topik tidak menampilkan pesan saat diklik — yang muncul daftar
     * TOPIK, yang menunggu dipilih. Menunggu pesan di sini sampai timeout
     * berakhir dengan "chat tidak mau terbuka, dilewati", padahal grupnya
     * terbuka dengan benar. Laporkan topiknya supaya pemanggil yang memilih.
     * Diperiksa SEBELUM ready(): Telegram bisa sekalian membuka topik
     * "General", dan itu tidak boleh membuat grupnya diunduh sebagai satu chat.
     */
    if (beforeRows && !p.parentHash) {
      const topics = topicList(p, beforeRows);
      if (topics.length) { await pause(1); return { topics: topicList(p, beforeRows) }; }
    }
    if (ready()) { await pause(2.5); return true; }
  }

  // Chat kosong tidak punya pesan untuk dibandingkan — jangan disebut gagal.
  if (currentPeerId() === p.peerId && document.querySelector('[data-mid]')) {
    log('warn', `${p.title}: isi chat tidak terlihat berganti, tetap dicoba.`);
    return true;
  }
  return false;
}

/**
 * Topik milik grup `g` yang sedang tampil di kolom kiri.
 *
 * Baris topik = a.chatlist-chat dengan data-peer-id grup ini DAN
 * data-thread-id. href-nya sama dengan grupnya, jadi href tidak bisa jadi
 * pembeda; thread-id-lah identitasnya. (Baris ber-href lain tanpa thread-id
 * yang tidak ada di `exclude` juga diterima — bentuk lama.)
 */
function topicList(g, exclude = null) {
  const out = [];
  const main = g.hash || `#${g.peerId}`;
  for (const a of document.querySelectorAll('a.chatlist-chat[data-peer-id]')) {
    if (a.getAttribute('data-peer-id') !== g.peerId) continue;
    const threadId = a.getAttribute('data-thread-id') || '';
    const hash = a.getAttribute('href') || main;
    if (!threadId && (hash === main || !exclude || exclude.has(hash))) continue;
    const key = threadId ? `${g.peerId}~${threadId}` : hash;
    if (out.some(t => t.key === key)) continue;
    const title = txt(a.querySelector('.user-title .peer-title')) || txt(a.querySelector('.user-title'));
    if (!title) continue;
    out.push({ peerId: g.peerId, hash, threadId, key, title: `${g.title}/${title}`, parent: g.title, parentHash: main });
  }
  return out;
}

/**
 * Topik-topik di dalam satu grup forum.
 *
 * Formatnya tidak ditebak: saat forum dibuka, kolom kiri berganti dari daftar
 * chat menjadi daftar topik, memakai baris yang sama persis. Jadi yang diambil
 * adalah baris yang BELUM ada di daftar chat utama — href-nya dipakai apa
 * adanya, apa pun bentuknya.
 */
async function topicsOf(p, mainHrefs, timeout = 15000) {
  const want = p.hash || `#${p.peerId}`;
  if (!await clickRow(rowSelector(p), `a.chatlist-chat[data-peer-id="${p.peerId}"]:not([data-thread-id])`,
                      Math.round(timeout / 2))) {
    location.hash = want;   // upaya terakhir
  }

  const t0 = Date.now();
  for (;;) {
    guard();
    await sleep(400);
    const rows = topicList(p, mainHrefs);
    if (rows.length) return rows;
    if (Date.now() - t0 > timeout) return [];
  }
}

/**
 * Semua media di DOM sekarang, urut atas→bawah.
 *
 * Kuncinya `data-mid` pada pembungkus TERDEKAT: untuk album itu
 * `.album-item` (satu mid per foto), untuk foto tunggal itu `.bubble`.
 * Mengambil mid dari bubble saja akan menggabungkan seluruh album jadi satu.
 */
function mediaItems() {
  const out = [];
  const seen = new Set();
  for (const img of document.querySelectorAll('img.media-photo')) {
    const carrier = img.closest('[data-mid]');
    const mid = carrier?.getAttribute('data-mid');
    if (!mid || seen.has(mid)) continue;
    seen.add(mid);
    const box = img.closest('.media-container, .attachment') || carrier;

    /*
     * Video dikenali dari penanda durasi, bukan dari ada/tidaknya <video>.
     * Pada video yang belum diputar, Telegram baru memasang <video> belakangan
     * dan yang ada di DOM cuma poster ber-class media-photo. Menebak dari
     * <video> saja berarti poster itu ikut tersimpan sebagai .jpg — thumbnail
     * kecil yang menyamar jadi "video sudah diunduh".
     */
    const isVideo = !!box.querySelector('.video-time')
      || !!carrier.querySelector(':scope > .bubble-content-wrapper .video-time')
      || !!box.querySelector('video')
      || !!carrier.closest('.bubble')?.classList.contains('video');

    out.push({ mid, img, isVideo, video: box.querySelector('video'), el: carrier });
  }

  /*
   * Diurutkan menurut posisi di LAYAR, bukan urutan DOM.
   *
   * Daftar pesan Telegram dirender terbalik (column-reverse): elemen pertama
   * di DOM justru yang tampil paling bawah. Memakai urutan DOM lalu
   * membaliknya menghasilkan arah yang persis terbalik dari yang diminta —
   * terbukti di log: mid-nya menaik (456, 457, 458 …) padahal mulai dari
   * paling bawah berarti harus menurun.
   *
   * Di lingkungan tanpa layout (jsdom) semua rect bernilai 0; sort yang stabil
   * membuat urutan DOM tetap dipakai apa adanya.
   */
  out.sort((a, b) => rectTop(a.el) - rectTop(b.el));
  return out;
}

function rectTop(el) {
  try { return el.getBoundingClientRect().top; } catch { return 0; }
}

/**
 * Tunggu sampai gambarnya benar-benar punya sumber.
 *
 * Telegram hanya MENGUNDUH media yang dekat viewport. Bubble yang ada di DOM
 * tapi jauh di luar layar tetap memegang <img> kosong selamanya — itulah
 * sebabnya versi pertama melewatkan semuanya dengan "gambar belum dimuat":
 * menunggu saja tidak akan pernah berhasil kalau item itu tidak pernah
 * didekati. Jadi item-nya didekatkan dulu, baru ditunggu.
 *
 * data: ditolak: itu placeholder buram beberapa piksel, bukan gambarnya.
 */
async function waitBlobSrc(img, el, timeout = 6000) {
  const t0 = Date.now();
  let nudged = false;
  for (;;) {
    guard();
    const src = img.currentSrc || img.src || '';
    if (src.startsWith('blob:') || /^https?:/.test(src)) return src;

    if (!nudged) {
      nudged = true;
      try { el?.scrollIntoView({ block: 'center' }); } catch { /* jsdom */ }
    }
    if (Date.now() - t0 > timeout) return null;
    await sleep(200);
  }
}

// ============================================================== unduh satu

const EXT_BY_TYPE = {
  'image/jpeg': 'jpg',
  'image/jpg':  'jpg',
  'image/png':  'png'
};

/**
 * Pastikan hasilnya .jpg atau .png.
 *
 * Telegram juga menyimpan webp (stiker) dan kadang gif. Formatnya diubah di
 * sini, bukan dibiarkan apa adanya, karena yang diminta memang hanya dua
 * format itu — dan berkas .webp berekstensi .png akan gagal dibuka.
 */
async function normalizeImage(blob) {
  const known = EXT_BY_TYPE[blob.type];
  if (known) return { blob, ext: known };

  try {
    const bmp = await createImageBitmap(blob);
    const canvas = new OffscreenCanvas(bmp.width, bmp.height);
    canvas.getContext('2d').drawImage(bmp, 0, 0);
    bmp.close();
    return { blob: await canvas.convertToBlob({ type: 'image/png' }), ext: 'png' };
  } catch (e) {
    /*
     * Sengaja dilempar, bukan disimpan apa adanya dengan nama .jpg: berkas
     * webp berekstensi .jpg tidak bisa dibuka, dan kegagalannya baru
     * ketahuan berbulan-bulan kemudian saat arsipnya dipakai.
     */
    throw new Error(`format ${blob.type || 'tidak dikenal'} tidak bisa diubah ke png: ${e.message}`);
  }
}

/**
 * Ambil video Telegram SUNGGUHAN dari URL "stream/…".
 *
 * Permintaan PERTAMA dikirim tanpa header Range — itu cara yang terbukti
 * jalan sejak awal: service worker Telegram menjawabnya dengan video utuh
 * (200), atau potongan pertama (206 + Content-Range). Hanya kalau jawabannya
 * sepotong, potongan berikutnya diminta dengan Range dan dirakit. Mengirim
 * "Range: bytes=0-" sejak awal justru dijawab "HTTP 302".
 *
 * Kalau jalur itu gagal, pengambilan diulang oleh HALAMAN-nya sendiri
 * (MAIN world, lewat background) sebagai cadangan.
 *
 * Hasilnya selalu diperiksa dari byte-nya sendiri: jawaban HTML (yang dulu
 * tersimpan sebagai .htm) tidak boleh tersimpan sebagai "sudah diunduh".
 */
async function fetchVideo(url, maxBytes = 0) {
  // Batas ukuran diperiksa SEBELUM mengunduh: ukurannya ada di URL stream/.
  assertSize(streamSize(url), maxBytes, 'video');

  let firstErr;
  try {
    return await checkVideo(await fetchPieces(url, maxBytes));
  } catch (e) {
    if (e instanceof Abort || e instanceof SkipChat || e instanceof TooBig) throw e;
    firstErr = e;
  }

  const viaPage = await bg('tgMainFetch', { url, maxBytes }).catch(e => ({ ok: false, error: e.message }));
  if (viaPage?.tooBig) throw new TooBig(`video ${fmtMB(viaPage.size)} melebihi batas ${fmtMB(maxBytes)}, dilewati`);
  if (viaPage?.ok && viaPage.blobUrl) {
    log('info', `Video diambil lewat halaman (jalur langsung: ${firstErr.message}).`);
    return checkVideo(await (await fetch(viaPage.blobUrl)).blob());
  }
  throw new Error(`${firstErr.message}${viaPage?.error ? `; lewat halaman: ${viaPage.error}` : ''}`);
}

/** Satu fetch biasa; potongan Range hanya kalau jawabannya 206. */
async function fetchPieces(url, maxBytes = 0) {
  const abs = new URL(url, location.href).href;
  const parts = [];
  let type = '', offset = 0;

  for (let i = 0; i < 20000; i++) {
    guard();
    const r = i === 0 || abs.startsWith('blob:')
      ? await fetch(abs)
      : await fetch(abs, { headers: { Range: `bytes=${offset}-` } });
    if (!r.ok) throw new Error(`HTTP ${r.status} saat mengambil video`);
    const ct = r.headers?.get?.('Content-Type') || '';
    if (/text\/html/i.test(ct)) {
      throw new Error('Telegram menjawab dengan halaman HTML, bukan video — putar videonya sekali lalu ulangi');
    }
    type = type || ct;
    const b = await r.blob();
    parts.push(b);

    // 206 + "bytes 0-524287/1234567": masih ada potongan berikutnya.
    const m = (r.headers?.get?.('Content-Range') || '').match(/bytes\s+(\d+)-(\d+)\/(\d+|\*)/i);
    // Pengaman kedua: ukuran total dari Content-Range, atau yang sudah terkumpul.
    if (m && m[3] !== '*') assertSize(Number(m[3]), maxBytes, 'video');
    assertSize(parts.reduce((n, p) => n + p.size, 0), maxBytes, 'video');
    if (r.status !== 206 || !m || !b.size) break;          // seluruh berkas sudah datang
    offset = Number(m[2]) + 1;
    if (m[3] !== '*' && offset >= Number(m[3])) break;
  }
  return new Blob(parts, { type: /^video\//i.test(type) ? type : 'video/mp4' });
}

/** Pastikan isinya benar-benar video (mp4 "ftyp" / webm), bukan halaman HTML. */
async function checkVideo(blob) {
  const h = new Uint8Array(await new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(new Error('gagal membaca awal berkas video'));
    fr.readAsArrayBuffer(blob.slice(0, 12));
  }));
  const isMp4  = h[4] === 0x66 && h[5] === 0x74 && h[6] === 0x79 && h[7] === 0x70;   // "ftyp"
  const isWebm = h[0] === 0x1a && h[1] === 0x45 && h[2] === 0xdf && h[3] === 0xa3;
  if (!isMp4 && !isWebm) {
    const head = String.fromCharCode(...h).replace(/[^ -~]/g, '.');
    throw new Error(`isinya bukan video (${blob.type || '?'}, diawali "${head}") — tidak disimpan`);
  }
  return { blob, ext: isWebm ? 'webm' : 'mp4' };
}

// ============================================================ panel Media

async function waitFor(fn, timeout, every = 250) {
  const t0 = Date.now();
  for (;;) {
    guard();
    const v = fn();
    if (v) return v;
    if (Date.now() - t0 > timeout) return null;
    await sleep(every);
  }
}

function sendKey(key, code, keyCode) {
  // Satu target saja: event-nya bubbling sampai document/window, dan
  // mengirimnya ke beberapa target membuat listener menerimanya berkali-kali.
  const t = document.activeElement || document.body;
  for (const type of ['keydown', 'keyup']) {
    t.dispatchEvent(new KeyboardEvent(type, {
      key, code, keyCode, which: keyCode, bubbles: true, cancelable: true, composed: true, view: window
    }));
  }
}

/** Item di grid Media (panel kanan), milik chat `peerId`. */
function gridItems(peerId) {
  return [...document.querySelectorAll('.search-super-content-media .search-super-item[data-mid], ' +
                                         '.search-super-content-media .grid-item[data-mid]')]
    .filter((g, i, all) => all.indexOf(g) === i)
    .filter(g => !peerId || g.getAttribute('data-peer-id') === peerId);
}

/**
 * Buka panel Media di kanan dengan mengklik header chat (.chat-info).
 *
 * Isi panel dari chat SEBELUMNYA bisa masih terpampang (terutama antar-topik
 * dalam satu grup, yang peer-id-nya sama), jadi yang ditunggu adalah grid
 * yang isinya BERGANTI dari potret sebelum klik.
 *
 * Mengembalikan null kalau header-nya tidak ada — pemanggil lalu memakai
 * cara lama (menggulung pesan).
 */
async function openSharedMedia(peerId, timeout = 12000) {
  const head = document.querySelector('.chat-info-container .chat-info .person')
    || document.querySelector('.chat-info-container .chat-info');
  if (!head) return null;

  const sig = () => gridItems(peerId).slice(0, 6).map(g => g.getAttribute('data-mid')).join(',');
  const stale = sig();
  const fresh = () => { const v = sig(); return v && v !== stale ? v : null; };

  realClick(head);
  if (await waitFor(fresh, Math.round(timeout / 3))) return true;

  // Panel terbuka di tab lain (mis. Anggota) — pindah ke tab Media.
  const tab = [...document.querySelectorAll('.search-super-tabs .menu-horizontal-div-item, ' +
                                             '.search-super .menu-horizontal-div-item')]
    .find(t => /^(media|foto|photos?)$/i.test(txt(t)));
  if (tab) { realClick(tab); if (await waitFor(fresh, Math.round(timeout / 3))) return true; }

  // Klik pertama bisa jadi malah menutup panel yang sudah terbuka.
  if (!gridItems(peerId).length) { realClick(head); if (await waitFor(fresh, Math.round(timeout / 3))) return true; }

  // Isinya tidak berganti tapi grid chat ini ada: chat yang sama dibuka ulang.
  return gridItems(peerId).length ? true : null;
}

/**
 * Viewer yang benar-benar TAMPIL, teratas terakhir.
 *
 * Telegram bisa menyisakan viewer lama di DOM (tersembunyi / sedang ditutup).
 * Memakai `.media-viewer-whole` PERTAMA membuat script membaca viewer lama:
 * mengira belum tertutup lalu membuka item baru di atasnya (modal
 * menumpuk), dan mencari media di viewer yang salah (tidak ada yang
 * terunduh).
 */
function viewers() {
  return [...document.querySelectorAll('.media-viewer-whole')].filter(v => {
    if (v.classList.contains('hiding') || v.classList.contains('is-closing')) return false;
    const st = getComputedStyle(v);
    return st.display !== 'none' && st.visibility !== 'hidden' && st.opacity !== '0';
  });
}
const viewerShown = () => viewers().pop() || null;

/**
 * Media yang sedang tampil di viewer.
 *
 * Gambar: img di .media-viewer-aspecter. Telegram memasang pratinjau dulu,
 * lalu gambar penuh — jadi ditunggu sebentar untuk versi non-thumbnail, dan
 * kalau tidak datang, yang ada yang dipakai.
 * Video: <video> di pemutar viewer, src-nya "stream/…" (diambil fetchVideo).
 */
/**
 * Wadah item yang SEDANG tampil di viewer.
 *
 * Viewer Telegram menyimpan lebih dari satu tampilan (item sebelum/sesudah,
 * pemutar video yang tertinggal). Mencari <video> di seluruh viewer membuat
 * setiap GAMBAR sesudah video pertama terbaca "video" — dan gambarnya tidak
 * pernah terunduh. Semua pemeriksaan harus dibatasi ke wadah ini.
 */
function activeMover() {
  const v = viewerShown();
  if (!v) return null;
  return v.querySelector('.media-viewer-mover.active')
    || [...v.querySelectorAll('.media-viewer-aspecter')].pop()?.parentElement
    || null;
}

async function viewerMedia(isVideo, timeout = 15000) {
  const aspecter = () => activeMover()?.querySelector('.media-viewer-aspecter') || activeMover();

  if (isVideo) {
    return waitFor(() => {
      const v = activeMover()?.querySelector('video');
      const src = v?.currentSrc || v?.getAttribute('src');
      return src ? { src } : null;
    }, timeout);
  }

  const imgs = () => [...(aspecter()?.querySelectorAll('img') || [])].filter(i => i.getAttribute('src'));
  if (!await waitFor(() => imgs().length, timeout)) return null;
  const full = await waitFor(() => imgs().find(i => !i.classList.contains('thumbnail')), 2500);
  const best = full || imgs().sort((a, b) =>
    (b.naturalWidth * b.naturalHeight) - (a.naturalWidth * a.naturalHeight))[0];
  return best ? { src: best.currentSrc || best.getAttribute('src') } : null;
}

/**
 * Tutup SEMUA viewer yang tampil. true = tidak ada lagi yang tampil.
 * Pemanggil tidak boleh membuka item baru kalau ini false — itu yang dulu
 * membuat modal saling tumpuk.
 */
async function closeViewer() {
  for (let k = 0; k < 4 && viewerShown(); k++) {
    const n = viewers().length;
    sendKey('Escape', 'Escape', 27);
    if (await waitFor(() => viewers().length < n, 2500)) continue;
    const top = viewerShown();
    const btn = top?.querySelector('.media-viewer-buttons .btn-icon:last-child, .media-viewer-topbar [class*="close"]');
    if (btn) { realClick(btn); await waitFor(() => viewers().length < n, 2500); }
  }
  return !viewerShown();
}

/** Batas aman untuk dikirim sebagai data: URL lewat pesan extension. */
const MAX_INLINE = 24 * 1024 * 1024;

const blobToDataUrl = (blob) => new Promise((resolve, reject) => {
  const fr = new FileReader();
  fr.onload = () => resolve(fr.result);
  fr.onerror = () => reject(new Error('gagal membaca berkas'));
  fr.readAsDataURL(blob);
});

/**
 * Mulai satu unduhan, dan usahakan TANPA izin apa pun.
 *
 * Unduhan yang dipicu halaman lewat <a download> membuat Chrome bertanya
 * "Download multiple files?" — karena memang halaman web yang meminta, dan
 * Chrome tidak tahu bedanya dengan situs yang menghujani pengguna dengan
 * berkas. Unduhan yang dipicu EXTENSION tidak kena aturan itu sama sekali.
 *
 * Extension tidak bisa membaca blob: milik halaman, jadi isinya dikirim
 * sebagai data: URL. Untuk gambar meme (puluhan–ratusan KB) ini murah.
 * Berkas yang terlalu besar untuk dilewatkan begitu — video panjang — baru
 * jatuh ke <a download>, dan hanya di situ izinnya mungkin ditanyakan.
 */
async function startDownload({ bucket, key, url, blob }) {
  let data = blob;
  if (!data && url && !url.startsWith('blob:')) {
    try { data = await (await fetch(url)).blob(); } catch { /* stream SW menolak: pakai anchor */ }
  }

  if (data && data.size <= MAX_INLINE) {
    try {
      const dataUrl = await blobToDataUrl(data);
      // fixedExt: ekstensinya sudah ditentukan dari tipe blob yang sebenarnya,
      // jadi tebakan Chrome (image/jpeg -> ".jfif" di Windows) jangan dipakai.
      const r = await bg('directDownload', { email: bucket, key, url: dataUrl, fixedExt: true });
      return r.armId;
    } catch (e) {
      log('warn', `${key}: jalur tanpa-izin gagal (${e.message}), memakai unduhan halaman.`);
    }
  }

  const { armId } = await bg('armDownload', { email: bucket, key, fixedExt: true });
  // Kalau isinya sudah di tangan, unduh DARI ISI itu. URL aslinya bisa jadi
  // "stream/…" yang tanpa service worker Telegram cuma menghasilkan HTML.
  if (data) {
    const obj = URL.createObjectURL(data);
    clickDownload(obj, key);
    setTimeout(() => URL.revokeObjectURL(obj), 120000);
  } else {
    clickDownload(url, key);
  }
  return armId;
}

/**
 * Picu unduhan dari DALAM halaman — cadangan untuk berkas yang terlalu besar
 * dikirim sebagai data: URL. Di jalur inilah Chrome bisa meminta izin
 * "Download multiple files?".
 */
function clickDownload(url, name) {
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => a.remove(), 2000);
}

async function waitDownload(armId, timeout) {
  const t0 = Date.now();
  for (;;) {
    guard();
    await sleep(600);
    const st = await bg('downloadStatus', { armId });
    if (st.state === 'done') return { ok: true, path: st.finalPath };
    if (st.state === 'failed') return { ok: false, error: st.error || 'gagal' };
    if (st.state === 'gone') return { ok: false, error: 'slot unduhan hilang' };
    if (Date.now() - t0 > timeout) return { ok: false, error: `timeout ${Math.round(timeout / 1000)}s` };
  }
}

// ================================================================ tugas

/**
 * Grup yang sedang dibuka — termasuk grup ber-topik yang BELUM membuka topik
 * apa pun (saat itu belum ada satu pesan pun di layar, jadi detectPeer kosong).
 *
 * Kalau yang terbuka sebuah topik, judulnya diambil dari baris "In <grup>"
 * di header, bukan nama topiknya.
 */
function currentGroup() {
  const info = document.querySelector('.chat-info-container .chat-info, .chat-info');
  let peerId = info?.querySelector('[data-peer-id]')?.getAttribute('data-peer-id') || '';
  if (!peerId) peerId = (location.hash.match(/^#(-?\d+)/) || [])[1] || '';
  if (!peerId) peerId = currentPeerId();

  let title = '';
  if (info?.querySelector('.person-avatar.is-topic, .user-title .peer-title[data-thread-id]')) {
    title = txt(info.querySelector('.bottom .info .peer-title'));
  } else {
    title = txt(info?.querySelector('.user-title .peer-title'));
  }
  if (!title && peerId) {
    title = txt(document.querySelector(`a.chatlist-chat[href="#${peerId}"]:not([data-thread-id]) .user-title .peer-title`));
  }
  return { peerId, title: title || (peerId ? detectTitle(peerId) : '') };
}

const topicRowsFor = (g) => topicList(g);

/**
 * Mode satu link: grup yang dibuka punya topik atau tidak?
 *
 * Grup ber-topik yang dibuka lewat link menampilkan DAFTAR TOPIK, bukan
 * pesan. Kalau daftarnya belum tampil, baris grupnya diklik sekali untuk
 * memunculkannya. Hasilnya daftar topik (bisa kosong = grup biasa).
 */
async function discoverTopics(g) {
  if (!g.peerId || !g.title) return [];
  let topics = topicRowsFor(g);
  if (topics.length) return topics;

  const row = document.querySelector(`a.chatlist-chat[href="#${g.peerId}"]:not([data-thread-id])`);
  if (!row) return [];
  realClick(row);
  return (await waitFor(() => { const t = topicRowsFor(g); return t.length ? t : null; }, 3500)) || [];
}

async function taskProbe() {
  const peer = detectPeer();
  const items = mediaItems();
  const g = peer.peerId ? null : currentGroup();
  const topics = topicRowsFor(g || currentGroup());
  return {
    ok: true,
    v: TG_VERSION,
    url: location.href,
    peerId: peer.peerId || g?.peerId || '',
    title: peer.title || g?.title || '',
    topics: topics.length,
    inDom: items.length,
    videos: items.filter(i => i.isVideo).length
  };
}

/**
 * Unduh beberapa chat berurutan, masing-masing ke foldernya sendiri.
 *
 * Loopnya di sini, bukan di sidepanel, karena berpindah chat di Telegram Web
 * cuma mengubah hash — halamannya tidak dimuat ulang, jadi content script ini
 * tetap hidup sepanjang antrean. (Bandingkan dengan login/logout di WAN, yang
 * memicu navigasi sungguhan dan karena itu loopnya harus di panel.)
 */
async function taskRun({ settings, peers }) {
  let queue = Array.isArray(peers) && peers.length ? peers : [null];

  /*
   * Mode satu link: cek dulu apakah grupnya punya topik. Kalau punya, SEMUA
   * topiknya diunduh berurutan ke <grup>/<topik>/image|video — bukan cuma
   * topik yang kebetulan terbuka. Kalau tidak, chat itu langsung diunduh ke
   * <grup>/image|video.
   */
  if (queue.length === 1 && queue[0] === null) {
    STEP = Math.max(120, Number(settings?.stepDelay) || 500);
    const g = currentGroup();
    const topics = await discoverTopics(g);
    if (!topics.length) return runOneChat(settings);
    log('ok', `${g.title}: grup ber-topik, ${topics.length} topik — disimpan ke "${g.title}/<topik>/image|video".`);
    queue = topics;
  }

  const openTimeout = Math.max(2000, Number(settings?.tgOpenTimeout) || 20000);
  const total = { processed: 0, saved: 0, skipped: 0, failed: 0 };
  let done = 0;

  for (const p of queue) {
    guard();
    done++;
    report('tgstep', { index: done, total: queue.length, title: p.title, phase: 'buka' });
    log('info', `[${done}/${queue.length}] ${p.title} …`);

    // Wadah forum yang topiknya sudah ada di antrean: topiknya yang diunduh.
    if (p.hasTopics && queue.some(q => q && (q.parentHash === p.hash || q.parent === p.title))) {
      log('info', `${p.title}: grup ber-topik — topiknya diproses satu per satu.`);
      continue;
    }

    const beforeRows = new Set([...document.querySelectorAll('a.chatlist-chat[href]')]
      .map(a => a.getAttribute('href')));
    const opened = await openChat(p, openTimeout, { beforeRows });

    /*
     * Grup ber-topik: yang terbuka daftar topik, bukan pesan. Topiknya
     * disisipkan tepat setelah grup ini di antrean, dan masing-masing masuk
     * ke foldernya sendiri: <grup>/<topik>.
     */
    if (opened && opened.topics) {
      const fresh = opened.topics.filter(t => !queue.some(q => q && (q.key || q.hash) === t.key));
      log('ok', `${p.title}: grup ber-topik, ${fresh.length} topik ditambahkan ke antrean.`);
      queue.splice(queue.indexOf(p) + 1, 0, ...fresh);
      continue;
    }
    if (!opened) {
      log('err', `${p.title}: chat tidak mau terbuka, dilewati.`);
      continue;
    }
    if (p.isForum) log('warn', `${p.title} itu grup ber-topik — yang terbaca hanya topik yang terbuka.`);

    try {
      report('tgstep', { index: done, total: queue.length, title: p.title, phase: 'unduh' });
      const r = await runOneChat(settings, { offset: total, title: p.title });
      for (const k of Object.keys(total)) total[k] += r[k] || 0;
    } catch (e) {
      if (e instanceof Abort) throw e;
      if (e instanceof SkipChat) { log('warn', `${p.title}: dilewati atas permintaan.`); continue; }
      log('err', `${p.title}: ${e.message}`);
    }
  }

  log('ok', `Selesai — ${queue.length} chat, ${total.saved} berkas baru, ${total.skipped} dilewati, ${total.failed} gagal.`);
  return { ok: true, ...total, chats: queue.length };
}

/**
 * Unduh semua media di chat yang sedang terbuka, dari bawah ke atas.
 *
 * Arahnya bukan selera: Telegram memuat pesan lama saat di-scroll ke ATAS,
 * jadi mulai dari yang terbaru adalah satu-satunya urutan yang tidak
 * mengharuskan menggulung seluruh riwayat lebih dulu sebelum berkas pertama
 * tersimpan. Proses yang terputus di tengah tetap meninggalkan hasil.
 */
async function runOneChat(settings, { offset = null, title = null } = {}) {
  const s = settings || {};
  STEP = Math.max(120, Number(s.stepDelay) || 500);
  const includeVideo = !!s.tgIncludeVideo;
  const maxItems = Math.max(0, Number(s.tgMaxItems) || 0);
  // Memuat riwayat lama itu permintaan jaringan; 4 percobaan terlalu mudah
  // menyimpulkan "habis" padahal jawabannya belum datang.
  const scrollRetries = Math.max(8, Number(s.scrollRetries) || 4);
  const dlTimeout = Math.max(15000, Number(s.downloadTimeout) || 240000);
  /** Batas ukuran per berkas (setelan, MB). 0 = tanpa batas. */
  const maxBytes = Math.max(0, Number(s.tgMaxSizeMB) || 0) * 1048576;
  /*
   * Lompat ke tujuan berikutnya setelah N media BERTURUT-TURUT sudah ada.
   * Urutannya dari yang terbaru, jadi deretan panjang "sudah ada" berarti
   * sisanya sudah pernah diunduh — tidak perlu menyusuri ribuan item lagi.
   * Yang mereset hitungan: unduhan baru atau kegagalan (masih ada yang belum
   * punya). Dilewati karena kebesaran / video dimatikan tidak dihitung.
   * 0 = mati.
   */
  const skipStreakMax = Math.max(0, Number(s.tgSkipStreak ?? 200) || 0);
  let dupStreak = 0;

  const peer = detectPeer();
  if (!peer.peerId) throw new Error('Tidak ada pesan di layar — buka dulu chat-nya di Telegram Web.');
  // Untuk topik forum, header hanya menampilkan nama forumnya — judul yang
  // benar (termasuk nama topiknya) hanya diketahui dari antrean.
  const bucket = 'tg:' + (title || peer.title);

  const info = await bg('tgInfo', { bucket });
  log('ok', `"${title || peer.title}" → ${info.dir}`);

  /*
   * Isi folder dibaca sekali di awal, dan itulah acuan utama "sudah punya".
   *
   * Pencocokannya memakai message-id, BUKAN URL. URL media di Telegram Web
   * berbentuk blob: dengan UUID acak yang dibuat ulang setiap halaman dimuat —
   * foto yang sama punya URL berbeda tiap sesi, jadi membandingkan URL berarti
   * tidak ada perlindungan sama sekali saat diulang. message-id tidak berubah,
   * dan karena dipakai sebagai nama berkas, isi folder langsung bisa dibaca
   * sebagai daftar "sudah diunduh".
   */
  const disk = await bg('tgScan', { bucket });
  const ONDISK = new Set(disk.mids || []);
  if (disk.available) {
    log('info', `${ONDISK.size} berkas sudah ada di folder — itu yang dilewati.`);
  } else {
    log('warn', 'Native host tidak aktif: anti-duplikat hanya bersandar pada catatan extension, bukan isi folder.');
  }
  if (info.indexed) log('info', `${info.indexed} media tercatat di index extension.`);

  const box = scrollBox();
  box.scrollTop = box.scrollHeight;          // mulai dari pesan terbaru
  await pause(2);

  let dir = 'up';          // naik dulu (dari terbaru), lalu sapu balik ke bawah
  const SEEN = new Set();
  const TRIES = new Map();

  /** Kembalikan item ke antrean kalau jatahnya masih ada. */
  const retry = (mid) => {
    const n = (TRIES.get(mid) || 0) + 1;
    TRIES.set(mid, n);
    if (n >= 3) return false;
    SEEN.delete(mid);        // boleh dicoba lagi saat ia tampil lagi
    processed--;             // belum jadi "diproses"
    return true;
  };

  let processed = 0, saved = 0, skipped = 0, failed = 0, failStreak = 0;

  // Angka di panel harus jumlah SELURUH antrean, bukan chat ini saja — kalau
  // tidak, hitungannya kembali ke nol tiap ganti chat dan terlihat seperti
  // pekerjaan sebelumnya hilang.
  const base = offset || { processed: 0, saved: 0, skipped: 0, failed: 0 };
  const stats = () => report('tgstats', {
    processed: base.processed + processed,
    saved:     base.saved + saved,
    skipped:   base.skipped + skipped,
    failed:    base.failed + failed
  });

  /*
   * JALUR UTAMA: panel Media.
   *
   * Klik header chat -> panel Media kanan -> klik item PERTAMA -> unduh dari
   * viewer (resolusi penuh; video lewat URL stream/ -> .mp4) -> panah kanan
   * -> unduh -> … dalam SATU modal yang sama sampai panah kanan tidak lagi
   * berpindah. Nama berkas (data-mid) diambil dari item grid pada urutan yang
   * sama; tiap perpindahan dicocokkan jenisnya (video/gambar) dengan grid,
   * dan kalau meleset, item itu dibuka ulang dari grid supaya selaras lagi.
   *
   * Kalau panelnya tidak bisa dibuka, jatuh ke cara lama di bawah
   * (menggulung pesan satu per satu).
   */
  if (await openSharedMedia(peer.peerId)) {
    log('info', 'Panel Media terbuka — membuka item pertama, lalu panah kanan.');

    /** Elemen tampilan item yang aktif; diganti Telegram setiap berpindah item. */
    const activeView = () => activeMover()?.querySelector('.media-viewer-aspecter') || activeMover();
    /** Sumber media yang sedang tampil — penanda item mana yang terbuka. */
    const viewSrcs = () => [...(activeView()?.querySelectorAll('img, video') || [])]
      .map(m => m.currentSrc || m.getAttribute('src') || '').filter(Boolean);
    // Hanya item aktif — lihat activeMover().
    const viewerIsVideo = () => !!activeMover()?.querySelector('video');

    /** Buka item ber-mid ini dari grid (pembuka pertama, atau penyelarasan ulang). */
    const openFromGrid = async (mid) => {
      if (!await closeViewer()) {
        throw new Error('viewer tidak bisa ditutup — berhenti supaya modal tidak saling tumpuk');
      }
      const g = await findGridItem(mid);
      if (!g) return false;
      try { g.scrollIntoView({ block: 'nearest' }); } catch {}
      realClick(g.querySelector('img') || g);
      return !!await waitFor(() => viewerShown() && activeView(), 10000);
    };

    /*
     * Cari item grid ber-mid ini, MENGGULUNG grid kalau perlu.
     *
     * Grid hanya menyimpan item di sekitar posisi gulungan; dengan ratusan
     * media, item ke-35 sudah dibuang dari DOM setelah grid digulung balik
     * ke atas. Dulu itu berarti "gagal menyelaraskan ulang" -> berhenti total.
     */
    const findGridItem = async (mid) => {
      const find = () => gridItems(peer.peerId).find(x => x.getAttribute('data-mid') === mid);
      let g = find();
      if (g) return g;
      const any = gridItems(peer.peerId)[0];
      const sc = any ? scrollBox(any) : null;
      if (!sc) return null;

      /*
       * Cari MAJU dari posisi gulungan sekarang dulu: item yang dicari
       * hampir selalu item berikutnya, yang ada tepat di bawah posisi
       * terakhir. Baru kalau mentok di bawah, ulangi dari atas. Selalu mulai
       * dari atas berarti ratusan gulungan per item pada grid 3.900 media.
       */
      const sweep = async (maxSteps) => {
        for (let k = 0; k < maxSteps && !(g = find()); k++) {
          guard();
          const before = sc.scrollTop;
          sc.scrollTop = before + Math.round((sc.clientHeight || 400) * 0.8);
          sc.dispatchEvent(new Event('scroll', { bubbles: true }));
          await pause(0.8);
          if (sc.scrollTop === before) break;          // sudah mentok bawah
        }
        return g || find() || null;
      };
      if (await sweep(2000)) return g || find();
      sc.scrollTop = 0;
      sc.dispatchEvent(new Event('scroll', { bubbles: true }));
      await pause(1);
      return (await sweep(2000)) || null;
    };

    /*
     * Jenis item yang sedang tampil, SETELAH viewer selesai memasangnya.
     *
     * Video menampilkan gambar poster dulu dan baru memasang <video> sesaat
     * kemudian. Memeriksa terlalu cepat membuat setiap video terbaca "gambar"
     * — itulah "urutan viewer tidak cocok" palsu yang memicu penyelarasan
     * ulang dan menghentikan unduhan di tengah jalan.
     */
    const settledIsVideo = async (expectVideo) => {
      await waitFor(() => activeView()?.querySelector('video, img'), 3000);
      if (expectVideo) await waitFor(() => viewerIsVideo(), 6000);
      else await pause(0.5);
      return viewerIsVideo();
    };

    /*
     * Daftar LENGKAP media, dikumpulkan SEBELUM modal dibuka.
     *
     * Grid hanya memuat yang terlihat (4–9 item), dan selama modal terbuka
     * ia tidak memuat lanjutan — dulu viewer terus berlanjut tapi nama
     * berkasnya tidak bisa dipastikan, jadi loop berhenti setelah satu
     * layar. Sekarang grid digulung sampai paling bawah dulu, dan urutan
     * mid + jenisnya dicatat; baru setelah itu item pertama dibuka.
     */
    const collectGrid = async () => {
      const order = [];
      const seen = new Set();
      const take = () => {
        for (const g of gridItems(peer.peerId)) {
          const m = g.getAttribute('data-mid');
          if (seen.has(m)) continue;
          seen.add(m);
          const v = !!g.querySelector('.video-time');
          order.push({ mid: m, isVideo: v, gridVideo: v });
        }
      };
      take();
      const first = gridItems(peer.peerId)[0];
      const sc = first ? scrollBox(first) : null;
      if (sc) {
        /*
         * Digulung BERTAHAP, bukan langsung melompat ke paling bawah: kalau
         * grid hanya menyimpan item di sekitar posisi gulungan, lompatan
         * membuat item di tengah tidak pernah sempat terbaca. Di dasar grid
         * ditunggu lebih lama supaya lanjutan sempat dimuat.
         */
        let idle = 0;
        while (idle < Math.max(3, scrollRetries)) {
          guard();
          const n = order.length, top = sc.scrollTop;
          const atBottom = top + (sc.clientHeight || 0) >= sc.scrollHeight - 5;
          sc.scrollTop = atBottom ? sc.scrollHeight : top + Math.round((sc.clientHeight || 400) * 0.9);
          sc.dispatchEvent(new Event('scroll', { bubbles: true }));
          await pause(atBottom ? 1.6 : 0.6);
          take();
          idle = (order.length !== n || sc.scrollTop !== top) ? 0 : idle + 1;
          report('tgstep', { index: order.length, total: order.length, title: `${title || peer.title} — mendata media`, phase: 'buka' });
        }
        sc.scrollTop = 0;
        sc.dispatchEvent(new Event('scroll', { bubbles: true }));
        await pause(1);
      }
      return order;
    };

    const list = await collectGrid();
    log('info', `${list.length} media di grid (${list.filter(x => x.isVideo).length} video) — membuka yang pertama.`);
    if (!list.length || !await openFromGrid(list[0].mid)) {
      throw new Error('Viewer tidak terbuka dari grid Media.');
    }

    let i = 0;
    let key = 'ArrowRight';
    for (;;) {
      guard();
      const { mid, isVideo } = list[i];

      if (maxItems && processed >= maxItems) {
        log('warn', `Batas ${maxItems} media tercapai.`);
        await closeViewer();
        stats();
        return { ok: true, processed, saved, skipped, failed, reason: 'batas' };
      }

      // ---- item yang sedang tampil
      if (isVideo && !includeVideo) {
        skipped++;
      } else if (processed++, ONDISK.has(mid) || (await bg('tgCheckDup', { bucket, mid })).dup) {
        skipped++;
        if (skipStreakMax && ++dupStreak >= skipStreakMax) {
          log('ok', `${dupStreak} media berturut-turut sudah ada — sisanya dianggap sudah terunduh, lanjut ke tujuan berikutnya.`);
          await closeViewer();
          stats();
          return { ok: true, processed, saved, skipped, failed, reason: 'sudah-terunduh' };
        }
      } else {
        try {
          let asVideo = isVideo;
          let media = await viewerMedia(asVideo, list[i].gridVideo ? 15000 : 4000);
          if (!media && asVideo && !list[i].gridVideo) {
            // Dianggap GIF tapi ternyata tidak ada videonya: itu gambar biasa.
            asVideo = false;
            media = await viewerMedia(false);
          }
          if (!media) throw new Error(asVideo ? 'video tidak muncul di viewer' : 'gambar tidak muncul di viewer');
          let blob, ext;
          if (asVideo) ({ blob, ext } = await fetchVideo(media.src, maxBytes));
          else {
            const raw = await (await fetch(media.src)).blob();
            assertSize(raw.size, maxBytes, 'gambar');
            ({ blob, ext } = await normalizeImage(raw));
          }

          const armId = await startDownload({ bucket, key: `${mid}.${ext}`, url: media.src, blob });
          const res = await waitDownload(armId, dlTimeout);
          if (res.ok) {
            saved++;
            dupStreak = 0;
            ONDISK.add(mid);
            await bg('markKey', { email: bucket, key: mid });
          } else {
            failed++;
            dupStreak = 0;
            log('err', `${mid}: ${res.error}`);
            await bg('cancelArm').catch(() => {});
          }
        } catch (e) {
          if (e instanceof Abort || e instanceof SkipChat) { await closeViewer().catch(() => {}); throw e; }
          if (e instanceof TooBig) { skipped++; log('info', `${mid}: ${e.message}.`); }
          else { failed++; dupStreak = 0; log('err', `${mid}: ${e.message}`); }
        }
      }
      stats();

      // ---- panah kanan -> item berikutnya, di modal yang sama
      /*
       * Berpindah atau tidak dinilai dari SUMBER media-nya (src gambar/video),
       * bukan dari elemennya: Telegram memakai ulang elemen tampilan yang sama
       * dan hanya mengganti isinya. Membandingkan elemen membuat setiap
       * perpindahan terbaca "tidak berpindah = habis", dan hanya item pertama
       * yang pernah terunduh.
       */
      const before = viewSrcs();
      const movedAway = () => { const now = viewSrcs(); return now.length && !now.some(x => before.includes(x)); };
      const step = async (k) => {
        sendKey(k, k, k === 'ArrowRight' ? 39 : 37);
        if (await waitFor(movedAway, 3000)) return true;
        // Panah keyboard tidak direspons: klik tombol panah di viewer.
        const btn = document.querySelector(k === 'ArrowRight'
          ? '.media-viewer-switcher-right, [class*="switcher-right"]'
          : '.media-viewer-switcher-left, [class*="switcher-left"]');
        if (btn) { realClick(btn); if (await waitFor(movedAway, 3000)) return true; }
        return false;
      };
      if (i + 1 >= list.length) { log('ok', 'Item terakhir di grid selesai.'); break; }
      let moved = await step(key);
      for (let t = 0; t < 2 && !moved; t++) {
        // Viewer mungkin sedang memuat lanjutan — beri waktu, coba lagi.
        await pause(3 + t * 4);
        moved = await step(key);
      }
      if (!moved && i === 0 && key === 'ArrowRight') {
        // Di sebagian tampilan urutannya terbalik: "berikutnya" ada di kiri.
        moved = await step('ArrowLeft');
        if (moved) key = 'ArrowLeft';
      }
      if (!moved) {
        /*
         * Panah kanan tidak berpindah padahal daftar belum habis (3.900 media,
         * macet di ~120): viewer sedang memuat lanjutan daftarnya sendiri,
         * atau item berikutnya lama sekali tampil. Itu BUKAN akhir — buka
         * item berikutnya langsung dari grid, lalu lanjut panah kanan.
         */
        log('warn', `Panah kanan tidak berpindah di item ${i + 1}/${list.length} — ` +
                    `membuka item berikutnya langsung dari grid.`);
        i++;
        let ok = await openFromGrid(list[i].mid);
        while (!ok && i + 1 < list.length) {
          log('warn', `${list[i].mid}: tidak ketemu di grid, dilewati.`);
          skipped++; stats();
          i++;
          ok = await openFromGrid(list[i].mid);
        }
        if (!ok) { log('err', 'Tidak bisa membuka item berikutnya dari grid — berhenti.'); break; }
        await settledIsVideo(list[i].isVideo);
        continue;
      }

      i++;

      // ---- cocokkan: jenis item di viewer harus sama dengan item ke-i di daftar
      const nowVideo = await settledIsVideo(list[i].isVideo);
      if (nowVideo && !list[i].isVideo) {
        // Grid bilang gambar, viewer memutar video: GIF/animasi. Bukan
        // urutan yang meleset — unduh sebagai video.
        list[i].isVideo = true;
      } else if (!nowVideo && list[i].isVideo) {
        log('warn', `Urutan viewer tidak cocok dengan grid di item ${list[i].mid} — diselaraskan ulang.`);
        let ok = await openFromGrid(list[i].mid);
        // Item ini tidak bisa dibuka lagi: lanjut dari item sesudahnya,
        // jangan hentikan seluruh chat.
        while (!ok && i + 1 < list.length) {
          log('warn', `${list[i].mid}: tidak ketemu di grid, dilewati.`);
          skipped++; stats();
          i++;
          ok = await openFromGrid(list[i].mid);
        }
        if (!ok) { log('err', 'Gagal menyelaraskan ulang viewer.'); break; }
      }
    }

    await closeViewer();
    stats();
    log('ok', `${title || peer.title}: ${saved} baru, ${skipped} dilewati, ${failed} gagal (panel Media).`);
    return { ok: true, processed, saved, skipped, failed, reason: 'habis' };
  }
  log('warn', 'Panel Media tidak terbuka — memakai cara lama (menggulung pesan).');

  for (;;) {
    guard();

    /*
     * HANYA yang benar-benar dirender yang dikerjakan.
     *
     * Telegram menyimpan bubble di DOM jauh melebihi yang tampil, dan yang
     * belum dirender tidak pernah mendapat gambarnya — <img>-nya kosong
     * selamanya. Versi sebelumnya memasukkan semuanya ke antrean, lalu
     * menunggu 12 detik per item sampai menyerah: itulah banjir "gambar belum
     * dimuat, dilewati" yang bergerak setiap 12 detik tanpa satu pun berkas
     * tersimpan.
     *
     * Item yang belum dirender TIDAK ditandai sudah dilihat — ia akan
     * dikerjakan begitu masuk layar, dan itu memang tugas loop di bawah.
     */
    const unseen = mediaItems().filter(i => !SEEN.has(i.mid));
    const batch = unseen.filter(isRendered).reverse();   // bawah → atas

    for (const item of batch) {
      guard();
      if (!isRendered(item)) continue;   // sempat tergulung keluar layar

      /*
       * Ditandai sudah dilihat HANYA setelah benar-benar ditangani.
       *
       * Telegram membuang bubble yang keluar layar. Kalau item ditandai lebih
       * dulu lalu gagal sementara — gambarnya belum sempat dimuat — ia tidak
       * akan pernah dicoba lagi, dan begitu layar bergeser bubble-nya lenyap
       * dari DOM. Itu kehilangan permanen dalam satu jalannya.
       *
       * Jadi yang gagal sementara dikembalikan ke antrean, dengan jatah
       * percobaan supaya tidak berputar selamanya pada item yang memang rusak.
       */
      SEEN.add(item.mid);

      if (maxItems && processed >= maxItems) {
        log('warn', `Batas ${maxItems} media tercapai.`);
        stats();
        return { ok: true, processed, saved, skipped, failed, reason: 'batas' };
      }

      if (item.isVideo && !includeVideo) { skipped++; stats(); continue; }

      processed++;
      try {
        // Berkasnya sudah ada di folder: tidak perlu tanya siapa-siapa lagi.
        const already = ONDISK.has(item.mid) || (await bg('tgCheckDup', { bucket, mid: item.mid })).dup;
        if (already) {
          skipped++; stats();
          if (skipStreakMax && ++dupStreak >= skipStreakMax) {
            log('ok', `${dupStreak} media berturut-turut sudah ada — sisanya dianggap sudah terunduh, lanjut ke tujuan berikutnya.`);
            return { ok: true, processed, saved, skipped, failed, reason: 'sudah-terunduh' };
          }
          continue;
        }

        let url, ext, blob = null, revoke = null;

        if (item.isVideo) {
          /*
           * Dibiarkan tercatat GAGAL, bukan dilewati diam-diam: sumbernya
           * belum ada berarti videonya belum dimuat Telegram, dan menandainya
           * "selesai" akan membuatnya terlewat selamanya di jalankan ulang.
           */
          const v = item.video || item.el.querySelector('video');
          url = v?.currentSrc || v?.src || '';
          if (!url) throw new Error('video belum dimuat Telegram — putar sekali lalu ulangi');
          ({ blob, ext } = await fetchVideo(url, maxBytes));
        } else {
          if (!item.el.isConnected) { skipped++; stats(); continue; }   // bubble sudah dibuang Telegram
          const src = await waitBlobSrc(item.img, item.el);
          if (!src) {
            if (retry(item.mid)) { stats(); continue; }
            skipped++; stats();
            log('warn', `${item.mid}: gambar tidak dimuat setelah 3 percobaan, dilewati.`);
            continue;
          }
          const raw = await (await fetch(src)).blob();
          const norm = await normalizeImage(raw);
          ext = norm.ext;
          blob = norm.blob;
          // Blob hasil konversi butuh URL sendiri; yang asli dipakai apa adanya.
          url = norm.blob === raw ? src : (revoke = URL.createObjectURL(norm.blob));
        }

        const key = `${item.mid}.${ext}`;
        const armId = await startDownload({ bucket, key, url, blob });

        const res = await waitDownload(armId, dlTimeout);
        if (revoke) URL.revokeObjectURL(revoke);

        if (res.ok) {
          saved++; failStreak = 0; dupStreak = 0;
          ONDISK.add(item.mid);
          await bg('markKey', { email: bucket, key: item.mid });
        } else {
          failed++; failStreak++; dupStreak = 0;
          log('err', `${item.mid}: ${res.error}`);
          await bg('cancelArm').catch(() => {});
        }
      } catch (e) {
        if (e instanceof Abort || e instanceof SkipChat) throw e;
        if (e instanceof TooBig) { skipped++; log('info', `${item.mid}: ${e.message}.`); }
        else { failed++; failStreak++; dupStreak = 0; log('err', `${item.mid}: ${e.message}`); }
      }

      stats();

      if (failStreak >= 5) {
        log('err', 'Lima kegagalan berturut-turut — berhenti supaya tidak jalan sia-sia.');
        return { ok: true, processed, saved, skipped, failed, reason: 'gagal beruntun' };
      }
      await pause(0.4);
    }

    // Masih ada yang tadi dikerjakan: enumerasi ulang, jangan buru-buru scroll.
    if (batch.length) continue;

    // Layar kosong dari pekerjaan — gulung sampai ada yang benar-benar tampil.
    const hasWork = () => mediaItems().some(m => !SEEN.has(m.mid) && isRendered(m));
    if (await scrollPass(box, scrollRetries, hasWork, dir)) continue;

    /*
     * Sampai ujung ke ATAS belum berarti selesai.
     *
     * Telegram membuang bubble yang keluar layar, jadi apa pun yang tidak
     * sempat diambil saat ia tampil — gambarnya belum dimuat, unduhannya
     * gagal sesaat — ikut lenyap di belakang kita. Menyapu balik ke bawah
     * memunculkannya lagi, dan yang sudah tersimpan tinggal dilewati lewat
     * daftar isi folder. Jadi sapuan kedua murah: yang diunduh cuma yang
     * memang terlewat.
     */
    if (dir === 'up') {
      dir = 'down';
      log('ok', 'Sampai pesan teratas — menyapu balik ke bawah untuk yang sempat terlewat.');
      continue;
    }

    log('ok', `Selesai disapu dua arah${saved ? ` — ${saved} berkas baru` : ''}.`);
    stats();
    return { ok: true, processed, saved, skipped, failed, reason: 'habis' };
  }
}

/**
 * Benar-benar tampil, bukan sekadar ada di DOM.
 *
 * Bubble yang belum dirender punya kotak berukuran nol — dan Telegram tidak
 * pernah mengunduh gambarnya. Memakainya sebagai pekerjaan berarti menunggu
 * sesuatu yang tidak akan pernah datang.
 */
function isRendered(item) {
  const r = item.el.getBoundingClientRect();
  return r.height > 8 && r.width > 8;
}

/**
 * Scroll ke atas sampai ada media baru termuat.
 *
 * Mengembalikan false hanya kalau setelah beberapa percobaan benar-benar tidak
 * ada mid baru. Satu percobaan saja tidak cukup: memuat riwayat lama itu
 * permintaan jaringan, dan "belum datang" mudah tersamar seperti "sudah habis".
 */
async function scrollPass(box, retries, hasWork, dir = 'up') {
  /** Cukup untuk tahu apakah daftarnya masih bergerak atau sudah mentok. */
  const snapshot = () => {
    const all = document.querySelectorAll('.bubble[data-mid]');
    return {
      top: box.scrollTop,
      count: document.querySelectorAll('[data-mid]').length,
      first: all[0]?.getAttribute('data-mid') || '',
      last: all[all.length - 1]?.getAttribute('data-mid') || ''
    };
  };

  /*
   * Batas keras berapa kali boleh scroll TANPA mendapat media baru.
   *
   * Versi sebelumnya menganggap "scrollTop berubah" sebagai kemajuan dan
   * mereset hitungannya. Di ujung atas percakapan, Telegram terus menggeser
   * scrollTop sedikit-sedikit sambil menata ulang daftarnya, jadi syarat itu
   * selalu terpenuhi dan loopnya berjalan sampai batas 2000 langkah — sekitar
   * 40 menit berdiri di satu chat. Dari luar itu terlihat seperti antrean
   * chat yang macet dan tidak mau lanjut.
   *
   * Yang dihitung sebagai kemajuan sekarang hanya yang benar-benar berarti:
   * pesan lama baru masuk ke DOM.
   */
  const MAX_BARREN = 40;

  let idle = 0;          // percobaan berturut-turut tanpa pesan lama baru
  let steps = 0;

  /*
   * Bubble paling pinggir DI LAYAR — atas untuk naik, bawah untuk turun.
   * Dipilih dari posisi layar, bukan urutan DOM: daftarnya dirender terbalik.
   */
  const edgeBubble = () => {
    let best = null, bestVal = dir === 'up' ? Infinity : -Infinity;
    for (const b of document.querySelectorAll('.bubble[data-mid]')) {
      const r = b.getBoundingClientRect();
      if (r.height <= 0) continue;
      if (dir === 'up' ? r.top < bestVal : r.bottom > bestVal) {
        bestVal = dir === 'up' ? r.top : r.bottom;
        best = b;
      }
    }
    return best;
  };

  while (idle < retries && steps++ < MAX_BARREN) {
    guard();
    const before = snapshot();

    /*
     * Digulung lewat ELEMENNYA, bukan lewat wadah yang ditebak.
     *
     * scrollBox() menebak wadah mana yang bisa di-scroll dari overflow dan
     * tinggi. Kalau tebakannya meleset, scrollTop tidak ke mana-mana, tidak
     * ada pesan lama yang termuat, dan setelah beberapa percobaan chatnya
     * dianggap habis — padahal isinya masih panjang. scrollIntoView tidak
     * perlu tahu wadahnya: browser yang mencarikan.
     */
    // block:center menyisakan tumpang-tindih setengah layar, jadi tidak ada
    // item yang sempat lewat tanpa pernah tampil.
    edgeBubble()?.scrollIntoView({ block: 'center' });
    const step = Math.round((box.clientHeight || 600) * 0.6) * (dir === 'up' ? -1 : 1);
    box.scrollTop = Math.max(0, box.scrollTop + step);
    box.dispatchEvent(new Event('scroll', { bubbles: true }));
    try {
      box.dispatchEvent(new WheelEvent('wheel', { deltaY: dir === 'up' ? -600 : 600, bubbles: true, cancelable: true }));
    } catch { /* WheelEvent tidak ada di lingkungan uji */ }

    await pause(2.4);
    if (hasWork()) return true;

    /*
     * Tidak ada media baru BUKAN berarti sudah habis.
     *
     * Channel campuran bisa punya puluhan pesan teks berturut-turut di antara
     * dua foto. Versi sebelumnya menghitung itu sebagai percobaan gagal, jadi
     * setelah empat kali scroll ia menyimpulkan "sudah sampai atas" padahal
     * baru melewati satu blok teks — dan sisa riwayatnya tidak pernah
     * tersentuh. Yang dihitung sekarang: daftarnya masih bergerak atau tidak.
     */
    const now = snapshot();
    const edgeMoved = dir === 'up' ? now.first !== before.first : now.last !== before.last;
    const grew = now.count > before.count || edgeMoved;
    if (grew) { idle = 0; continue; }   // scrollTop bergeser saja TIDAK dihitung

    idle++;
    log('info', `Menunggu pesan ${dir === 'up' ? 'lama' : 'baru'} termuat (${idle}/${retries}) …`);
  }

  /*
   * Kalau menyerah, sebutkan angkanya.
   *
   * "Sudah sampai pesan paling atas" itu kesimpulan, bukan pengamatan — dan
   * kalau kesimpulannya salah, dari log biasa tidak ada cara membedakannya
   * dari chat yang memang sudah habis. Angka-angka ini yang membedakan.
   */
  const s = snapshot();
  log('warn',
    `Berhenti menggulung setelah ${steps}× — scrollTop ${s.top}/${box.scrollHeight}, ` +
    `${s.count} pesan di DOM, teratas ${s.first || '?'}. ` +
    (s.top > 40 ? 'Masih jauh dari atas: kemungkinan gulungannya tidak bekerja.' : 'Sudah di puncak.'));
  return false;
}

// =============================================================== dispatcher

/**
 * Potret keadaan halaman apa adanya.
 *
 * Ada supaya kalau ada yang tidak jalan, jawabannya datang dari halamanmu
 * sendiri — bukan dari menebak-nebak struktur Telegram dari jauh, yang sudah
 * beberapa kali meleset dan memakan waktumu.
 */
async function taskDiag() {
  const imgs = [...document.querySelectorAll('img.media-photo')];
  const inner = document.querySelector('.bubbles-inner') || document.querySelector('.bubbles');
  const anchor = document.querySelector('.bubble[data-mid]');
  const box = anchor ? scrollBox(anchor) : null;

  const sample = imgs.slice(0, 10).map(i => {
    const carrier = i.closest('[data-mid]');
    const r = (carrier || i).getBoundingClientRect();
    const s = i.currentSrc || i.src || '';
    return {
      mid: carrier?.getAttribute('data-mid') || null,
      srcPrefix: s ? s.slice(0, 14) : '(kosong)',
      w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top)
    };
  });

  return {
    ok: true,
    v: TG_VERSION,
    url: location.href,
    peer: detectPeer(),
    counts: {
      bubbles: document.querySelectorAll('.bubble[data-mid]').length,
      mediaPhoto: imgs.length,
      berblob: imgs.filter(i => (i.currentSrc || i.src || '').startsWith('blob:')).length,
      dirender: mediaItems().filter(isRendered).length,
      chatRows: document.querySelectorAll('a.chatlist-chat').length,
      forumRows: chatRows().filter(c => c.isForum).length
    },
    layout: {
      flexDirection: inner ? getComputedStyle(inner).flexDirection : null,
      innerClass: (inner?.className || '').slice(0, 80),
      scrollBoxClass: (box?.className || '').slice(0, 80),
      scrollTop: box?.scrollTop, scrollHeight: box?.scrollHeight, clientHeight: box?.clientHeight,
      viewportH: window.innerHeight
    },
    sample,
    mediaTags: [...new Set([...document.querySelectorAll('.bubble img, .bubble canvas, .bubble video')]
      .map(e => `${e.tagName}.${String(e.className).split(' ').slice(0, 3).join('.')}`))].slice(0, 12)
  };
}

/**
 * Kerjakan SATU chat atau topik, lalu kembali ke panel.
 *
 * Antreannya diatur panel, bukan di sini: di antara dua chat/topik panel
 * kembali ke https://web.telegram.org/k/ (memuat ulang halaman supaya
 * keadaan Telegram bersih), dan pemuatan ulang itu mematikan content script
 * ini. Loop yang tinggal di sini akan ikut mati.
 *
 * Grup ber-topik: yang terbuka daftar topik, bukan pesan. Topiknya
 * dikembalikan ke panel ({ topics }) untuk disisipkan ke antrean — tiap
 * topik lalu dikerjakan dengan: kembali ke /k/ -> klik grup -> klik topik.
 */
async function taskRunOne({ settings, peer, index = 1, total = 1, offset = null }) {
  STEP = Math.max(120, Number(settings?.stepDelay) || 500);
  const zero = { processed: 0, saved: 0, skipped: 0, failed: 0 };
  if (!peer) return runOneChat(settings, { offset });

  const openTimeout = Math.max(2000, Number(settings?.tgOpenTimeout) || 20000);
  report('tgstep', { index, total, title: peer.title, phase: 'buka' });

  // Sehabis kembali ke /k/, daftar chat butuh waktu untuk dirender.
  await waitFor(() => document.querySelector('a.chatlist-chat'), 20000);

  const beforeRows = new Set([...document.querySelectorAll('a.chatlist-chat[href]')]
    .map(a => a.getAttribute('href')));
  const opened = await openChat(peer, openTimeout, { beforeRows });

  if (opened && opened.topics) {
    log('ok', `${peer.title}: grup ber-topik, ${opened.topics.length} topik — dikerjakan satu per satu.`);
    return { ok: true, ...zero, topics: opened.topics };
  }
  if (!opened) {
    log('err', `${peer.title}: chat tidak mau terbuka, dilewati.`);
    return { ok: true, ...zero, failedOpen: true };
  }

  report('tgstep', { index, total, title: peer.title, phase: 'unduh' });
  return runOneChat(settings, { offset, title: peer.title });
}

/** Mode satu link: grup yang terbuka + topiknya (kosong = grup biasa). */
async function taskDiscover({ settings }) {
  STEP = Math.max(120, Number(settings?.stepDelay) || 500);
  const group = currentGroup();
  const topics = await discoverTopics(group);
  return { ok: true, group, topics };
}

const TASKS = {
  'tg.probe': taskProbe, 'tg.chats': taskChats, 'tg.run': taskRun, 'tg.diag': taskDiag,
  'tg.runOne': taskRunOne, 'tg.discover': taskDiscover
};

async function runTask(cmd, msg) {
  if (RUNNING) throw new Error(`Masih menjalankan "${RUNNING}". Tekan Stop dulu.`);
  ABORT = false;
  SKIP = false;
  RUNNING = cmd;
  report('start', { task: cmd });
  try {
    const res = await TASKS[cmd](msg);
    report('end', { task: cmd, ...res });
    return res;
  } catch (e) {
    if (e instanceof SkipChat) { log('warn', 'Dilewati.'); report('end', { task: cmd, ok: true, skipped: true }); return { ok: true, skipped: true }; }
    const aborted = e instanceof Abort;
    if (aborted) log('warn', 'Dihentikan oleh pengguna.');
    else log('err', `${cmd} gagal: ${e.message}`);
    report('end', { task: cmd, ok: false, aborted, error: e.message });
    return { ok: false, aborted, error: e.message };
  } finally {
    RUNNING = null;
    await bg('cancelArm').catch(() => {});
  }
}

function onExtMessage(msg, sender, sendResponse) {
  if (!msg?.cmd?.startsWith('tg.')) return false;

  if (msg.cmd === 'tg.ping') {
    sendResponse({ ok: true, v: TG_VERSION, running: RUNNING, url: location.href });
    return false;
  }
  if (msg.cmd === 'tg.stop') { ABORT = true; sendResponse({ ok: true }); return false; }
  if (msg.cmd === 'tg.skip') { SKIP = true; sendResponse({ ok: true }); return false; }

  if (TASKS[msg.cmd]) {
    runTask(msg.cmd, msg).then(r => { try { sendResponse(r); } catch {} });
    return true;
  }

  /*
   * Perintah tg.* yang tidak dikenal HARUS dijawab, bukan didiamkan.
   * Listener yang mengembalikan false menutup kanal tanpa balasan, dan yang
   * sampai ke panel cuma "message channel closed" — menyembunyikan penyebab
   * sebenarnya, yaitu content script versi lama di tab yang belum di-refresh.
   */
  sendResponse({ ok: false, error: `Perintah "${msg.cmd}" tidak ada di tgcontent ${TG_VERSION} — reload extension lalu refresh tab ini.` });
  return false;
}

chrome.runtime.onMessage.addListener(onExtMessage);

window.__WAN_TG_TEARDOWN__ = () => {
  ABORT = true;
  try { chrome.runtime.onMessage.removeListener(onExtMessage); } catch {}
  delete window.__WAN_TG_TEARDOWN__;
};

console.log(`[WAN Studio] tgcontent ${TG_VERSION} siap.`);
})();
