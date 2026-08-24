'use strict';
// Ekstraksi data struk dari gambar: QR -> e-receipt URL -> OCR (fallback).
const P = require('./parser');

async function cobaDecodeQr(buffer) {
  try {
    const sharp = require('sharp');
    const jsQR = require('jsqr');
    const { data, info } = await sharp(buffer)
      .greyscale()
      .normalise()
      .resize({ width: 1400, height: 1400, fit: 'inside', withoutEnlargement: false })
      .raw()
      .toBuffer({ resolveWithObject: true });
    const hasil = jsQR(new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength), info.width, info.height);
    return hasil ? hasil.data : null;
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

async function ocrStruk(buffer) {
  const { createWorker } = require('tesseract.js');
  const worker = await createWorker('ind');
  try {
    const { data } = await worker.recognize(buffer);
    return data.text;
  } finally {
    await worker.terminate();
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
  // 3) OCR gambar langsung.
  try {
    const teks = await ocrStruk(buffer);
    const h = P.parseStrukText(teks);
    if (h) return Object.assign(h, { sumber: 'ocr' });
  } catch (e) {
    console.error('[OCR] gagal:', e.message);
  }
  return null;
}

module.exports = { prosesGambarStruk, cobaDecodeQr, fetchEreceipt, ocrStruk };
