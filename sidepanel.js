/**
 * sidepanel.js — UI WAN Telegram Downloader.
 *
 * Bagian Telegram-nya disalin dari sidebar WAN Studio RPA (D:/AI/wan);
 * yang dibuang hanya bagian WAN (akun, login, check-in, API).
 */

import { STORE, getSettings, setSettings, DEFAULT_SETTINGS } from './common.js';

const $  = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

let SETTINGS = { ...DEFAULT_SETTINGS };

const bg = (cmd, payload = {}) => chrome.runtime.sendMessage({ cmd, ...payload });

function fmtTime(t) {
  const d = new Date(t);
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map(n => String(n).padStart(2, '0')).join(':');
}

function addLog(level, msg, t = Date.now()) {
  for (const box of $$('.log')) {
    const row = document.createElement('div');
    row.innerHTML = `<span class="t">${fmtTime(t)}</span><span class="${level}"></span>`;
    row.lastChild.textContent = msg;
    box.appendChild(row);
    while (box.children.length > 400) box.firstChild.remove();
    box.scrollTop = box.scrollHeight;
  }
}

function setDot(state) { $('#dot').className = 'dot ' + (state || ''); }

function waitTabReady(tabId, timeout = 45000) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const tick = async () => {
      try {
        const t = await chrome.tabs.get(tabId);
        if (t.status === 'complete') { setTimeout(resolve, 1200); return; }
      } catch { return reject(new Error('Tab hilang')); }
      if (Date.now() - t0 > timeout) return reject(new Error('Timeout memuat halaman'));
      setTimeout(tick, 400);
    };
    tick();
  });
}

const CHANNEL_GONE = /message channel closed|Receiving end does not exist|port closed/i;

// --------------------------------------------------------------- setelan

function fillSettingsUI() {
  $('#tgIncludeVideo').checked = !!SETTINGS.tgIncludeVideo;
  $('#tgScanTopics').checked   = !!SETTINGS.tgScanTopics;
  $('#tgMaxItems').value       = SETTINGS.tgMaxItems;
  $('#tgRootDir').value        = SETTINGS.tgRootDir;
  $('#stepDelay').value        = SETTINGS.stepDelay;
  $('#downloadTimeout').value  = SETTINGS.downloadTimeout;
  $('#scrollRetries').value    = SETTINGS.scrollRetries;
}

async function saveSettingsFromUI() {
  SETTINGS = await setSettings({
    tgIncludeVideo:  $('#tgIncludeVideo').checked,
    tgScanTopics:    $('#tgScanTopics').checked,
    tgMaxItems:      Number($('#tgMaxItems').value) || 0,
    tgRootDir:       $('#tgRootDir').value.trim(),
    stepDelay:       Number($('#stepDelay').value) || 500,
    downloadTimeout: Number($('#downloadTimeout').value) || 240000,
    scrollRetries:   Number($('#scrollRetries').value) || 4
  });
  await updatePath();
}

async function updatePath() {
  const r = await bg('tgInfo', {}).catch(() => null);
  $('#stPath').textContent = r?.root ? `${r.root}/<grup>/<topik>/image|video` : '—';
}

function renderNative(info) {
  const box = $('#nativeBox');
  if (info?.available) {
    box.className = 'nativebox on';
    box.textContent = `✔ Aktif (v${info.version}) — berkas dipindah ke folder tujuan.`;
    $('#stNative').textContent = 'aktif';
  } else {
    box.className = 'nativebox off';
    box.textContent = `● Tidak terpasang — berkas tetap di folder Download Chrome. ` +
                      `Jalankan native-host/install.bat. (${info?.error || ''})`;
    $('#stNative').textContent = 'tidak aktif';
  }
}

function renderIndex(stats) {
  const box = $('#idxBox');
  const entries = Object.entries(stats || {}).sort((a, b) => b[1] - a[1]);
  if (!entries.length) { box.innerHTML = '<span class="muted">Belum ada riwayat unduhan.</span>'; return; }
  box.innerHTML = '';
  for (const [k, n] of entries) {
    const r = document.createElement('div'); r.className = 'r';
    const s = document.createElement('span'); s.textContent = k.replace(/^tg:/, '');
    const b = document.createElement('b');    b.textContent = n;
    r.append(s, b); box.appendChild(r);
  }
}

async function refresh() {
  const st = await bg('getState');
  if (!st?.ok) return;
  SETTINGS = { ...DEFAULT_SETTINGS, ...st.settings };
  fillSettingsUI();
  renderNative(st.native);
  renderIndex(st.indexStats);
  for (const l of (st.log || []).slice(-200)) addLog(l.level, l.msg, l.t);
  await updatePath();
}

// ---------------------------------------------------------- progres halaman

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.cmd !== 'progress') return;
  if (msg.type === 'log') addLog(msg.level, msg.msg);
  if (msg.type === 'tgstep') {
    const phase = { buka: 'membuka…', unduh: 'mengunduh', lewat: 'dilewati' }[msg.phase] || msg.phase;
    $('#tgNow').innerHTML = '';
    const a = document.createElement('span');
    a.textContent = `[${msg.index}/${msg.total}] `;
    const b = document.createElement('b');
    b.textContent = msg.title;
    const c = document.createElement('span');
    c.className = 'ph';
    c.textContent = ` — ${phase}`;
    $('#tgNow').append(a, b, c);
  }
  if (msg.type === 'tgstats') {
    $('#tgProc').textContent  = msg.processed ?? 0;
    $('#tgSaved').textContent = msg.saved ?? 0;
    $('#tgSkip').textContent  = msg.skipped ?? 0;
    $('#tgFail').textContent  = msg.failed ?? 0;
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[STORE.nativeInfo]) renderNative(changes[STORE.nativeInfo].newValue);
});

// ------------------------------------------------------------- Telegram

const TG_URL = 'https://web.telegram.org/k/';

/**
 * Rapikan apa pun yang ditempel jadi URL Telegram Web.
 *
 * Link t.me tidak bisa dibuka langsung oleh extension — yang bisa dikendalikan
 * hanya Telegram Web. Untuk channel publik, nama penggunanya cukup untuk
 * membuka chat yang sama di sana.
 */
function tgNormalizeUrl(raw) {
  const v = String(raw || '').trim();
  if (!v) return TG_URL;
  if (/^https?:\/\/web\.telegram\.org\//i.test(v)) return v;

  const m = v.match(/^(?:https?:\/\/)?t\.me\/(?:s\/)?([A-Za-z0-9_]{4,})/i);
  if (m) return `${TG_URL}#@${m[1]}`;

  if (/^@?[A-Za-z0-9_]{4,}$/.test(v)) return `${TG_URL}#@${v.replace(/^@/, '')}`;
  return v;
}

async function tgTab({ navigate = false } = {}) {
  const want = tgNormalizeUrl($('#tgUrl').value);
  const win = await chrome.windows.getCurrent();
  let [tab] = await chrome.tabs.query({ url: 'https://web.telegram.org/*', windowId: win.id });
  if (!tab) [tab] = await chrome.tabs.query({ url: 'https://web.telegram.org/*' });

  if (!tab) {
    tab = await chrome.tabs.create({ url: want, active: true });
    await waitTabReady(tab.id);
  } else if (navigate && $('#tgUrl').value.trim()) {
    await chrome.tabs.update(tab.id, { url: want, active: true });
    await waitTabReady(tab.id);
  }
  await bg('ensureTgContent', { tabId: tab.id });
  return tab;
}

async function tgcs(cmd, payload = {}, { longRunning = false } = {}) {
  const t = await tgTab();
  try {
    const res = await chrome.tabs.sendMessage(t.id, { cmd, settings: SETTINGS, ...payload });
    if (res && res.ok === false && res.error && !res.aborted) throw new Error(res.error);
    return res;
  } catch (e) {
    if (longRunning && CHANNEL_GONE.test(String(e?.message))) {
      addLog('warn', 'Kanal balasan tertutup, tapi unduhan TETAP BERJALAN — pantau lewat log.');
      return { ok: true, detached: true };
    }
    throw e;
  }
}

function tgRow(box, k, v) {
  const d = document.createElement('div'); d.className = 'r';
  const s = document.createElement('span'); s.textContent = k;
  const b = document.createElement('b');    b.textContent = v;
  d.append(s, b); box.appendChild(d);
}

async function tgDoProbe() {
  const box = $('#tgBox');
  box.textContent = 'Mengecek …';
  try {
    const p = await tgcs('tg.probe');
    const info = await bg('tgInfo', { bucket: p.title ? 'tg:' + p.title : null });
    box.innerHTML = '';
    tgRow(box, 'Channel', p.title || '—');
    tgRow(box, 'Media di layar', `${p.inDom} (${p.videos} video)`);
    if (p.topics) tgRow(box, 'Topik terlihat', String(p.topics));
    tgRow(box, 'Sudah tercatat', String(info.indexed || 0));
    const path = document.createElement('div');
    path.style.cssText = 'word-break:break-all;margin-top:6px;color:var(--muted)';
    path.textContent = info.dir || info.root;
    box.appendChild(path);
  } catch (e) {
    box.textContent = `Gagal: ${e.message}`;
  }
}

function tgSetBusy(v) {
  for (const id of ['#tgStart', '#tgOpen', '#tgProbe', '#tgLoadChats', '#tgPickAll', '#tgPickNone']) {
    $(id).disabled = v;
  }
  $('#tgStop').disabled = !v;
  $('#tgSkipOne').disabled = !v;
  setDot(v ? 'busy' : 'on');
}

// ------------------------------------------------------- pilih chat

let TG_CHATS = [];

function tgRenderChats() {
  const box = $('#tgChatList');
  const q = $('#tgChatFilter').value.trim().toLowerCase();
  // Kunci unik: topik-topik satu grup punya peer-id yang SAMA, jadi peer-id
  // saja membuat mencentang satu topik ikut mencentang semuanya.
  const keyOf = (c) => c.key || c.peerId;
  const picked = new Set(tgPicked().map(keyOf));

  box.hidden = false;
  $('#tgChatFilter').hidden = false;
  box.innerHTML = '';

  const shown = TG_CHATS.filter(c => !q || c.title.toLowerCase().includes(q));
  for (const c of shown) {
    const l = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = keyOf(c);
    cb.checked = picked.has(keyOf(c));
    const nm = document.createElement('span');
    nm.className = 'nm';
    // Topik ditampilkan menjorok dengan nama topiknya saja; nama grupnya sudah
    // terbaca di baris induknya tepat di atas.
    const isTopic = c.title.includes('/');
    nm.textContent = isTopic ? '↳ ' + c.title.split('/').slice(1).join('/') : c.title;
    if (isTopic) nm.style.paddingLeft = '12px';
    l.append(cb, nm);

    if (c.hasTopics) {
      // Wadah topik: tidak ada media langsung di bawahnya.
      cb.checked = false; cb.disabled = true;
      const t = document.createElement('span');
      t.className = 'tag'; t.textContent = 'forum';
      t.title = 'Grup ber-topik — pilih topiknya di bawah ini.';
      l.appendChild(t);
    } else if (c.isForum) {
      const t = document.createElement('span');
      t.className = 'tag'; t.textContent = 'forum?';
      t.title = 'Topiknya tidak terbaca; hanya topik yang terbuka yang akan terunduh.';
      l.appendChild(t);
    }
    cb.addEventListener('change', tgUpdatePickCount);
    box.appendChild(l);
  }
  if (!shown.length) box.textContent = q ? 'Tidak ada yang cocok.' : 'Belum ada daftar.';
  tgUpdatePickCount();
}

/** Centang saat ini -> data chat-nya. Urutannya mengikuti daftar. */
function tgPicked() {
  const on = new Set([...document.querySelectorAll('#tgChatList input:checked')].map(i => i.value));
  return TG_CHATS.filter(c => on.has(c.key || c.peerId));
}

function tgUpdatePickCount() {
  const n = document.querySelectorAll('#tgChatList input:checked').length;
  $('#tgPickCount').textContent = TG_CHATS.length ? `(${n}/${TG_CHATS.length} dipilih)` : '';
  $('#tgStart').textContent = n ? `▶ Unduh ${n} chat` : '▶ Unduh chat terbuka';
}

async function tgLoadChats() {
  tgSetBusy(true);
  $('#tgChatList').hidden = false;
  $('#tgChatList').textContent = 'Menggulung daftar chat …';
  try {
    await tgTab({ navigate: false });
    const withTopics = $('#tgScanTopics').checked;
    if (withTopics) addLog('info', 'Memeriksa sub-topik: tiap chat dibuka sebentar, ini makan waktu.');
    const r = await tgcs('tg.chats', { withTopics }, { longRunning: true });
    TG_CHATS = r?.chats || [];
    addLog('ok', `${TG_CHATS.length} chat terdata.`);
    tgRenderChats();
  } catch (e) {
    $('#tgChatList').textContent = `Gagal: ${e.message}`;
    addLog('err', e.message);
  }
  tgSetBusy(false);
}

function tgSetAll(on) {
  // Baris wadah forum sengaja dinonaktifkan — jangan ikut tercentang.
  for (const cb of document.querySelectorAll('#tgChatList input:not(:disabled)')) cb.checked = on;
  tgUpdatePickCount();
}

let TG_STOP = false;

/**
 * Kembali ke https://web.telegram.org/k/ — halaman dimuat ulang, jadi
 * Telegram mulai dari keadaan bersih (tanpa chat terbuka, daftar kiri =
 * daftar chat utama) sebelum grup/topik berikutnya diklik.
 */
async function tgGoHome(tab) {
  await chrome.tabs.update(tab.id, { url: TG_URL });
  await waitTabReady(tab.id);
  await bg('ensureTgContent', { tabId: tab.id });
}

/**
 * Antrean diatur DI SINI, bukan di content script.
 *
 * Tiap grup/topik: kembali ke /k/ -> klik grup -> (klik topik) -> unduh.
 * Kembali ke /k/ memuat ulang halaman dan mematikan content script, jadi
 * loop yang tinggal di halaman akan ikut mati di tengah antrean.
 *
 * Grup ber-topik melaporkan topiknya; topik itu disisipkan tepat setelah
 * grupnya, jadi semua topik satu grup selesai dulu sebelum pindah grup.
 */
async function tgDoStart() {
  const peers = tgPicked();

  if (peers.length > 1 &&
      !confirm(`Unduh ${peers.length} chat berurutan?\n\n` +
               `Tiap chat masuk ke foldernya sendiri. Bisa dihentikan kapan saja, ` +
               `dan yang sudah tersimpan tidak akan diunduh lagi.`)) return;

  for (const id of ['#tgProc', '#tgSaved', '#tgSkip', '#tgFail']) $(id).textContent = '0';
  $('#tgNow').textContent = 'menyiapkan …';
  TG_STOP = false;
  tgSetBusy(true);

  const totals = { processed: 0, saved: 0, skipped: 0, failed: 0 };
  try {
    const tab = await tgTab({ navigate: !peers.length });
    let queue;

    if (!peers.length) {
      // Satu link: grup ber-topik atau bukan? Dicek dulu.
      const d = await tgcs('tg.discover');
      if (d?.topics?.length) {
        addLog('info', `"${d.group.title}": grup ber-topik, ${d.topics.length} topik — ` +
                       `tiap topik ke "${d.group.title}/<topik>/image|video".`);
        const link = (await chrome.tabs.get(tab.id)).url;
        queue = d.topics.map(t => ({ ...t, link }));
      } else {
        const p = await tgcs('tg.probe');
        if (!p?.peerId) throw new Error('Belum ada pesan di layar — buka chat-nya dulu, atau pilih dari daftar.');
        addLog('info', `Mulai unduh dari "${p.title}" …`);
        queue = [null];          // chat yang sedang terbuka, tanpa kembali ke /k/
      }
    } else {
      addLog('info', `Mulai unduh ${peers.length} chat …`);
      queue = [...peers];
    }

    for (let i = 0; i < queue.length; i++) {
      if (TG_STOP) { addLog('warn', 'Dihentikan.'); break; }
      const p = queue[i];

      // Wadah forum yang topiknya sudah ada di antrean: topiknya yang dikerjakan.
      if (p?.hasTopics && queue.some(q => q && (q.parentHash === p.hash || q.parent === p.title))) continue;

      const run = () => tgcs('tg.runOne',
        { peer: p, index: i + 1, total: queue.length, offset: { ...totals } }, { longRunning: true });

      let r;
      try {
        if (p) {
          addLog('info', `[${i + 1}/${queue.length}] ${p.title} — kembali ke ${TG_URL} dulu …`);
          await tgGoHome(tab);
        }
        r = await run();

        // Grupnya tidak ketemu di daftar chat (mis. belum bergabung): buka lewat link-nya.
        if (r?.failedOpen && p?.link) {
          addLog('warn', `${p.title}: dibuka lewat link grupnya.`);
          await chrome.tabs.update(tab.id, { url: p.link });
          await waitTabReady(tab.id);
          await bg('ensureTgContent', { tabId: tab.id });
          r = await run();
        }
      } catch (e) {
        addLog('err', `${p?.title || 'chat'}: ${e.message}`);
        continue;
      }

      if (r?.topics?.length) {
        const fresh = r.topics.filter(t => !queue.some(q => q && (q.key || q.hash) === t.key));
        queue.splice(i + 1, 0, ...fresh.map(t => ({ ...t, link: p?.link })));
        continue;
      }
      for (const k of Object.keys(totals)) totals[k] += Number(r?.[k]) || 0;
    }
    addLog('ok', `Selesai — ${totals.saved} berkas baru, ${totals.skipped} dilewati, ${totals.failed} gagal.`);
  } catch (e) {
    addLog('err', e.message);
  }
  tgSetBusy(false);
  $('#tgNow').textContent = 'selesai';
  await tgDoProbe().catch(() => {});
}

$('#tgOpen').onclick   = async () => { await tgTab({ navigate: true }); await tgDoProbe(); };
$('#tgProbe').onclick  = tgDoProbe;

/*
 * Potret keadaan halaman, langsung ke clipboard.
 *
 * Ada karena struktur Telegram sudah beberapa kali kutebak dari jauh dan
 * meleset. Lebih murah mengambil faktanya sekali daripada menebak berkali-kali.
 */
$('#tgDiag').onclick = async () => {
  try {
    const d = await tgcs('tg.diag');
    const text = JSON.stringify(d, null, 1);
    try {
      await navigator.clipboard.writeText(text);
      addLog('ok', 'Diagnosa disalin ke clipboard — tempel ke chat.');
    } catch {
      addLog('warn', 'Clipboard ditolak — salin dari kotak di atas.');
    }
    $('#tgBox').textContent = text;
  } catch (e) { addLog('err', e.message); }
};
$('#tgLoadChats').onclick = tgLoadChats;
$('#tgPickAll').onclick   = () => tgSetAll(true);
$('#tgPickNone').onclick  = () => tgSetAll(false);
$('#tgChatFilter').addEventListener('input', tgRenderChats);
$('#tgStart').onclick  = tgDoStart;
$('#tgSkipOne').onclick = async () => {
  try { await tgcs('tg.skip'); addLog('warn', 'Lewati diminta — lanjut ke tujuan berikutnya.'); }
  catch (e) { addLog('err', e.message); }
};
$('#tgClearLog').onclick = () => { $('#tgLog').innerHTML = ''; };
$('#tgStop').onclick   = async () => {
  TG_STOP = true;          // antrean di panel berhenti setelah item ini
  try { await tgcs('tg.stop'); } catch { /* tab mungkin sudah tertutup */ }
  addLog('warn', 'Stop diminta.');
  tgSetBusy(false);
};


// ------------------------------------------------------------------ wire

$$('.tab').forEach(b => b.onclick = () => {
  $$('.tab').forEach(x => x.classList.toggle('active', x === b));
  $$('.pane').forEach(p => p.classList.toggle('active', p.id === 'pane-' + b.dataset.tab));
});

for (const id of ['#tgIncludeVideo', '#tgScanTopics', '#tgMaxItems', '#tgRootDir',
                  '#stepDelay', '#downloadTimeout', '#scrollRetries']) {
  $(id).addEventListener('change', saveSettingsFromUI);
}

$('#btnProbe').onclick = async () => renderNative(await bg('probeNative'));
$('#btnClearIdxAll').onclick = async () => {
  if (!confirm('Reset SEMUA riwayat unduhan Telegram?')) return;
  renderIndex((await bg('clearIndex', {})).stats);
};

refresh();
bg('probeNative').then(renderNative).catch(() => {});

// Penanda modul selesai dieksekusi (lihat bootcheck.js).
window.__WAN_PANEL_OK__ = true;
