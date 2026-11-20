'use client';

import Link from 'next/link';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { Icon } from '@/components/ui/icons';
import type { NavItem } from './nav-config';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export interface NavItemLinkProps {
  item: NavItem;
  label: string;
  active: boolean;
  /** true = sidebar desktop yang menyusut jadi rail 72px di tablet. */
  rail: boolean;
  onNavigate?: () => void;
}

export function NavItemLink({ item, label, active, rail, onNavigate }: NavItemLinkProps) {
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-label={rail ? label : undefined}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'group relative flex items-center gap-space-sm rounded-lg px-space-sm py-2 font-label-md transition-all duration-[var(--motion-fast)] focus-ring',
        rail && 'justify-center md:px-0 xl:justify-start xl:px-space-sm',
        active
          ? 'bg-primary-container text-on-primary font-bold'
          : 'text-on-surface-variant hover:bg-surface-container hover:text-on-surface',
      )}
    >
      <Icon name={item.icon} className="text-[18px]" />
      <span className={cn('truncate', rail && 'md:hidden xl:inline')}>{label}</span>
      {/* Purpose Gate: underline tumbuh dari kiri 120ms saat hover dan penuh saat
          aktif, sehingga perpindahan halaman terasa seperti indikator yang bergeser. */}
      <span
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute bottom-1 left-3 right-3 h-0.5 origin-left rounded-full bg-current transition-transform duration-[var(--motion-fast)] ease-[var(--ease-out-quart)] motion-reduce:transform-none',
          active ? 'scale-x-100' : 'scale-x-0 group-hover:scale-x-100',
          rail && 'md:left-2 md:right-2 xl:left-3 xl:right-3',
        )}
      />
    </Link>
  );
}
