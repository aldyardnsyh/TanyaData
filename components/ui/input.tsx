import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { IconAlertTriangle as AlertTriangle } from './icons';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label?: string;
  hint?: string;
  error?: string;
  size?: 'sm' | 'md';
}

export function Input({ label, hint, error, size = 'md', className, ...props }: InputProps) {
  const id = props.id ?? `input-${label?.replace(/\s+/g, '-').toLowerCase()}`;
  return (
    <div className="flex flex-col gap-1">
      {label && (
        <label htmlFor={id} className="font-body text-label-md font-semibold text-ink">
          {label}
        </label>
      )}
      <input
        id={id}
        className={cn(
          'min-h-11 rounded-control border border-border-control bg-surface px-3 font-body text-body-md text-ink transition-colors duration-[var(--motion-fast)] placeholder:text-ink-muted-strong focus-ring',
          size === 'sm' && 'text-body-sm',
          error && 'border-signal-terracotta',
          className,
        )}
        {...props}
      />
      {error ? (
        <p className="flex items-center gap-1 font-body text-body-sm text-error-text">
          <AlertTriangle className="h-3 w-3" />
          {error}
        </p>
      ) : hint ? (
        <p className="font-body text-body-sm text-ink-muted-strong">{hint}</p>
      ) : null}
    </div>
  );
}
