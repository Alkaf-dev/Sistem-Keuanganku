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

// ---------- cariToko: merek berjarak & konteks aplikasi ----------
cek('cariToko huruf berjarak (logo OCR)', P.cariToko(['A L FA MART', 'Jl. Sudirman No.1'], '') === 'Alfamart',
  P.cariToko(['A L FA MART', 'Jl. Sudirman No.1'], ''));
cek('cariToko alfagift -> Alfamart', P.cariToko(['ALFAGIFT - Pesanan #123', 'Jakarta'], '') === 'Alfamart',
  P.cariToko(['ALFAGIFT - Pesanan #123', 'Jakarta'], ''));

// Struk pengiriman online TANPA kata merek (hanya logo): toko tidak boleh baris kirim.
const STRUK_KIRIM = [
  'Pesanan #AGF-20260823-00123',
  'Delivered at Blok C No 8 ISouthlake Resi, Rumpin',
  '',
  'Susu UHT 1L                    18.500',
  'Roti Tawar                     14.000',
  'Telur Ayam 1kg                 28.000',
  'Total                          60.500',
  'Metode Pembayaran : QRIS'
].join('\n');
const hk = P.parseStrukText(STRUK_KIRIM);
cek('struk kirim: total 60500', hk && hk.total === 60500, hk && JSON.stringify(hk));
cek('struk kirim: toko bukan baris kirim', hk && !/delivered|blok|resi/i.test(hk.toko), hk && hk.toko);
cek('struk kirim: item bebas baris kirim', hk && !/delivered|blok|resi/i.test(hk.item), hk && hk.item);
cek('struk kirim: item memuat susu & roti', hk && /susu/i.test(hk.item) && /roti/i.test(hk.item), hk && hk.item);

// ---------- parsePerintahBayar ----------
const b1 = P.parsePerintahBayar(['75000', 'alfamart', 'belanja', 'mingguan']);
cek('bayar toko+ket', b1 && b1.nominal === 75000 && b1.toko === 'Alfamart' && b1.item === 'belanja mingguan', JSON.stringify(b1));
const b2 = P.parsePerintahBayar(['120.000', 'Indomaret']);
cek('bayar titik ribuan + kapital', b2 && b2.nominal === 120000 && b2.toko === 'Indomaret' && b2.item === 'Pengeluaran manual', JSON.stringify(b2));
const b3 = P.parsePerintahBayar(['5000']);
cek('bayar tanpa toko', b3 && b3.nominal === 5000 && b3.toko === '' && b3.item === 'Pengeluaran manual', JSON.stringify(b3));
const b4 = P.parsePerintahBayar(['abc']);
cek('bayar nominal rusak -> null', b4 === null, JSON.stringify(b4));
const b5 = P.parsePerintahBayar(['25000', 'kopi', 'sachet']);
cek('bayar ket di posisi toko tetap ket', b5 && b5.toko === '' && b5.item === 'kopi sachet', JSON.stringify(b5));

// ---------- filter alamat: toko tak boleh potongan alamat ----------
const BARIS_ALAMATNYA = [
  'po',
  'Delivered at : Alkaf',
  'CIVErea 3 Blok C No 8 (Southlake Residence No.C5/11',
  'Rumpin, Kabupaten Bogor, Jawa Barat 16350, Indonesia',
  'Maks Kirim : Minggu, 23 Agustus 2026',
  'Status Order : Selesai',
  'CICANGKAL RUMPIN',
  '081294654121'
];
const tokoA = P.cariToko(BARIS_ALAMATNYA, '');
cek('cariToko layar kirim -> Tidak dikenal', tokoA === 'Tidak dikenal', tokoA);

// ---------- angkaTrx: normalisasi & penolakan nominal rusak ----------
const S = require('./sheets');
cek('angkaTrx dari field total', (() => { try { return S.angkaTrx({ total: 34592 }) === 34592; } catch (e) { return false; } })(), '');
cek('angkaTrx dari field nominal', (() => { try { return S.angkaTrx({ nominal: 75000 }) === 75000; } catch (e) { return false; } })(), '');
cek('angkaTrx terima angka polos ber-string', (() => { try { return S.angkaTrx({ nominal: '34592' }) === 34592; } catch (e) { return false; } })(), '');
cek('angkaTrx tolak format locale ambigu', (() => { let ok = false; try { S.angkaTrx({ nominal: 'Rp75.000' }); } catch (e) { ok = true; } return ok; })(), '');
cek('angkaTrx tolak kosong', (() => { let ok = false; try { S.angkaTrx({ nominal: '' }); } catch (e) { ok = true; } return ok; })(), '');
cek('angkaTrx tolak nol/negatif', (() => { let ok = false; try { S.angkaTrx({ total: 0 }); } catch (e) { ok = true; } return ok; })(), '');

// ---------- struk alfagift ASLI (hasil OCR psm6 dari screenshot pengguna) ----------
const STRUK_ALFAGIFT_ASLI = [
  'po',
  '——"',
  'Delivered at :                                                                                                   Alkaf',
  'CIVErea 3                        Blok C No 8 (Southlake Residence No.C5/11, Mekar Sari, Kec.',
  'Rumpin, Kabupaten Bogor, Jawa Barat 16350, Indonesial',
  'Maks Kirim :                                                                   Minggu, 23 Agustus 2026',
  '07:00 - 22:00',
  'Status Order :                                                                                         Selesai',
  'CICANGKAL RUMPIN',
  '081294654121',
  'SUKAMULYA, RUMPIN',
  'Lenanananananananun.. SE SURADITANO. 6ORT OO2RW',
  'Ref. $-260823-AGXBFHL',
  'SGM Eksplor 1t IronC Susu',
  'Bubuk Pertumbuhan Anak Madu                                               1           16,600           16,600',
  '150 g',
  'Disc. -1,100',
  '7 omie Mi Instan Soto Mie 70                                         9          3.200          6,400',
  'Disc. -200',
  'Sedaap Mi Instan Goreng',
  'Selection Korean Ayam Pedas 87                                      1           3,200           3,200',
  'g',
  'Disc. -100',
  '5Days Roti Croissant Isi Fla',
  'Cokelat Pisang 60 g                                                      1           71,300          7,300',
  'Disc. -1,000',
  'MyRoti Roti Sandwich Cokelat                                          1           4,500           4,500',
  '46 g',
  'Subtotal                                                                          6                            38,000',
  'Total Diskon                                                                                        -2,400',
  'A-Poin                                                                                                           -1,008',
  'Biaya Pengiriman                                                                                             0',
  'Total                                                                                                            34,592',
  '“Harga yang tertera sudah termasuk PPN',
  'Tgl. 08-23-2026 17:41:04',
  'Kritik & Saran: 1500959',
  'Email: alfacare@sat.co.id'
].join('\n');
const ha = P.parseStrukText(STRUK_ALFAGIFT_ASLI);
cek('alfagift asli: toko Alfamart via alfacare/A-Poin', ha && ha.toko === 'Alfamart', ha && ha.toko);
cek('alfagift asli: total 34592', ha && ha.total === 34592, ha && ha.total);
cek('alfagift asli: tanggal 2026-08-23 + jam', ha && ha.tanggal === '2026-08-23' && ha.jam === '17:41', ha && (ha.tanggal + ' ' + ha.jam));
cek('alfagift asli: item memuat produk nyata', ha && /sedaap|sgm|roti/i.test(ha.item), ha && ha.item);
cek('alfagift asli: item bebas sampah alamat', ha && !/suraditano|cicangkal|sukamulya/i.test(ha.item), ha && ha.item);

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
