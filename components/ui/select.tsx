import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { IconChevronDown as ChevronDown } from './icons';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  hint?: string;
  error?: string;
}

export function Select({ label, hint, error, className, children, ...props }: SelectProps) {
  const id = props.id ?? `select-${label?.replace(/\s+/g, '-').toLowerCase()}`;
  return (
    <div className="flex flex-col gap-1">
      {label && (
        <label htmlFor={id} className="font-body text-label-md font-semibold text-ink">
          {label}
        </label>
      )}
      <div className="relative">
        <select
          id={id}
          className={cn(
            'min-h-11 w-full appearance-none rounded-control border border-border-control bg-surface px-3 pr-8 font-body text-body-md text-ink transition-colors duration-[var(--motion-fast)] focus-ring',
            error && 'border-signal-terracotta',
            className,
          )}
          {...props}
        >
          {children}
        </select>
        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted-strong" />
      </div>
      {error ? (
        <p className="font-body text-body-sm text-error-text">{error}</p>
      ) : hint ? (
        <p className="font-body text-body-sm text-ink-muted-strong">{hint}</p>
      ) : null}
    </div>
  );
}
