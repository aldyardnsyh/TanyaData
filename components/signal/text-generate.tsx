'use client';

import { useEffect, useState } from 'react';
import type { ComponentState, StateCopy } from '@/lib/ui/component-state';
import { DEFAULT_STATE_COPY } from '@/lib/ui/component-state';
import { motionTokens, shouldAnimate } from '@/lib/motion-tokens';

/**
 * C-08 Answer Reveal (dari Text Generate Effect + Typewriter).
 * Purpose Gate: menandakan jawaban baru dibuat. Efek mengetik per karakter
 * ditolak karena menyerupai AI generik dan mengubah cara membaca bukti.
 * Motion: 120ms per frasa, maksimal 8 frasa; sisanya tampil sekaligus (M6).
 */
export interface TextGenerateProps extends StateCopy {
  text: string;
  state?: ComponentState;
  className?: string;
}

const MAX_PHRASES = 8;

export function TextGenerate({
  text,
  state = 'default',
  emptyTitle = 'Informasi ini tidak ditemukan pada sumber.',
  emptyAction,
  errorTitle = 'Jawaban gagal dibuat.',
  onRetry,
  className = '',
}: TextGenerateProps) {
  const phrases = text.split(/(?<=[.!?])\s+/).filter(Boolean);
  const [visible, setVisible] = useState(() => (shouldAnimate() ? 0 : phrases.length));

  useEffect(() => {
    if (state !== 'default' && state !== 'success') return;
    if (!shouldAnimate()) {
      setVisible(phrases.length);
      return;
    }
    setVisible(0);
    let index = 0;
    const step = () => {
      index += 1;
      setVisible(Math.min(index, MAX_PHRASES));
      if (index < Math.min(phrases.length, MAX_PHRASES)) {
        timer = window.setTimeout(step, motionTokens.duration.fast * 1000);
      }
    };
    const timer = window.setTimeout(step, motionTokens.duration.fast * 1000);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, state]);

  if (state === 'loading') {
    return (
      <span className={`inline-flex items-center gap-s1 ${className}`} role="status" aria-label="Jawaban sedang dibuat">
        {[0, 1, 2].map((i) => (
          <span key={i} className="animate-typing-dot state-dot" aria-hidden="true" />
        ))}
      </span>
    );
  }

  if (state === 'empty') {
    return (
      <div className={`flex flex-col items-start gap-s2 ${className}`}>
        <p className="font-body text-body text-ink">{emptyTitle}</p>
        {emptyAction && (
          <button type="button" onClick={emptyAction.onClick} className="touch-44 rounded-control border border-forest px-s3 font-display text-label font-semibold text-forest focus-ring">
            {emptyAction.label}
          </button>
        )}
      </div>
    );
  }

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

  // hover/focus/active: teks statis, tanpa efek tambahan (n/a beralasan).
  const shown = phrases.slice(0, visible).join(' ');
  const rest = phrases.slice(visible).join(' ');

  return (
    <p className={`max-w-[68ch] font-body text-body leading-relaxed text-ink ${className}`} data-state={state}>
      {shown}
      {rest && <span className="sr-only">{rest}</span>}
      {visible < phrases.length && <span aria-hidden="true"> </span>}
    </p>
  );
}
