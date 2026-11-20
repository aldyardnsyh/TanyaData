import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { MonoMeta } from './mono-meta';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export interface CardProps {
  title?: string;
  subtitle?: string;
  meta?: string;
  rule?: boolean;
  headerAction?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

/** Satu kartu = satu latar (L-02). Flat + hairline, tanpa shadow dekoratif. */
export function Card({ title, subtitle, meta, rule = true, headerAction, footer, children, className }: CardProps) {
  return (
    <section className={cn('rounded-card border border-border-hairline bg-surface', className)}>
      {(title || meta || headerAction) && (
        <header className={cn('px-5 py-4', rule && 'measurement-rule')}>
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              {title && <h3 className="font-body text-headline-sm text-ink">{title}</h3>}
              {subtitle && <p className="mt-1 font-body text-body-sm text-ink-muted-strong">{subtitle}</p>}
            </div>
            <div className="flex shrink-0 items-center gap-3">
              {meta && <MonoMeta>{meta}</MonoMeta>}
              {headerAction}
            </div>
          </div>
        </header>
      )}
      <div className="p-5">{children}</div>
      {footer && <footer className="border-t border-border-hairline px-5 py-3">{footer}</footer>}
    </section>
  );
}
