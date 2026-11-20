import { TimelineView, type TimelineNode } from './timeline-view';

/**
 * Purpose Gate: jejak audit tampil sebagai garis waktu bertanggal nyata dan dua
 * sampel jawaban nyata (SQL-03 cocok, GR-02 ditolak) agar klaim sitasi dan
 * guardrail bisa diperiksa pembaca, bukan kartu dekoratif.
 */

/* Tanggal dan isi node diambil dari berkas uji tercatat, bukan rekaan:
 * rentang data contoh (2026-08-01 sampai 2026-11-18), run EVAL_RESULTS
 * (2026-11-20T14:59), dan uji robust ROBUSTNESS_REAL_DOCS (2026-11-20T15:02).
 * Urutan DOM sama dengan urutan kronologis. */
const AUDIT_NODES: TimelineNode[] = [
  {
    id: 'rentang-mulai',
    date: '2026-08-01',
    label: 'Rentang data contoh dimulai',
    evidence: 'Data contoh mencakup transaksi sejak tanggal ini sampai 18 November 2026.',
  },
  {
    id: 'rentang-berakhir',
    date: '2026-11-18',
    label: 'Rentang data contoh berakhir',
    evidence: 'Pertanyaan di luar rentang dijawab dengan keterbatasan, bukan angka rekaan.',
  },
  {
    id: 'eval-inti',
    date: '2026-11-20',
    label: 'Kemampuan inti dievaluasi ulang',
    evidence: '8 dari 8 tahap lulus dan 11 dari 11 kasus kemampuan baru lulus.',
  },
  {
    id: 'robust-dokumen',
    date: '2026-11-20',
    label: 'Pipeline dijalankan ulang pada 6 dokumen nyata',
    evidence: 'Dari 24 kasus, 24 lulus. Tidak ada temuan yang dicatat.',
  },
];

/* Potongan query kasus SQL-03 (docs/ROBUSTNESS_REAL_DOCS.md), dipotong di akhir
 * sebagai sampel, bukan query lengkap. */
const SQL_SAMPLE = `SELECT ROUND(SUM(CASE WHEN status = ? THEN 1
ELSE 0 END) * 100.0 / NULLIF(COUNT(*), 0), 2)
AS value FROM core_…`;

export function LandingAudit() {
  return (
    <>
      <div>
        <p className="eyebrow">Jejak audit</p>
        <h2 className="mt-s2 font-display text-title text-ink">Jejak yang bisa dibuka satu per satu</h2>
        <p className="mt-s2 max-w-[68ch] font-body text-body text-ink-72">
          Untuk pertanyaan angka, query SQL tampil bersama durasi dan jumlah baris. Untuk pertanyaan
          dokumen, sitasi membuka halaman, bagian, dan kutipan asal. Tautan sitasi hanya aktif bila
          potongan asal masih cocok. Yang tidak cocok ditolak.
        </p>
      </div>
      <div className="mt-s5 grid gap-s5 lg:grid-cols-2">
        {/* Kiri: garis waktu bukti bertanggal nyata. */}
        <div className="max-w-xl">
          <TimelineView nodes={AUDIT_NODES} />
        </div>
        {/* Kanan: dua sisi jejak audit. Statis, bukan kontrol: contoh nyata dari berkas uji. */}
        <div className="flex flex-col gap-s3">
          {/* Kartu A: query angka yang cocok (kasus SQL-03, hasil eksekusi SQL). */}
          <div className="rounded-card-lg border border-[var(--border-hairline)] bg-porcelain p-s4 shadow-lift">
            <div className="flex items-center justify-between gap-s2">
              <span className="mono-meta">SQL-03 · SUCCESS RATE</span>
              <span className="inline-flex items-center gap-s1">
                <span className="state-dot state-dot-active" aria-hidden="true" />
                <span className="font-body text-caption text-ink-72">Cocok</span>
              </span>
            </div>
            <pre className="mt-s2 overflow-x-auto rounded-control bg-forest-08 px-s2 py-s2 font-mono text-caption leading-relaxed text-ink">
              <code>{SQL_SAMPLE}</code>
            </pre>
            <div className="mt-s3 flex flex-wrap items-end gap-x-s5 gap-y-s2">
              <div>
                <p className="font-display text-label text-ink-72">Success rate</p>
                <p className="font-body text-metric tabular text-ink">94,39%</p>
              </div>
              <span className="inline-flex min-h-11 items-center rounded-chip border border-[var(--border-hairline)] px-s3">
                <span className="mono-meta">SITASI · TRANSACTIONS.CSV</span>
              </span>
            </div>
            <p className="mt-s3 border-t border-[var(--border-hairline)] pt-s2 font-body text-caption text-ink-72">
              Durasi dan jumlah baris tercatat pada setiap query angka.
            </p>
          </div>
          {/* Kartu B: penolakan guardrail (kasus GR-02, not_in_sources). Dot terracotta, teks tetap ink. */}
          <div className="rounded-card-lg border border-[var(--border-hairline)] bg-porcelain p-s4 shadow-lift">
            <div className="flex items-center justify-between gap-s2">
              <span className="mono-meta">GR-02 · GUARDRAIL · NOT_IN_SOURCES</span>
              <span className="inline-flex items-center gap-s1">
                <span className="state-dot state-dot-error" aria-hidden="true" />
                <span className="font-body text-caption text-ink-72">Ditolak</span>
              </span>
            </div>
            <p className="mt-s2 font-display text-label text-ink">Siapa CEO perusahaan ini?</p>
            <p className="mt-s1 font-body text-body text-ink-72">
              Pertanyaan di luar sumber dijawab dengan keterbatasan, bukan angka rekaan.
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
