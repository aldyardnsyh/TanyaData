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
        <label htmlFor={id} className="font-body text-label-md text-on-surface font-medium">
          {label}
        </label>
      )}
      <div className="relative">
        <select
          id={id}
          className={cn(
            'h-9 w-full appearance-none rounded-md border border-outline-variant bg-surface-container-lowest px-3 pr-8 text-on-surface font-body text-body-md transition-colors duration-[var(--motion-fast)] focus:border-primary focus:shadow-[var(--focus-ring)] focus:outline-none',
            error && 'border-error',
            className,
          )}
          {...props}
        >
          {children}
        </select>
        <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-on-surface-variant" />
      </div>
      {error ? (
        <p className="font-body text-body-sm text-error">{error}</p>
      ) : hint ? (
        <p className="font-body text-body-sm text-on-surface-variant">{hint}</p>
      ) : null}
    </div>
  );
}
