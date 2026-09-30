'use client';
import { useEffect } from 'react';
export default function ScrollToHighlight({ id }: { id: string }) {
  useEffect(() => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [id]);
  return null;
}
