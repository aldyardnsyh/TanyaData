#!/usr/bin/env python3
"""Regenerate the three synthetic transfer PDFs deterministically.

Jalankan lewat wrapper global:
    python safe_exec.py --timeout 300 -- python tanyadata/eval/transfer_set/generate.py

Teks di bawah adalah sumber kebenaran untuk evidence_spans di file *_qa.json.
Jangan mengubah teks tanpa memperbarui QA yang bersangkutan.
"""
from __future__ import annotations

from pathlib import Path

HERE = Path(__file__).resolve().parent
FONT = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"


def build_pdf(path: Path, objects: dict[int, str | list[str]], root: int = 1) -> None:
    """objects: nomor -> string dictionary, atau list baris content stream."""
    buf = bytearray(b"%PDF-1.4\n")
    offsets: dict[int, int] = {}
    for num in sorted(objects):
        offsets[num] = len(buf)
        buf += f"{num} 0 obj\n".encode("latin-1")
        value = objects[num]
        if isinstance(value, list):
            data = ("\n".join(value) + "\n").encode("latin-1")
            buf += f"<< /Length {len(data)} >>\nstream\n".encode("latin-1")
            buf += data + b"endstream\n"
        else:
            buf += value.encode("latin-1") + b"\n"
        buf += b"endobj\n"
    xref = len(buf)
    size = max(objects) + 1
    buf += f"xref\n0 {size}\n".encode("latin-1")
    buf += b"0000000000 65535 f \n"
    for num in range(1, size):
        buf += f"{offsets[num]:010d} 00000 n \n".encode("latin-1")
    buf += (
        f"trailer\n<< /Size {size} /Root {root} 0 R >>\n"
        f"startxref\n{xref}\n%%EOF\n"
    ).encode("latin-1")
    path.write_bytes(buf)
    print(f"wrote {path.name} ({len(buf)} bytes)")


def page(parent: int, contents: int) -> str:
    return (
        f"<< /Type /Page /Parent {parent} 0 R /MediaBox [0 0 612 792] "
        f"/Resources << /Font << /F1 4 0 R >> >> /Contents {contents} 0 R >>"
    )


CUTI_LEFT = [
    "BT /F1 9 Tf 40 760 Td 13 TL",
    "(CUTI#1 Tujuan: Kebijakan ini mengatur pengajuan dan pencatatan cuti karyawan secara seragam.) Tj T*",
    "(Setiap cuti wajib memiliki nomor pengajuan dan tanggal pengajuan.) Tj T*",
    "(CUTI#2 Jenis Cuti: Cuti terdiri atas cuti tahunan, cuti sakit, cuti melahirkan, dan cuti kematian.) Tj T*",
    "(Cuti tahunan diberikan 12 hari kerja per tahun.) Tj T*",
    "(CUTI#3 Pengajuan: Cuti tahunan diajukan paling lambat 3 hari kerja sebelum tanggal mulai.) Tj T*",
    "(Cuti sakit dapat diajukan pada hari yang sama dengan keterangan dokter.) Tj T*",
    "(CUTI#4 Persetujuan: Atasan menyetujui atau menolak paling lambat 2 hari kerja.) Tj T*",
    "(Penolakan wajib disertai alasan tertulis.) Tj T*",
    "ET",
    "BT /F1 9 Tf 320 760 Td 13 TL",
    "(CUTI#5 Saldo: Saldo cuti tahunan tidak dapat dibawa lebih dari 6 hari ke tahun berikutnya.) Tj T*",
    "(Cuti sakit tidak mengurangi saldo cuti tahunan.) Tj T*",
    "(CUTI#6 Cuti Bersama: Ditetapkan perusahaan dan diumumkan paling lambat 30 hari sebelum pelaksanaan.) Tj T*",
    "(Cuti bersama tidak memotong saldo cuti tahunan.) Tj T*",
    "(CUTI#7 Pelaporan: Bagian SDM mencatat seluruh cuti dalam sistem kehadiran.) Tj T*",
    "(Laporan saldo cuti dibuat setiap awal bulan.) Tj T*",
    "(CUTI#8 Ketentuan Khusus: Karyawan dengan masa kerja kurang dari satu tahun belum memperoleh cuti tahunan.) Tj T*",
    "(Pengecualian diatur oleh kebijakan terpisah.) Tj T*",
    "ET",
]

TI_ROWS = [
    "BT /F1 8 Tf 40 760 Td 14 TL",
    "0.5 w 40 768 m 572 768 l S",
    "40 752 m 572 752 l S",
    "(Bagian | Ketentuan) Tj T*",
    "(TI#1 Ruang Lingkup | Berlaku untuk karyawan, kontraktor, dan mitra yang mengakses sistem perusahaan.) Tj T*",
    "(TI#2 Kata Sandi | Kata sandi minimal 12 karakter dengan huruf, angka, dan simbol; diganti tiap 90 hari.) Tj T*",
    "(TI#3 Autentikasi | Autentikasi dua faktor wajib untuk administrator dan akses jarak jauh; OTP tidak dibagikan.) Tj T*",
    "(TI#4 Klasifikasi Data | Data berkelas Publik, Internal, Rahasia, dan Sangat Rahasia; yang terakhir hanya untuk pihak ditunjuk.) Tj T*",
    "(TI#5 Perangkat | Perangkat pribadi dilarang mengakses data Rahasia; perangkat perusahaan wajib terenkripsi.) Tj T*",
    "(TI#6 Insiden Keamanan | Dugaan pelanggaran keamanan dilaporkan ke tim keamanan dalam 1 jam sejak diketahui.) Tj T*",
    "(TI#7 Pembaruan Sistem | Patch kritikal dipasang dalam 7 hari; patch non-kritikal dalam 30 hari sejak rilis.) Tj T*",
    "(TI#8 Penghentian Akses | Akses karyawan keluar dicabut paling lambat hari kerja terakhir; akun tidak dihapus sebelum audit.) Tj T*",
    "ET",
]

PD_PAGE1 = [
    "BT /F1 9 Tf 40 760 Td 14 TL",
    "(PENGADAAN BARANG - DOKUMEN INTERNAL) Tj T*",
    "(1. Tujuan: Prosedur pengadaan mengatur permintaan, persetujuan, pemesanan, dan penerimaan barang.) Tj T*",
    "(2. Permintaan: Unit peminta mengajukan formulir dengan spesifikasi, jumlah, dan perkiraan anggaran.) Tj T*",
    "(2.1. Persetujuan Anggaran: Permintaan di bawah 5 juta rupiah disetujui kepala unit.) Tj T*",
    "(Di atas itu disetujui direktur.) Tj T*",
    "(2.1.1. Verifikasi Spesifikasi: Tim pengadaan memeriksa spesifikasi agar tidak mengarah pada merek tertentu.) Tj T*",
    "(Halaman 1 dari 2) Tj T*",
    "ET",
]

PD_PAGE2 = [
    "BT /F1 9 Tf 40 760 Td 14 TL",
    "(PENGADAAN BARANG - DOKUMEN INTERNAL) Tj T*",
    "(3. Pemesanan: Pemesanan dilakukan kepada minimal tiga penyedia untuk nilai di atas 10 juta rupiah.) Tj T*",
    "(3.2.1. Evaluasi Penawaran: Penawaran dinilai dari harga, kesesuaian spesifikasi, dan waktu pengiriman.) Tj T*",
    "(4. Penerimaan: Barang diterima oleh unit peminta dengan berita acara yang ditandatangani dua pihak.) Tj T*",
    "(4.1. Pembayaran: Pembayaran diproses setelah berita acara dan faktur lengkap diverifikasi.) Tj T*",
    "(Halaman 2 dari 2) Tj T*",
    "ET",
]


def main() -> None:
    build_pdf(HERE / "kebijakan_cuti.pdf", {
        1: "<< /Type /Catalog /Pages 2 0 R >>",
        2: "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        3: page(2, 5),
        4: FONT,
        5: CUTI_LEFT,
    })
    build_pdf(HERE / "keamanan_ti.pdf", {
        1: "<< /Type /Catalog /Pages 2 0 R >>",
        2: "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        3: page(2, 5),
        4: FONT,
        5: TI_ROWS,
    })
    build_pdf(HERE / "pengadaan_barang.pdf", {
        1: "<< /Type /Catalog /Pages 2 0 R >>",
        2: "<< /Type /Pages /Kids [3 0 R 6 0 R] /Count 2 >>",
        3: page(2, 5),
        4: FONT,
        5: PD_PAGE1,
        6: page(2, 7),
        7: PD_PAGE2,
    })


if __name__ == "__main__":
    main()
