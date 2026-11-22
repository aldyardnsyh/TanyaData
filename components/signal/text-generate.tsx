'use client';

import { useEffect, useState } from 'react';
import type { ComponentState, StateCopy } from '@/lib/ui/component-state';
import { DEFAULT_STATE_COPY } from '@/lib/ui/component-state';
import { motionTokens, shouldAnimate } from '@/lib/motion-tokens';
import type { SourceCitation } from '@/lib/contracts/http';
import { InlineCitationMark } from '@/components/signal/citation-marks';

/**
 * C-08 Answer Reveal (dari Text Generate Effect + Typewriter).
 * Purpose Gate: menandakan jawaban baru dibuat. Efek mengetik per karakter
 * ditolak karena menyerupai AI generik dan mengubah cara membaca bukti.
 * Motion: 120ms per frasa, maksimal 8 frasa; sisanya tampil sekaligus (M6).
 * Token sitasi inline [n] dalam teks dirender sebagai InlineCitationMark
 * (hover = kaca pembesar kutipan, klik = buka sumber).
 */
export interface TextGenerateProps extends StateCopy {
  text: string;
  state?: ComponentState;
  className?: string;
  /** Sitasi [S1]..[Sn] untuk marker inline [n] dalam teks jawaban. */
  citations?: SourceCitation[];
  onOpenCitation?: (citation: SourceCitation) => void;
}

const MAX_PHRASES = 8;
const CITE_TOKEN_RE = /\[(\d+)\]/g;

/** Render teks sebaris: **bold** + marker sitasi inline [n]. */
function InlineText({
  text,
  citations,
  onOpenCitation,
}: {
  text: string;
  citations?: SourceCitation[];
  onOpenCitation?: (citation: SourceCitation) => void;
}) {
  // Pecah dulu per segmen bold, lalu marker sitasi dalam tiap segmen.
  const segments = text.split(/\*\*(.+?)\*\*/g);
  return (
    <>
      {segments.map((seg, i) =>
        i % 2 === 1 ? (
          <strong key={i} className="font-semibold text-ink">
            <PhraseWithCitations phrase={seg} citations={citations} onOpenCitation={onOpenCitation} />
          </strong>
        ) : (
          <PhraseWithCitations key={i} phrase={seg} citations={citations} onOpenCitation={onOpenCitation} />
        ),
      )}
    </>
  );
}

function PhraseWithCitations({
  phrase,
  citations,
  onOpenCitation,
}: {
  phrase: string;
  citations?: SourceCitation[];
  onOpenCitation?: (citation: SourceCitation) => void;
}) {
  if (!citations?.length || !/\[\d+\]/.test(phrase)) return <>{phrase}</>;
  const nodes: React.ReactNode[] = [];
  let last = 0;
  for (const match of phrase.matchAll(CITE_TOKEN_RE)) {
    const start = match.index ?? 0;
    if (start > last) nodes.push(phrase.slice(last, start));
    const n = Number(match[1]);
    const citation = citations[n - 1];
    if (citation) {
      nodes.push(
        <InlineCitationMark key={`${start}-${n}`} index={n - 1} citation={citation} onOpen={onOpenCitation} />,
      );
    } else {
      nodes.push(match[0]);
    }
    last = start + match[0].length;
  }
  if (last < phrase.length) nodes.push(phrase.slice(last));
  return <>{nodes}</>;
}

/** Blok jawaban: paragraf, bullet (- ), atau bernomor (1. ). */
type AnswerBlock = { kind: 'p' | 'ul' | 'ol'; lines: string[] };

function parseBlocks(text: string): AnswerBlock[] {
  const blocks: AnswerBlock[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('- ')) {
      const last = blocks[blocks.length - 1];
      if (last?.kind === 'ul') last.lines.push(line.slice(2));
      else blocks.push({ kind: 'ul', lines: [line.slice(2)] });
    } else if (/^\d+\.\s/.test(line)) {
      const last = blocks[blocks.length - 1];
      if (last?.kind === 'ol') last.lines.push(line.replace(/^\d+\.\s/, ''));
      else blocks.push({ kind: 'ol', lines: [line.replace(/^\d+\.\s/, '')] });
    } else {
      blocks.push({ kind: 'p', lines: [line] });
    }
  }
  return blocks;
}

export function TextGenerate({
  text,
  state = 'default',
  emptyTitle = 'Informasi ini tidak ditemukan pada sumber.',
  emptyAction,
  errorTitle = 'Jawaban gagal dibuat.',
  onRetry,
  citations,
  onOpenCitation,
  className = '',
}: TextGenerateProps) {
  // Jawaban terstruktur: blok paragraf/bullet/nomor (parse dari \n), bukan
  // satu paragraf panjang. Animasi reveal per blok (maks 8 blok, M6).
  const blocks = parseBlocks(text);
  const [visible, setVisible] = useState(() => (shouldAnimate() ? 0 : blocks.length));

  useEffect(() => {
    if (state !== 'default' && state !== 'success') return;
    if (!shouldAnimate()) {
      setVisible(blocks.length);
      return;
    }
    setVisible(0);
    let index = 0;
    let timer = 0;
    const step = () => {
      index += 1;
      setVisible(Math.min(index, MAX_PHRASES));
      if (index < Math.min(blocks.length, MAX_PHRASES)) {
        timer = window.setTimeout(step, motionTokens.duration.fast * 1000);
      }
    };
    timer = window.setTimeout(step, motionTokens.duration.fast * 1000);
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
  const shown = blocks.slice(0, visible);
  const rest = blocks.slice(visible);

  return (
    <div className={`flex max-w-[68ch] flex-col gap-s2 font-body text-body leading-relaxed text-ink ${className}`} data-state={state}>
      {shown.map((block, i) => {
        if (block.kind === 'ul') {
          return (
            <ul key={i} className="flex list-disc flex-col gap-s1 pl-s4">
              {block.lines.map((line, j) => (
                <li key={j}><InlineText text={line} citations={citations} onOpenCitation={onOpenCitation} /></li>
              ))}
            </ul>
          );
        }
        if (block.kind === 'ol') {
          return (
            <ol key={i} className="flex list-decimal flex-col gap-s1 pl-s4">
              {block.lines.map((line, j) => (
                <li key={j}><InlineText text={line} citations={citations} onOpenCitation={onOpenCitation} /></li>
              ))}
            </ol>
          );
        }
        return (
          <p key={i}>
            <InlineText text={block.lines[0]} citations={citations} onOpenCitation={onOpenCitation} />
          </p>
        );
      })}
      {rest.length > 0 && <span className="sr-only">{rest.map((b) => b.lines.join(' ')).join(' ')}</span>}
      {visible < blocks.length && <span aria-hidden="true"> </span>}
    </div>
  );
}
