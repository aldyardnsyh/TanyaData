'use client';

import type { ComponentState, StateCopy } from '@/lib/ui/component-state';
import { DEFAULT_STATE_COPY } from '@/lib/ui/component-state';

/**
 * C-03b Moving Border Button — variasi sekunder dari Attention Border.
 * Purpose Gate: sweep mengelilingi border menandakan satu aksi primer. Dipakai
 * hanya bila tombol tersebut benar-benar aksi utama; jangan dipasang berjamaah.
 * Motion: sweep 240ms linear, dihentikan saat tab tersembunyi (M4).
 */
export interface MovingBorderButtonProps extends StateCopy {
  children: React.ReactNode;
  state?: ComponentState;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
}

export function MovingBorderButton({
  children,
  state = 'default',
  onClick,
  disabled = false,
  loadingLabel = DEFAULT_STATE_COPY.loadingLabel,
  errorTitle = DEFAULT_STATE_COPY.errorTitle,
  onRetry,
  className = '',
}: MovingBorderButtonProps) {
  if (state === 'empty') return null; // n/a: tombol selalu punya target.

  if (state === 'error') {
    return (
      <div className={`flex flex-col items-start gap-s2 ${className}`} role="alert">
        <span className="inline-flex items-center gap-s2">
          <span className="state-dot state-dot-error" aria-hidden="true" />
          <span className="font-body text-body text-ink">{errorTitle}</span>
        </span>
        {onRetry && (
          <button type="button" onClick={onRetry} className="touch-44 rounded-control border border-forest px-s3 font-display text-label font-semibold text-forest focus-ring">
            Coba lagi
          </button>
        )}
      </div>
    );
  }

  const loading = state === 'loading';

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      data-state={state}
      className={`attention-border touch-44 inline-flex items-center justify-center gap-s2 bg-porcelain px-s4 font-display text-label font-semibold text-forest transition-colors duration-[var(--motion-fast)] hover:bg-forest-08 disabled:opacity-60 focus-ring ${className}`}
    >
      {loading && <span className="skeleton h-s2 w-s2" aria-hidden="true" />}
      <span>{loading ? loadingLabel : children}</span>
    </button>
  );
}
