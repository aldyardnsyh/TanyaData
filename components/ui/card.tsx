import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export interface CardProps {
  title?: string;
  subtitle?: string;
  headerAction?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

export function Card({ title, subtitle, headerAction, footer, children, className }: CardProps) {
  return (
    <div className={cn('rounded-lg bg-surface-container-lowest border border-outline-variant p-5', className)}>
      {title && (
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h3 className="font-display text-headline-sm font-semibold text-on-surface">{title}</h3>
            {subtitle && <p className="font-body text-body-sm text-on-surface-variant mt-0.5">{subtitle}</p>}
          </div>
          {headerAction}
        </div>
      )}
      {children}
      {footer && <div className="mt-4 border-t border-outline-variant pt-4">{footer}</div>}
    </div>
  );
}
