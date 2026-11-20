# FAQ Customer Support - Transaksi Gagal

_Dokumen internal Customer Support | Versi 1.4 | Diperbarui: 1 Oktober 2026_

## 1. Saldo saya terpotong tetapi transaksi gagal. Apa yang harus saya lakukan?
Tunggu hingga 30 menit karena sistem melakukan pengecekan status otomatis setiap 5 menit. Jika status akhir transaksi FAILED dan dana terdebet, dana akan dikembalikan otomatis. Estimasi pengembalian: Virtual Account 3 hari kerja, e-wallet maksimal 2 x 24 jam, QRIS 2 hari kerja, kartu kredit 7 sampai 14 hari kerja. Jika dana belum kembali setelah SLA terlewati, hubungi Customer Support dengan menyertakan nomor transaksi (format `TRXyyyymmddnnnnn`).

## 2. Apa arti status transaksi?
- **SUCCESS**: pembayaran berhasil.
- **FAILED**: pembayaran gagal; penyebabnya ditunjukkan oleh kode kegagalan.
- **PENDING**: menunggu konfirmasi dari bank/penyedia.
- **EXPIRED**: batas waktu pembayaran terlewati (bukan kegagalan sistem).
- **REFUNDED**: dana sudah dikembalikan.

## 3. Mengapa pembayaran saya gagal dengan pesan "saldo tidak mencukupi" (F01)?
Saldo rekening atau dompet digital tidak cukup untuk nominal ditambah biaya layanan. Lakukan top-up atau pilih kanal pembayaran lain.

## 4. OTP saya ditolak (F02). Bagaimana solusinya?
OTP berlaku 5 menit. Minta kirim ulang OTP (maksimal 3 kali). Setelah 3 kali salah, akun dikunci 30 menit demi keamanan.

## 5. Kartu kredit saya ditolak (F03).
Penolakan dilakukan oleh bank penerbit kartu. Hubungi bank penerbit untuk memastikan limit, status kartu, dan pengaturan transaksi online, atau gunakan kanal lain.

## 6. Pembayaran Virtual Account Mandiri sering timeout. Apakah ini gangguan?
Sejak pertengahan Oktober 2026 terdapat gangguan pada VA Mandiri yang sedang ditangani (lihat INC-2026-1015). Sementara waktu pelanggan disarankan memakai VA BCA, VA BNI, VA BRI, atau e-wallet. Jika dana sudah terdebet, tim akan melakukan rekonsiliasi dan refund sesuai SLA.

## 7. Top-up lewat OVO gagal dengan "Gateway Error". Apakah ini gangguan?
Sejak 6 November 2026 terdapat kendala pada transaksi OVO terutama kategori top-up (lihat INC-2026-1106). Perbaikan (hotfix) dijadwalkan pada 20 November 2026. Gunakan e-wallet lain sementara waktu.

## 8. Mengapa transaksi saya berstatus EXPIRED?
Nomor Virtual Account berlaku 24 jam secara default (dapat dikonfigurasi 1 sampai 72 jam). QRIS dinamis berlaku 15 menit dan e-wallet 30 menit. Setelah lewat batas waktu, buat transaksi baru. Transaksi EXPIRED tidak memotong dana.

## 9. Apa itu limit transaksi (F06)?
Setiap kanal memiliki limit harian dan limit per transaksi. Jika nominal melebihi limit, pecah transaksi atau naikkan limit melalui bank/penyedia dompet digital.

## 10. Transaksi saya ditahan karena dicurigai fraud (F07).
Sistem risiko menahan transaksi yang tidak biasa (nominal tinggi, perangkat baru, atau pola berulang). Tim Risk akan meninjau secara manual dalam 2 jam kerja dan menghubungi Anda bila perlu verifikasi.

## 11. Transaksi saya tercatat dua kali (F09).
Hal ini dapat terjadi karena klik ganda atau percobaan ulang. Transaksi duplikat akan dibatalkan; jika dana terdebet ganda, kelebihan dana dikembalikan.

## 12. Kapan layanan dalam pemeliharaan (F12)?
Pemeliharaan terjadwal penyedia umumnya dilakukan dini hari sekitar pukul 01:00 sampai 04:00 WIB dan diumumkan lebih dulu melalui banner di halaman pembayaran.
