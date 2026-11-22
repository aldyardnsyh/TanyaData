'use client';

import { Icon } from '@/components/ui/icons';

/**
 * Pagination brand TanyaData untuk daftar yang tumbuh (sumber data, laporan).
 * Murni presentasi: page berbasis 1, total = jumlah item terfilter.
 * Tampil hanya bila item tidak muat dalam satu halaman.
 */
export function Pagination({
  page,
  pageSize,
  total,
  onPage,
  label = 'item',
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
  label?: string;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;

  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  // Nomor halaman: pertama, terakhir, sekitar halaman aktif; sisanya elipsis.
  const numbers: (number | '…')[] = [];
  const push = (n: number | '…') => {
    if (numbers[numbers.length - 1] !== n) numbers.push(n);
  };
  for (let n = 1; n <= pages; n += 1) {
    if (n === 1 || n === pages || Math.abs(n - page) <= 1) push(n);
    else if (numbers[numbers.length - 1] !== '…') push('…');
  }

  const buttonBase =
    'touch-44 inline-flex items-center justify-center rounded-control border px-s2 font-display text-label font-semibold focus-ring disabled:opacity-40';

  return (
    <nav aria-label={`Navigasi halaman ${label}`} className="flex flex-wrap items-center justify-between gap-s2 border-t border-[var(--border-hairline)] pt-s2">
      <span className="mono-meta">
        MENAMPILKAN {from}–{to} DARI {total} {label.toUpperCase()}
      </span>
      <div className="flex items-center gap-s1">
        <button
          type="button"
          onClick={() => onPage(page - 1)}
          disabled={page <= 1}
          aria-label="Halaman sebelumnya"
          className={`${buttonBase} border-[var(--border-hairline)] text-ink hover:border-forest`}
        >
          <Icon name="chevron_left" className="text-[16px]" />
        </button>
        {numbers.map((n, i) =>
          n === '…' ? (
            <span key={`ellipsis-${i}`} className="px-s1 font-body text-caption text-ink-72" aria-hidden="true">…</span>
          ) : (
            <button
              key={n}
              type="button"
              onClick={() => onPage(n)}
              aria-label={`Halaman ${n}`}
              aria-current={n === page ? 'page' : undefined}
              className={`${buttonBase} ${n === page ? 'border-forest bg-forest text-porcelain' : 'border-[var(--border-hairline)] text-ink hover:border-forest'} min-w-11`}
            >
              {n}
            </button>
          ),
        )}
        <button
          type="button"
          onClick={() => onPage(page + 1)}
          disabled={page >= pages}
          aria-label="Halaman berikutnya"
          className={`${buttonBase} border-[var(--border-hairline)] text-ink hover:border-forest`}
        >
          <Icon name="chevron_right" className="text-[16px]" />
        </button>
      </div>
    </nav>
  );
}
