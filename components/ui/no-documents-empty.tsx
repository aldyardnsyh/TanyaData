import Link from 'next/link';
import { EmptyState } from './empty-state';

/**
 * Empty state jujur untuk workspace tanpa dokumen (SEED_PROFILE=none).
 * Satu sumber kebenaran untuk copy + CTA agar kelima halaman konsisten.
 *
 * Purpose Gate:
 * - R-17/R-38: tanpa angka, tanpa identitas rekaan, tanpa contoh data.
 * - R-27: menyebut penyebab (belum ada dokumen) + satu aksi (unggah).
 * - R-15: CTA spesifik "Unggah dokumen", bukan "Mulai" generik.
 * - Ikon dokumen (FileText di EmptyState) relevan langsung dengan isi pesan.
 */
export const NO_DOCUMENTS_MESSAGE =
  'Belum ada dokumen. Unggah SOP, kebijakan, atau panduan untuk mulai bertanya.';

export interface NoDocumentsEmptyProps {
  /** Judul singkat; default netral agar tidak mengulang kalimat isi. */
  heading?: string;
  /** Ganti CTA default (mis. tombol scroll ke dropzone di halaman unggah). */
  action?: React.ReactNode;
  className?: string;
}

export function NoDocumentsEmpty({
  heading = 'Mulai dari dokumen',
  action,
  className,
}: NoDocumentsEmptyProps) {
  return (
    <EmptyState
      title={heading}
      description={NO_DOCUMENTS_MESSAGE}
      action={
        action ?? (
          <Link
            href="/data-sources"
            className="touch-44 inline-flex items-center rounded-control bg-forest px-s3 font-display text-label font-semibold text-porcelain focus-ring"
          >
            Unggah dokumen
          </Link>
        )
      }
      className={className}
    />
  );
}
