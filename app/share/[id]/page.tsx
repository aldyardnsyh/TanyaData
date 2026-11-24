import type { Metadata } from 'next';
import { SignalShareView } from '@/components/share/signal-share-view';

/** Rute publik read-only. Tidak ada layout workspace, sidebar, atau composer. */

/** P6-FIX / SEC-002: snapshot bearer tidak boleh masuk indeks mesin pencari. */
export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true },
};

export default async function SharePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SignalShareView id={id} />;
}
