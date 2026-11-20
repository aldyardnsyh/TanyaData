import { IconTooltip } from '@/components/ui/icon-tooltip';

/**
 * Purpose Gate: section bukti kompak berupa satu banner angka utama dan strip
 * stat berpemisah garis tabel, menggantikan narasi storytelling panjang agar
 * angka bukti terbaca sekali lintas.
 * Sumber angka: docs/ROBUSTNESS_REAL_DOCS.md (uji robust 20 November 2026,
 * 24/24 kasus lulus, 6/6 dokumen nyata di-ingest, 0 temuan) dan
 * docs/EVAL_RESULTS.md (8/8 tahap evaluasi kemampuan inti, 11/11 kasus
 * FR-A sampai FR-E pada evaluasi CORE V2).
 */

const EVIDENCE_STATS = [
  {
    value: '6/6',
    label: 'Dokumen terbaca',
    tooltip: 'Sumber: docs/ROBUSTNESS_REAL_DOCS.md. Enam dokumen nyata di-ingest.',
  },
  {
    value: '8/8',
    label: 'Tahap evaluasi lulus',
    tooltip: 'Sumber: docs/EVAL_RESULTS.md. Delapan tahap evaluasi kemampuan inti.',
  },
  {
    value: '11/11',
    label: 'Kasus FR-A sampai FR-E',
    tooltip: 'Sumber: docs/EVAL_RESULTS.md. Sebelas kasus kemampuan CORE V2.',
  },
  {
    value: '0',
    label: 'Temuan tercatat',
    tooltip: 'Sumber: docs/ROBUSTNESS_REAL_DOCS.md. Tidak ada temuan pada run.',
  },
] as const;

export function LandingEvidenceBand() {
  return (
    <>
      <div className="flex flex-col gap-s2">
        <p className="eyebrow">Bukti uji</p>
        <h2 className="font-display text-title text-ink">Yang sudah diuji, bukan yang dijanjikan</h2>
        <p className="max-w-[68ch] font-body text-body text-ink-72">
          Uji robust 20 November 2026 pada 6 dokumen nyata dan data transaksi: 24 kasus lulus,
          tidak ada temuan. Angka dari eksekusi, bukan narasi.
        </p>
      </div>

      <div className="mt-s5 relative overflow-hidden rounded-card-lg border border-hairline-dark bg-forest p-s5 text-porcelain">
        <div aria-hidden="true" className="bg-grid-dark mask-grid-fade absolute inset-0" />
        <div aria-hidden="true" className="glow-radial-lime absolute -right-24 -top-28 h-[320px] w-[440px]" />
        <div className="relative flex flex-wrap items-center justify-between gap-s3">
          <div>
            <p className="font-display text-label font-semibold text-porcelain">
              Kasus uji produksi lulus
            </p>
            <p className="text-stat-lg mt-s1 text-lime text-glow-lime">24/24</p>
          </div>
          <IconTooltip label="Sumber: docs/ROBUSTNESS_REAL_DOCS.md. Uji robust 20 November 2026: 24 kasus, 24 lulus.">
            <span className="inline-flex min-h-11 items-center font-mono text-[11px] uppercase tracking-[0.06em] text-dark-muted">
              docs/ROBUSTNESS_REAL_DOCS.md
            </span>
          </IconTooltip>
        </div>
      </div>

      <div className="mt-s3 grid grid-cols-2 gap-px overflow-hidden rounded-card-lg border border-[var(--border-hairline)] bg-[var(--border-hairline)] md:grid-cols-4">
        {EVIDENCE_STATS.map((stat) => (
          <div key={stat.label} className="bg-porcelain p-s4">
            <p className="font-body text-metric tabular text-ink">{stat.value}</p>
            <div className="mt-s1">
              <IconTooltip label={stat.tooltip}>
                <span className="font-body text-caption text-ink-72">{stat.label}</span>
              </IconTooltip>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
