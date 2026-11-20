import { MonoMeta } from '@/components/ui/mono-meta';

/**
 * Pembungkus section halaman share. Measurement rule tiga tick hadir di
 * setiap header section (SHARE_PAGE_SPEC §2), urutan DOM tetap di semua breakpoint.
 */
export function ShareSection({
  id,
  label,
  children,
  className = '',
}: {
  id?: string;
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section id={id} className={`min-w-0 ${className}`}>
      <header className="mb-4">
        <div className="measurement-rule-share w-full" aria-hidden="true" />
        <div className="mt-2">
          <MonoMeta>{label}</MonoMeta>
        </div>
      </header>
      {children}
    </section>
  );
}
