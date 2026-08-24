'use strict';
// Parser struk belanja - fungsi MURNI tanpa dependensi eksternal agar mudah dites.

function parseRupiah(s) {
  if (s == null) return null;
  if (typeof s === 'number') return isFinite(s) ? Math.round(s) : null;
  let t = String(s).trim().replace(/rp/gi, '').replace(/\s/g, '');
  // Koreksi salah-baca OCR pada angka: O->0, l/I/| ->1, S->5
  t = t.replace(/[Oo]/g, '0').replace(/[lI|]/g, '1').replace(/S/g, '5');
  const bersih = t.replace(/\./g, '').replace(/,/g, '');
  if (!/^\d+$/.test(bersih)) return null;
  return parseInt(bersih, 10);
}

function formatRupiah(n) {
  n = Math.round(Number(n) || 0);
  const neg = n < 0 ? '-' : '';
  return neg + 'Rp' + Math.abs(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function htmlKeTeks(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(tr|p|div|h[1-6]|li)>/gi, '\n')
    .replace(/<\/t[dh]>/gi, '\t')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n');
}

function cariTanggal(teks) {
  const m = String(teks).match(/\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})(?:[ ,]+(\d{1,2}):(\d{2}))?/);
  if (!m) return null;
  let d = +m[1], bulan = +m[2], y = +m[3];
  if (y < 100) y += 2000;
  if (bulan > 12 && d <= 12) { const t = d; d = bulan; bulan = t; }
  if (d < 1 || d > 31 || bulan < 1 || bulan > 12 || y < 2000 || y > 2100) return null;
  const pad = (n) => String(n).padStart(2, '0');
  return { tanggal: y + '-' + pad(bulan) + '-' + pad(d), jam: m[4] ? pad(+m[4]) + ':' + m[5] : '' };
}

function cariTotal(lines) {
  const angkaDi = (L) => { const m = String(L).match(/([\d.,OolIS|]{3,})\s*$/); return m ? parseRupiah(m[1]) : null; };
  let idxTotal = -1;
  let total = null;
  for (let i = lines.length - 1; i >= 0; i--) {
    const L = lines[i];
    if (!/^(?:grand\s*)?total(?:\s*(?:belanja|bayar|tagihan|semua))?\b/i.test(L)) continue;
    if (/total\s*(item|qty|disc)/i.test(L)) continue;
    let v = angkaDi(L);
    if (v == null && i + 1 < lines.length) v = parseRupiah(lines[i + 1]);
    if (v != null && v > 0) { idxTotal = i; total = v; break; }
  }
  // Kumpulkan TUNAI/KEMBALI di seluruh struk untuk validasi & fallback.
  let tunai = null, kembali = null;
  for (let i = 0; i < lines.length; i++) {
    const L = lines[i];
    if (/^(?:tunai|cash)\b|^bayar\s*$/i.test(L)) { const v = angkaDi(L); if (v != null) tunai = v; }
    else if (/^kembali\b|^change\b/i.test(L)) { const v = angkaDi(L); if (v != null) kembali = v; }
  }
  if (total == null && tunai != null && kembali != null && tunai > kembali && kembali >= 0) {
    return { total: tunai - kembali, idx: -1 };
  }
  if (total == null) return { total: null, idx: -1 };
  // Validasi silang pembayaran tunai: TUNAI - KEMBALI harus = TOTAL.
  if (tunai != null && kembali != null && tunai >= total && kembali <= tunai) {
    const hitung = tunai - kembali;
    if (hitung > 0) total = hitung; // hasil hitung lebih dipercaya
  }
  return { total, idx: idxTotal };
}

function cariNoStruk(teks) {
  const pola = [
    /no\.?\s*(?:struk|transaksi|bon|trx|nota)?\s*[:#]\s*([A-Z0-9][A-Z0-9\/\-.]{5,})/i,
    /\b((?:INDO|GLB)[A-Z0-9\-]{8,})\b/i
  ];
  for (const p of pola) {
    const m = String(teks).match(p);
    if (m) return m[1];
  }
  return '';
}

// Merek dikenali walau hurufnya terbaca berjarak/miring akibat OCR/logo,
// plus konteks aplikasi terkait (alfagift = toko online Alfamart).
const POLA_MEREK = [
  [/i\s*n\s*d\s*o\s*m\s*a\s*r\s*e\s*t|indomaret|indo\W?prime/i, 'Indomaret'],
  // alfacare (email layanan Alfamart) & A-Poin (poin loyalitas) = sidik jari
  // e-receipt alfagift yang logonya tak terbaca OCR.
  [/a\s*l\s*f\s*a\s*(?:m\s*a\s*r\s*t|m\s*i\s*d\s*i|g\s*i\s*f\s*t)|alfamart|alfamidi|alfagift|alfacare|a-poin/i, 'Alfamart'],
  [/l\s*a\s*w\s*s\s*o\s*n|lawson/i, 'Lawson']
];
// Baris pengiriman/alamat/informasi - BUKAN nama toko maupun nama barang.
const BARIS_BUKAN_TOKO = /delivered|dikirim|diambil|pengiriman|pengantar|alamat|resi|kurir|driver|penerima|pesanan|invoice|order|estimasi|metode\s*pembayar|gopay|shopeepay|qris|e-?money|flazz|kartu\s*(debit|kredit)/i;
// Baris alamat/status/waktu: tidak layak jadi nama toko maupun barang.
const BARIS_ALAMAT = /kabupaten|kecamatan|kelurahan|\bdesa\b|provinsi|\bjawa\b|indonesia|kode\s*pos|residen|perumahan|gedung|lantai|ruko|\bblok\b|no\.?\s*\d+\b|maks\s*kirim|status|selesai|dibuat|diproses|diantar|dikemas/i;

function cariToko(lines, teks) {
  // 1) Merek eksplisit di 12 baris awal (regex merek spesifik - aman di semua baris).
  for (const L of lines.slice(0, 12)) {
    for (const [re, nama] of POLA_MEREK) {
      if (re.test(L)) return nama;
    }
  }
  // 2) Merek di mana pun pada teks penuh (logo kadang terbaca jauh di bawah).
  const T = String(teks || '').replace(/\n/g, ' ');
  for (const [re, nama] of POLA_MEREK) {
    if (re.test(T)) return nama;
  }
  // 3) Fallback: baris awal yang "seperti nama toko" - bukan alamat/kirim/status.
  const kotorToko = /total|subtotal|kasir|struk\s*(no|:)|terima\s*kasih|tanggal|npwp|www\.|telp|whatsapp/i;
  for (const L of lines.slice(0, 6)) {
    if (BARIS_BUKAN_TOKO.test(L)) continue;
    if (BARIS_ALAMAT.test(L)) continue;
    if (kotorToko.test(L)) continue;
    if ((String(L).match(/,/g) || []).length >= 2) continue; // alamat ber-koma panjang
    if (/^[\d\s+\-().:]+$/.test(L)) continue; // telepon/jam/angka polos
    const bersih = String(L).replace(/[^A-Za-z .&'-]/g, ' ').replace(/\s+/g, ' ').trim();
    if (bersih.length >= 4 && /[A-Za-z]{4}/.test(bersih)) return bersih.slice(0, 30);
  }
  // Jujur saja daripada mengarang nama dari potongan alamat.
  return 'Tidak dikenal';
}

// Perintah manual: bayar <nominal> [toko] [keterangan...]
// Toko opsional dikenali hanya pada posisi tepat setelah nominal.
function parsePerintahBayar(argumen) {
  const nominal = parseRupiah(argumen[0]);
  if (nominal == null) return null;
  const sisa = argumen.slice(1);
  let toko = '';
  let ket = sisa;
  if (sisa.length && sisa[0].length <= 12) {
    const kata = String(sisa[0]).replace(/[^a-z]/gi, '');
    for (const [, nama] of POLA_MEREK) {
      const dasar = nama === 'Indomaret' ? /^(?:indo(?:maret|prime)?)$/i
        : nama === 'Alfamart' ? /^(?:alfamart|alfamidi|alfagift|alfa)$/i
        : /^lawson$/i;
      if (dasar.test(kata)) { toko = nama; ket = sisa.slice(1); break; }
    }
  }
  return { nominal, toko, item: ket.join(' ') || 'Pengeluaran manual' };
}

function ambilItemRingkas(lines, idxTotal) {
  const kandidat = [];
  const akhir = idxTotal === -1 ? lines.length : idxTotal;
  const bising = /indomaret|alfamart|alfamidi|alfagift|npwp|kasir|struk\s*(no|:)|terima kasih|www\.|telp|member|pt\.|harga|subtotal|ppn|pb1|voucher|poin|point|cashback|diskon|disc|jl\.|jalan|kab\.|kec\.|kode|transaksi|non\s*pajak|qty|tunai|kembali|total|delivered|dikirim|pengiriman|pengantar|alamat|resi|kurir|driver|penerima|pesanan|invoice|order|estimasi|ongkir|biaya|gratis|metode|pembayaran|gopay|shopeepay|qris|e-?money|flazz|kartu\s*(debit|kredit)|kabupaten|kecamatan|kelurahan|\bjawa\b|indonesia|maks\s*kirim|status|selesai|diproses|diantar|dikemas|\bref\.?\b|email|kritik|saran|\brt\b|\brw\b|\.\./i;
  for (let i = 0; i < akhir && kandidat.length < 8; i++) {
    const L = lines[i];
    if (!L || L.length < 4) continue;
    if (bising.test(L)) continue;
    if (/^\d{1,2}[\/\-.]\d{1,2}[\/\-.]/.test(L)) continue;
    if (/^[\d\s+\-().:]+$/.test(L)) continue; // telepon/jam/rentang waktu
    if (/^\d{1,4}\s*(?:g|gr|kg|ml|l|pcs)$/i.test(L)) continue; // baris satuan
    if (/^[-=._]{3,}$/.test(L)) continue;
    // Nama = teks sebelum kolom harga (layout struk) / sebelum kolom qty-harga (aplikasi).
    let nama = L.replace(/\d{1,3}\s*[xX*]\s*[\d.,]+\s*$/g, '')
      .replace(/\s{2,}.*$/, '')
      .replace(/[^\wA-Za-z .&'\-/]/g, ' ')
      .replace(/^\d{1,3}\s+(?=[A-Za-z])/, '') // qty nyangkut di depan ("7 omie...")
      .replace(/\s+\d{1,4}$/, '')             // varian/kode angka nyangkut di belakang
      .replace(/\s+/g, ' ')
      .trim();
    if (nama.length < 3 || !/[A-Za-z]{3}/.test(nama)) continue;
    kandidat.push({ nama: nama.slice(0, 40), rapi: /[a-z]/.test(nama) });
  }
  // Utamakan nama bergaya judul (Title Case) - baris KAPITAL penuh biasanya
  // nama cabang/tempat, bukan barang.
  const bagus = kandidat.filter((k) => k.rapi).map((k) => k.nama);
  const kapital = kandidat.filter((k) => !k.rapi).map((k) => k.nama);
  return bagus.concat(kapital).slice(0, 4).join(', ');
}

function parseStrukText(teks) {
  if (!teks) return null;
  const bersih = String(teks).replace(/\r/g, '');
  const lines = bersih.split('\n').map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return null;
  const { total, idx } = cariTotal(lines);
  if (total == null) return null;
  const tgl = cariTanggal(bersih) || {};
  return {
    toko: cariToko(lines, bersih),
    tanggal: tgl.tanggal || null,
    jam: tgl.jam || '',
    nostruk: cariNoStruk(bersih),
    item: ambilItemRingkas(lines, idx),
    total
  };
}

function kategoriUntuk(teks, peta) {
  const T = String(teks).toLowerCase();
  for (const [kategori, kataList] of Object.entries(peta || {})) {
    for (const k of kataList) {
      if (T.includes(String(k).toLowerCase())) return kategori;
    }
  }
  return 'Lainnya';
}

module.exports = { parseRupiah, formatRupiah, htmlKeTeks, cariTanggal, cariTotal, cariNoStruk, cariToko, parsePerintahBayar, parseStrukText, kategoriUntuk };
