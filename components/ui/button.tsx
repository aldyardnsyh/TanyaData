'use client';

import { clsx, type ClassValue } from 'clsx';
import * as React from 'react';
import { twMerge } from 'tailwind-merge';
import { IconLoader } from './icons';
import { useRipple } from '@/lib/ui/ripple';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'icon';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  /** Render anak tunggal (mis. `<Link>`) dengan kelas tombol, bukan `<button>`. */
  asChild?: boolean;
}

/* S-05: semua tombol punya area sentuh ≥44px. Visual dibedakan oleh padding. */
const variantClasses: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-on-primary border border-primary hover:bg-forest-hover focus-ring-forest',
  secondary: 'bg-surface text-ink border border-border-control hover:border-primary focus-ring',
  ghost: 'bg-transparent text-ink-muted-strong border border-transparent hover:bg-row-hover hover:text-ink focus-ring',
  danger: 'bg-surface text-error-text border border-signal-terracotta hover:bg-row-hover focus-ring',
  icon: 'bg-transparent text-ink-muted-strong border border-transparent hover:bg-row-hover hover:text-ink focus-ring',
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'min-h-11 px-3 text-label-md',
  md: 'min-h-11 px-4 text-label-md',
  lg: 'min-h-11 px-6 text-label-md',
};

export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  disabled,
  className,
  children,
  onPointerDown,
  ref,
  asChild = false,
  ...props
}: ButtonProps & { ref?: React.Ref<HTMLButtonElement> }) {
  const ripple = useRipple<HTMLButtonElement>();

  const classes = cn(
    'motion-ripple-host inline-flex min-h-11 items-center justify-center gap-2 rounded-control px-4 font-body font-semibold transition-[background-color,border-color,color] duration-[var(--motion-fast)] active:translate-y-px motion-reduce:transform-none',
    variantClasses[variant],
    sizeClasses[size],
    variant === 'icon' && 'h-11 w-11 min-h-11 min-w-11 px-0',
    disabled && 'cursor-not-allowed opacity-45',
    className,
  );

  if (asChild) {
    const child = React.Children.only(children) as React.ReactElement<{
      className?: string;
      'aria-busy'?: boolean;
      'aria-disabled'?: boolean;
    }>;
    return React.cloneElement(child, {
      className: cn(classes, child.props.className),
      'aria-busy': loading || undefined,
      'aria-disabled': disabled || undefined,
    });
  }

  return (
    <button
      type="button"
      ref={ref}
      disabled={disabled || loading}
      aria-busy={loading}
      onPointerDown={(event) => {
        if (variant === 'primary') ripple(event);
        onPointerDown?.(event);
      }}
      className={classes}
      {...props}
    >
      {loading ? <IconLoader className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
      {children}
    </button>
  );
}
