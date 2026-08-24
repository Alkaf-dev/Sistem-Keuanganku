'use strict';
// Bot WhatsApp: kirim FOTO struk ke chat "Message yourself" -> tercatat di Sheets.
require('dotenv').config();
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const P = require('./parser');
const logika = require('./logika');
const KATEGORI = require('./kategori.json');
const sheets = require('./sheets');
const { prosesGambarStruk } = require('./struk');

const OWNERS = (process.env.OWNER_JID || '').split(',').map((s) => s.trim()).filter(Boolean);

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

let sibuk = false;

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: '.wwebjs_auth' }),
  puppeteer: { headless: true, args: ['--no-sandbox', '--disable-gpu'] }
});

client.on('qr', async function () {
  // Mode kode pemuatan (tanpa kamera): set PAIRING_PHONE di .env / lingkungan.
  const nomor = (process.env.PAIRING_PHONE || '').replace(/\D/g, '');
  if (!nomor) {
    console.log('QR baru tersedia tapi PAIRING_PHONE tidak disetel - sesi mungkin perlu login ulang.');
    return;
  }
  try {
    const kode = await client.requestPairingCode(nomor);
    console.log('PAIRCODE:' + kode);
  } catch (e) {
    console.error('Gagal minta kode pemuatan:', e.message);
  }
});

client.on('ready', function () {
  console.log('Bot siap. Kirim foto struk / perintah ke chat "Message yourself" (Note-to-Self).');
});

client.on('auth_failure', function (m) {
  console.error('AUTH GAGAL:', m);
});

client.on('disconnected', function (alasan) {
  console.log('Terputus:', alasan, '- mencoba ulang dalam 10 detik...');
  setTimeout(function () { client.initialize(); }, 10000);
});

// Buang akhiran perangkat (:52 dst.) supaya perbandingan whitelist aman.
function normalJid(jid) {
  return String(jid || '').split('@')[0].split(':')[0];
}

client.on('message_create', async function (msg) {
  try {
    if (msg.isStatus || msg.from === 'status@broadcast') return;
    console.log('[MSG] dari=' + msg.from + ' ke=' + msg.to + ' dariSaya=' + msg.fromMe +
      ' tipe=' + msg.type + ' teks=' + String(msg.body || '').slice(0, 40));
    if (!msg.fromMe) return; // hanya pesan yang dikirim sendiri dari akun ini
    const chatId = msg.to;   // pada Note-to-Self: tujuan = nomor sendiri
    if (!OWNERS.length) {
      console.log('[SETUP] OWNER_JID kosong. Chat id pesanmu:', chatId,
        '- isi OWNER_JID di .env lalu restart.');
      return;
    }
    const milikSendiri = OWNERS.some(function (o) {
      return normalJid(o) === normalJid(chatId) || normalJid(o) === normalJid(msg.from);
    });
    if (!milikSendiri) {
      console.log('[LEWAT] bukan chat sendiri: ' + chatId);
      return;
    }
    if (sibuk) { console.log('[ANTRI] masih memproses pesan sebelumnya'); return; }
    sibuk = true;
    try {
      await tanganiPesan(msg, chatId);
    } catch (e) {
      console.error('[TANGANI GAGAL]', e);
      try { await client.sendMessage(chatId, 'Terjadi error internal: ' + e.message); } catch (e2) { /* abaikan */ }
    } finally {
      sibuk = false;
    }
  } catch (e) {
    console.error(e);
  }
});

async function tanganiPesan(msg, chatId) {
  const bales = function (t) { return client.sendMessage(chatId, t); };

  if (msg.hasMedia && /^image\//.test(msg.mimetype || '')) {
    const media = await msg.downloadMedia();
    const buffer = Buffer.from(media.data, 'base64');
    const hasil = await prosesGambarStruk(buffer);
    if (!hasil) {
      return bales('Gagal membaca struk (QR & OCR tidak menemukan TOTAL).\nBalas dengan perintah: *bayar <nominal> [keterangan]*');
    }
    if (hasil.nostruk && (await sheets.sudahAdaNoStruk(hasil.nostruk))) {
      return bales('Struk ini sudah pernah dicatat (anti-dobel):\n' + hasil.nostruk);
    }
    const kategori = tentukanKategori(hasil);
    if (!hasil.tanggal) {
      const skrg = await tanggalJamSekarang();
      hasil.tanggal = skrg.tanggal;
      hasil.jam = hasil.jam || skrg.jam;
    }
    const saldoBaru = await sheets.catatTransaksi(Object.assign({}, hasil, { kategori }));
    const tanda = hasil.sumber === 'ocr' ? '\n_(via OCR - cek angkanya ya)_' : '';
    return bales(
      '*Tercatat* ' + P.formatRupiah(hasil.total) + '\n' +
      hasil.toko + (hasil.item ? ' - ' + hasil.item : '') + '\n' +
      'Kategori: ' + kategori + '\n' +
      'Tanggal: ' + hasil.tanggal + (hasil.jam ? ' ' + hasil.jam : '') + '\n' +
      'Saldo: ' + P.formatRupiah(saldoBaru) + tanda
    );
  }

  const teks = (msg.body || '').trim();
  if (!teks) return;
  const argumen = teks.split(/\s+/);
  const perintah = (argumen.shift() || '').toLowerCase();

  if (perintah === 'saldo') {
    if (argumen[0] === 'set') {
      const n = P.parseRupiah(argumen[1]);
      if (n == null) return bales('Format: *saldo set 500000*');
      await sheets.setSaldo(n);
      return bales('Saldo disetel: *' + P.formatRupiah(n) + '*');
    }
    const s = await sheets.getSisa();
    return bales('Saldo saat ini: *' + P.formatRupiah(s) + '*');
  }

  if (perintah === 'undo') {
    const u = await sheets.undoTerakhir();
    if (!u) return bales('Tidak ada transaksi yang bisa di-undo.');
    return bales('Undo: ' + u.toko + ' ' + P.formatRupiah(u.nominal) + '\nSaldo: *' + P.formatRupiah(u.saldoBaru) + '*');
  }

  if (perintah === 'bayar') {
    const n = P.parseRupiah(argumen[0]);
    if (n == null) return bales('Format: *bayar 25000 keterangan opsional*');
    const ket = argumen.slice(1).join(' ') || 'Pengeluaran manual';
    const kategori = tentukanKategori({ item: ket, toko: '' });
    const skrg = await tanggalJamSekarang();
    const saldoBaru = await sheets.catatTransaksi({
      tanggal: skrg.tanggal, jam: skrg.jam, toko: 'Manual',
      nostruk: 'MANUAL-' + Date.now(), item: ket, nominal: n, kategori
    });
    return bales('*Tercatat* ' + P.formatRupiah(n) + '\n' + ket + '\nKategori: ' + kategori + '\nSaldo: *' + P.formatRupiah(saldoBaru) + '*');
  }

  if (perintah === 'rekap') {
    const rows = await sheets.ambilSemuaTransaksi();
    const daftarKat = Object.keys(KATEGORI).concat(['Belanja Harian', 'Lainnya']);
    return bales(logika.teksRekap(logika.bangunRekap(rows, daftarKat)));
  }

  return bales([
    'Perintah:',
    '- Kirim *foto struk* -> otomatis tercatat',
    '- *saldo* / *saldo set 500000*',
    '- *undo* (hapus transaksi terakhir)',
    '- *bayar 25000 [keterangan]*',
    '- *rekap* (ringkasan bulanan)'
  ].join('\n'));
}

sheets.pastikanTab()
  .then(function () { client.initialize(); })
  .catch(function (e) {
    console.error('Gagal menyiapkan spreadsheet:', e.message);
    process.exit(1);
  });
