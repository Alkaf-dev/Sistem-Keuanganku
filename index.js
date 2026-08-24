'use strict';
// Bot WhatsApp via BAILEYS (protokol langsung, tanpa browser):
// kirim FOTO struk ke chat "Message yourself" -> tercatat di Sheets.
require('dotenv').config();
const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestWaWebVersion,
  downloadMediaMessage,
  DisconnectReason
} = require('@whiskeysockets/baileys');
const P = require('./parser');
const logika = require('./logika');
const KATEGORI = require('./kategori.json');
const sheets = require('./sheets');
const { prosesGambarStruk } = require('./struk');

const OWNERS = (process.env.OWNER_JID || '').split(',').map((s) => s.trim()).filter(Boolean);
const NOMOR_PAIRING = (process.env.PAIRING_PHONE || '').replace(/\D/g, '');
const FOLDER_SESI = '.baileys_auth';

let sockGlobal = null;
let sibuk = false;
let pairingDiminta = false;
let qrDibuka = false;
let qrTerbaru = null;
let sudahPair = false; // pair-success sudah diterima -> JANGAN minta kode lagi apa pun yang terjadi
const idTerkirim = new Set(); // id pesan yang dikirim bot sendiri -> diabaikan saat diterima kembali (anti-gema)

// Halaman lokal yang selalu menampilkan QR TERBARU (menyegarkan sendiri).
require('http').createServer(function (req, res) {
  if (req.url === '/qr.png') {
    if (!qrTerbaru) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': 'image/png' });
    return res.end(qrTerbaru);
  }
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(
    '<html><head><meta charset="utf-8"><meta http-equiv="refresh" content="6">' +
    '<style>body{font-family:sans-serif;text-align:center;background:#111;color:#eee;margin-top:30px}</style></head>' +
    '<body><h2>Pindai QR ini dengan WhatsApp</h2>' +
    '<p>HP: WhatsApp &gt; Setelan &gt; Perangkat Tertaut &gt; Tautkan Perangkat</p>' +
    '<img src="/qr.png" width="420"><p><small>Halaman menyegarkan otomatis tiap 6 detik</small></p></body></html>'
  );
}).listen(8765);

function tidur(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

function normalJid(jid) {
  return String(jid || '').split('@')[0].split(':')[0];
}

// Kategori: kata kunci item dulu; kalau tidak cocok, toko minimarket -> Belanja Harian.
function tentukanKategori(hasil) {
  const k = P.kategoriUntuk((hasil.item || '') + ' ' + (hasil.toko || ''), KATEGORI);
  if (k !== 'Lainnya') return k;
  if (/indomaret|alfamart|alfamidi/i.test(hasil.toko || '')) return 'Belanja Harian';
  return 'Lainnya';
}

async function tanggalJamSekarang() {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false
  });
  const bagian = {};
  for (const p of fmt.formatToParts(new Date())) bagian[p.type] = p.value;
  return { tanggal: bagian.year + '-' + bagian.month + '-' + bagian.day, jam: bagian.hour + ':' + bagian.minute };
}

// Unduh media dengan 3x percobaan (media kadang belum siap saat pesan baru masuk).
async function unduhMediaAman(m) {
  const jeda = [1000, 3000, 6000];
  let terakhir = null;
  for (let i = 0; i < jeda.length; i++) {
    await tidur(jeda[i]);
    try {
      const buf = await downloadMediaMessage(m, 'buffer', {}, {
        reuploadRequest: sockGlobal.updateMediaMessage // media basih diminta ulang otomatis
      });
      if (buf && buf.length) return buf;
      terakhir = new Error('data kosong');
      console.error('[FOTO] percobaan ' + (i + 1) + ': data kosong');
    } catch (e) {
      terakhir = e;
      console.error('[FOTO] percobaan ' + (i + 1) + ' gagal: ' + e.message +
        (e.stack ? '\nSTACK: ' + String(e.stack).split('\n').slice(0, 3).join(' | ') : ''));
    }
  }
  throw terakhir || new Error('gagal tidak diketahui');
}

function adalahChatSendiri(m) {
  if (!m.key.fromMe) return false;
  const user = sockGlobal && sockGlobal.user ? sockGlobal.user : {};
  const kandidatSaya = [user.id, user.lid].map(normalJid);
  return kandidatSaya.indexOf(normalJid(m.key.remoteJid)) !== -1;
}

async function tanganiPesan(m, chatId) {
  const bales = function (t) {
    console.log('[BALAS] ' + String(t).replace(/\n/g, ' | ').slice(0, 140));
    return sockGlobal.sendMessage(chatId, { text: t }).then(function (r) {
      idTerkirim.add(r && r.key && r.key.id);
      if (idTerkirim.size > 500) { // jaga memori
        const pertama = idTerkirim.values().next().value;
        idTerkirim.delete(pertama);
      }
      return r;
    });
  };
  const isi = m.message || {};

  if (isi.imageMessage) {
    let buffer;
    try {
      buffer = await unduhMediaAman(m);
    } catch (e) {
      console.error('[FOTO] unduh gagal permanen:', e.message);
      return bales('⚠️ Gagal mengunduh gambar setelah beberapa percobaan.\n🔄 Coba kirim ulang fotonya ya');
    }
    console.log('[FOTO] memproses gambar, ukuran~' + Math.round(buffer.length / 1024) + 'KB');
    const hasil = await prosesGambarStruk(buffer);
    if (!hasil || hasil.gagal) {
      const mentah = hasil && hasil.pratinjau && hasil.pratinjau.length
        ? '\n🔍 Terbaca:\n> ' + hasil.pratinjau.slice(0, 6).join('\n> ') + '\n'
        : '\n';
      return bales('🚫 TOTAL tidak terbaca dari gambar ini.' + mentah +
        '💡 Koreksi manual:\n*bayar <nominal> [toko] [keterangan]*\nContoh: bayar 75000 alfamart belanja mingguan');
    }
    if (!(hasil.total > 0)) {
      return bales('🚫 Total tidak terbaca mantap - tidak kutulis agar sheet tetap bersih.\n' +
        '💡 Koreksi manual: *bayar <nominal> [toko] [keterangan]*');
    }
    // Gerbang konfirmasi: total boleh, toko tak teridentifikasi -> jangan tulis dulu.
    if (/tidak dikenal/i.test(hasil.toko || '')) {
      const pratinjau = hasil.pratinjau && hasil.pratinjau.length
        ? '\n🔍 Terbaca:\n> ' + hasil.pratinjau.slice(0, 6).join('\n> ') + '\n'
        : '';
      return bales('⚠️ Total terbaca *' + P.formatRupiah(hasil.total) + '* tapi nama tokonya tak dikenal - belum kutulis ya\n' +
        '👉 Balas: *bayar ' + hasil.total + ' <toko> <keterangan>*\nContoh: bayar ' + hasil.total + ' alfamart belanja' + pratinjau);
    }
    if (hasil.nostruk && (await sheets.sudahAdaNoStruk(hasil.nostruk))) {
      return bales('⚠️ Struk ini sudah pernah dicatat (anti-dobel):\n🧾 ' + hasil.nostruk);
    }
    const kategori = tentukanKategori(hasil);
    if (!hasil.tanggal) {
      const skrg = await tanggalJamSekarang();
      hasil.tanggal = skrg.tanggal;
      hasil.jam = hasil.jam || skrg.jam;
    }
    const saldoBaru = await sheets.catatTransaksi(Object.assign({}, hasil, { kategori, nominal: hasil.total }));
    const daftar = hasil.item ? hasil.item.split(',').map(function (s) { return s.trim(); }).filter(Boolean) : [];
    const barisItem = daftar.length
      ? daftar[0] + (daftar.length > 1 ? ' +' + (daftar.length - 1) + ' item lainnya' : '')
      : '';
    return bales(
      '✅ Tercatat *' + P.formatRupiah(hasil.total) + '* - ' + hasil.toko + '\n' +
      (barisItem ? '🛒 ' + barisItem + '\n' : '') +
      '🏷️ Kategori: ' + kategori + '\n' +
      '💰 Saldo: *' + P.formatRupiah(saldoBaru) + '*'
    );
  }

  const teks = (isi.conversation || (isi.extendedTextMessage && isi.extendedTextMessage.text) || '').trim();
  if (!teks) return;
  // Anti-gema lapis-2: balasan bot kini diawali emoji - buang simbol dulu,
  // lalu kenali frasa pembuka balasan (frasa spesifik agar catatan pribadi
  // yang kebetulan berawalan kata serupa tidak ikut terbuang).
  if (/^[\W_]*(?:tercatat\b|saldo (?:saat ini|disetel)|undo\b|perintahku|struk ini sudah|total terbaca|aku tidak mengenali|gagal mengunduh)/i.test(teks)) return;
  const argumen = teks.split(/\s+/);
  const perintah = (argumen.shift() || '').toLowerCase();

  if (perintah === 'saldo') {
    if (argumen[0] === 'set') {
      const n = P.parseRupiah(argumen[1]);
      if (n == null) return bales('💵 Format: *saldo set 500000*');
      await sheets.setSaldo(n);
      return bales('✅ Saldo disetel: *' + P.formatRupiah(n) + '*');
    }
    const s = await sheets.getSisa();
    return bales('💰 Saldo saat ini: *' + P.formatRupiah(s) + '*');
  }

  if (perintah === 'undo') {
    const u = await sheets.undoTerakhir();
    if (!u) return bales('🤷 Tidak ada transaksi yang bisa di-undo.');
    const ketUndo = u.nominal > 0 ? P.formatRupiah(u.nominal) : '(tanpa nominal)';
    return bales('↩️ Undo: ' + (u.toko || '?') + ' ' + ketUndo + (u.catatan || '') +
      '\n💰 Saldo: *' + P.formatRupiah(u.saldoBaru) + '*');
  }

  if (perintah === 'bayar') {
    const b = P.parsePerintahBayar(argumen);
    if (!b) return bales('💸 Format: *bayar <nominal> [toko] [keterangan]*\nContoh: bayar 75000 alfamart belanja mingguan');
    const kategori = tentukanKategori({ item: b.item, toko: b.toko });
    const skrg = await tanggalJamSekarang();
    const saldoBaru = await sheets.catatTransaksi({
      tanggal: skrg.tanggal, jam: skrg.jam, toko: b.toko || 'Manual',
      nostruk: 'MANUAL-' + Date.now(), item: b.item, nominal: b.nominal, kategori
    });
    return bales('✅ Tercatat *' + P.formatRupiah(b.nominal) + '* - ' + (b.toko || 'Manual') +
      (b.item && b.item !== 'Pengeluaran manual' ? '\n🛒 ' + b.item : '') +
      '\n🏷️ Kategori: ' + kategori +
      '\n💰 Saldo: *' + P.formatRupiah(saldoBaru) + '*');
  }

  if (perintah === 'rekap') {
    const rows = await sheets.ambilSemuaTransaksi();
    const daftarKat = Object.keys(KATEGORI).concat(['Belanja Harian', 'Lainnya']);
    return bales('📊 Rekap Pengeluaran\n\n' + logika.teksRekap(logika.bangunRekap(rows, daftarKat)));
  }

  if (perintah === 'help' || perintah === 'menu') {
    return bales([
      '📖 Perintahku:',
      '📸 Kirim foto struk -> otomatis tercatat',
      '💰 saldo - cek saldo',
      '💵 saldo set 500000 - setel saldo awal',
      '↩️ undo - hapus transaksi terakhir',
      '💸 bayar <nominal> [toko] [keterangan]',
      '📊 rekap - ringkasan bulanan'
    ].join('\n'));
  }

  return bales('🤔 Aku tidak mengenali itu. Ketik *help* untuk lihat daftar perintah 🙂');
}

async function prosesUpsert(m) {
  try {
    if (!m.message || m.key.remoteJid === 'status@broadcast') return;
    // DIAGNOSTIK: catat setiap pesan SEBELUM pagar waktu.
    const umurDetik = Math.floor(Date.now() / 1000) - Number(m.messageTimestamp || 0);
    console.log('[RAW] jid=' + m.key.remoteJid + ' ts=' + m.key.timestamp + ' umur=' + umurDetik + 's tipe=' + Object.keys(m.message)[0] + ' dariSaya=' + m.key.fromMe);
    // Pagar waktu: abaikan pesan replay/backlog (>10 menit) agar sinkronisasi
    // riwayat tidak memicu balasan atau pencatatan ulang.
    if (umurDetik > 600) return;
    if (idTerkirim.has(m.key.id)) return; // pesan kiriman bot sendiri
    if (!OWNERS.length) {
      console.log('[SETUP] OWNER_JID kosong. Chat id pesanmu:', m.key.remoteJid);
      return;
    }
    // Privasi: chat lain hanya dicatat ID-nya, tanpa isi teks/gambar.
    if (!adalahChatSendiri(m)) {
      console.log('[LEWAT] chat lain: ' + m.key.remoteJid);
      return;
    }
    console.log('[MSG] dari=' + m.key.remoteJid + ' dariSaya=' + m.key.fromMe +
      ' tipe=' + (m.message.imageMessage ? 'image' : Object.keys(m.message)[0]) +
      ' teks=' + String(m.message.conversation || '').slice(0, 40));
    if (sibuk) { console.log('[ANTRI] masih memproses pesan sebelumnya'); return; }
    sibuk = true;
    try {
      await tanganiPesan(m, m.key.remoteJid);
    } catch (e) {
      console.error('[TANGANI GAGAL]', e);
      try { await sockGlobal.sendMessage(m.key.remoteJid, { text: '😵 Terjadi error internal: ' + e.message }); } catch (e2) { /* abaikan */ }
    } finally {
      sibuk = false;
    }
  } catch (e) {
    console.error(e);
  }
}

async function mulai() {
  if (!sudahPair) pairingDiminta = false; // sesi baru berhak minta kode bila belum pernah pair
  const { state, saveCreds } = await useMultiFileAuthState(FOLDER_SESI);
  let version;
  try {
    version = await Promise.race([
      fetchLatestWaWebVersion(sockGlobal ? sockGlobal : undefined, {}).then(function (v) { return v.version; }),
      new Promise(function (_, rej) { setTimeout(function () { rej(new Error('timeout ambil versi')); }, 8000); })
    ]);
    console.log('[VERSI] WA Web live ' + version);
  } catch (e) {
    console.log('[VERSI] pakai bawaan (' + e.message + ')');
    try { version = (await fetchLatestBaileysVersion()).version; } catch (e2) { /* bawaan pustaka */ }
  }

  const pino = require('pino');
  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    syncFullHistory: false,
    markOnlineOnConnect: true, // WA bisa membuang sesi yang tidak pernah online
    browser: ['Ubuntu', 'Chrome', '20.0.04'],
    logger: pino({ level: 'silent' })
  });
  sockGlobal = sock;

  // Pola ev.process: creds WAJIB tersimpan sebelum event close diproses
  // (kalau tidak, sambung ulang memakai sesi setengah jadi -> 401 terus).
  sock.ev.process(async function (events) {
    if (events['creds.update']) {
      await saveCreds();
    }

    if (events['connection.update']) {
      const u = events['connection.update'];
      console.log('[KONEKSI] ' + (u.connection || '') +
        (u.isNewLogin ? ' (PAIR-SUCCES)' : '') +
        (u.receivedPendingNotifications ? ' (sinkron riwayat)' : '') +
        (u.lastDisconnect ? ' (' + ((u.lastDisconnect.error && u.lastDisconnect.error.output && u.lastDisconnect.error.output.statusCode) || '?') + ')' : ''));

      // Saat pair-success: KUNCI registered=true + simpan SEBELUM server memutus dengan 515.
      // (Bug rc14: flag ini hanya diset di jalur notifikasi yang sering kalah balapan.)
      if (u.isNewLogin && !state.creds.registered) {
        sudahPair = true;
        state.creds.registered = true;
        await saveCreds();
        console.log('[PAIR] sukses - registered dikunci, menunggu sambung ulang wajib (515)...');
      }

      // Cadangan: QR untuk discan kamera "Tautkan Perangkat" via browser lokal.
      if (u.qr) {
        const qrcode = require('qrcode');
        try {
          qrTerbaru = await qrcode.toBuffer(u.qr, { width: 480, margin: 2 });
          console.log('[QR] diperbarui di http://localhost:8765');
          if (!qrDibuka) {
            qrDibuka = true;
            require('child_process').exec('cmd /c start "" "http://localhost:8765"');
          }
        } catch (e) { console.error('[QR] gagal: ' + e.message); }
      }

      if (u.connection === 'open') {
        console.log('=== BOT SIAP. Kirim foto struk / perintah ke chat "Message yourself". ===');
        console.log('Login sebagai:', sock.user && sock.user.id, '| lid:', sock.user && sock.user.lid);
      }

      if (u.connection === 'close') {
        const kode = u.lastDisconnect && u.lastDisconnect.error &&
          u.lastDisconnect.error.output ? u.lastDisconnect.error.output.statusCode : '';

        if (kode === DisconnectReason.loggedOut) {
          if (sudahPair && state.creds.registered && state.creds.account) {
            console.error('Sesi dicabut dari HP (Perangkat Tertaut > keluar). Reset untuk login ulang...');
          } else {
            console.error('Ditolak server sebelum sesi utuh -> reset otomatis');
          }
          sudahPair = false;
          try { require('fs').rmSync(FOLDER_SESI, { recursive: true, force: true }); } catch (e) { /* abaikan */ }
        }

        // 515 restartRequired & 408 pasca-scan HARUS langsung disambung ulang tanpa jeda.
        const cepat = kode === DisconnectReason.restartRequired || kode === DisconnectReason.timedOut;
        const jeda = cepat ? 300 : (kode === DisconnectReason.forbidden || kode === DisconnectReason.loggedOut ? 12000 : 5000);
        console.log('Terputus (' + kode + '), sambung ulang dalam ' + Math.round(jeda / 1000) + ' detik...');
        await tidur(jeda);
        mulai();
        return;
      }

      // Minta kode pairing hanya jika BELUM PERNAH pair (belum ada identitas akun).
      const belumAdaIdentitas = !state.creds.account && !sudahPair;
      if (!pairingDiminta && belumAdaIdentitas && NOMOR_PAIRING && (u.connection === 'connecting')) {
        pairingDiminta = true;
        try {
          await tidur(2500); // beri waktu handshake sebelum minta kode
          console.log('[PAIR] meminta kode untuk +' + NOMOR_PAIRING + '...');
          const kode = await Promise.race([
            sock.requestPairingCode(NOMOR_PAIRING),
            new Promise(function (_, rej) { setTimeout(function () { rej(new Error('timeout 20s minta kode')); }, 20000); })
          ]);
          console.log('PAIRCODE:' + kode);
        } catch (e) {
          pairingDiminta = false;
          console.error('Gagal meminta kode pairing: ' + e.message + ' -> sambung ulang otomatis');
          try { sock.end(); } catch (e2) { /* abaikan */ }
        }
      }
    }

    if (events['messages.upsert']) {
      for (const m of events['messages.upsert'].messages || []) await prosesUpsert(m);
    }
  });
}

process.on('unhandledRejection', function (e) { console.error('unhandledRejection:', e); });

sheets.pastikanTab()
  .then(function () { mulai(); })
  .catch(function (e) {
    console.error('Gagal menyiapkan spreadsheet:', e.message);
    process.exit(1);
  });
