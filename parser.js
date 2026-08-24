'use strict';
// Parser struk belanja - fungsi MURNI tanpa dependensi eksternal agar mudah dites.

function parseRupiah(s) {
  if (s == null) return null;
  if (typeof s === 'number') return isFinite(s) ? Math.round(s) : null;
  let t = String(s).trim().replace(/rp/gi, '').replace(/\s/g, '');
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
  let idxTotal = -1;
  let total = null;
  for (let i = lines.length - 1; i >= 0; i--) {
    const L = lines[i];
    if (!/^(?:grand\s*)?total(?:\s*(?:belanja|bayar|tagihan|semua))?\b/i.test(L)) continue;
    if (/total\s*(item|qty|disc)/i.test(L)) continue;
    const m = L.match(/([\d.,]{3,})\s*$/);
    let v = m ? parseRupiah(m[1]) : null;
    if (v == null && i + 1 < lines.length) v = parseRupiah(lines[i + 1]);
    if (v != null && v > 0) { idxTotal = i; total = v; break; }
  }
  if (total == null) return { total: null, idx: -1 };
  // Validasi silang pembayaran tunai: TUNAI - KEMBALI harus = TOTAL.
  let tunai = null, kembali = null;
  for (let i = idxTotal + 1; i < lines.length; i++) {
    let m;
    if (/^(?:tunai|cash|bayar)\b/i.test(lines[i])) {
      m = lines[i].match(/([\d.,]{3,})\s*$/); if (m) tunai = parseRupiah(m[1]);
    } else if (/^kembali\b|^change\b/i.test(lines[i])) {
      m = lines[i].match(/([\d.,]{3,})\s*$/); if (m) kembali = parseRupiah(m[1]);
    }
  }
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

function cariToko(lines, teks) {
  for (const L of lines.slice(0, 8)) {
    if (/indomaret/i.test(L)) return 'Indomaret';
    if (/alfamart|alfamidi/i.test(L)) return 'Alfamart';
  }
  if (/indomaret/i.test(teks)) return 'Indomaret';
  if (/alfamart|alfamidi/i.test(teks)) return 'Alfamart';
  return lines.length ? String(lines[0]).slice(0, 30) : 'Tidak dikenal';
}

function ambilItemRingkas(lines, idxTotal) {
  const item = [];
  const akhir = idxTotal === -1 ? lines.length : idxTotal;
  for (let i = 0; i < akhir && item.length < 3; i++) {
    const L = lines[i];
    if (!L || L.length < 4) continue;
    if (/indomaret|alfamart|alfamidi|npwp|kasir|struk|terima kasih|www\.|telp|member|pt\.|harga|subtotal|jl\./i.test(L)) continue;
    if (/^\d{1,2}[\/\-.]\d{1,2}[\/\-.]/.test(L)) continue;
    if (/^[-=]{3,}$/.test(L)) continue;
    item.push(L.replace(/\s{2,}.*$/, '').slice(0, 40));
  }
  return item.join(', ');
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

module.exports = { parseRupiah, formatRupiah, htmlKeTeks, cariTanggal, cariTotal, cariNoStruk, cariToko, parseStrukText, kategoriUntuk };
