/**
 * tgcontent.js di dalam jsdom, dengan DOM Telegram Web yang asli.
 *
 * Markup-nya disalin dari halaman sungguhan, bukan disederhanakan: yang paling
 * gampang salah di sini justru hal-hal yang cuma terlihat di markup asli —
 * album yang punya satu data-mid per foto, label "Forwarded from" yang memakai
 * class .peer-title yang sama dengan judul channel, dan video yang <video>-nya
 * belum ada sehingga cuma poster ber-class .media-photo yang terlihat.
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const SRC = path.resolve(__dirname, "..");
const tgcontent = fs.readFileSync(path.join(SRC, 'tgcontent.js'), 'utf8');
/*
 * common.js milik extension ini adalah modul ES yang meng-import config.js.
 * Untuk dipakai dari tes CommonJS, import/export-nya dibuang dan nilai dari
 * config.js diganti tiruan kosong.
 */
const COMMON_SRC = 'const NATIVE_HOST = "", TMP_SUBDIR = "", DEFAULTS = {};\n' +
  fs.readFileSync(path.join(SRC, 'common.js'), 'utf8')
    .replace(/^import .*$/gm, '')
    .replace(/^export \{.*\};?$/gm, '')
    .replace(/^export\s+/gm, '');

const PEER = '-4294540188';

/** Satu foto di dalam album: data-mid ada di album-item, bukan di bubble. */
const albumPhoto = (mid) => `
  <div class="album-item grouped-item" data-mid="${mid}" data-peer-id="${PEER}">
    <div class="album-item-media media-container no-background">
      <img class="media-photo" src="blob:https://web.telegram.org/b-${mid}">
    </div>
  </div>`;

const albumBubble = (mids) => `
  <div data-mid="${mids[0]}" data-peer-id="${PEER}" class="bubble channel-post photo is-album is-grouped is-in">
    <div class="bubble-content-wrapper"><div class="bubble-content">
      <div class="attachment">${mids.map(albumPhoto).join('')}</div>
    </div></div>
  </div>`;

/** Video terusan — <video> sudah ada. */
const videoBubble = (mid) => `
  <div data-mid="${mid}" data-peer-id="${PEER}" class="bubble channel-post video is-in">
    <div class="bubble-content-wrapper"><div class="bubble-content">
      <div class="name floating-part"><span class="i18n bubble-name-forwarded">Forwarded from
        <span class="peer-title" data-peer-id="-3949888330">pejuhin</span></span></div>
      <div class="attachment media-container media-container-fitted no-background">
        <span class="video-time">0:08<span class="tgico video-time-icon"></span></span>
        <canvas class="canvas-thumbnail thumbnail media-photo" width="22" height="40"></canvas>
        <div class="media-container-aspecter">
          <img class="media-photo" src="blob:https://web.telegram.org/poster-${mid}">
          <video class="media-video" autoplay="" loop="" src="stream/%7B%22id%22%3A%22${mid}%22%7D"></video>
        </div>
      </div>
    </div></div>
  </div>`;

/** Video yang BELUM diputar: penanda durasi ada, elemen <video> belum. */
const lazyVideoBubble = (mid) => `
  <div data-mid="${mid}" data-peer-id="${PEER}" class="bubble channel-post video is-in">
    <div class="bubble-content-wrapper"><div class="bubble-content">
      <div class="attachment media-container no-background">
        <span class="video-time">0:15<span class="tgico video-time-icon"></span></span>
        <img class="media-photo" src="blob:https://web.telegram.org/poster-${mid}">
      </div>
    </div></div>
  </div>`;

/** Pesan layanan: .peer-title-nya adalah judul channel yang sesungguhnya. */
const serviceBubble = () => `
  <div data-mid="1" data-peer-id="${PEER}" class="bubble service">
    <div class="bubble-content-wrapper"><div class="bubble-content"><div class="service-msg">
      <span class="i18n"><span class="peer-title" data-peer-id="${PEER}">Para mantan</span>
        now accepts direct messages for free</span>
    </div></div></div>
  </div>`;

/** Versi ber-peer-id bebas, untuk menguji perpindahan antar chat. */
const albumBubbleFor = (peer, mids) => `
  <div data-mid="${mids[0]}" data-peer-id="${peer}" class="bubble channel-post photo is-album is-grouped is-in">
    <div class="bubble-content-wrapper"><div class="bubble-content"><div class="attachment">
      ${mids.map(mid => `
        <div class="album-item grouped-item" data-mid="${mid}" data-peer-id="${peer}">
          <div class="album-item-media media-container no-background">
            <img class="media-photo" src="blob:https://web.telegram.org/b-${mid}">
          </div>
        </div>`).join('')}
    </div></div></div>
  </div>`;

const serviceBubbleFor = (peer, title) => `
  <div data-mid="1" data-peer-id="${peer}" class="bubble service">
    <div class="bubble-content-wrapper"><div class="bubble-content"><div class="service-msg">
      <span class="i18n"><span class="peer-title" data-peer-id="${peer}">${title}</span> dibuat</span>
    </div></div></div>
  </div>`;

/** Pesan teks: menambah [data-mid] tapi tidak menambah media. */
const textBubble = (mid) => `
  <div data-mid="${mid}" data-peer-id="${PEER}" class="bubble channel-post is-in">
    <div class="bubble-content-wrapper"><div class="bubble-content">
      <div class="message">halo</div>
    </div></div>
  </div>`;

/**
 * Satu baris daftar chat.
 *
 * `.peer-title` muncul DUA kali di baris yang sama: judul chat di `.user-title`,
 * dan nama pengirim pesan terakhir di `.primary-text`. Bedanya itu yang diuji.
 */
const chatRow = (peerId, title, sender = 'Rose', opts = {}) => `
  <a class="rp row chatlist-chat${opts.forum ? ' is-forum' : ''}"
     href="${opts.href || '#' + peerId}" data-peer-id="${peerId}"${opts.thread ? ` data-thread-id="${opts.thread}"` : ''} style="top: 0px;">
    <div class="row-title-row">
      <div class="user-title"><span class="peer-title" data-peer-id="${peerId}">${title}</span></div>
      <div class="dialog-title-details"><span class="message-time">15:15</span></div>
    </div>
    <div class="row-subtitle-row">
      <div class="dialog-subtitle-parts">
        <span class="primary-text"><span class="peer-title">${sender}</span></span>
        <span class="dialog-subtitle-span dialog-subtitle-span-last">meme</span>
      </div>
    </div>
    <div class="avatar"><img class="avatar-photo" src="blob:https://web.telegram.org/av-${peerId}"></div>
  </a>`;

function boot({ bodyHtml, settings = {}, dupMids = [], blobType = 'image/jpeg',
               onScroll = null, onDisk = [], nativeOn = true,
               chatsHtml = '', onChatScroll = null, chatBubbles = null,
               chatListByHash = null, hashNavWorks = false, streamHtml = false, rangeRedirects = false } = {}) {
  const dom = new JSDOM(
    `<!doctype html><body>
       <div id="column-left"><div class="chatlist-container">
         <ul class="chatlist virtual-chatlist">${chatsHtml}</ul>
       </div></div>
       <div id="column-center"><div class="bubbles"><div class="bubbles-inner">${bodyHtml}</div></div></div>
     </body>`,
    { url: 'https://web.telegram.org/k/', pretendToBeVisual: true, runScripts: 'outside-only' });
  const w = dom.window;

  // Daftar chat juga virtual dan bisa di-scroll.
  const clBox = w.document.querySelector('.chatlist-container');
  Object.defineProperty(clBox, 'scrollHeight', { value: 3000, configurable: true });
  Object.defineProperty(clBox, 'clientHeight', { value: 500, configurable: true });
  clBox.style.overflowY = 'auto';
  let clTop = 0, clScrolls = 0;
  Object.defineProperty(clBox, 'scrollTop', {
    configurable: true,
    get: () => clTop,
    set: (v) => {
      clTop = v;
      if (onChatScroll) onChatScroll(++clScrolls, w.document.querySelector('ul.chatlist'));
    }
  });

  /*
   * Router Telegram tiruan: berpindah chat di Telegram Web hanya mengubah
   * hash, dan yang berganti adalah isi daftar pesannya. Halamannya TIDAK
   * dimuat ulang — itulah sebabnya loop antar-chat boleh tinggal di content
   * script.
   */
  /*
   * Telegram Web K MENULIS hash-nya sendiri tapi tidak mendengarkannya:
   * mengubah location.hash dari luar hanya mengganti URL, aplikasinya diam.
   * Satu-satunya yang benar-benar berpindah chat adalah KLIK pada barisnya.
   * hashNavWorks default false supaya tesnya menguji kenyataan itu.
   */
  const applyNav = (h) => {
    const id = h.replace(/^#/, '');
    if (chatBubbles && chatBubbles[id] != null) {
      w.document.querySelector('.bubbles-inner').innerHTML = chatBubbles[id];
    }
    // Membuka grup forum mengganti daftar chat kiri jadi daftar TOPIK.
    if (chatListByHash && chatListByHash[h] != null) {
      w.document.querySelector('ul.chatlist').innerHTML = chatListByHash[h];
    }
  };
  if (hashNavWorks) w.addEventListener('hashchange', () => applyNav(w.location.hash));

  // jsdom tidak melakukan layout; wadah scroll dicari lewat overflow + ukuran.
  const box = w.document.querySelector('.bubbles');
  const inner = w.document.querySelector('.bubbles-inner');
  Object.defineProperty(box, 'scrollHeight', { value: 5000, configurable: true });
  Object.defineProperty(box, 'clientHeight', { value: 600, configurable: true });
  box.style.overflowY = 'auto';

  // scrollTop disadap supaya riwayat lama bisa "termuat" saat di-scroll,
  // seperti yang dilakukan Telegram sungguhan.
  let top = 0, scrolls = 0;
  Object.defineProperty(box, 'scrollTop', {
    configurable: true,
    get: () => top,
    set: (v) => {
      top = v;
      if (onScroll) onScroll(++scrolls, inner);
    }
  });

  const listeners = [];
  const calls = { armed: [], clicked: [], marked: [], dupChecked: [], logs: [], fetched: [], rowClicks: [], ranges: [] };
  let armSeq = 0;

  w.chrome = {
    runtime: {
      id: 'test',
      onMessage: {
        addListener(fn) { listeners.push(fn); },
        removeListener(fn) { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); }
      },
      async sendMessage(msg) {
        if (msg.cmd === 'log') { calls.logs.push(`${msg.level}: ${msg.msg}`); return { ok: true }; }
        if (msg.cmd === 'progress') return { ok: true };
        if (msg.cmd === 'tgInfo') return { ok: true, root: 'D:/telegram', dir: 'D:/telegram/Para mantan', indexed: 0 };
        // Isi folder: sumber kebenaran "sudah punya". Berkas yang tersimpan
        // masuk ke sini, jadi array-nya bisa dioper ke run berikutnya persis
        // seperti folder yang tidak dikosongkan.
        if (msg.cmd === 'tgScan') {
          return { ok: true, available: nativeOn, dir: 'D:/telegram/Para mantan', mids: onDisk.slice() };
        }
        if (msg.cmd === 'tgCheckDup') {
          calls.dupChecked.push(msg.mid);
          return { ok: true, dup: dupMids.includes(msg.mid), via: 'index' };
        }
        // Jalur tanpa-izin: extension yang mengunduh, bukan halaman.
        if (msg.cmd === 'directDownload') {
          calls.armed.push({ email: msg.email, key: msg.key });
          calls.clicked.push({ name: msg.key, href: msg.url, via: 'extension' });
          return { ok: true, armId: 'arm' + (++armSeq) };
        }
        // Cadangan: halaman yang mengunduh (di sinilah Chrome bisa minta izin).
        if (msg.cmd === 'armDownload') {
          calls.armed.push({ email: msg.email, key: msg.key });
          return { ok: true, armId: 'arm' + (++armSeq) };
        }
        if (msg.cmd === 'downloadStatus') return { ok: true, state: 'done', finalPath: 'D:/telegram/x' };
        if (msg.cmd === 'markKey') {
          calls.marked.push(msg.key);
          onDisk.push(msg.key);        // berkasnya sekarang ada di folder
          return { ok: true };
        }
        if (msg.cmd === 'cancelArm') return { ok: true };
        return { ok: true };
      }
    }
  };

  // Blob asli Telegram tidak bisa dihidupkan di jsdom; yang penting tipenya.
  // URL-nya dicatat supaya bisa dibuktikan video diambil dari stream/, bukan
  // dari poster-nya — sesudah jalur tanpa-izin, yang sampai ke extension cuma
  // data: URL sehingga sumber aslinya tidak terlihat lagi di sana.
  w.fetch = async (u, opts = {}) => {
    calls.fetched.push(String(u));
    /*
     * Video "stream/…" meniru service worker Telegram: hanya menjawab per
     * potongan (206 + Content-Range). streamHtml = keadaan tanpa service
     * worker, saat server mengirim halaman aplikasinya.
     */
    if (/\/stream\//.test(String(u))) {
      if (streamHtml) {
        return { ok: true, status: 200, headers: new w.Headers({ 'Content-Type': 'text/html' }),
                 blob: async () => new w.Blob(['<!doctype html>'], { type: 'text/html' }) };
      }
      const full = new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 1, 2, 3, 4, 5, 6, 7, 8]);
      // Keadaan yang dilaporkan: permintaan ber-Range dijawab 302, fetch
      // biasa dijawab video utuh.
      if (rangeRedirects) {
        if (opts.headers?.Range) return { ok: false, status: 302, headers: new w.Headers(), blob: async () => new w.Blob([]) };
        calls.ranges.push('utuh');
        return { ok: true, status: 200, headers: new w.Headers({ 'Content-Type': 'video/mp4' }),
                 blob: async () => new w.Blob([full], { type: 'video/mp4' }) };
      }
      const start = Number((opts.headers?.Range || 'bytes=0-').match(/bytes=(\d+)-/)[1]);
      const end = Math.min(start + 7, full.length - 1);   // potongan 8 byte
      calls.ranges.push(start);
      return {
        ok: true, status: 206,
        headers: new w.Headers({ 'Content-Type': 'video/mp4', 'Content-Range': `bytes ${start}-${end}/${full.length}` }),
        blob: async () => new w.Blob([full.slice(start, end + 1)], { type: 'video/mp4' })
      };
    }
    return { ok: true, status: 200, headers: new w.Headers(),
             blob: async () => new w.Blob(['x'], { type: blobType }) };
  };

  // jsdom tidak punya scrollIntoView; di browser sungguhan selalu ada.
  w.Element.prototype.scrollIntoView = function () {};

  // jsdom tidak melakukan layout, jadi posisi layar dipalsukan lewat
  // data-vtop. Tanpa atribut itu semuanya 0 dan sort yang stabil membuat
  // urutan DOM tetap terpakai — persis seperti sebelumnya.
  w.Element.prototype.getBoundingClientRect = function () {
    const t = Number(this.getAttribute('data-vtop') || 0);
    return { top: t, bottom: t + 50, left: 0, right: 100, width: 100, height: 50, x: 0, y: t };
  };

  w.HTMLAnchorElement.prototype.click = function () {
    // Baris chat: klik = pindah chat, persis seperti di Telegram sungguhan.
    if (this.classList.contains('chatlist-chat')) {
      // Baris topik: href-nya SAMA dengan grupnya, pembedanya data-thread-id.
      const h = this.getAttribute('href');
      const t = this.getAttribute('data-thread-id');
      const key = t ? `${h}~${t}` : h;
      calls.rowClicks.push(key);
      w.location.hash = h;
      applyNav(key);
      return;
    }
    calls.clicked.push({ href: this.getAttribute('href'), name: this.getAttribute('download'), via: 'halaman' });
  };

  w.eval(tgcontent);

  // tgcontent mendaftar lewat chrome.runtime.onMessage; di sini listener itu
  // dipanggil langsung, seperti yang dilakukan chrome.tabs.sendMessage.
  const send = (msg) => new Promise((resolve) => {
    for (const fn of listeners) {
      let done = false;
      const keep = fn(msg, {}, (r) => { done = true; resolve(r); });
      if (done || keep) return;
    }
    resolve(undefined);
  });

  return { w, calls, send, settings };
}

let COMMON = null;
let pass = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + '  ' + extra); }
};

(async () => {
  const BODY = serviceBubble()
    + albumBubble(['100', '101'])
    + videoBubble('200')
    + albumBubble(['300', '301', '302'])
    + lazyVideoBubble('400');

  // 1. Hanya gambar, urut bawah ke atas, satu berkas per foto album.
  {
    const { calls, send } = boot({ bodyHtml: BODY });
    const r = await send({ cmd: 'tg.run', settings: { stepDelay: 1, scrollRetries: 1, downloadTimeout: 5000 } });

    check('selesai tanpa error', r?.ok === true, JSON.stringify(r));
    check('nama berkas = <mid>.jpg',
      calls.clicked.every(c => /^\d+\.jpg$/.test(c.name)), JSON.stringify(calls.clicked));
    check('urut bawah ke atas (mid terbesar dulu)',
      calls.clicked.map(c => c.name).join(',') === '302.jpg,301.jpg,300.jpg,101.jpg,100.jpg',
      calls.clicked.map(c => c.name).join(','));
    check('album jadi beberapa berkas, bukan satu', calls.clicked.length === 5, String(calls.clicked.length));
    check('video dilewati saat setelan mati',
      !calls.clicked.some(c => /^(200|400)\./.test(c.name)), JSON.stringify(calls.clicked));
    check('bucket pakai judul channel dari pesan layanan, bukan label forward',
      calls.armed.every(a => a.email === 'tg:Para mantan'), JSON.stringify(calls.armed[0]));
    check('yang ditandai selesai adalah mid polos',
      calls.marked.join(',') === '302,301,300,101,100', calls.marked.join(','));
  }

  // 2. Video ikut: yang sudah punya <video> terunduh, yang belum dimuat gagal
  //    dengan pesan jelas — dan TIDAK ditandai selesai.
  {
    const { calls, send } = boot({ bodyHtml: BODY });
    await send({ cmd: 'tg.run', settings: { stepDelay: 1, scrollRetries: 1, tgIncludeVideo: true, downloadTimeout: 5000 } });

    const names = calls.clicked.map(c => c.name);
    check('video terunduh sebagai .mp4', names.includes('200.mp4'), names.join(','));
    check('  sumbernya URL stream, bukan poster',
      calls.fetched.some(u => u.includes('/stream/')) &&
      !calls.fetched.some(u => u.includes('poster-200')),
      calls.fetched.join(' | '));
    check('poster video tidak ikut tersimpan sebagai gambar',
      !names.includes('200.jpg') && !names.includes('400.jpg'), names.join(','));
    check('video yang belum dimuat dilaporkan, bukan didiamkan',
      calls.logs.some(l => /400.*belum dimuat/.test(l)), calls.logs.join(' | '));
    check('  dan tidak ditandai selesai', !calls.marked.includes('400'), calls.marked.join(','));
  }

  // 2b. Video "stream/…" diambil per potongan Range lalu dirakit — satu fetch
  //     biasa dijawab HTML oleh server dan tersimpan sebagai .htm.
  {
    const { calls, send } = boot({ bodyHtml: BODY });
    await send({ cmd: 'tg.run', settings: { stepDelay: 1, scrollRetries: 1, tgIncludeVideo: true, downloadTimeout: 5000 } });
    check('video diminta per potongan Range sampai habis', calls.ranges.join(',') === '0,8', calls.ranges.join(','));
    const v = calls.clicked.find(c => c.name === '200.mp4');
    check('  yang dikirim ke extension adalah isi videonya, bukan halaman',
      v && /^data:video\/mp4/.test(v.href), v?.href?.slice(0, 40));
  }

  // 2c. Kalau yang datang HTML, jangan simpan apa pun sebagai "video".
  {
    const { calls, send } = boot({ bodyHtml: BODY, streamHtml: true });
    await send({ cmd: 'tg.run', settings: { stepDelay: 1, scrollRetries: 1, tgIncludeVideo: true, downloadTimeout: 5000 } });
    check('jawaban HTML tidak tersimpan', !calls.clicked.some(c => /^200\./.test(c.name)),
      calls.clicked.map(c => c.name).join(','));
    check('  dan tidak ditandai selesai', !calls.marked.includes('200'), calls.marked.join(','));
    check('  alasannya dilaporkan', calls.logs.some(l => /200.*HTML/.test(l)), calls.logs.join(' | '));
  }

  // 3. Yang sudah pernah diunduh dilewati tanpa menyentuh unduhan.
  {
    const { calls, send } = boot({ bodyHtml: BODY, dupMids: ['100', '300', '301'] });
    await send({ cmd: 'tg.run', settings: { stepDelay: 1, scrollRetries: 1, downloadTimeout: 5000 } });
    const names = calls.clicked.map(c => c.name).join(',');
    check('duplikat tidak diunduh ulang', names === '302.jpg,101.jpg', names);
    check('  semua sempat dicek dulu',
      ['100', '101', '300', '301', '302'].every(m => calls.dupChecked.includes(m)),
      calls.dupChecked.join(','));
  }

  // 4. Batas media dihormati.
  {
    const { calls, send } = boot({ bodyHtml: BODY });
    const r = await send({ cmd: 'tg.run', settings: { stepDelay: 1, scrollRetries: 1, tgMaxItems: 2, downloadTimeout: 5000 } });
    check('berhenti di batas', calls.clicked.length === 2, String(calls.clicked.length));
    check('  alasannya dilaporkan', r?.reason === 'batas', JSON.stringify(r));
  }

  // 5. Format selain jpg/png yang tidak bisa dikonversi harus GAGAL,
  //    bukan tersimpan dengan nama .jpg yang menyesatkan.
  {
    const { calls, send } = boot({ bodyHtml: albumBubble(['500']), blobType: 'image/webp' });
    await send({ cmd: 'tg.run', settings: { stepDelay: 1, scrollRetries: 1, downloadTimeout: 5000 } });
    check('webp tak terkonversi tidak disimpan sebagai .jpg',
      !calls.clicked.some(c => c.name === '500.jpg'), JSON.stringify(calls.clicked));
    check('  kegagalannya dicatat', calls.logs.some(l => /webp/.test(l)), calls.logs.join(' | '));
  }

  // 6. Perintah tak dikenal dijawab, bukan mendiamkan kanal.
  {
    const { send } = boot({ bodyHtml: BODY });
    const r = await send({ cmd: 'tg.tidakada' });
    check('perintah asing dapat pesan yang menjelaskan',
      r?.ok === false && /reload extension/i.test(r.error), JSON.stringify(r));
  }

  // 7. Scroll terus sampai benar-benar mentok — blok pesan teks yang panjang
  //    di antara dua foto TIDAK boleh disalahartikan sebagai "sudah habis".
  {
    let textMid = 900;
    const { calls, send } = boot({
      bodyHtml: albumBubble(['100']),
      onScroll(n, inner) {
        // Lima kali scroll pertama cuma memuat teks; foto lamanya baru muncul
        // di scroll keenam. retries = 2, jadi versi lama menyerah di scroll 2.
        if (n <= 5) inner.insertAdjacentHTML('afterbegin', textBubble(String(textMid++)));
        else if (n === 6) inner.insertAdjacentHTML('afterbegin', albumBubble(['50']));
      }
    });
    await send({ cmd: 'tg.run', settings: { stepDelay: 1, scrollRetries: 2, downloadTimeout: 5000 } });
    const names = calls.clicked.map(c => c.name).join(',');
    check('blok teks panjang tidak menghentikan pencarian', names === '100.jpg,50.jpg', names);
  }

  // 8. Berhenti kalau benar-benar tidak ada lagi yang termuat.
  {
    const { calls, send } = boot({ bodyHtml: albumBubble(['100']), onScroll: null });
    const r = await send({ cmd: 'tg.run', settings: { stepDelay: 1, scrollRetries: 2, downloadTimeout: 5000 } });
    check('berhenti saat daftar tidak bergerak lagi', r?.reason === 'habis', JSON.stringify(r));
    check('  tanpa mengunduh ulang', calls.clicked.length === 1, String(calls.clicked.length));
  }

  // 9. Dijalankan ULANG di folder yang sama: tidak boleh ada yang dobel.
  //    Folder-nya yang jadi acuan, jadi index extension sengaja dikosongkan
  //    untuk meniru extension yang baru dipasang ulang.
  {
    const folder = [];
    const run1 = boot({ bodyHtml: BODY, onDisk: folder });
    await run1.send({ cmd: 'tg.run', settings: { stepDelay: 1, scrollRetries: 1, downloadTimeout: 5000 } });
    check('run pertama mengunduh 5 foto', run1.calls.clicked.length === 5, String(run1.calls.clicked.length));
    check('  folder berisi message-id polos',
      folder.slice().sort().join(',') === '100,101,300,301,302', folder.join(','));

    const run2 = boot({ bodyHtml: BODY, onDisk: folder });   // index kosong lagi
    await run2.send({ cmd: 'tg.run', settings: { stepDelay: 1, scrollRetries: 1, downloadTimeout: 5000 } });
    check('run kedua tidak mengunduh apa pun', run2.calls.clicked.length === 0,
      JSON.stringify(run2.calls.clicked));
    check('  dan tidak menanyai index sama sekali', run2.calls.dupChecked.length === 0,
      run2.calls.dupChecked.join(','));
  }

  // 10. Nama berkas -> message-id. Ini yang membuat isi folder bisa dibaca
  //     sebagai daftar "sudah diunduh", jadi diuji langsung.
  {
    // common.js itu modul ES; di-eval sebagai skrip biasa supaya berkas tes
    // ini tetap CommonJS dan Node tidak perlu menebak-nebak tipe modulnya.
    const flat = COMMON_SRC;
    const tgMidFromFile = new Function(`${flat}\nreturn keyFromFile;`)();
    COMMON = new Function(`${flat}\nreturn { finalRelPath, normalizeExt };`)();
    const cases = [
      ['4294967300.jpg', '4294967300'],
      ['4294967300.png', '4294967300'],
      ['4294967322.mp4', '4294967322'],
      ['4294967300 (1).jpg', '4294967300'],   // salinan hasil uniquify Chrome
      ['4294967300 (12).png', '4294967300']
    ];
    const bad = cases.filter(([inp, want]) => tgMidFromFile(inp) !== want);
    check('nama berkas terbaca kembali jadi message-id', bad.length === 0,
      bad.map(([i, w]) => `${i} -> ${tgMidFromFile(i)} (harusnya ${w})`).join('; '));
  }

  // 11. Tanpa native host, isi folder tidak terbaca — itu harus DIKATAKAN,
  //     bukan diam-diam berubah jadi "tidak ada duplikat".
  {
    const { calls, send } = boot({ bodyHtml: albumBubble(['100']), nativeOn: false });
    await send({ cmd: 'tg.run', settings: { stepDelay: 1, scrollRetries: 1, downloadTimeout: 5000 } });
    check('memperingatkan kalau folder tidak bisa dibaca',
      calls.logs.some(l => /warn.*[Nn]ative host tidak aktif/.test(l)), calls.logs.join(' | '));
  }

  // 12. Daftar chat: judul diambil dari .user-title, bukan nama pengirim di
  //     subtitle — kalau tertukar, folder dinamai menurut siapa yang kebetulan
  //     terakhir mengirim pesan.
  {
    const { send } = boot({
      bodyHtml: albumBubble(['100']),
      chatsHtml: chatRow('-100', 'Meme Squad', 'Rose')
               + chatRow('-200', 'Judul 🚹🚺', 'CHAINSAW')
               + chatRow('-300', 'Forum Meme', 'Bot', { forum: true })
    });
    const r = await send({ cmd: 'tg.chats', settings: { stepDelay: 1, scrollRetries: 1 } });
    const titles = (r.chats || []).map(c => c.title).join('|');
    check('judul chat, bukan nama pengirim', titles === 'Meme Squad|Judul 🚹🚺|Forum Meme', titles);
    check('  hash diambil dari href baris',
      (r.chats || []).map(c => c.hash).join(',') === '#-100,#-200,#-300',
      (r.chats || []).map(c => c.hash).join(','));
    check('  grup ber-topik ditandai', r.chats?.[2]?.isForum === true, JSON.stringify(r.chats?.[2]));
  }

  // 13. Daftar chat juga virtual: harus digulung sampai habis.
  {
    let n = 400;
    const { send } = boot({
      bodyHtml: albumBubble(['100']),
      chatsHtml: chatRow('-100', 'Chat 1'),
      onChatScroll(step, ul) {
        if (step <= 3) ul.insertAdjacentHTML('beforeend', chatRow('-' + (n++), 'Chat ' + (n - 400 + 1)));
      }
    });
    const r = await send({ cmd: 'tg.chats', settings: { stepDelay: 1, scrollRetries: 2 } });
    check('chat yang baru termuat saat scroll ikut terdata',
      (r.chats || []).length === 4, String((r.chats || []).length));
  }

  // 14. Beberapa chat berurutan, masing-masing ke foldernya sendiri.
  {
    const folder = [];
    const { calls, send } = boot({
      bodyHtml: '',
      onDisk: folder,
      chatsHtml: chatRow('-100', 'Meme Squad') + chatRow('-200', 'Kantor'),
      chatBubbles: {
        '-100': serviceBubbleFor('-100', 'Meme Squad') + albumBubbleFor('-100', ['11', '12']),
        '-200': serviceBubbleFor('-200', 'Kantor') + albumBubbleFor('-200', ['21'])
      }
    });
    const r = await send({
      cmd: 'tg.run',
      peers: [{ peerId: '-100', title: 'Meme Squad', hash: '#-100' },
              { peerId: '-200', title: 'Kantor', hash: '#-200' }],
      settings: { stepDelay: 1, scrollRetries: 1, downloadTimeout: 5000 }
    });

    const buckets = [...new Set(calls.armed.map(a => a.email))];
    check('tiap chat punya foldernya sendiri',
      buckets.join(',') === 'tg:Meme Squad,tg:Kantor', buckets.join(','));
    check('  semua media kedua chat terunduh',
      calls.clicked.map(c => c.name).join(',') === '12.jpg,11.jpg,21.jpg',
      calls.clicked.map(c => c.name).join(','));
    check('  hitungannya dijumlah, tidak kembali ke nol tiap chat',
      r?.saved === 3 && r?.chats === 2, JSON.stringify(r));
  }

  // 15. Chat yang tidak mau terbuka dilewati, sisanya tetap jalan.
  {
    const { calls, send } = boot({
      bodyHtml: '',
      chatsHtml: chatRow('-200', 'Kantor'),
      chatBubbles: { '-200': serviceBubbleFor('-200', 'Kantor') + albumBubbleFor('-200', ['21']) }
    });
    const r = await send({
      cmd: 'tg.run',
      peers: [{ peerId: '-999', title: 'Hilang', hash: '#-999' },
              { peerId: '-200', title: 'Kantor', hash: '#-200' }],
      settings: { stepDelay: 1, scrollRetries: 1, downloadTimeout: 5000, tgOpenTimeout: 2000 }
    });
    check('chat yang gagal dibuka tidak menghentikan antrean',
      calls.clicked.map(c => c.name).join(',') === '21.jpg', calls.clicked.map(c => c.name).join(','));
    check('  kegagalannya dilaporkan',
      calls.logs.some(l => /Hilang.*tidak mau terbuka/.test(l)), calls.logs.join(' | '));
    check('  tetap selesai normal', r?.ok === true, JSON.stringify(r));
  }

  // 16. Daftar pesan Telegram dirender TERBALIK (column-reverse): elemen
  //     pertama di DOM justru yang tampil paling bawah. Urutannya harus
  //     ditentukan dari posisi layar, bukan urutan DOM.
  {
    // DOM: 30, 20, 10 — tapi di layar 30 ada paling bawah (top terbesar).
    const rev = ['30', '20', '10'].map((mid, i) => `
      <div data-mid="${mid}" data-peer-id="${PEER}" class="bubble channel-post photo is-in">
        <div class="bubble-content"><div class="attachment">
          <div class="album-item grouped-item" data-mid="${mid}" data-peer-id="${PEER}"
               data-vtop="${300 - i * 100}">
            <div class="album-item-media media-container no-background">
              <img class="media-photo" src="blob:https://web.telegram.org/b-${mid}">
            </div>
          </div>
        </div></div>
      </div>`).join('');

    const { calls, send } = boot({ bodyHtml: rev });
    await send({ cmd: 'tg.run', settings: { stepDelay: 1, scrollRetries: 1, downloadTimeout: 5000 } });
    const order = calls.clicked.map(c => c.name).join(',');
    check('paling bawah di LAYAR duluan, bukan paling awal di DOM',
      order === '30.jpg,20.jpg,10.jpg', order);
  }

  // 17. Unduhan lewat extension, bukan lewat halaman — itu yang membuat Chrome
  //     tidak pernah bertanya "Download multiple files?".
  {
    const { calls, send } = boot({ bodyHtml: albumBubble(['100', '101']) });
    await send({ cmd: 'tg.run', settings: { stepDelay: 1, scrollRetries: 1, downloadTimeout: 5000 } });
    check('tidak ada unduhan yang dipicu halaman',
      calls.clicked.length === 2 && calls.clicked.every(c => c.via === 'extension'),
      JSON.stringify(calls.clicked.map(c => c.via)));
    check('  isinya dikirim sebagai data: URL',
      calls.clicked.every(c => String(c.href).startsWith('data:')),
      String(calls.clicked[0]?.href).slice(0, 30));
  }

  // 18. Nama berkas akhir: gambar HARUS berakhir .jpg atau .png.
  //     Chrome menebak nama dari tabel MIME Windows, dan di situ image/jpeg
  //     terdaftar sebagai ".jfif" — tebakan itu tidak boleh menang.
  {
    const { finalRelPath, normalizeExt } = COMMON;

    check('jfif/jpe/jpeg dianggap jpg',
      ['jfif', 'jpe', 'jpeg', 'JFIF'].every(e => normalizeExt(e) === 'jpg'),
      ['jfif', 'jpe', 'jpeg', 'JFIF'].map(normalizeExt).join(','));

    check('ekstensi yang sudah ditentukan tidak ditimpa tebakan Chrome',
      finalRelPath('tmp/tg_Meme/123.jpg', 'download.jfif', true) === 'tmp/tg_Meme/123.jpg',
      finalRelPath('tmp/tg_Meme/123.jpg', 'download.jfif', true));

    check('  bahkan tanpa penanda, jfif tetap jadi jpg',
      finalRelPath('tmp/tg_Meme/123.jpg', 'download.jfif', false) === 'tmp/tg_Meme/123.jpg',
      finalRelPath('tmp/tg_Meme/123.jpg', 'download.jfif', false));

    check('  png tetap png',
      finalRelPath('tmp/tg_Meme/123.png', 'download.png', true) === 'tmp/tg_Meme/123.png',
      finalRelPath('tmp/tg_Meme/123.png', 'download.png', true));

    // Perilaku lama untuk WAN tetap ada: di sana ekstensi memang diambil dari
    // URL CDN yang asli, karena nama dari kunci dedupe bisa saja salah.
    check('  WAN tetap boleh mengoreksi dari URL asli',
      finalRelPath('_tmp/a@x.com/foto.png', 'https://cdn.wanxai.com/x/foto.webp', false)
        === '_tmp/a@x.com/foto.webp',
      finalRelPath('_tmp/a@x.com/foto.png', 'https://cdn.wanxai.com/x/foto.webp', false));
  }

  // 19. Scroll yang cuma menggeser posisi, tanpa memuat pesan lama, TIDAK
  //     boleh dihitung sebagai kemajuan. Kalau dihitung, di ujung percakapan
  //     Telegram terus menggeser sendiri dan loopnya tidak pernah selesai —
  //     dari luar terlihat seperti antrean chat yang macet.
  {
    const { calls, send } = boot({ bodyHtml: albumBubble(['100']) });
    const r = await send({ cmd: 'tg.run', settings: { stepDelay: 1, scrollRetries: 3, downloadTimeout: 5000 } });
    const waits = calls.logs.filter(l => /Menunggu pesan lama/.test(l)).length;
    /*
     * Ada LANTAI 8 percobaan, sengaja mengabaikan setelan yang lebih kecil:
     * memuat riwayat lama itu permintaan jaringan, dan menyerah setelah 3 kali
     * membuat chat panjang dianggap habis padahal baru tergulung sedikit.
     * Tetap berhenti, tapi tidak terlalu cepat.
     */
    check('berhenti — tapi tidak sebelum 8 percobaan',
      r?.reason === 'habis' && waits === 8, `reason=${r?.reason} waits=${waits}`);
    check('  alasan berhentinya disertai angka yang bisa diperiksa',
      calls.logs.some(l => /Berhenti menggulung setelah \d+×.*scrollTop/.test(l)),
      calls.logs.filter(l => /Berhenti menggulung/.test(l)).join(' | '));
  }

  // 20. Grup forum: topiknya didata lebih dulu, lalu tiap topik jadi foldernya
  //     sendiri — dan baris grupnya sendiri tidak ikut diunduh.
  {
    // Baris topik memakai peer-id grupnya, tapi href-nya sendiri — itulah yang
    // membedakan topik dari grupnya, dan href itu yang dipakai apa adanya.
    const forumTopics = chatRow('-300', 'Topik Meme', 'Rose', { href: '#-300_1' })
                      + chatRow('-300', 'Topik Random', 'Rose', { href: '#-300_2' });
    const ctx = boot({
      bodyHtml: albumBubble(['100']),
      chatsHtml: chatRow('-100', 'Meme Squad') + chatRow('-300', 'Forum Kita', 'Bot', { forum: true }),
      chatListByHash: { '#-300': forumTopics }
    });

    const r = await ctx.send({ cmd: 'tg.chats', withTopics: true, settings: { stepDelay: 1, scrollRetries: 1 } });
    const titles = (r.chats || []).map(c => c.title).join(' | ');
    check('topik ikut terdata di bawah grupnya',
      titles === 'Meme Squad | Forum Kita | Forum Kita/Topik Meme | Forum Kita/Topik Random', titles);
    check('  baris grup ditandai sebagai wadah, bukan tujuan',
      r.chats.find(c => c.title === 'Forum Kita')?.hasTopics === true,
      JSON.stringify(r.chats.find(c => c.title === 'Forum Kita')));
  }

  // 21. Saat diunduh, baris grup dilewati dan judul topik yang dipakai untuk
  //     foldernya — bukan nama grup yang terbaca dari header.
  {
    const { calls, send } = boot({
      bodyHtml: '',
      chatsHtml: chatRow('-300', 'Forum Kita'),
      chatBubbles: {
        '-300': serviceBubbleFor('-300', 'Forum Kita') + albumBubbleFor('-300', ['31'])
      }
    });
    await send({
      cmd: 'tg.run',
      peers: [
        { peerId: '-300', title: 'Forum Kita', hash: '#-300', hasTopics: true },
        { peerId: '-300', title: 'Forum Kita/Topik Meme', hash: '#-300', parent: 'Forum Kita' }
      ],
      settings: { stepDelay: 1, scrollRetries: 1, downloadTimeout: 5000, tgOpenTimeout: 2000 }
    });
    check('wadah forum dilewati, topiknya yang diunduh',
      calls.armed.map(a => a.email).join(',') === 'tg:Forum Kita/Topik Meme',
      calls.armed.map(a => a.email).join(','));
  }

  // 22. "Grup/Topik" jadi folder bertingkat, bukan satu nama panjang.
  {
    const { safeDirName } = new Function(`${COMMON_SRC}\nreturn { safeDirName };`)();
    const tgTitleOf = (b) => String(b).slice('tg:'.length);   // sama dengan titleOf di background.js
    const parts = tgTitleOf('tg:Forum Kita/Topik Meme').split('/').filter(Boolean).map(safeDirName);
    check('judul topik terpecah jadi dua folder',
      parts.join('/') === 'Forum Kita/Topik Meme', parts.join('/'));
  }

  // 23. Penanda forum bisa ada di barisnya ATAU di avatarnya — catatan
  //     strukturnya menyebut dua tempat, jadi keduanya harus dikenali.
  {
    const onAvatar = `
      <a class="rp row chatlist-chat" href="#-400" data-peer-id="-400">
        <div class="row-title-row"><div class="user-title">
          <span class="peer-title" data-peer-id="-400">Forum Avatar</span></div></div>
        <div class="avatar is-forum"><img class="avatar-photo" src="blob:x"></div>
      </a>`;
    const { send } = boot({
      bodyHtml: albumBubble(['100']),
      chatsHtml: onAvatar,
      chatListByHash: { '#-400': chatRow('-400', 'Topik A', 'Rose', { href: '#-400_1' }) }
    });
    const r = await send({ cmd: 'tg.chats', withTopics: true, settings: { stepDelay: 1, scrollRetries: 1 } });
    /*
     * Penanda class-nya sengaja tidak dipasang di tempat yang "benar" — dan
     * topiknya tetap harus ketemu, karena yang menentukan adalah hasil membuka
     * chatnya, bukan tebakan dari class. Dua tebakan sebelumnya meleset ke dua
     * arah berlawanan: sekali tidak ada yang terdeteksi, sekali semuanya.
     */
    check('topik ketemu tanpa bergantung pada penanda class',
      (r.chats || []).some(c => c.title === 'Forum Avatar/Topik A'),
      (r.chats || []).map(c => c.title).join(' | '));
  }

  // 24. Lewati: tujuan yang sedang jalan ditinggalkan, ANTREANNYA lanjut.
  {
    let sent = false;
    const ctx = boot({
      bodyHtml: '',
      chatsHtml: chatRow('-100', 'A') + chatRow('-200', 'B'),
      chatBubbles: {
        '-100': serviceBubbleFor('-100', 'A') + albumBubbleFor('-100', ['11', '12', '13']),
        '-200': serviceBubbleFor('-200', 'B') + albumBubbleFor('-200', ['21'])
      }
    });
    // Begitu berkas pertama chat A tersimpan, minta lewati.
    const orig = ctx.w.chrome.runtime.sendMessage;
    ctx.w.chrome.runtime.sendMessage = async (msg) => {
      const r = await orig(msg);
      if (!sent && msg.cmd === 'markKey') {
        sent = true;
        await ctx.send({ cmd: 'tg.skip' });
      }
      return r;
    };

    const r = await ctx.send({
      cmd: 'tg.run',
      peers: [{ peerId: '-100', title: 'A', hash: '#-100' },
              { peerId: '-200', title: 'B', hash: '#-200' }],
      settings: { stepDelay: 1, scrollRetries: 1, downloadTimeout: 5000, tgOpenTimeout: 2000 }
    });

    const names = ctx.calls.clicked.map(c => c.name);
    check('sisa chat yang dilewati tidak diunduh',
      !names.includes('11.jpg'), names.join(','));
    check('  antrean lanjut ke chat berikutnya', names.includes('21.jpg'), names.join(','));
    check('  dilaporkan sebagai dilewati, bukan gagal',
      ctx.calls.logs.some(l => /A: dilewati atas permintaan/.test(l)), ctx.calls.logs.join(' | '));
    check('  run tetap selesai normal', r?.ok === true, JSON.stringify(r));
  }

  // 25. Chat dibuka dengan MENGKLIK barisnya, bukan dengan mengubah URL —
  //     dan barisnya digulung dulu kalau belum ada di DOM.
  {
    // Baris tujuan baru muncul setelah daftar chat digulung, persis seperti
    // daftar virtual Telegram.
    const { calls, send } = boot({
      bodyHtml: '',
      chatsHtml: chatRow('-100', 'A'),
      onChatScroll(step, ul) {
        if (step === 2) ul.insertAdjacentHTML('beforeend', chatRow('-200', 'B'));
      },
      chatBubbles: {
        '-100': serviceBubbleFor('-100', 'A') + albumBubbleFor('-100', ['11']),
        '-200': serviceBubbleFor('-200', 'B') + albumBubbleFor('-200', ['21'])
      }
    });
    await send({
      cmd: 'tg.run',
      peers: [{ peerId: '-100', title: 'A', hash: '#-100' },
              { peerId: '-200', title: 'B', hash: '#-200' }],
      settings: { stepDelay: 1, scrollRetries: 1, downloadTimeout: 5000, tgOpenTimeout: 6000 }
    });

    check('chat kedua dibuka lewat klik barisnya',
      calls.rowClicks.includes('#-200'), calls.rowClicks.join(','));
    check('  barisnya ditemukan dengan menggulung daftar',
      calls.clicked.map(c => c.name).join(',') === '11.jpg,21.jpg',
      calls.clicked.map(c => c.name).join(','));
    check('  tidak menyerah ke URL padahal barisnya ada',
      !calls.logs.some(l => /barisnya tidak ketemu/.test(l)), calls.logs.join(' | '));
  }

  // 26. Topik: grup induknya diklik dulu supaya daftar topiknya muncul,
  //     baru baris topiknya. Tanpa itu, baris topik tidak pernah ada di DOM.
  {
    const { calls, send } = boot({
      bodyHtml: '',
      chatsHtml: chatRow('-300', 'Forum Kita', 'Bot', { forum: true }),
      chatListByHash: { '#-300': chatRow('-300', 'Topik A', 'Rose', { href: '#-300_1' }) },
      chatBubbles: {
        '-300': serviceBubbleFor('-300', 'Forum Kita'),
        '-300_1': serviceBubbleFor('-300', 'Forum Kita') + albumBubbleFor('-300', ['41'])
      }
    });
    await send({
      cmd: 'tg.run',
      peers: [{ peerId: '-300', title: 'Forum Kita/Topik A', hash: '#-300_1', parentHash: '#-300' }],
      settings: { stepDelay: 1, scrollRetries: 1, downloadTimeout: 5000, tgOpenTimeout: 6000 }
    });
    check('grup induk diklik lebih dulu, lalu topiknya',
      calls.rowClicks.join(',') === '#-300,#-300_1', calls.rowClicks.join(','));
    check('  isinya masuk ke folder topiknya',
      calls.armed[0]?.email === 'tg:Forum Kita/Topik A', JSON.stringify(calls.armed[0]));
  }

  // 27. Chat biasa TIDAK boleh menghasilkan peringatan apa pun.
  //     Versi sebelumnya menebak forum dari class dan salah ke dua arah —
  //     sekali tak satu pun terdeteksi, sekali semuanya, sehingga setiap chat
  //     diberi peringatan "topiknya tidak terbaca".
  {
    const { calls, send } = boot({
      bodyHtml: albumBubble(['100']),
      chatsHtml: chatRow('-100', 'Chat Biasa') + chatRow('-200', 'Chat Lain'),
      chatBubbles: { '-100': albumBubbleFor('-100', ['11']), '-200': albumBubbleFor('-200', ['21']) }
    });
    const r = await send({ cmd: 'tg.chats', withTopics: true, settings: { stepDelay: 1, scrollRetries: 1 } });
    check('chat biasa tidak jadi "forum"',
      (r.chats || []).every(c => !c.isForum && !c.hasTopics),
      JSON.stringify((r.chats || []).map(c => [c.title, c.isForum, c.hasTopics])));
    check('  tanpa satu pun peringatan',
      !calls.logs.some(l => l.startsWith('warn')), calls.logs.filter(l => l.startsWith('warn')).join(' | '));
  }

  // 28. Tanpa mencentang pencarian topik, daftar chat tidak dibuka satu-satu.
  {
    const { calls, send } = boot({
      bodyHtml: albumBubble(['100']),
      chatsHtml: chatRow('-100', 'A') + chatRow('-200', 'B')
    });
    const r = await send({ cmd: 'tg.chats', settings: { stepDelay: 1, scrollRetries: 1 } });
    check('pendataan cepat: tidak ada chat yang diklik', calls.rowClicks.length === 0,
      calls.rowClicks.join(','));
    check('  daftarnya tetap lengkap', (r.chats || []).length === 2, String((r.chats || []).length));
  }

  // 29. Telegram membuang bubble yang keluar layar. Item yang gagal SEMENTARA
  //     harus dicoba lagi, bukan ditandai selesai lalu ikut lenyap.
  {
    let attempts = 0;
    const ctx = boot({ bodyHtml: albumBubble(['100']) });
    // Dua percobaan pertama: gambarnya "belum dimuat". Ketiga: berhasil.
    const img = ctx.w.document.querySelector('img.media-photo');
    const realSrc = img.getAttribute('src');
    img.removeAttribute('src');
    const orig = ctx.w.chrome.runtime.sendMessage;
    ctx.w.chrome.runtime.sendMessage = async (msg) => {
      if (msg.cmd === 'tgCheckDup' && ++attempts === 3) img.setAttribute('src', realSrc);
      return orig(msg);
    };

    await ctx.send({ cmd: 'tg.run', settings: { stepDelay: 1, scrollRetries: 1, downloadTimeout: 3000 } });
    check('gagal sementara dicoba lagi, bukan hilang selamanya',
      ctx.calls.clicked.map(c => c.name).join(',') === '100.jpg',
      `percobaan=${attempts} unduh=${ctx.calls.clicked.map(c => c.name).join(',')}`);
  }

  // 30. Jatah percobaannya terbatas — item yang memang tidak pernah dimuat
  //     tidak boleh membuat chatnya berputar selamanya.
  {
    const ctx = boot({ bodyHtml: albumBubble(['100']) });
    ctx.w.document.querySelector('img.media-photo').removeAttribute('src');
    const r = await ctx.send({ cmd: 'tg.run', settings: { stepDelay: 1, scrollRetries: 1, downloadTimeout: 3000 } });
    check('menyerah setelah 3 percobaan', r?.ok === true && r?.reason === 'habis', JSON.stringify(r));
    check('  dan mengatakan sudah berapa kali dicoba',
      ctx.calls.logs.some(l => /3 percobaan/.test(l)), ctx.calls.logs.join(' | '));
  }

  // 31. Setelah sampai atas, disapu balik ke bawah — itu yang menyelamatkan
  //     item yang bubble-nya sempat dibuang saat layar bergeser.
  {
    const { calls, send } = boot({ bodyHtml: albumBubble(['100']) });
    await send({ cmd: 'tg.run', settings: { stepDelay: 1, scrollRetries: 1, downloadTimeout: 3000 } });
    check('sapuan balik ke bawah dijalankan',
      calls.logs.some(l => /menyapu balik ke bawah/i.test(l)), calls.logs.join(' | '));
    check('  dan menunggu pesan BARU, bukan lama, saat turun',
      calls.logs.some(l => /Menunggu pesan baru termuat/.test(l)), calls.logs.join(' | '));
  }

  // 32. Grup ber-topik yang dicentang BIASA (tanpa pindai sub-topik): saat
  //     diklik yang muncul daftar topik, bukan pesan. Dulu ditunggu sampai
  //     timeout lalu "tidak mau terbuka, dilewati" — sekarang topiknya masuk
  //     antrean dan masing-masing diunduh ke <grup>/<topik>.
  {
    const topics = chatRow('-500', 'Topik A', 'Rose', { href: '#-500_1' })
                 + chatRow('-500', 'Topik B', 'Rose', { href: '#-500_2' });
    const { calls, send } = boot({
      bodyHtml: albumBubbleFor('-100', ['1']),
      chatsHtml: chatRow('-100', 'Chat Biasa') + chatRow('-500', 'Forum Kita'),
      chatListByHash: { '#-500': chatRow('-100', 'Chat Biasa') + chatRow('-500', 'Forum Kita') + topics },
      chatBubbles: { '-500_1': albumBubbleFor('-500', ['10']), '-500_2': albumBubbleFor('-500', ['20']) }
    });
    await send({ cmd: 'tg.run', peers: [{ peerId: '-500', title: 'Forum Kita', hash: '#-500' }],
                 settings: { stepDelay: 1, scrollRetries: 1, downloadTimeout: 3000, tgOpenTimeout: 4000 } });
    check('grup ber-topik tidak dilewati — topiknya ditemukan',
      calls.logs.some(l => /Forum Kita: grup ber-topik, 2 topik/.test(l)), calls.logs.join(' | '));
    check('  tiap topik diunduh ke foldernya sendiri',
      calls.armed.some(a => a.email === 'tg:Forum Kita/Topik A') &&
      calls.armed.some(a => a.email === 'tg:Forum Kita/Topik B'),
      JSON.stringify(calls.armed));
    check('  isi chat sebelumnya tidak tersimpan ke folder grup',
      !calls.armed.some(a => a.email === 'tg:Forum Kita'), JSON.stringify(calls.armed));
    check('  grup induk tidak diklik ulang saat topiknya sudah tampil',
      calls.rowClicks.filter(h => h === '#-500').length === 1, calls.rowClicks.join(','));
  }

  // 33. Video dan gambar dipisah: <chat>/video/ dan <chat>/image/.
  {
    const { kindDirOf: tgKindDir } = new Function(`${COMMON_SRC}\nreturn { kindDirOf };`)();
    check('video masuk subfolder video',
      ['123.mp4', '5.webm', '7 (1).MP4'].every(n => tgKindDir(n) === 'video'));
    check('gambar masuk subfolder image',
      ['123.jpg', '5.png', '9 (2).jpg'].every(n => tgKindDir(n) === 'image'));
  }

  // 34. Panel Media: klik header chat -> grid Media -> klik tiap item ->
  //     unduh dari viewer. Gambar .jpg, video .mp4 lewat stream/, yang sudah
  //     ada dilewati tanpa dibuka, dan folder topik = <grup>/<topik>.
  {
    const ctx = boot({ bodyHtml: albumBubbleFor('-3952422572', ['1']), onDisk: ['4294970447'] });
    const d = ctx.w.document;
    d.body.insertAdjacentHTML('afterbegin', `
      <div class="chat-info-container"><div class="chat-info"><div class="person">
        <div class="avatar person-avatar is-topic" data-peer-id="-3952422572" data-thread-id="4294967315"></div>
        <div class="content"><div class="top"><div class="user-title">
          <span class="peer-title" data-peer-id="-3952422572" data-thread-id="4294967315">Diedit</span></div></div>
        <div class="bottom"><div class="info"><span class="i18n">In <span class="peer-title" data-peer-id="-3952422572">Fotoku</span></span></div></div>
        </div></div></div></div>`);

    const grid = (mid, video) => `
      <div class="grid-item media-container search-super-item" data-mid="${mid}" data-peer-id="-3952422572">
        ${video ? '<span class="video-time">0:10</span>' : ''}
        <img class="media-photo grid-item-media" src="blob:https://web.telegram.org/g-${mid}"></div>`;
    const opened = [];
    const mids = ['4294970448', '4294970447', '4294968634'];
    let pos = -1;
    const render = () => {
      const mid = mids[pos];
      const video = mid !== '4294968634';
      const inner = video
        ? `<div class="ckin__player"><video src="stream/%7B%22id%22%3A${mid}%7D"></video></div>`
        : `<img class="thumbnail" src="blob:https://web.telegram.org/v-${mid}">`;
      // Seperti Telegram: elemen tampilan DIPAKAI ULANG, hanya isinya berganti.
      const whole = d.querySelector('.media-viewer-whole');
      let asp = whole.querySelector('.media-viewer-aspecter');
      if (!asp) {
        whole.innerHTML = '<div class="media-viewer-mover active"><div class="media-viewer-aspecter"></div></div>';
        asp = whole.querySelector('.media-viewer-aspecter');
      }
      asp.innerHTML = inner;
    };
    d.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight' && d.querySelector('.media-viewer-whole') && pos < mids.length - 1) { pos++; render(); }
    });
    d.addEventListener('click', (e) => {
      if (e.target.closest('.chat-info') && !d.querySelector('.search-super')) {
        d.body.insertAdjacentHTML('beforeend', `<div class="search-super"><div class="search-super-content-container search-super-content-media">
          <div class="search-super-content-media-grid">${grid('4294970448', true)}${grid('4294970447', true)}${grid('4294968634', false)}</div></div></div>`);
      }
      const g = e.target.closest('.search-super-item');
      if (g && !d.querySelector('.media-viewer-whole')) {
        const mid = g.getAttribute('data-mid');
        opened.push(mid);
        pos = mids.indexOf(mid);
        d.body.insertAdjacentHTML('beforeend', '<div class="media-viewer-whole"></div>');
        render();
      }
    });
    d.addEventListener('keydown', (e) => { if (e.key === 'Escape') d.querySelector('.media-viewer-whole')?.remove(); });

    await ctx.send({ cmd: 'tg.run', settings: { stepDelay: 1, scrollRetries: 1, tgIncludeVideo: true, downloadTimeout: 3000 } });
    const names = ctx.calls.clicked.filter(c => c.via === 'extension').map(c => c.name);
    check('panel Media dipakai: video .mp4 dan gambar .jpg dari viewer',
      names.join(',') === '4294970448.mp4,4294968634.jpg', names.join(',') + ' :: ' + ctx.calls.logs.slice(-4).join(' | '));
    check('  SATU modal: hanya item pertama yang diklik, sisanya panah kanan',
      opened.join(',') === '4294970448', opened.join(','));
    check('  folder topik = <grup>/<topik>',
      ctx.calls.armed.every(a => a.email === 'tg:Fotoku/Diedit'), JSON.stringify(ctx.calls.armed));
    check('  viewer ditutup setelah tiap item', !d.querySelector('.media-viewer-whole'));
  }

  // 35. Mode satu link, grup ber-topik: yang tampil daftar topik (belum ada
  //     pesan). Topiknya dicek dulu, lalu SEMUANYA diunduh ke <grup>/<topik>.
  {
    const topics = chatRow('-700', 'Diedit', 'Rose', { thread: '1' })
                 + chatRow('-700', 'Asli', 'Rose', { thread: '2' });
    const ctx = boot({
      bodyHtml: '',
      chatsHtml: chatRow('-100', 'Chat Lain') + chatRow('-700', 'Fotoku'),
      chatListByHash: { '#-700': chatRow('-100', 'Chat Lain') + chatRow('-700', 'Fotoku') + topics },
      chatBubbles: { '-700~1': albumBubbleFor('-700', ['71']), '-700~2': albumBubbleFor('-700', ['72']) }
    });
    ctx.w.location.hash = '#-700';
    const r = await ctx.send({ cmd: 'tg.run', peers: [],
      settings: { stepDelay: 1, scrollRetries: 1, downloadTimeout: 3000, tgOpenTimeout: 4000 } });
    check('satu link: topik grup dicek dan ditemukan',
      ctx.calls.logs.some(l => /Fotoku: grup ber-topik, 2 topik/.test(l)), ctx.calls.logs.join(' | '));
    check('  tiap topik ke <grup>/<topik>',
      ['tg:Fotoku/Diedit', 'tg:Fotoku/Asli'].every(b => ctx.calls.armed.some(a => a.email === b)),
      JSON.stringify(ctx.calls.armed) + ' ' + JSON.stringify(r));
  }

  // 36. Mode satu link, grup BIASA: tidak ada topik -> langsung diunduh.
  {
    const { calls, send } = boot({ bodyHtml: albumBubble(['100']) });
    await send({ cmd: 'tg.run', settings: { stepDelay: 1, scrollRetries: 1, downloadTimeout: 3000 } });
    check('satu link tanpa topik: langsung ke folder grupnya',
      calls.armed.length > 0 && calls.armed.every(a => !a.email.includes('/')), JSON.stringify(calls.armed));
  }

  // 37. Bentuk ASLI Telegram Web: baris topik ber-href SAMA dengan grupnya
  //     ("#-3739847319"), dibedakan data-thread-id. Grup "Meme" dicentang
  //     biasa — dulu "chat tidak mau terbuka, dilewati".
  {
    const topics = chatRow('-3739847319', 'General', 'Rose', { thread: '4294967297' })
                 + chatRow('-3739847319', 'Chat & Link', 'Rose', { thread: '4294967301' });
    const { calls, send } = boot({
      bodyHtml: albumBubbleFor('-100', ['1']),
      chatsHtml: chatRow('-100', 'Lain') + chatRow('-3739847319', 'Meme'),
      chatListByHash: { '#-3739847319': topics },
      chatBubbles: {
        '-3739847319~4294967297': albumBubbleFor('-3739847319', ['501']),
        '-3739847319~4294967301': albumBubbleFor('-3739847319', ['601'])
      }
    });
    await send({ cmd: 'tg.run', peers: [{ peerId: '-3739847319', title: 'Meme', hash: '#-3739847319' }],
                 settings: { stepDelay: 1, scrollRetries: 1, downloadTimeout: 3000, tgOpenTimeout: 4000 } });
    check('topik ber-href sama dikenali lewat data-thread-id',
      calls.logs.some(l => /Meme: grup ber-topik, 2 topik/.test(l)), calls.logs.join(' | '));
    check('  topiknya yang diklik, bukan grupnya lagi',
      calls.rowClicks.includes('#-3739847319~4294967297') && calls.rowClicks.includes('#-3739847319~4294967301'),
      calls.rowClicks.join(','));
    check('  tiap topik ke Meme/<topik>',
      calls.armed.some(a => a.email === 'tg:Meme/General') && calls.armed.some(a => a.email === 'tg:Meme/Chat & Link'),
      JSON.stringify(calls.armed));
    check('  tidak ada yang "tidak mau terbuka"', !calls.logs.some(l => /tidak mau terbuka/.test(l)), calls.logs.join(' | '));
  }

  // 38. Daftar chat utama: baris topik tidak boleh ikut jadi "chat".
  {
    const { send } = boot({
      bodyHtml: '',
      chatsHtml: chatRow('-3739847319', 'Meme') + chatRow('-3739847319', 'General', 'Rose', { thread: '1' })
    });
    const r = await send({ cmd: 'tg.chats', settings: { stepDelay: 1, scrollRetries: 1 } });
    check('baris topik tidak menimpa grupnya di daftar chat',
      r?.chats?.length === 1 && r.chats[0].title === 'Meme', JSON.stringify(r?.chats));
  }

  // 39. Video: permintaan pertama TANPA Range. Server yang menjawab Range
  //     dengan 302 (laporan pengguna) tetap memberi video utuh lewat fetch biasa.
  {
    const { calls, send } = boot({ bodyHtml: BODY, rangeRedirects: true });
    await send({ cmd: 'tg.run', settings: { stepDelay: 1, scrollRetries: 1, tgIncludeVideo: true, downloadTimeout: 5000 } });
    const v = calls.clicked.find(c => c.name === '200.mp4');
    check('video tetap terunduh walau Range dijawab 302',
      v && /^data:video\/mp4/.test(v.href) && calls.ranges.join(',') === 'utuh',
      `${calls.ranges.join(',')} :: ${calls.logs.filter(l => /200/.test(l)).join(' / ')}`);
  }

  // 40. Antrean di panel: tg.runOne mengerjakan SATU item. Grup ber-topik
  //     melaporkan topiknya; tiap topik lalu dikerjakan dari keadaan
  //     "baru kembali ke /k/" (daftar chat utama, tanpa chat terbuka):
  //     klik grup -> klik topik -> unduh.
  {
    const MAIN = chatRow('-100', 'Lain') + chatRow('-3739847319', 'Meme');
    const topics = chatRow('-3739847319', 'General', 'Rose', { thread: '11' })
                 + chatRow('-3739847319', 'Chat & Link', 'Rose', { thread: '12' });
    const ctx = boot({
      bodyHtml: '',
      chatsHtml: MAIN,
      chatListByHash: { '#-3739847319': topics },
      chatBubbles: {
        '-3739847319~11': albumBubbleFor('-3739847319', ['501']),
        '-3739847319~12': albumBubbleFor('-3739847319', ['601'])
      }
    });
    const S = { stepDelay: 1, scrollRetries: 1, downloadTimeout: 3000, tgOpenTimeout: 4000 };
    const goHome = () => {
      ctx.w.document.querySelector('ul.chatlist').innerHTML = MAIN;
      ctx.w.document.querySelector('.bubbles-inner').innerHTML = '';
      ctx.w.location.hash = '';
    };

    const g = await ctx.send({ cmd: 'tg.runOne', settings: S, peer: { peerId: '-3739847319', title: 'Meme', hash: '#-3739847319' } });
    check('runOne: grup ber-topik melaporkan topiknya ke panel',
      g?.topics?.map(t => t.title).join(',') === 'Meme/General,Meme/Chat & Link', JSON.stringify(g));
    check('  dan belum mengunduh apa pun', ctx.calls.armed.length === 0, JSON.stringify(ctx.calls.armed));

    for (const t of g?.topics || []) {
      goHome();
      ctx.calls.rowClicks.length = 0;
      await ctx.send({ cmd: 'tg.runOne', settings: S, peer: t });
      check(`  ${t.title}: grup diklik dulu, lalu topiknya`,
        ctx.calls.rowClicks[0] === '#-3739847319' && ctx.calls.rowClicks[1] === `#-3739847319~${t.threadId}`,
        ctx.calls.rowClicks.join(','));
    }
    check('  tiap topik ke foldernya sendiri',
      ['tg:Meme/General', 'tg:Meme/Chat & Link'].every(b => ctx.calls.armed.some(a => a.email === b)),
      JSON.stringify(ctx.calls.armed));
  }

  // 41. tg.discover (satu link): grup + topiknya.
  {
    const ctx = boot({
      bodyHtml: '',
      chatsHtml: chatRow('-900', 'Fotoku'),
      chatListByHash: { '#-900': chatRow('-900', 'Fotoku') + chatRow('-900', 'Diedit', 'Rose', { thread: '5' }) }
    });
    ctx.w.location.hash = '#-900';
    const d = await ctx.send({ cmd: 'tg.discover', settings: { stepDelay: 1 } });
    check('discover: topik grup satu link ditemukan',
      d?.group?.title === 'Fotoku' && d.topics?.[0]?.title === 'Fotoku/Diedit', JSON.stringify(d));
  }

  // 42. Grid Media memuat lanjutan hanya saat digulung, dan TIDAK selama
  //     modal terbuka. Dulu berhenti setelah satu layar (4–9 item); sekarang
  //     grid didata sampai habis dulu, lalu satu modal + panah kanan.
  {
    const ctx = boot({ bodyHtml: albumBubbleFor('-55', ['1']) });
    const d = ctx.w.document;
    d.body.insertAdjacentHTML('afterbegin',
      '<div class="chat-info-container"><div class="chat-info"><div class="person"><div class="user-title">' +
      '<span class="peer-title" data-peer-id="-55">Grup Besar</span></div></div></div></div>');

    const ALL = Array.from({ length: 12 }, (_, k) => String(1000 - k));   // terbaru dulu
    const cell = (m) => `<div class="grid-item search-super-item" data-mid="${m}" data-peer-id="-55">
      <img class="media-photo" src="blob:https://web.telegram.org/g-${m}"></div>`;
    let loaded = 4, pos = -1;
    const opened = [];

    const render = () => {
      const asp = d.querySelector('.media-viewer-whole .media-viewer-aspecter');
      asp.innerHTML = `<img class="thumbnail" src="blob:https://web.telegram.org/v-${ALL[pos]}">`;
    };
    d.addEventListener('click', (e) => {
      if (e.target.closest('.chat-info') && !d.querySelector('.search-super')) {
        d.body.insertAdjacentHTML('beforeend',
          `<div class="search-super" style="overflow-y:auto"><div class="search-super-content-media"><div class="grid">${
            ALL.slice(0, loaded).map(cell).join('')}</div></div></div>`);
        const sc = d.querySelector('.search-super');
        Object.defineProperty(sc, 'scrollHeight', { value: 3000, configurable: true });
        Object.defineProperty(sc, 'clientHeight', { value: 400, configurable: true });
        let top = 0;
        Object.defineProperty(sc, 'scrollTop', {
          configurable: true, get: () => top,
          set: (v) => {
            top = v;
            // Memuat lanjutan hanya kalau modal TIDAK terbuka.
            if (v > 0 && !d.querySelector('.media-viewer-whole') && loaded < ALL.length) {
              const add = ALL.slice(loaded, loaded + 4);
              loaded += add.length;
              d.querySelector('.search-super .grid').insertAdjacentHTML('beforeend', add.map(cell).join(''));
            }
          }
        });
      }
      const g = e.target.closest('.search-super-item');
      if (g && !d.querySelector('.media-viewer-whole')) {
        opened.push(g.getAttribute('data-mid'));
        pos = ALL.indexOf(g.getAttribute('data-mid'));
        d.body.insertAdjacentHTML('beforeend',
          '<div class="media-viewer-whole"><div class="media-viewer-mover active"><div class="media-viewer-aspecter"></div></div></div>');
        render();
      }
    });
    d.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight' && d.querySelector('.media-viewer-whole') && pos < ALL.length - 1) { pos++; render(); }
      if (e.key === 'Escape') d.querySelector('.media-viewer-whole')?.remove();
    });

    await ctx.send({ cmd: 'tg.run', settings: { stepDelay: 1, scrollRetries: 2, downloadTimeout: 3000 } });
    const names = ctx.calls.clicked.filter(c => c.via === 'extension').map(c => c.name.replace(/\.jpg$/, ''));
    check('grid lazy-load: SEMUA media terunduh, bukan satu layar saja',
      names.join(',') === ALL.join(','), `${names.length}/${ALL.length}: ${names.join(',')}`);
    check('  tetap satu modal', opened.length === 1, opened.join(','));
  }

  /*
   * Grid + viewer tiruan yang lebih mirip Telegram, untuk tes 43–44:
   *  - `virtual`: grid hanya menyimpan WINDOW item di sekitar gulungan
   *    (satu item per baris, 100px), item lain dibuang dari DOM;
   *  - video menampilkan POSTER (<img>) dulu, <video>-nya baru dipasang
   *    `videoDelay` ms kemudian;
   *  - `jumpAt`: sekali, panah kanan dari posisi itu melompat dua item.
   */
  function bootGrid({ n, isVid, virtual = false, videoDelay = 0, jumpAt = -1, staleVideo = false, stuckAt = -1, sizeOf = null,
                      closeMode = 'remove', onDisk = [] }) {
    const ctx = boot({ bodyHtml: albumBubbleFor('-66', ['1']), onDisk });
    const d = ctx.w.document;
    d.body.insertAdjacentHTML('afterbegin',
      '<div class="chat-info-container"><div class="chat-info"><div class="person"><div class="user-title">' +
      '<span class="peer-title" data-peer-id="-66">Grup</span></div></div></div></div>');
    const ALL = Array.from({ length: n }, (_, k) => String(5000 - k));
    const cell = (m, k) => `<div class="grid-item search-super-item" data-mid="${m}" data-peer-id="-66">
      ${isVid(k) ? '<span class="video-time">0:10</span>' : ''}
      <img class="media-photo" src="blob:https://web.telegram.org/g-${m}"></div>`;
    const WIN = 5;
    const shownViewers = () => [...d.querySelectorAll('.media-viewer-whole')].filter(v => v.style.display !== 'none');
    const topViewer = () => shownViewers().pop() || null;
    let openWhileShown = 0, maxShown = 0;
    let top = 0, pos = -1, jumped = false;
    const opened = [];
    const drawGrid = () => {
      const start = virtual ? Math.floor(top / 100) : 0;
      const end = virtual ? start + WIN : n;
      d.querySelector('.search-super .grid').innerHTML =
        ALL.slice(start, end).map((m) => cell(m, ALL.indexOf(m))).join('');
    };
    const render = () => {
      const asp = topViewer().querySelector('.media-viewer-aspecter');
      const m = ALL[pos];
      if (isVid(pos)) {
        asp.innerHTML = `<img class="thumbnail" src="blob:https://web.telegram.org/poster-${m}">`;
        const at = pos;
        // URL stream/ Telegram memuat JSON lokasi berkas, termasuk "size".
        const size = sizeOf ? `%2C%22size%22%3A${sizeOf(at)}` : '';
        const mount = () => { if (pos === at) asp.innerHTML = `<video src="stream/%7B%22id%22%3A${m}${size}%7D"></video>`; };
        videoDelay ? setTimeout(mount, videoDelay) : mount();
      } else {
        asp.innerHTML = `<img class="thumbnail" src="blob:https://web.telegram.org/v-${m}">`;
      }
    };
    d.addEventListener('click', (e) => {
      if (e.target.closest('.chat-info') && !d.querySelector('.search-super')) {
        d.body.insertAdjacentHTML('beforeend',
          '<div class="search-super" style="overflow-y:auto"><div class="search-super-content-media"><div class="grid"></div></div></div>');
        const sc = d.querySelector('.search-super');
        Object.defineProperty(sc, 'scrollHeight', { value: n * 100, configurable: true });
        Object.defineProperty(sc, 'clientHeight', { value: 300, configurable: true });
        Object.defineProperty(sc, 'scrollTop', {
          configurable: true, get: () => top,
          set: (v) => { top = Math.max(0, Math.min(v, n * 100 - 300)); drawGrid(); }
        });
        drawGrid();
      }
      const g = e.target.closest('.search-super-item');
      if (g && topViewer()) openWhileShown++;   // akan MENUMPUK di Telegram sungguhan
      if (g && !topViewer()) {
        opened.push(g.getAttribute('data-mid'));
        pos = ALL.indexOf(g.getAttribute('data-mid'));
        // staleVideo: pemutar video yang TERTINGGAL di luar item aktif, seperti
        // yang dilakukan viewer Telegram setelah satu video pernah diputar.
        d.body.insertAdjacentHTML('beforeend',
          '<div class="media-viewer-whole"><div class="media-viewer-mover active"><div class="media-viewer-aspecter"></div></div>' +
          (staleVideo ? '<div class="media-viewer-mover"><div class="ckin__player"><video src="stream/lama"></video></div></div>' : '') +
          '</div>');
        render();
        maxShown = Math.max(maxShown, shownViewers().length);
      }
    });
    d.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && topViewer()) {
        // remove: dibuang dari DOM · hide: disembunyikan tapi TETAP di DOM
        // (seperti viewer Telegram) · stuck: tidak mau tertutup sama sekali.
        if (closeMode === 'remove') topViewer().remove();
        else if (closeMode === 'hide') topViewer().style.display = 'none';
      }
      if (e.key !== 'ArrowRight' || !topViewer() || pos >= n - 1) return;
      // stuckAt: viewer berhenti merespons panah kanan di posisi ini (daftar
      // internalnya belum memuat lanjutan), padahal grid masih panjang.
      if (pos === stuckAt) return;
      if (pos === jumpAt && !jumped) { jumped = true; pos = Math.min(pos + 2, n - 1); } else pos++;
      render();
    });
    return { ...ctx, ALL, opened, stats: () => ({ openWhileShown, maxShown }) };
  }
  const saved = (ctx) => ctx.calls.clicked.filter(c => c.via === 'extension').map(c => c.name.replace(/\.(jpg|mp4)$/, ''));

  // 43. Video memasang <video> belakangan (poster dulu). Dulu terbaca
  //     "gambar" -> "urutan tidak cocok" palsu -> penyelarasan ulang -> berhenti.
  {
    const ctx = bootGrid({ n: 8, isVid: k => k % 2 === 1, videoDelay: 400 });
    await ctx.send({ cmd: 'tg.run', settings: { stepDelay: 1, scrollRetries: 2, downloadTimeout: 3000, tgIncludeVideo: true } });
    check('video yang dipasang belakangan tidak memicu "tidak cocok"',
      !ctx.calls.logs.some(l => /tidak cocok/.test(l)), ctx.calls.logs.filter(l => /cocok|Gagal/.test(l)).join(' | '));
    check('  semua 8 terunduh dalam satu modal',
      saved(ctx).join(',') === ctx.ALL.join(',') && ctx.opened.length === 1,
      `${saved(ctx).join(',')} / buka ${ctx.opened.length}x`);
  }

  // 44. Grid virtual + viewer sekali melompat: penyelarasan ulang harus
  //     MENGGULUNG grid untuk menemukan itemnya, lalu lanjut sampai habis.
  {
    const isVid = (k) => k === 10;
    const ctx = bootGrid({ n: 15, isVid, virtual: true, jumpAt: 9 });
    await ctx.send({ cmd: 'tg.run', settings: { stepDelay: 1, scrollRetries: 2, downloadTimeout: 3000, tgIncludeVideo: true } });
    check('grid virtual: pendataan bertahap membaca semua 15 item',
      ctx.calls.logs.some(l => /15 media di grid/.test(l)), ctx.calls.logs.filter(l => /media di grid/.test(l)).join(' | '));
    check('  lompatan viewer diselaraskan ulang lewat grid yang digulung',
      ctx.opened.length === 2 && ctx.opened[1] === ctx.ALL[10], ctx.opened.join(','));
    check('  tidak berhenti di tengah: semua terunduh, masing-masing sekali',
      saved(ctx).slice().sort().join(',') === ctx.ALL.slice().sort().join(',') && saved(ctx).length === 15,
      `${saved(ctx).length}: ${saved(ctx).join(',')} :: ${ctx.calls.logs.filter(l => /cocok|Gagal|dilewati/.test(l)).join(' | ')}`);
  }

  // 45. Keluhan pengguna: sejak revisi, GAMBAR tidak pernah terunduh lagi.
  //     Pemutar video yang tertinggal di viewer membuat setiap gambar terbaca
  //     "video" (lalu dianggap GIF) -> "video tidak muncul di viewer".
  {
    const ctx = bootGrid({ n: 6, isVid: k => k === 1 || k === 4, staleVideo: true });
    await ctx.send({ cmd: 'tg.run', settings: { stepDelay: 1, scrollRetries: 2, downloadTimeout: 3000, tgIncludeVideo: true } });
    const names = ctx.calls.clicked.filter(c => c.via === 'extension').map(c => c.name);
    const want = ctx.ALL.map((m, k) => `${m}.${k === 1 || k === 4 ? 'mp4' : 'jpg'}`);
    check('gambar tetap terunduh sebagai .jpg walau ada pemutar video tertinggal',
      names.join(',') === want.join(','),
      `${names.join(',')} :: ${ctx.calls.logs.filter(l => /tidak muncul|cocok/.test(l)).join(' | ')}`);
    check('  tidak ada "video tidak muncul"', !ctx.calls.logs.some(l => /video tidak muncul/.test(l)),
      ctx.calls.logs.filter(l => /tidak muncul/.test(l)).join(' | '));
  }

  // 46. Keluhan: grid 3.900 media, tapi "panah kanan tidak lagi berpindah —
  //     media habis" di ~120. Macetnya viewer bukan akhir daftar: item
  //     berikutnya dibuka dari grid, lalu panah kanan dilanjutkan.
  {
    const ctx = bootGrid({ n: 12, isVid: () => false, virtual: true, stuckAt: 5 });
    await ctx.send({ cmd: 'tg.run', settings: { stepDelay: 1, scrollRetries: 2, downloadTimeout: 3000 } });
    const names = ctx.calls.clicked.filter(c => c.via === 'extension').map(c => c.name.replace(/\.jpg$/, ''));
    check('viewer macet di tengah: tetap lanjut sampai semua 12',
      names.join(',') === ctx.ALL.join(','),
      `${names.length}: ${names.join(',')} :: ${ctx.calls.logs.filter(l => /berpindah|habis|grid/.test(l)).join(' | ')}`);
    check('  pulih dengan membuka item berikutnya dari grid (sekali)',
      ctx.opened.length === 2 && ctx.opened[1] === ctx.ALL[6], ctx.opened.join(','));
    check('  tidak menyebut "media habis" sebelum waktunya',
      !ctx.calls.logs.some(l => /media habis/.test(l)), ctx.calls.logs.filter(l => /habis/.test(l)).join(' | '));
  }

  // 47. Batas ukuran (setelan, default 300 MB): video 400 MB dilewati
  //     SEBELUM diunduh — ukurannya dibaca dari URL stream/.
  {
    const MB = 1048576;
    const ctx = bootGrid({ n: 4, isVid: k => k === 1 || k === 2, sizeOf: k => (k === 1 ? 400 : 5) * MB });
    await ctx.send({ cmd: 'tg.run', settings: { stepDelay: 1, scrollRetries: 2, downloadTimeout: 3000, tgIncludeVideo: true, tgMaxSizeMB: 300 } });
    const names = ctx.calls.clicked.filter(c => c.via === 'extension').map(c => c.name);
    const big = ctx.ALL[1];
    check('video di atas batas tidak diunduh, sisanya tetap',
      names.join(',') === [`${ctx.ALL[0]}.jpg`, `${ctx.ALL[2]}.mp4`, `${ctx.ALL[3]}.jpg`].join(','), names.join(','));
    check('  bahkan tidak diambil sama sekali (hemat kuota)',
      !ctx.calls.fetched.some(u => u.includes(`%3A${big}`)), ctx.calls.fetched.filter(u => /stream/.test(u)).join(' | '));
    check('  alasannya dicatat, dihitung skip bukan gagal',
      ctx.calls.logs.some(l => new RegExp(`${big}: video 400 MB melebihi batas 300 MB`).test(l)) &&
      !ctx.calls.logs.some(l => /^err: /.test(l) && l.includes(big)),
      ctx.calls.logs.filter(l => l.includes(big)).join(' | '));
  }

  // 48. Batas 0 = tanpa batas.
  {
    const ctx = bootGrid({ n: 2, isVid: k => k === 0, sizeOf: () => 900 * 1048576 });
    await ctx.send({ cmd: 'tg.run', settings: { stepDelay: 1, scrollRetries: 2, downloadTimeout: 3000, tgIncludeVideo: true, tgMaxSizeMB: 0 } });
    const names = ctx.calls.clicked.filter(c => c.via === 'extension').map(c => c.name);
    check('batas 0: video besar tetap diunduh', names.includes(`${ctx.ALL[0]}.mp4`), names.join(','));
  }

  // 49. Keluhan: modal saling tumpuk + tidak ada yang terunduh. Viewer
  //     Telegram yang ditutup bisa TERTINGGAL tersembunyi di DOM; script
  //     harus membaca viewer yang tampil, bukan yang pertama.
  {
    const ctx = bootGrid({ n: 10, isVid: () => false, closeMode: 'hide', stuckAt: 4 });
    await ctx.send({ cmd: 'tg.run', settings: { stepDelay: 1, scrollRetries: 2, downloadTimeout: 3000 } });
    const names = ctx.calls.clicked.filter(c => c.via === 'extension').map(c => c.name.replace(/\.jpg$/, ''));
    check('viewer lama tersembunyi di DOM: tetap terunduh semua',
      names.join(',') === ctx.ALL.join(','), `${names.length}: ${names.join(',')}`);
    check('  tidak pernah membuka item saat viewer lain masih tampil',
      ctx.stats().openWhileShown === 0 && ctx.stats().maxShown === 1, JSON.stringify(ctx.stats()));
  }

  // 50. Viewer tidak mau tertutup sama sekali: JANGAN buka yang baru di
  //     atasnya — berhenti dengan alasan yang jelas.
  {
    const ctx = bootGrid({ n: 10, isVid: () => false, closeMode: 'stuck', stuckAt: 3 });
    await ctx.send({ cmd: 'tg.run', settings: { stepDelay: 1, scrollRetries: 2, downloadTimeout: 3000 } });
    check('viewer macet terbuka: tidak ada modal kedua',
      ctx.stats().openWhileShown === 0 && ctx.opened.length === 1, JSON.stringify({ ...ctx.stats(), opened: ctx.opened.length }));
    check('  alasannya dilaporkan', ctx.calls.logs.some(l => /tidak bisa ditutup/.test(l)), ctx.calls.logs.slice(-3).join(' | '));
  }

  // 51. Lompat setelah N "sudah ada" berturut-turut: sisanya dianggap sudah
  //     terunduh, tujuan ini selesai (antrean di panel lanjut ke berikutnya).
  {
    const ALLm = Array.from({ length: 12 }, (_, k) => String(5000 - k));
    const ctx = bootGrid({ n: 12, isVid: () => false, onDisk: ALLm.slice(2, 9) });
    const r = await ctx.send({ cmd: 'tg.run', settings: { stepDelay: 1, scrollRetries: 2, downloadTimeout: 3000, tgSkipStreak: 3 } });
    const names = ctx.calls.clicked.filter(c => c.via === 'extension').map(c => c.name.replace(/\.jpg$/, ''));
    check('3 "sudah ada" berturut-turut: berhenti, sisanya tidak disusuri',
      names.join(',') === ALLm.slice(0, 2).join(',') && r?.reason === 'sudah-terunduh',
      `${names.join(',')} / ${r?.reason}`);
    check('  alasannya dicatat', ctx.calls.logs.some(l => /3 media berturut-turut sudah ada/.test(l)), ctx.calls.logs.slice(-3).join(' | '));
  }

  // 52. Deretan "sudah ada" yang terputus unduhan baru dihitung ulang dari nol.
  {
    const ALLm = Array.from({ length: 8 }, (_, k) => String(5000 - k));
    // sudah ada: 0,1 · baru: 2 · sudah ada: 3,4 · baru: 5,6,7  (batas 3 tidak pernah tercapai)
    const ctx = bootGrid({ n: 8, isVid: () => false, onDisk: [ALLm[0], ALLm[1], ALLm[3], ALLm[4]] });
    const r = await ctx.send({ cmd: 'tg.run', settings: { stepDelay: 1, scrollRetries: 2, downloadTimeout: 3000, tgSkipStreak: 3 } });
    const names = ctx.calls.clicked.filter(c => c.via === 'extension').map(c => c.name.replace(/\.jpg$/, ''));
    check('hitungan direset oleh unduhan baru: semua yang baru tetap terunduh',
      names.join(',') === [ALLm[2], ALLm[5], ALLm[6], ALLm[7]].join(',') && r?.reason === 'habis',
      `${names.join(',')} / ${r?.reason}`);
  }

  console.log('\n' + pass + ' lulus, ' + fail + ' gagal');
  process.exit(fail ? 1 : 0);
})();
