import type { DotTone } from './status-dot';
import { StatusDot } from './status-dot';

/**
 * Status badge fungsional: dot + teks. Teks memakai ink, bukan terracotta
 * (UI_REFACTOR_DESIGN §2: terracotta dilarang sebagai teks).
 * Purpose Gate: menyatakan status nyata dari sumber/proses, bukan badge hiasan.
 */
export function StatusBadge({
  label,
  tone = 'neutral',
  className = '',
}: {
  label: string;
  tone?: DotTone;
  className?: string;
}) {
  return (
    <span className={`inline-flex min-h-11 items-center gap-s2 rounded-control border border-[var(--border-hairline)] px-s2 ${className}`}>
      <StatusDot tone={tone} />
      <span className="font-body text-caption text-ink">{label}</span>
    </span>
  );
}
