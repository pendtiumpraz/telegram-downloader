/**
 * bootcheck.js — deteksi sidepanel yang gagal dimuat.
 *
 * sidepanel.js adalah ES module: satu syntax error atau import yang gagal
 * membuatnya tidak jalan sama sekali, dan satu-satunya gejala adalah UI yang
 * setengah mati — dropdown akun kosong, tombol tidak merespons — TANPA pesan
 * apa pun. Berkas ini membuat kegagalan itu terlihat.
 *
 * WAJIB file terpisah, bukan <script> inline: Content Security Policy bawaan
 * MV3 melarang skrip inline di halaman extension, jadi versi inline-nya
 * diblokir dan justru menambah error sendiri di konsol.
 */

let bootMsg = null;

/*
 * Handler ini menangkap error apa pun, termasuk event dari resource yang gagal
 * dimuat (yang tidak punya .message maupun .filename). Ia sendiri harus
 * MUSTAHIL melempar — handler yang ikut error cuma menambah kebisingan.
 */
addEventListener('error', (e) => {
  try {
    const where = e && e.filename ? ` @ ${String(e.filename).split('/').pop()}:${e.lineno}` : '';
    bootMsg = ((e && e.message) || String((e && e.error) || 'error')) + where;
  } catch { bootMsg = 'error'; }
}, true);

addEventListener('unhandledrejection', (e) => {
  try { bootMsg = String((e.reason && e.reason.message) || e.reason); } catch { bootMsg = 'rejection'; }
});

setTimeout(() => {
  if (window.__WAN_PANEL_OK__) return;
  const b = document.getElementById('bootErr');
  if (!b) return;
  b.hidden = false;
  b.textContent = '⚠ Sidebar gagal dimuat' + (bootMsg ? `: ${bootMsg}` : '. Cek Console panel ini.');
}, 2000);
