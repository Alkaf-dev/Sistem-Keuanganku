'use strict';
// Logika keuangan murni (rekap dll.) - tanpa dependensi eksternal.
const { formatRupiah } = require('./parser');

const NAMA_BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

function bulanLabel(ym) {
  const m = Number(String(ym).split('-')[1]);
  return (NAMA_BULAN[m - 1] || m) + ' ' + String(ym).split('-')[0];
}

// rows: baris Transaksi [tanggal, jam, toko, nostruk, item, nominal, kategori, saldo]
// -> daftar {bulan, label, perKategori, total} terurut naik.
function bangunRekap(rows, daftarKategori) {
  const peta = new Map();
  for (const r of rows || []) {
    if (!r || !r[0]) continue;
    const ym = String(r[0]).slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(ym)) continue;
    const kat = r[6] || 'Lainnya';
    const n = Math.abs(Number(r[5]) || 0);
    if (!peta.has(ym)) {
      const kosong = {};
      for (const k of daftarKategori) kosong[k] = 0;
      kosong[kat] = 0;
      peta.set(ym, kosong);
    }
    const b = peta.get(ym);
    b[kat] = (b[kat] || 0) + n;
  }
  return Array.from(peta.keys()).sort().map(function (ym) {
    const perKategori = peta.get(ym);
    let total = 0;
    for (const v of Object.values(perKategori)) total += v;
    return { bulan: ym, label: bulanLabel(ym), perKategori, total };
  });
}

function teksRekap(rekap, maks) {
  const out = [];
  const list = (rekap || []).slice(-(maks || 12)).reverse();
  for (const b of list) {
    out.push('*' + b.label + '* - total ' + formatRupiah(b.total));
    for (const [k, v] of Object.entries(b.perKategori)) {
      if (v > 0) out.push('   ' + k + ': ' + formatRupiah(v));
    }
  }
  return out.join('\n') || 'Belum ada transaksi.';
}

module.exports = { bulanLabel, bangunRekap, teksRekap };
