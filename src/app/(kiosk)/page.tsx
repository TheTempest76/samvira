import { Suspense } from 'react';
import AskPanel from '@/components/AskPanel';

export default function AskPage() {
  return (
    <Suspense>
      <AskPanel />
    </Suspense>
  );
}
