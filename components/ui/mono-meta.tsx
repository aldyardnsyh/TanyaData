import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Signature 3.2: label metadata teknis. Tidak beranimasi, tidak dibungkus badge. */
export function MonoMeta({
  children,
  className,
  title,
}: {
  children: React.ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <span className={cn('mono-meta whitespace-nowrap', className)} title={title}>
      {children}
    </span>
  );
}
