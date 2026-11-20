'use client';

import * as TooltipPrimitive from '@radix-ui/react-tooltip';

/**
 * Tooltip untuk ikon-only button/link. Radix Content merender role="tooltip"
 * secara default, jadi probe hover audit mendeteksinya di DOM.
 * Delay 120ms, tanpa animasi → aman untuk prefers-reduced-motion (globals.css).
 */
export function TooltipProvider({ children }: { children: React.ReactNode }) {
  return (
    <TooltipPrimitive.Provider delayDuration={120} skipDelayDuration={0}>
      {children}
    </TooltipPrimitive.Provider>
  );
}

export function IconTooltip({
  label,
  children,
  side = 'bottom',
}: {
  label: string;
  children: React.ReactNode;
  side?: 'top' | 'right' | 'bottom' | 'left';
}) {
  return (
    <TooltipPrimitive.Root delayDuration={120}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={6}
          className="z-tooltip max-w-[240px] rounded-control border border-border-hairline bg-surface px-2 py-1 font-body text-body-sm text-ink shadow-overlay"
        >
          {label}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
