import { SignalShareView } from '@/components/share/signal-share-view';

/** Rute publik read-only. Tidak ada layout workspace, sidebar, atau composer. */
export default async function SharePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SignalShareView id={id} />;
}
