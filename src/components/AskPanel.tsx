'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Speaker, splitSentences } from '@/lib/speech';
import { Lang, LANGS, useKiosk } from './KioskShell';
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

const citesIn = (s: string) => [...s.matchAll(/\[S(\d+)\]/g)].map((m) => Number(m[1]));

export default function AskPanel() {
  const { lang, setLang, t } = useKiosk();
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
  const [spoken, setSpoken] = useState<number | null>(null); // index of the sentence being read aloud
  const [voiceOn, setVoiceOn] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const speaker = useRef<Speaker | null>(null);

  useEffect(() => {
    fetch('/api/voice').then((r) => r.json()).then((j) => setVoiceOn(!!j.stt)).catch(() => {});
  }, []);

  const stopSpeaking = useCallback(() => {
    speaker.current?.stop();
    speaker.current = null;
    window.speechSynthesis?.cancel();
  }, []);

  const newSpeaker = useCallback((l: Lang) => {
    stopSpeaking();
    const sp = new Speaker(l, LANGS.find((x) => x.id === l)!.speech, setSpoken, () => {
      if (speaker.current === sp) speaker.current = null;
      setSpeaking(false);
    });
    speaker.current = sp;
    setSpeaking(true);
    return sp;
  }, [stopSpeaking]);

  const reset = useCallback(() => {
    abort.current?.abort();
    stopSpeaking();
    setQ(''); setAsked(''); setAnswer(''); setSources([]); setStatus(''); setDone(null); setActive(null); setBusy(false);
  }, [stopSpeaking]);
  useEffect(() => {
    window.addEventListener('kiosk-reset', reset);
    window.addEventListener('kiosk-stop-speaking', stopSpeaking);
    return () => {
      window.removeEventListener('kiosk-reset', reset);
      window.removeEventListener('kiosk-stop-speaking', stopSpeaking);
    };
  }, [reset, stopSpeaking]);

  /**
   * Asks the archive. With `speak`, the answer is read aloud while it streams, one sentence at a time.
   * Nothing is read until the answer has cited a real source (or the server has finished and judged it),
   * so an answer that ends up withheld for lack of citations is never spoken.
   */
  const ask = useCallback(async (question: string, opts: { speak?: boolean; lang?: Lang } = {}) => {
    const qq = question.trim();
    if (!qq) return;
    const l = opts.lang ?? lang;
    abort.current?.abort();
    const ctl = new AbortController();
    abort.current = ctl;
    stopSpeaking();
    const sp = opts.speak ? newSpeaker(l) : null;
    setAsked(qq); setAnswer(''); setSources([]); setDone(null); setActive(null); setSpoken(null); setBusy(true); setStatus(t('searching'));

    let full = '';
    let nSources = 0;
    let fed = 0;
    let gateOpen = false;
    const feed = (text: string, final: boolean) => {
      if (!sp) return;
      const ss = splitSentences(text);
      const upto = final ? ss.length : ss.length - 1; // the last sentence may still be growing
      for (; fed < upto; fed++) sp.push(fed, ss[fed].text);
      if (final) sp.finish();
    };

    try {
      const res = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question: qq, lang: l }),
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
          if (ev.type === 'meta') { setSources(ev.sources); nSources = ev.sources.length; }
          else if (ev.type === 'status') setStatus(ev.text);
          else if (ev.type === 'delta') {
            setStatus('');
            full += ev.text;
            setAnswer(full);
            if (!gateOpen) gateOpen = citesIn(full).some((n) => n >= 1 && n <= nSources);
            if (gateOpen) feed(full, false);
          } else if (ev.type === 'done') {
            setDone(ev);
            setStatus('');
            if (ev.verdict === 'uncited' && ev.refusalText) { full = ev.refusalText; fed = 0; setAnswer(full); }
            feed(full, true);
          } else if (ev.type === 'error') setStatus(`Something went wrong: ${ev.text}`);
        }
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setStatus('The kiosk could not reach its server. Please try again.');
      sp?.stop();
    } finally {
      setBusy(false);
    }
  }, [lang, t, stopSpeaking, newSpeaker]);

  // Deep link: /?q=… (used by "Ask about this" on the timeline and graph)
  useEffect(() => {
    const pq = params.get('q');
    if (pq) { setQ(pq); ask(pq); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  function onVoice(text: string, heard: Lang) {
    setQ(text);
    if (heard !== lang) setLang(heard);
    ask(text, { speak: true, lang: heard });
  }

  function readAloud() {
    if (speaking) return stopSpeaking();
    const sp = newSpeaker(lang);
    splitSentences(answer).forEach((s, i) => sp.push(i, s.text));
    sp.finish();
  }

  const sentences = useMemo(() => splitSentences(answer), [answer]);
  // While reading aloud, the sources cited by the current sentence light up.
  const speakingCites = new Set(spoken !== null && sentences[spoken] ? citesIn(sentences[spoken].text) : []);

  const cited = new Set(done?.cited ?? []);
  const verdictBadge = () => {
    if (!done) return null;
    const by = !done.model ? null : done.answeredBy === 'local' ? `On-device · ${done.model}` : done.answeredBy === 'online' ? `Online · ${done.model}` : null;
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
          <VoiceButton onText={onVoice} onStatus={setStatus} />
          <button className="btn" type="submit" disabled={busy || !q.trim()}>{t('askBtn')}</button>
        </form>
        {voiceOn && !asked && <p className="voice-hint">{t('voiceHint')}</p>}
        <div className="chips">
          {(SUGGESTIONS[lang] ?? SUGGESTIONS.en).map((s) => (
            <button key={s} className="chip" onClick={() => { setQ(s); ask(s); }}>{s}</button>
          ))}
        </div>

        {(asked || status) && (
          <article className={`answer${speaking ? ' reading' : ''}`} aria-live="polite">
            {asked && <h2 className="answer-q">{asked}</h2>}
            <div className="answer-body selectable">
              <Rendered sentences={sentences} spoken={spoken} active={active} onCite={(n) => setActive(active === n ? null : n)} />
              {busy && <span className="caret" aria-hidden />}
            </div>
            <div className="status-line">{status}</div>
            {done && (
              <div className="answer-foot">
                {verdictBadge()}
                <button className={`btn ghost listen${speaking ? ' on' : ''}`} style={{ marginLeft: 'auto', minHeight: 48 }} onClick={readAloud}>
                  {speaking ? <><Eq /> {t('stop')}</> : `▶ ${t('listen')}`}
                </button>
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
          const cls = ['src', active === s.n || speakingCites.has(s.n) ? 'active' : '', done && done.verdict === 'grounded' && !isCited ? 'dim' : ''].join(' ');
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

/** Small animated equaliser shown while the answer is being read aloud. */
function Eq() {
  return <span className="eq" aria-hidden><i /><i /><i /><i /></span>;
}

/** Renders answer sentences with [S n] markers as tappable citation chips; the sentence being read aloud is highlighted. */
function Rendered({ sentences, spoken, active, onCite }: {
  sentences: ReturnType<typeof splitSentences>; spoken: number | null; active: number | null; onCite: (n: number) => void;
}) {
  const paras: { s: (typeof sentences)[number]; i: number }[][] = [];
  sentences.forEach((s, i) => (paras[s.para] ??= []).push({ s, i }));
  return (
    <>
      {paras.filter(Boolean).map((p, pi) => (
        <p key={pi}>
          {p.map(({ s, i }) => (
            <Fragment key={i}>
              <span className={`sent${spoken === i ? ' speaking' : ''}`}>
                {s.text.split(/(\[S\d+\])/g).map((part, k) => {
                  const m = part.match(/^\[S(\d+)\]$/);
                  if (!m) return <Fragment key={k}>{part}</Fragment>;
                  const n = Number(m[1]);
                  return (
                    <button key={k} className="cite" aria-pressed={active === n} onClick={() => onCite(n)} aria-label={`Source ${n}`}>
                      S{n}
                    </button>
                  );
                })}
              </span>{' '}
            </Fragment>
          ))}
        </p>
      ))}
    </>
  );
}
