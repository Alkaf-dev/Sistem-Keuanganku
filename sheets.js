'use strict';
// Akses Google Sheets via REST + JWT Service Account (tanpa library googleapis).
// Kredensial: file JSON service-account (SERVICE_ACCOUNT_FILE) dan spreadsheet
// harus di-share (Editor) ke client_email service account.
require('dotenv').config();
const fs = require('fs');
const crypto = require('crypto');

const SHEET_ID = process.env.GOOGLE_SHEETS_ID;
const KEY_FILE = process.env.SERVICE_ACCOUNT_FILE || 'service-account.json';
const TAB_TRX = 'Transaksi';
const TAB_SALDO = 'Saldo';
const TAB_REKAP = 'Rekap Bulanan';
const HEADER = ['Tanggal', 'Jam', 'Toko', 'No Struk', 'Item', 'Nominal', 'Kategori', 'Saldo Setelah'];

let cacheToken = null;

function b64url(input) {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function getAccessToken() {
  if (cacheToken && Date.now() < cacheToken.exp) return cacheToken.t;
  const cred = JSON.parse(fs.readFileSync(KEY_FILE, 'utf8'));
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64url(JSON.stringify({
    iss: cred.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600
  }));
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(head + '.' + claim);
  const ttd = b64url(signer.sign(cred.private_key));
  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion: head + '.' + claim + '.' + ttd
  });
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body });
  const j = await r.json();
  if (!j.access_token) throw new Error('Auth Google gagal: ' + (j.error_description || j.error));
  cacheToken = { t: j.access_token, exp: Date.now() + (j.expires_in - 120) * 1000 };
  return cacheToken.t;
}

async function api(metode, jalur, bodyObj) {
  const token = await getAccessToken();
  const r = await fetch('https://sheets.googleapis.com/v4/spreadsheets/' + SHEET_ID + jalur, {
    method: metode,
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: bodyObj ? JSON.stringify(bodyObj) : undefined
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('Sheets API ' + metode + ' ' + jalur + ' -> ' + (j.error ? j.error.message : r.status));
  return j;
}

async function nilaiGet(range) {
  const j = await api('GET', '/values/' + encodeURIComponent(range));
  return j.values || [];
}

async function nilaiUpdate(range, values) {
  return api('PUT', '/values/' + encodeURIComponent(range) + '?valueInputOption=USER_ENTERED', { values });
}

async function nilaiAppend(range, values) {
  return api('POST', '/values/' + encodeURIComponent(range) + ':append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS', { values });
}

async function pastikanTab() {
  if (!SHEET_ID || SHEET_ID.indexOf('isi_') === 0) throw new Error('.env belum diisi GOOGLE_SHEETS_ID');
  const meta = await api('GET', '?fields=sheets.properties.title');
  const ada = {};
  for (const s of meta.sheets || []) ada[s.properties.title] = true;
  const permintaan = [];
  for (const nama of [TAB_TRX, TAB_SALDO, TAB_REKAP]) {
    if (!ada[nama]) permintaan.push({ addSheet: { properties: { title: nama } } });
  }
  if (permintaan.length) await api('POST', ':batchUpdate', { requests: permintaan });
  const headerTrx = await nilaiGet(TAB_TRX + '!A1:H1');
  if (!headerTrx.length) await nilaiUpdate(TAB_TRX + '!A1', [HEADER]);
  const headerSaldo = await nilaiGet(TAB_SALDO + '!A1:B1');
  if (!headerSaldo.length) await nilaiUpdate(TAB_SALDO + '!A1:B1', [['Saldo Saat Ini', 0]]);
  return true;
}

async function bacaSaldo() {
  const v = await nilaiGet(TAB_SALDO + '!B1:B1');
  const n = Number(v[0] && v[0][0]);
  return isFinite(n) ? n : 0;
}

async function tulisSaldo(v) {
  await nilaiUpdate(TAB_SALDO + '!B1:B1', [[v]]);
}

async function sudahAdaNoStruk(nostruk) {
  if (!nostruk) return false;
  const kolom = await nilaiGet(TAB_TRX + '!D2:D');
  const target = String(nostruk).toUpperCase();
  for (const baris of kolom) {
    if (String(baris[0] || '').trim().toUpperCase() === target) return true;
  }
  return false;
}

async function catatTransaksi(trx) {
  const saldoLama = await bacaSaldo();
  const saldoBaru = saldoLama - trx.nominal;
  await nilaiAppend(TAB_TRX + '!A1', [[
    trx.tanggal, trx.jam || '', trx.toko || '', trx.nostruk || '',
    trx.item || '', trx.nominal, trx.kategori || 'Lainnya', saldoBaru
  ]]);
  await tulisSaldo(saldoBaru);
  return saldoBaru;
}

async function undoTerakhir() {
  const semua = await nilaiGet(TAB_TRX + '!A2:H');
  if (!semua.length) return null;
  const terakhir = semua[semua.length - 1];
  const nomor = semua.length + 1; // nomor baris sheet asli
  const nominal = Math.abs(Number(terakhir[5]) || 0);
  if (!nominal) return null;
  const saldoBaru = (await bacaSaldo()) + nominal;
  await api('POST', '/values/' + encodeURIComponent(TAB_TRX + '!A' + nomor + ':H' + nomor) + ':clear');
  await tulisSaldo(saldoBaru);
  return { toko: terakhir[2] || '', nominal, saldoBaru };
}

async function setSaldo(v) {
  await tulisSaldo(v);
}

async function getSisa() {
  return bacaSaldo();
}

async function ambilSemuaTransaksi() {
  const v = await nilaiGet(TAB_TRX + '!A2:H');
  return v;
}

module.exports = {
  pastikanTab, bacaSaldo, tulisSaldo, sudahAdaNoStruk, catatTransaksi,
  undoTerakhir, setSaldo, getSisa, ambilSemuaTransaksi,
  TAB_TRX, TAB_SALDO, TAB_REKAP, HEADER
};
