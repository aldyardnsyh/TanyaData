/**
 * Section 2 ringkasan eksekutif. Sumber teks: field `answer` jawaban utama.
 * Angka tidak disalin ke sini; dirender komponen hasil di section 4 (SHARE_PAGE_SPEC §2.2).
 */
export function ShareSummary({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <div className="rounded-card border border-border-hairline bg-surface p-4 sm:p-5">
      <p className="max-w-[72ch] font-body text-body-lg leading-relaxed text-ink">{text}</p>
    </div>
  );
}
