/** Dot status 6px. Label teks selalu menyertai dot (UI_REFACTOR_DESIGN §3.2 / C-01). */
export type DotTone = 'active' | 'error' | 'neutral' | 'loading';

const TONE_CLASS: Record<DotTone, string> = {
  active: 'state-dot-active',
  error: 'state-dot-error',
  neutral: '',
  loading: 'state-dot-empty',
};

export function StatusDot({ tone = 'neutral', className = '' }: { tone?: DotTone; className?: string }) {
  return <span className={`state-dot ${TONE_CLASS[tone]} ${className}`} aria-hidden="true" />;
}
