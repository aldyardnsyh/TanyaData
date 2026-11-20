'use client';

import type { ComponentState } from '@/lib/ui/component-state';
import { Icon } from '@/components/ui/icons';

/**
 * C-05 Mobile Dock (dari Floating Dock).
 * Purpose Gate: navigasi jempol di 390px menggantikan drawer. Efek magnify
 * dihapus karena mengganggu target sentuh. Item aktif memakai dot lime.
 * Motion: 160ms spring ringan, tanpa efek magnify berlebih (M2).
 *
 * 8 state: hover n/a (perangkat sentuh), loading/empty/error n/a (navigasi
 * selalu punya rute nyata). Alasan ditulis agar tidak dianggap terlewat.
 */
export interface DockItem {
  id: string;
  label: string;
  icon: string;
  href: string;
}

export interface FloatingDockProps {
  items: DockItem[];
  activeId: string;
  state?: ComponentState;
  className?: string;
}

export function FloatingDock({ items, activeId, state = 'default', className = '' }: FloatingDockProps) {
  return (
    <nav
      aria-label="Navigasi utama"
      data-state={state}
      className={`h-dock fixed inset-x-0 bottom-0 z-sticky flex items-stretch justify-around border-t border-[var(--border-hairline)] bg-porcelain px-s2 ${className}`}
    >
      {items.map((item) => {
        const active = item.id === activeId || state === 'active';
        return (
          <a
            key={item.id}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            aria-label={item.label}
            className="touch-44 relative flex flex-1 flex-col items-center justify-center gap-s1 rounded-control text-ink-72 transition-colors duration-[var(--motion-normal)] hover:text-forest focus-ring"
          >
            <Icon name={item.icon} className="text-[20px]" />
            <span className="text-caption leading-none">{item.label}</span>
            {active && <span className="state-dot state-dot-active absolute top-s1" aria-hidden="true" />}
          </a>
        );
      })}
    </nav>
  );
}
