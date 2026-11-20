'use client';

import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * M7/U-02: tanpa inisial "TD", tanpa dropdown satu-workspace, tanpa identitas rekaan.
 * Brand ditampilkan sebagai teks, bukan logo hasil asumsi (R-23).
 */
export function WorkspaceSwitcher({ name, rail = false }: { name: string; rail?: boolean }) {
  return (
    <div
      className={cn(
        'flex h-14 items-center border-b border-border-hairline px-4',
        rail && 'justify-center px-0 xl:justify-start xl:px-4',
      )}
    >
      <span className="font-display text-headline-sm font-bold tracking-tight text-ink">
        {rail ? <span className="md:hidden xl:inline">{name}</span> : name}
      </span>
      {rail && <span className="sr-only">{name}</span>}
    </div>
  );
}
