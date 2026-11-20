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
  rail: boolean;
  onNavigate?: () => void;
}

/** Motion #1: indikator 2px meluncur ke item aktif, spring settle 180ms tanpa bounce. */
export function NavItemLink({ item, label, active, rail, onNavigate }: NavItemLinkProps) {
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-label={rail ? label : undefined}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'group relative flex min-h-11 items-center gap-3 rounded-control px-3 font-body text-label-md transition-colors duration-[var(--motion-fast)] focus-ring',
        rail && 'justify-center md:px-0 xl:justify-start xl:px-3',
        active
          ? 'bg-primary/10 font-semibold text-primary'
          : 'text-ink-muted-strong hover:bg-row-hover hover:text-ink',
      )}
    >
      <Icon name={item.icon} className="text-[20px]" />
      <span className={cn('truncate', rail && 'md:hidden xl:inline')}>{label}</span>
      <span
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute bottom-1 left-3 right-3 h-0.5 origin-left rounded-control bg-primary transition-transform duration-[var(--motion-base)] ease-[var(--ease-spring)] motion-reduce:transform-none',
          active ? 'scale-x-100' : 'scale-x-0 group-hover:scale-x-50',
          rail && 'md:left-2 md:right-2 xl:left-3 xl:right-3',
        )}
      />
    </Link>
  );
}
