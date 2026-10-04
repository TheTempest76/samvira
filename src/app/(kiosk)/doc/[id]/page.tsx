import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getDoc } from '@/lib/retrieval';
import ScrollToHighlight from '@/components/ScrollToHighlight';

export const dynamic = 'force-dynamic';

export default async function DocPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ chunk?: string }> }) {
  const { id } = await params;
  const { chunk } = await searchParams;
  const d = await getDoc(decodeURIComponent(id));
  if (!d) notFound();
  let lastPage: number | undefined;
  return (
    <div>
      <Link className="back" href="/">← Back to questions</Link>
      <article className="reader selectable">
        <h1>{d.doc.title}</h1>
        <div className="meta">{[d.doc.type, d.doc.date, d.doc.place, d.doc.pages ? `${d.doc.pages} pages` : null].filter(Boolean).join(' · ')}</div>
        {/\.(jpe?g|png)$/i.test(d.doc.file) && (
          // The original photo/scan next to its OCR text.
          // eslint-disable-next-line @next/next/no-img-element
          <img className="doc-scan" src={`/api/doc-image?id=${encodeURIComponent(d.doc.id)}`} alt={`Original scan of ${d.doc.title}`} />
        )}
        {d.chunks.map((c) => {
          const showPage = c.page !== undefined && c.page !== lastPage;
          lastPage = c.page;
          return (
            <div key={c.id}>
              {showPage && <div className="pg">Page {c.page}</div>}
              <p id={`c-${c.id}`} className={`pass${c.id === chunk ? ' hl' : ''}`}>{c.text}</p>
            </div>
          );
        })}
        <div className="meta" style={{ marginTop: 28 }}>Source file: {d.doc.file}</div>
      </article>
      {chunk && <ScrollToHighlight id={`c-${chunk}`} />}
    </div>
  );
}
