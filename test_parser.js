'use strict';
// Tes parser.js + logika.js (murni, TANPA dependensi eksternal).
const P = require('./parser');
const L = require('./logika');
const KATEGORI = require('./kategori.json');

let gagal = 0, jumlah = 0;
function cek(nama, ok, detail) {
  jumlah++;
  if (!ok) gagal++;
  console.log((ok ? 'PASS' : 'GAGAL') + ' ' + nama + (ok ? '' : ' :: ' + detail));
}

// ---------- parseRupiah ----------
cek('rupiah Rp23.500', P.parseRupiah('Rp23.500') === 23500, P.parseRupiah('Rp23.500'));
cek('rupiah "Rp 1.276.500"', P.parseRupiah('Rp 1.276.500') === 1276500, P.parseRupiah('Rp 1.276.500'));
cek('rupiah polos', P.parseRupiah('23500') === 23500, P.parseRupiah('23500'));
cek('rupiah angka', P.parseRupiah(19900) === 19900, P.parseRupiah(19900));
cek('rupiah koma ribuan (OCR)', P.parseRupiah('19,900') === 19900, P.parseRupiah('19,900'));
cek('rupiah bukan angka -> null', P.parseRupiah('TOTAL') === null, P.parseRupiah('TOTAL'));
cek('formatRupiah', P.formatRupiah(1276500) === 'Rp1.276.500', P.formatRupiah(1276500));
cek('formatRupiah nol', P.formatRupiah(0) === 'Rp0', P.formatRupiah(0));

// ---------- htmlKeTeks ----------
const html = '<html><body><script>x</script><table><tr><td>TOTAL</td><td>25.000</td></tr></table><br>Selesai</body></html>';
const teksHtml = P.htmlKeTeks(html);
cek('htmlKeTeks buang tag+script', !teksHtml.includes('<') && !teksHtml.includes('x'), JSON.stringify(teksHtml));
cek('htmlKeTeks sel tabel jadi baris', /TOTAL[\s\S]*25\.000/.test(teksHtml), JSON.stringify(teksHtml));

// ---------- cariTanggal ----------
cek('tanggal dd/mm/yy + jam', JSON.stringify(P.cariTanggal('23/08/26 14:35')) === '{"tanggal":"2026-08-23","jam":"14:35"}', JSON.stringify(P.cariTanggal('23/08/26 14:35')));
cek('tanggal dd-mm-yyyy', P.cariTanggal('05-01-2026').tanggal === '2026-01-05', JSON.stringify(P.cariTanggal('05-01-2026')));
cek('tanggal tidak ada', P.cariTanggal('tanpa tanggal') === null, '');

// ---------- parseStrukText: struk Indomaret sintetis ----------
const STRUK_INDO = [
  'INDOMARET',
  'KC. TANJUNG DUREN',
  'Jl. Meruya Ilir Raya No.1',
  'NPWP: 01.234.567.8-901.000',
  'No. Struk : INDOG1234567890-1',
  'Kasir : RINA',
  '--------------------------------',
  'INDOMILK SUSU COKLAT 125ML        4.500',
  'AQUA BOTOL 600ML                  3.500',
  'CHITATO PIKANTES 68G             11.900',
  '--------------------------------',
  'SUB TOTAL                       19.900',
  'PPN                                  0',
  'TOTAL                           19.900',
  'TUNAI                           20.000',
  'KEMBALI                            100',
  'Terima kasih telah berbelanja'
].join('\n');

const h1 = P.parseStrukText(STRUK_INDO);
cek('struk toko Indomaret', h1 && h1.toko === 'Indomaret', JSON.stringify(h1));
cek('struk total 19900 (validasi tunai-kembali)', h1 && h1.total === 19900, h1 && h1.total);
cek('struk nostruk terbaca', h1 && h1.nostruk === 'INDOG1234567890-1', h1 && h1.nostruk);
cek('struk tanggal', h1 && h1.tanggal === null, h1 && h1.tanggal); // struk ini sengaja tanpa tanggal
cek('struk item pertama susu', h1 && /INDOMILK/i.test(h1.item), h1 && h1.item);

const STRUK_TGL = 'INDOMARET\n07/09/25 10:01\nNo. Struk : INDOG9998887770\nMIE INSTAN GORENG     3.500\nTOTAL                 3.500';
const h2 = P.parseStrukText(STRUK_TGL);
cek('struk2 total 3500', h2 && h2.total === 3500, h2 && h2.total);
cek('struk2 tanggal 2025-09-07', h2 && h2.tanggal === '2025-09-07', h2 && h2.tanggal);
cek('struk2 jam 10:01', h2 && h2.jam === '10:01', h2 && h2.jam);

// TOTAL di baris sendiri, angka di baris berikutnya
const h3 = P.parseStrukText('ALFAMART\nSABUN LIFEBOY   4.000\nTOTAL:\n15.500\nTUNAI\n16.000\nKEMBALI\n500');
cek('total di baris berikutnya', h3 && h3.total === 15500, h3 && JSON.stringify(h3));
cek('toko Alfamart', h3 && h3.toko === 'Alfamart', h3 && h3.toko);

// Tanpa TOTAL -> null
cek('tanpa TOTAL -> null', P.parseStrukText('INDOMARET\nAQUA 3.500\nTUNAI 5.000') === null, '');
cek('teks kosong -> null', P.parseStrukText('') === null, '');

// e-receipt hasil htmlKeTeks bisa diparse
const h4 = P.parseStrukText(P.htmlKeTeks('<div>No Struk: INDOG5551234567</div><div>INDOMILK SUSU 4.500</div><div>TOTAL 4.500</div><div>TUNAI 5.000 KEMBALI 500</div>'));
cek('e-receipt html -> total 4500', h4 && h4.total === 4500, h4 && JSON.stringify(h4));
cek('e-receipt html -> nostruk', h4 && h4.nostruk === 'INDOG5551234567', h4 && h4.nostruk);

// ---------- kategori ----------
cek('kategori indomilk -> Makan & Minum', P.kategoriUntuk('indomilk susu coklat', KATEGORI) === 'Makan & Minum', '');
cek('kategori pulsa', P.kategoriUntuk('token pln 50k', KATEGORI) === 'Pulsa & Token', '');
cek('kategori tak dikenal -> Lainnya', P.kategoriUntuk('barang aneh xyz', KATEGORI) === 'Lainnya', '');
cek('kategori case-insensitive', P.kategoriUntuk('CHITATO PIKANTES 68G', KATEGORI) === 'Makan & Minum', '');

// ---------- logika rekap ----------
const ROWS = [
  ['2026-07-02', '10:00', 'Indomaret', 'A1', 'mie', 20000, 'Makan & Minum', 980000],
  ['2026-07-20', '11:00', 'Indomaret', 'A2', 'pulsa', 50000, 'Pulsa & Token', 930000],
  ['2026-08-01', '09:00', 'Indomaret', 'A3', 'susu', 4500, 'Makan & Minum', 925500],
  ['', '', '', '', '', '', '', ''],
  [null]
];
const KATS = Object.keys(KATEGORI).concat(['Belanja Harian', 'Lainnya']);
const rekap = L.bangunRekap(ROWS, KATS);
cek('rekap 2 bulan', rekap.length === 2, JSON.stringify(rekap));
cek('rekap Jul total 70000', rekap[0].total === 70000, rekap[0] && rekap[0].total);
cek('rekap Jul label', rekap[0].label === 'Jul 2026', rekap[0] && rekap[0].label);
cek('rekap Agu hanya makanan 4500', rekap[1].perKategori['Makan & Minum'] === 4500 && rekap[1].total === 4500, JSON.stringify(rekap[1]));
cek('rekap baris kosong dilewati', true, '');
const teksR = L.teksRekap(rekap);
cek('teksRekap memuat Jul & Agu', teksR.includes('Jul 2026') && teksR.includes('Agu 2026'), teksR);
cek('teksRekap kosong', L.teksRekap([]) === 'Belum ada transaksi.', L.teksRekap([]));

console.log('\n' + (jumlah - gagal) + '/' + jumlah + ' PASS');
process.exit(gagal ? 1 : 0);
