import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { IconLoader } from './icons';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'icon';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-on-primary',
  secondary: 'bg-surface-container-lowest text-on-surface border border-outline-variant',
  ghost: 'bg-transparent text-on-surface-variant',
  danger: 'bg-error text-on-primary',
  icon: 'bg-transparent text-on-surface-variant',
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'h-7 px-2.5 text-label-md',
  md: 'h-9 px-3.5 text-label-md',
  lg: 'h-11 px-5 text-label-md',
};

export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  disabled,
  className,
  children,
  ref,
  ...props
}: ButtonProps & { ref?: React.Ref<HTMLButtonElement> }) {
  return (
    <button
      type="button"
      ref={ref}
      disabled={disabled || loading}
      aria-busy={loading}
      className={cn(
        // Purpose Gate: tekan 1px ke bawah 120ms memberi umpan balik tanpa menggeser layout (§4.1).
        'inline-flex items-center justify-center gap-2 rounded-md font-body font-medium transition-[transform,background-color,border-color,color] duration-[var(--motion-fast)] active:translate-y-px',
        variantClasses[variant],
        sizeClasses[size],
        variant === 'icon' && 'w-9 h-9 px-0',
        'focus-ring',
        disabled && 'opacity-45 cursor-not-allowed',
        className,
      )}
      {...props}
    >
      {loading ? <IconLoader className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
      {children}
    </button>
  );
}
