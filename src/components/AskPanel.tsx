'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { LANGS, useKiosk } from './KioskShell';
import VoiceButton from './VoiceButton';

interface Source {
  n: number; doc: string; title: string; type: string; date: string | null; page: number | null;
  label: string; chunk: string; snippet: string; score: number;
}
interface Done {
  verdict: 'grounded' | 'refused' | 'uncited' | 'extractive';
  cited: number[];
  answeredBy: 'local' | 'online' | 'extractive' | 'refused';
  model: string | null;
  latencyMs: number;
  firstTokenMs: number | null;
  refusalText?: string;
}

const SUGGESTIONS: Record<string, string[]> = {
  en: ['What happened at Mahad in 1927?', 'Who chaired the Drafting Committee?', 'What was the Poona Pact?', 'Where did he study abroad?', 'Why did he resign as Law Minister?'],
  hi: ['महाड सत्याग्रह क्या था?', 'पूना समझौता क्या था?', 'उन्होंने विदेश में कहाँ पढ़ाई की?'],
  mr: ['महाड सत्याग्रह काय होता?', 'पुणे करार काय होता?', 'त्यांनी परदेशात कुठे शिक्षण घेतले?'],
  kn: ['ಮಹಾಡ್ ಸತ್ಯಾಗ್ರಹ ಎಂದರೇನು?', 'ಪೂನಾ ಒಪ್ಪಂದ ಏನು?', 'ಅವರು ವಿದೇಶದಲ್ಲಿ ಎಲ್ಲಿ ಓದಿದರು?'],
};

export default function AskPanel() {
  const { lang, t } = useKiosk();
  const params = useSearchParams();
  const [q, setQ] = useState('');
  const [asked, setAsked] = useState('');
  const [answer, setAnswer] = useState('');
  const [sources, setSources] = useState<Source[]>([]);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Done | null>(null);
  const [active, setActive] = useState<number | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);

  const reset = useCallback(() => {
    abort.current?.abort();
    setQ(''); setAsked(''); setAnswer(''); setSources([]); setStatus(''); setDone(null); setActive(null); setBusy(false);
  }, []);
  useEffect(() => {
    window.addEventListener('kiosk-reset', reset);
    return () => window.removeEventListener('kiosk-reset', reset);
  }, [reset]);

  const ask = useCallback(async (question: string) => {
    const qq = question.trim();
    if (!qq) return;
    abort.current?.abort();
    const ctl = new AbortController();
    abort.current = ctl;
    stopSpeaking();
    setAsked(qq); setAnswer(''); setSources([]); setDone(null); setActive(null); setBusy(true); setStatus('Searching the archive…');
    try {
      const res = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question: qq, lang }),
        signal: ctl.signal,
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done: end } = await reader.read();
        if (end) break;
        buf += dec.decode(value, { stream: true });
        let i: number;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i);
          buf = buf.slice(i + 1);
          if (!line.trim()) continue;
          const ev = JSON.parse(line);
          if (ev.type === 'meta') setSources(ev.sources);
          else if (ev.type === 'status') setStatus(ev.text);
          else if (ev.type === 'delta') { setStatus(''); setAnswer((a) => a + ev.text); }
          else if (ev.type === 'done') {
            setDone(ev);
            setStatus('');
            if (ev.verdict === 'uncited' && ev.refusalText) setAnswer(ev.refusalText);
          } else if (ev.type === 'error') setStatus(`Something went wrong: ${ev.text}`);
        }
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setStatus('The kiosk could not reach its server. Please try again.');
    } finally {
      setBusy(false);
    }
  }, [lang]);

  // Deep link: /?q=… (used by "Ask about this" on the timeline and graph)
  useEffect(() => {
    const pq = params.get('q');
    if (pq) { setQ(pq); ask(pq); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  function stopSpeaking() {
    window.speechSynthesis?.cancel();
    audio.current?.pause();
    setSpeaking(false);
  }

  async function speak() {
    if (speaking) return stopSpeaking();
    const text = answer.replace(/\[S\d+\]/g, '').trim();
    if (!text) return;
    setSpeaking(true);
    try {
      const res = await fetch('/api/tts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, lang }) });
      if (res.ok) {
        const url = URL.createObjectURL(await res.blob());
        const a = new Audio(url);
        audio.current = a;
        a.onended = () => setSpeaking(false);
        await a.play();
        return;
      }
    } catch { /* fall through to browser voice */ }
    const u = new SpeechSynthesisUtterance(text);
    u.lang = LANGS.find((l) => l.id === lang)!.speech;
    u.rate = 0.95;
    u.onend = () => setSpeaking(false);
    u.onerror = () => setSpeaking(false);
    window.speechSynthesis.speak(u);
  }

  const cited = new Set(done?.cited ?? []);
  const verdictBadge = () => {
    if (!done) return null;
    const by = done.answeredBy === 'local' ? `On-device · ${done.model}` : done.answeredBy === 'online' ? `Online · ${done.model}` : null;
    const secs = (done.latencyMs / 1000).toFixed(1);
    return (
      <>
        {done.verdict === 'grounded' && <span className="badge ok"><span className="dot" />Grounded in {done.cited.length} source{done.cited.length === 1 ? '' : 's'}</span>}
        {done.verdict === 'extractive' && <span className="badge warn"><span className="dot" />Direct archive passages (no AI summary)</span>}
        {done.verdict === 'refused' && <span className="badge"><span className="dot" />Not found in the archive</span>}
        {done.verdict === 'uncited' && <span className="badge bad"><span className="dot" />Answer withheld: no citations</span>}
        {by && <span className="badge">{by}</span>}
        <span className="badge">{secs} s</span>
      </>
    );
  };

  return (
    <div className="ask-grid">
      <section>
        <h1 className="hero-q">{t('heroQ')}</h1>
        <p className="hero-sub">{t('heroSub')}</p>
        <form className="askbar" onSubmit={(e) => { e.preventDefault(); ask(q); }}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('placeholder')} aria-label="Question" enterKeyHint="search" />
          <VoiceButton lang={lang} onText={(txt) => { setQ(txt); ask(txt); }} onStatus={setStatus} />
          <button className="btn" type="submit" disabled={busy || !q.trim()}>{t('askBtn')}</button>
        </form>
        <div className="chips">
          {(SUGGESTIONS[lang] ?? SUGGESTIONS.en).map((s) => (
            <button key={s} className="chip" onClick={() => { setQ(s); ask(s); }}>{s}</button>
          ))}
        </div>

        {(asked || status) && (
          <article className="answer" aria-live="polite">
            {asked && <h2 className="answer-q">{asked}</h2>}
            <div className="answer-body selectable">
              <Rendered text={answer} active={active} onCite={(n) => setActive(active === n ? null : n)} />
              {busy && <span className="caret" aria-hidden />}
            </div>
            <div className="status-line">{status}</div>
            {done && (
              <div className="answer-foot">
                {verdictBadge()}
                {done.verdict !== 'refused' && done.verdict !== 'uncited' && (
                  <button className="btn ghost" style={{ marginLeft: 'auto', minHeight: 48 }} onClick={speak}>
                    {speaking ? `■ ${t('stop')}` : `▶ ${t('listen')}`}
                  </button>
                )}
              </div>
            )}
          </article>
        )}
      </section>

      <aside className="sources">
        <h2>{t('sources')}</h2>
        {sources.length === 0 && <div className="empty-note">Sources appear here with each answer — tap a number like <span className="cite">S1</span> in the answer to highlight where it came from.</div>}
        {sources.map((s) => {
          const isCited = cited.has(s.n);
          const cls = ['src', active === s.n ? 'active' : '', done && done.verdict === 'grounded' && !isCited ? 'dim' : ''].join(' ');
          return (
            <div key={s.chunk} className={cls} onClick={() => setActive(active === s.n ? null : s.n)}>
              <div className="src-head">
                <span className="src-n">S{s.n}</span>
                <span className="src-title">{s.title}</span>
              </div>
              <div className="src-meta">
                {[s.type, s.date, s.page ? `page ${s.page}` : null].filter(Boolean).join(' · ')}
                {done?.verdict === 'grounded' && (isCited ? ' · cited' : ' · retrieved, not cited')}
              </div>
              <div className="src-text">{s.snippet}</div>
              <Link className="open" href={`/doc/${encodeURIComponent(s.doc)}?chunk=${encodeURIComponent(s.chunk)}`} onClick={(e) => e.stopPropagation()}>
                {t('open')}
              </Link>
            </div>
          );
        })}
      </aside>
    </div>
  );
}

/** Renders answer text with [S n] markers turned into tappable citation chips. */
function Rendered({ text, active, onCite }: { text: string; active: number | null; onCite: (n: number) => void }) {
  const paras = text.replace(/\*\*/g, '').split(/\n{2,}/);
  return (
    <>
      {paras.map((p, pi) => (
        <p key={pi}>
          {p.split(/(\[S\d+\])/g).map((part, i) => {
            const m = part.match(/^\[S(\d+)\]$/);
            if (!m) return <Fragment key={i}>{part}</Fragment>;
            const n = Number(m[1]);
            return (
              <button key={i} className="cite" aria-pressed={active === n} onClick={() => onCite(n)} aria-label={`Source ${n}`}>
                S{n}
              </button>
            );
          })}
        </p>
      ))}
    </>
  );
}
