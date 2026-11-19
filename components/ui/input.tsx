import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { AlertTriangle } from 'lucide-react';

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
        <label htmlFor={id} className="font-body text-label-md text-on-surface font-medium">
          {label}
        </label>
      )}
      <input
        id={id}
        className={cn(
          'h-9 rounded-md border border-outline-variant bg-surface-container-lowest px-3 text-on-surface font-body text-body-md transition-colors duration-[var(--motion-fast)] focus:border-primary focus:shadow-[var(--focus-ring)] focus:outline-none',
          size === 'sm' && 'h-7 text-body-sm',
          error && 'border-error',
          className,
        )}
        {...props}
      />
      {error ? (
        <p className="flex items-center gap-1 font-body text-body-sm text-error">
          <AlertTriangle className="h-3 w-3" />
          {error}
        </p>
      ) : hint ? (
        <p className="font-body text-body-sm text-on-surface-variant">{hint}</p>
      ) : null}
    </div>
  );
}
