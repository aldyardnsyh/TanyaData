import { redirect } from 'next/navigation';

/**
 * Ringkasan tidak lagi halaman global: ringkasan + laporan analisis hidup
 * per dokumen di halaman detail sumber (/data-sources/[id]).
 * Rute lama dialihkan agar tautan lama tidak 404.
 */
export default function OverviewPage(): never {
  redirect('/data-sources');
}
