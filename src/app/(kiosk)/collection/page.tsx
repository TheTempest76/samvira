import { indexStats } from '@/lib/retrieval';
import CollectionView from '@/components/CollectionView';

export const dynamic = 'force-dynamic';

export default async function CollectionPage() {
  const s = await indexStats();
  return <CollectionView docs={s.docs} passages={s.passages} />;
}
