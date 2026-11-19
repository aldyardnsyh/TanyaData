import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export interface Tab {
  id: string;
  label: string;
}

export interface TabsProps {
  tabs: Tab[];
  value: string;
  onChange: (id: string) => void;
  className?: string;
}

export function Tabs({ tabs, value, onChange, className }: TabsProps) {
  return (
    <div
      role="tablist"
      className={cn('flex gap-1 rounded-md bg-surface-container-high p-0.5', className)}
    >
      {tabs.map((tab) => {
        const active = tab.id === value;
        return (
          <button
            key={tab.id}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(tab.id)}
            className={cn(
              'rounded-md px-3 py-1 font-body text-label-md transition-colors duration-[var(--motion-fast)] focus-ring focus-visible:outline-none',
              active
                ? 'bg-surface-container-lowest text-primary font-semibold'
                : 'text-on-surface-variant hover:text-on-surface',
            )}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
