/**
 * Satu sumber ikon UI (blueprint §2 / DECISION-011).
 *
 * Material Symbols self-hosted dipakai sebagai pengganti Lucide. Setiap ikon
 * dirender sebagai:
 *   <span className="material-symbols-outlined text-[18px]" aria-hidden="true">nama</span>
 *
 * Alias `Icon*` dipertahankan agar komponen lama tidak perlu diubah satu per
 * satu; ukuran `h-N w-N` diterjemahkan ke `text-[Npx]` karena font ikon
 * diukur dari font-size, bukan width/height.
 */
import type { HTMLAttributes } from 'react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Terjemahkan kelas ukuran lama ke kelas font-size Material Symbols. */
function symbolSize(className?: string): string {
  if (!className) return 'text-[18px]';

  const px = className.match(/h-\[(\d+(?:\.\d+)?)px\]/);
  if (px) return `text-[${px[1]}px]`;

  const step = className.match(/(?:^|\s)h-(\d+(?:\.\d+)?)(?=\s|$)/);
  if (step) return `text-[${parseFloat(step[1]) * 4}px]`;

  const named = className.match(/(?:^|\s)(text-(?:xs|sm|base|lg|xl|2xl|3xl))(?=\s|$)/);
  if (named) return named[1];

  const explicit = className.match(/text-\[(\d+(?:\.\d+)?)px\]/);
  if (explicit) return `text-[${explicit[1]}px]`;

  return 'text-[18px]';
}

/** Buang kelas width/height lama supaya tidak menggunting glyph font. */
function stripBoxClasses(className?: string): string | undefined {
  return className
    ?.split(/\s+/)
    .filter((c) => c && !/^(?:h|w)-/.test(c))
    .join(' ');
}

export type MaterialIconProps = Omit<HTMLAttributes<HTMLSpanElement>, 'children'> & {
  name: string;
};

export function Icon({ name, className, ...rest }: MaterialIconProps) {
  return (
    <span
      className={cn(
        'material-symbols-outlined inline-block leading-none select-none',
        symbolSize(className),
        stripBoxClasses(className),
      )}
      aria-hidden="true"
      {...rest}
    >
      {name}
    </span>
  );
}

type AliasProps = Omit<MaterialIconProps, 'name'>;
const symbol = (name: string) => function MaterialSymbolAlias(props: AliasProps) {
  return <Icon name={name} {...props} />;
};

/* Nama Lucide lama → nama Material Symbols (blueprint §2). */
export const IconAlertTriangle = symbol('warning');
export const IconArrowDown = symbol('arrow_downward');
export const IconArrowLeft = symbol('arrow_back');
export const IconArrowRight = symbol('arrow_forward');
export const IconArrowDownRight = symbol('south_east');
export const IconArrowUpRight = symbol('north_east');
export const IconArrowUp = symbol('arrow_upward');
export const IconArrowUpDown = symbol('swap_vert');
export const IconCheck = symbol('check');
export const IconCheckCircle = symbol('check_circle');
export const IconChevronDown = symbol('expand_more');
export const IconChevronLeft = symbol('chevron_left');
export const IconChevronRight = symbol('chevron_right');
export const IconClock = symbol('schedule');
export const IconCopy = symbol('content_copy');
export const IconDatabase = symbol('database');
export const IconDownload = symbol('download');
export const IconFileSpreadsheet = symbol('table_rows');
export const IconFileText = symbol('description');
export const IconHistory = symbol('history');
export const IconInfo = symbol('info');
export const IconLayoutDashboard = symbol('dashboard');
export const IconLoader = symbol('progress_activity');
export const IconMapPin = symbol('location_on');
export const IconMenu = symbol('menu');
export const IconMessageSquare = symbol('forum');
export const IconMinus = symbol('remove');
export const IconPlus = symbol('add');
export const IconRefresh = symbol('refresh');
export const IconSave = symbol('save');
export const IconScanSearch = symbol('biotech');
export const IconSearch = symbol('search');
export const IconSend = symbol('send');
export const IconSettings = symbol('settings');
export const IconShield = symbol('verified_user');
export const IconTrash = symbol('delete');
export const IconUpload = symbol('upload_file');
export const IconX = symbol('close');

/* Ekspor lama dari toaster.tsx, dipertahankan sebagai alias. */
export const CheckCircle = IconCheckCircle;
export const AlertTriangle = IconAlertTriangle;
export const Info = IconInfo;
export const X = IconX;
