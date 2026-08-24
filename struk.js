'use strict';
// Ekstraksi data struk dari gambar: QR -> e-receipt URL -> OCR (fallback).
const P = require('./parser');

async function cobaDecodeQr(buffer) {
  try {
    const sharp = require('sharp');
    const jsQR = require('jsqr');
    // jsQR menuntut piksel RGBA (4 byte/px) - grayscale mentah menyebabkan
    // "Malformed data passed to binarizer". Coba beberapa skala sampai terbaca.
    const skala = [1200, 1800, 2400];
    for (const lebar of skala) {
      for (const gamma of [false, true]) {
        try {
          let p = sharp(buffer)
            .resize({ width: lebar, height: lebar, fit: 'inside', withoutEnlargement: false })
            .normalise();
          if (gamma) p = p.gamma(2.2);
          const { data, info } = await p
            .ensureAlpha()
            .raw()
            .toBuffer({ resolveWithObject: true });
          if (data.length !== info.width * info.height * 4) continue;
          const hasil = jsQR(new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength), info.width, info.height);
          if (hasil && hasil.data) return hasil.data;
        } catch (e) {
          console.error('[QR] skala ' + lebar + (gamma ? '+gamma' : '') + ' gagal: ' + e.message);
        }
      }
    }
    return null;
  } catch (e) {
    console.error('[QR] decode gagal:', e.message);
    return null;
  }
}

async function fetchEreceipt(url) {
  const r = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', Accept: 'text/html,*/*' },
    redirect: 'follow'
  });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.text();
}

async function ocrStruk(buffer, psm) {
  const sharp = require('sharp');
  const { createWorker } = require('tesseract.js');
  // Pra-proses untuk struk thermal: perbesar, pertajam, ratakan kontras.
  const gambar = await sharp(buffer)
    .resize({ width: 2000, withoutEnlargement: false })
    .greyscale()
    .normalise()
    .sharpen({ sigma: 1 })
    .png()
    .toBuffer();
  const worker = await createWorker('ind');
  try {
    await worker.setParameters({
      tessedit_pageseg_mode: String(psm || 6), // 6=blok seragam (struk); 4=kolom/layar lebar
      preserve_interword_spaces: '1'
    });
    const { data } = await worker.recognize(gambar);
    console.log('[OCR] contoh hasil (psm' + (psm || 6) + '):\n' + data.text.split('\n').slice(0, 10).join('\n'));
    return data.text;
  } finally {
    await worker.terminate();
  }
}

// Satu putaran OCR + coba parse. Balas { h, baris } - h bisa null bila total tak ketemu.
async function satuPutaranOcr(buffer, psm) {
  try {
    const teks = await ocrStruk(buffer, psm);
    if (!teks || !teks.trim()) return null;
    // Simpan teks penuh untuk diagnosis (bukan cuma cuplikan log).
    try {
      const fs = require('fs');
      const tujuan = require('path').join(require('os').tmpdir(), 'keuangan-bot-ocr-psm' + (psm || 6) + '.txt');
      fs.writeFileSync(tujuan, teks, 'utf8');
      console.log('[OCR] teks penuh -> ' + tujuan);
    } catch (e) { /* debug saja, abaikan */ }
    return { h: P.parseStrukText(teks), baris: teks.split('\n').map((l) => l.trim()).filter(Boolean) };
  } catch (e) {
    console.error('[OCR] psm' + psm + ' gagal:', e.message);
    return null;
  }
}

async function prosesGambarStruk(buffer) {
  // 1) QR berisi URL e-receipt -> fetch halaman -> parse teksnya.
  const qr = await cobaDecodeQr(buffer);
  if (qr) console.log('[QR terbaca]', qr.slice(0, 120));
  if (qr && /^https?:\/\//i.test(qr)) {
    try {
      const html = await fetchEreceipt(qr);
      const h = P.parseStrukText(P.htmlKeTeks(html));
      if (h) return Object.assign(h, { sumber: 'qr-url', url: qr });
      console.log('[e-receipt] halaman terbaca tapi total tidak ditemukan');
    } catch (e) {
      console.error('[e-receipt] fetch gagal:', e.message);
    }
  }
  // 2) QR berisi teks/JSON struk langsung.
  if (qr) {
    let teksQr = qr;
    if (/^[\[{]/.test(qr.trim())) {
      try { teksQr = JSON.stringify(JSON.parse(qr)); } catch (e) { /* biarkan apa adanya */ }
    }
    const h = P.parseStrukText(teksQr.replace(/[{}"]/g, ' ').replace(/,/g, '\n'));
    if (h) return Object.assign(h, { sumber: 'qr-teks' });
  }
  // 3) OCR gambar langsung - putaran pertama layout struk, kedua layout lebar.
  const putaran = [];
  const p1 = await satuPutaranOcr(buffer, 6);
  if (p1) {
    if (p1.h) return Object.assign(p1.h, { sumber: 'ocr', pratinjau: p1.baris.slice(0, 8) });
    putaran.push(p1);
    console.log('[OCR] total tidak ketemu (psm6) - coba mode layout lain...');
  }
  const p2 = await satuPutaranOcr(buffer, 4);
  if (p2 && p2.h) return Object.assign(p2.h, { sumber: 'ocr', pratinjau: p2.baris.slice(0, 8) });
  if (p2) putaran.push(p2);
  // Gagal transparan: serahkan teks mentah supaya bisa dikoreksi bersama.
  const terbaik = putaran.sort((a, b) => b.baris.join(' ').length - a.baris.join(' ').length)[0];
  return { gagal: true, pratinjau: terbaik ? terbaik.baris.slice(0, 12) : [] };
}

module.exports = { prosesGambarStruk, cobaDecodeQr, fetchEreceipt, ocrStruk };
