import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Signature 3.1: garis ukur 1px + 3 tick (tengah forest). Menggantikan shadow. */
export function MeasurementRule({
  className,
  label,
}: {
  className?: string;
  label?: string;
}) {
  return (
    <div className={cn('measurement-rule w-full', className)}>
      {label && <span className="mono-meta absolute -bottom-2.5 right-0 bg-surface pl-2">{label}</span>}
    </div>
  );
}
