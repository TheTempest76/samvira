import type { Metadata } from 'next';
import OpsDashboard from '@/components/OpsDashboard';

export const metadata: Metadata = { title: 'Operator dashboard · Ambedkar Digital Archive' };

export default function AdminPage() {
  return <OpsDashboard />;
}
