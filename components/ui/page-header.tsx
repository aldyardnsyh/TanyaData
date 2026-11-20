'use client';

import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { MeasurementRule } from './measurement-rule';
import { MonoMeta } from './mono-meta';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export interface PageHeaderProps {
  title: string;
  subtitle?: string;
  meta?: string;
  actions?: React.ReactNode;
  className?: string;
}

/** Satu display per layar (M3) + measurement rule + mono metadata. */
export function PageHeader({ title, subtitle, meta, actions, className }: PageHeaderProps) {
  return (
    <div className={cn('mb-6', className)}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="font-display text-display text-ink">{title}</h1>
          {subtitle && <p className="mt-2 max-w-2xl font-body text-body-lg text-ink-muted-strong">{subtitle}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      <div className="relative mt-5">
        <MeasurementRule />
        {meta && <MonoMeta className="absolute -bottom-2.5 right-0 bg-canvas pl-2">{meta}</MonoMeta>}
      </div>
    </div>
  );
}
