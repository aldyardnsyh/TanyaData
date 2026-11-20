import { ShareView } from '@/components/share/share-view';

/** Rute publik read-only. Tidak ada layout workspace, sidebar, atau composer. */
export default async function SharePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ShareView id={id} />;
}
