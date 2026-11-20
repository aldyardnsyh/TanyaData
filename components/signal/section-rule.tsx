/**
 * Measurement rule (garis 1px + tiga tick 1x4px, tick tengah forest).
 * Purpose Gate: memisahkan section secara struktural, bukan dekorasi.
 * Dipakai share (6 section) dan modul kerja dengan RHYTHM 2.
 */
export function SectionRule({ className = '' }: { className?: string }) {
  return (
    <div className={`flex items-center gap-s1 border-b border-[var(--border-hairline)] ${className}`} aria-hidden="true">
      <span className="block h-s1 w-px bg-muted" />
      <span className="block h-s1 w-px bg-forest" />
      <span className="block h-s1 w-px bg-muted" />
    </div>
  );
}
