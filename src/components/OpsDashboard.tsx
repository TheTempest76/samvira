'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import Sparkline from './Sparkline';

type Mode = 'auto' | 'local' | 'online' | 'extractive';
interface Sys {
  board: string; isJetson: boolean; l4t: string | null; uptimeS: number; cpuPct: number | null; cores: number; load1: number;
  gpuPct: number | null; mem: { totalMb: number; usedMb: number }; hottest: { name: string; c: number } | null;
  temps: { name: string; c: number }[]; power: { totalW: number | null; rails: { name: string; w: number }[] };
}
interface Models {
  settings: { mode: Mode; localChatModel: string; onlineChatModel: string; requireCitations: boolean };
  local: { reachable: boolean; pingMs: number | null; error?: string; installed: { name: string; size: number }[]; loaded: { name: string; vram: number }[]; baseUrl: string; embedModel: string | null };
  online: { configured: boolean; reachable: boolean; pingMs: number | null; authOk?: boolean; status?: number; error?: string; provider: string; baseUrl: string };
  voice: { stt: boolean; tts: boolean };
  index: { documents: number; passages: number; vocabulary: number; embedModel: string | null; vectors: boolean; builtAt: string };
  adminPin: boolean;
}
interface QRec { ts: number; question: string; lang: string; mode: string; answeredBy: string; model: string | null; latencyMs: number; firstTokenMs: number | null; sources: number; cited: number; verdict: string; fallbacks: string[] }
interface QSum { total: number; grounded: number; refused: number; extractive: number; errors: number; local: number; online: number; p50LatencyMs: number | null; p90LatencyMs: number | null; p50FirstTokenMs: number | null }

const HIST = 60; // samples × 2 s = 2 minutes
const MODES: { id: Mode; label: string; help: string }[] = [
  { id: 'auto', label: 'Auto', help: 'On-device first; if it fails, the online model; if both fail, archive passages.' },
  { id: 'local', label: 'On-device', help: 'Only the model running on this Jetson. Works with no internet.' },
  { id: 'online', label: 'Online', help: 'Only the online model. Faster and larger, needs internet.' },
  { id: 'extractive', label: 'Archive only', help: 'No AI summary: shows the best matching passages verbatim.' },
];

const fmtMs = (v: number | null | undefined) => (v === null || v === undefined ? '—' : v < 1000 ? `${v} ms` : `${(v / 1000).toFixed(1)} s`);
const fmtUp = (s: number) => `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h ${Math.floor((s % 3600) / 60)}m`;

function State({ kind, text }: { kind: 'ok' | 'warn' | 'bad' | 'na'; text: string }) {
  const icon = kind === 'ok' ? '●' : kind === 'warn' ? '▲' : kind === 'bad' ? '■' : '○';
  return <span className={`state ${kind}`}><span aria-hidden>{icon}</span>{text}</span>;
}

export default function OpsDashboard() {
  const [pin, setPin] = useState('');
  const [sys, setSys] = useState<Sys | null>(null);
  const [hist, setHist] = useState<{ cpu: (number | null)[]; gpu: (number | null)[]; mem: (number | null)[]; temp: (number | null)[]; pw: (number | null)[] }>({ cpu: [], gpu: [], mem: [], temp: [], pw: [] });
  const [models, setModels] = useState<Models | null>(null);
  const [queries, setQueries] = useState<{ summary: QSum; recent: QRec[] } | null>(null);
  const [msg, setMsg] = useState('');
  const [onlineModel, setOnlineModel] = useState('');
  const headers = useCallback((): Record<string, string> => ({ 'content-type': 'application/json', ...(pin ? { 'x-admin-pin': pin } : {}) }), [pin]);

  useEffect(() => {
    try { setPin(sessionStorage.getItem('ops-pin') ?? ''); } catch { /* ignore */ }
  }, []);

  // live hardware stats every 2 s
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const s: Sys = await fetch('/api/system', { cache: 'no-store' }).then((r) => r.json());
        if (!alive) return;
        setSys(s);
        const push = (a: (number | null)[], v: number | null) => [...a, v].slice(-HIST);
        setHist((h) => ({
          cpu: push(h.cpu, s.cpuPct),
          gpu: push(h.gpu, s.gpuPct),
          mem: push(h.mem, (100 * s.mem.usedMb) / s.mem.totalMb),
          temp: push(h.temp, s.hottest?.c ?? null),
          pw: push(h.pw, s.power.totalW),
        }));
      } catch { /* server restarting */ }
    };
    tick();
    const id = setInterval(tick, 2000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  const loadModels = useCallback(async () => {
    try {
      const m: Models = await fetch('/api/models', { cache: 'no-store' }).then((r) => r.json());
      setModels(m);
      setOnlineModel((cur) => cur || m.settings.onlineChatModel);
    } catch { /* ignore */ }
  }, []);
  useEffect(() => {
    loadModels();
    const id = setInterval(loadModels, 10000);
    return () => clearInterval(id);
  }, [loadModels]);

  useEffect(() => {
    const load = () => fetch('/api/queries', { cache: 'no-store' }).then((r) => r.json()).then(setQueries).catch(() => {});
    load();
    const id = setInterval(load, 4000);
    return () => clearInterval(id);
  }, []);

  async function save(patch: Record<string, unknown>) {
    const res = await fetch('/api/settings', { method: 'POST', headers: headers(), body: JSON.stringify(patch) });
    if (res.status === 401) { setMsg('Wrong or missing PIN.'); return; }
    setMsg('Saved.');
    setTimeout(() => setMsg(''), 1800);
    loadModels();
  }

  const s = models?.settings;
  const memPct = sys ? (100 * sys.mem.usedMb) / sys.mem.totalMb : null;
  const temp = sys?.hottest?.c ?? null;

  return (
    <div className="ops">
      <header className="ops-top">
        <div>
          <h1>Operator dashboard</h1>
          <div className="sub">
            {sys ? `${sys.board}${sys.l4t ? ' · ' + sys.l4t.replace(/^#\s*/, '').slice(0, 40) : ''} · up ${fmtUp(sys.uptimeS)}` : 'connecting…'}
            {sys && !sys.isJetson && ' · not a Jetson: GPU and power readings unavailable'}
          </div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 10, alignItems: 'center' }}>
          {models?.adminPin && (
            <input type="password" placeholder="Admin PIN" value={pin} style={{ width: 120 }}
              onChange={(e) => { setPin(e.target.value); try { sessionStorage.setItem('ops-pin', e.target.value); } catch { /* ignore */ } }} />
          )}
          <span className="muted" aria-live="polite">{msg}</span>
          <Link className="btn2" href="/" target="_blank">Open kiosk ↗</Link>
        </div>
      </header>

      <main className="ops-main">
        {/* ── Answer engine ── */}
        <section className="card">
          <h2>Answer engine <span className="right">{MODES.find((m) => m.id === s?.mode)?.help}</span></h2>
          <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'center' }}>
            <div className="seg" role="group" aria-label="Answer mode">
              {MODES.map((m) => (
                <button key={m.id} aria-pressed={s?.mode === m.id} onClick={() => save({ mode: m.id })}>{m.label}</button>
              ))}
            </div>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input type="checkbox" checked={!!s?.requireCitations} onChange={(e) => save({ requireCitations: e.target.checked })} />
              Withhold answers without citations
            </label>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              On-device model
              <select value={s?.localChatModel ?? ''} onChange={(e) => save({ localChatModel: e.target.value })}>
                {[...new Set([s?.localChatModel, ...(models?.local.installed.map((m) => m.name) ?? [])].filter(Boolean))].map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </label>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              Online model
              <input type="text" value={onlineModel} onChange={(e) => setOnlineModel(e.target.value)} placeholder="model id" style={{ width: 200 }} />
              <button className="btn2" onClick={() => save({ onlineChatModel: onlineModel })}>Set</button>
            </label>
          </div>
        </section>

        {/* ── Hardware ── */}
        <section className="row tiles">
          <div className="card tile">
            <div className="label"><span>CPU</span><span>{sys ? `${sys.cores} cores` : ''}</span></div>
            <div className="value">{sys?.cpuPct != null ? sys.cpuPct.toFixed(0) : '—'}<small>%</small></div>
            <div className="hint">load avg {sys ? sys.load1.toFixed(2) : '—'}</div>
            <Sparkline values={hist.cpu} max={100} unit="%" label="CPU" />
          </div>
          <div className="card tile">
            <div className="label"><span>GPU</span>{sys?.gpuPct == null && <State kind="na" text="n/a" />}</div>
            <div className="value">{sys?.gpuPct != null ? sys.gpuPct.toFixed(0) : '—'}<small>%</small></div>
            <div className="hint">{models?.local.loaded.length ? `serving ${models.local.loaded.map((m) => m.name).join(', ')}` : 'no model in memory'}</div>
            <Sparkline values={hist.gpu} max={100} unit="%" label="GPU" />
          </div>
          <div className="card tile">
            <div className="label"><span>Memory (shared CPU/GPU)</span>{memPct !== null && (memPct > 90 ? <State kind="warn" text="High" /> : <State kind="ok" text="OK" />)}</div>
            <div className="value">{sys ? (sys.mem.usedMb / 1024).toFixed(1) : '—'}<small>/ {sys ? (sys.mem.totalMb / 1024).toFixed(1) : '—'} GB</small></div>
            <div className="hint">{memPct !== null ? `${memPct.toFixed(0)}% used` : ''}</div>
            <Sparkline values={hist.mem} max={100} unit="%" label="Memory" />
          </div>
          <div className="card tile">
            <div className="label">
              <span>Temperature</span>
              {temp === null ? <State kind="na" text="n/a" /> : temp < 70 ? <State kind="ok" text="Normal" /> : temp < 85 ? <State kind="warn" text="Warm" /> : <State kind="bad" text="Hot" />}
            </div>
            <div className="value">{temp !== null ? temp.toFixed(0) : '—'}<small>°C</small></div>
            <div className="hint">{sys?.hottest ? `hottest: ${sys.hottest.name}` : ''}</div>
            <Sparkline values={hist.temp} unit="°C" label="Hottest temperature" max={100} />
          </div>
          <div className="card tile">
            <div className="label"><span>Board power</span>{sys?.power.totalW == null && <State kind="na" text="n/a" />}</div>
            <div className="value">{sys?.power.totalW != null ? sys.power.totalW.toFixed(1) : '—'}<small>W</small></div>
            <div className="hint">{sys?.power.rails.length ? sys.power.rails.map((r) => `${r.name} ${r.w.toFixed(1)}`).join(' · ') : 'INA3221 rail not found'}</div>
            <Sparkline values={hist.pw} unit=" W" label="Board power" />
          </div>
        </section>

        {/* ── Models ── */}
        <section className="row two">
          <div className="card">
            <h2>On-device model (Ollama) <span className="right">{models?.local.baseUrl}</span></h2>
            {models ? (
              <dl className="kv">
                <dt>Status</dt><dd>{models.local.reachable ? <State kind="ok" text={`Reachable · ${models.local.pingMs} ms`} /> : <State kind="bad" text="Unreachable" />}{models.local.error && <span className="muted"> — {models.local.error}</span>}</dd>
                <dt>Chat model</dt><dd>{s?.localChatModel} {models.local.installed.some((m) => m.name === s?.localChatModel) ? <span className="pill on">installed</span> : <span className="pill">not pulled — run: ollama pull {s?.localChatModel}</span>}</dd>
                <dt>Embeddings</dt><dd>{models.local.embedModel ?? 'off (keyword search only)'}</dd>
                <dt>In memory</dt><dd>{models.local.loaded.length ? models.local.loaded.map((m) => <span key={m.name} className="pill on">{m.name} · {(m.vram / 1e9).toFixed(1)} GB</span>) : <span className="muted">none (loads on first question)</span>}</dd>
                <dt>Installed</dt><dd>{models.local.installed.length ? models.local.installed.map((m) => <span key={m.name} className="pill">{m.name} · {(m.size / 1e9).toFixed(1)} GB</span>) : <span className="muted">—</span>}</dd>
              </dl>
            ) : <span className="muted">loading…</span>}
          </div>
          <div className="card">
            <h2>Online model <span className="right">{models?.online.baseUrl}</span></h2>
            {models ? (
              <dl className="kv">
                <dt>Status</dt>
                <dd>
                  {!models.online.configured ? <State kind="na" text="No API key set (ONLINE_API_KEY)" /> :
                    !models.online.reachable ? <State kind="bad" text="Unreachable (offline?)" /> :
                      models.online.authOk ? <State kind="ok" text={`Reachable · ${models.online.pingMs} ms`} /> :
                        <State kind="warn" text={`Reachable, HTTP ${models.online.status} — check the key`} />}
                </dd>
                <dt>Provider</dt><dd>{models.online.provider === 'anthropic' ? 'Anthropic Messages API' : 'OpenAI-compatible API'}</dd>
                <dt>Model</dt><dd>{s?.onlineChatModel || <span className="muted">not set</span>}</dd>
                <dt>Voice</dt><dd>Speech-to-text {models.voice.stt ? <span className="pill on">on</span> : <span className="pill">off</span>} · Server voice {models.voice.tts ? <span className="pill on">on</span> : <span className="pill">browser voice</span>}</dd>
              </dl>
            ) : <span className="muted">loading…</span>}
          </div>
        </section>

        {/* ── Quality + recent questions ── */}
        <section className="row wide">
          <div className="card">
            <h2>Recent questions <span className="right">last {queries?.recent.length ?? 0}</span></h2>
            <div style={{ overflowX: 'auto' }}>
              <table className="q">
                <thead>
                  <tr><th>Time</th><th>Question</th><th>Lang</th><th>Answered by</th><th>Result</th><th className="num">First token</th><th className="num">Total</th></tr>
                </thead>
                <tbody>
                  {queries?.recent.length ? queries.recent.map((r, i) => (
                    <tr key={i} title={r.fallbacks.join('\n')}>
                      <td>{new Date(r.ts).toLocaleTimeString()}</td>
                      <td>{r.question}</td>
                      <td>{r.lang}</td>
                      <td>{r.answeredBy}{r.model ? ` · ${r.model}` : ''}{r.fallbacks.length ? ' ↩' : ''}</td>
                      <td>
                        {r.verdict === 'grounded' ? <State kind="ok" text={`grounded (${r.cited}/${r.sources})`} /> :
                          r.verdict === 'extractive' ? <State kind="warn" text="passages" /> :
                            r.verdict === 'error' ? <State kind="bad" text="error" /> :
                              r.verdict === 'uncited' ? <State kind="bad" text="withheld" /> : <State kind="na" text="not found" />}
                      </td>
                      <td className="num">{fmtMs(r.firstTokenMs)}</td>
                      <td className="num">{fmtMs(r.latencyMs)}</td>
                    </tr>
                  )) : <tr><td colSpan={7} className="muted">No questions yet. Ask something on the kiosk.</td></tr>}
                </tbody>
              </table>
            </div>
            <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>↩ = fell back to another engine (hover the row for the reason).</div>
          </div>
          <div className="card">
            <h2>Answer quality <span className="right">last {queries?.summary.total ?? 0} questions</span></h2>
            {queries && (
              <>
                <div className="statgrid">
                  <div className="stat"><div className="n">{queries.summary.grounded}</div><div className="l">grounded</div></div>
                  <div className="stat"><div className="n">{queries.summary.refused}</div><div className="l">refused / withheld</div></div>
                  <div className="stat"><div className="n">{queries.summary.extractive}</div><div className="l">passages only</div></div>
                  <div className="stat"><div className="n">{queries.summary.errors}</div><div className="l">errors</div></div>
                </div>
                <div className="statgrid" style={{ marginTop: 14 }}>
                  <div className="stat"><div className="n">{fmtMs(queries.summary.p50FirstTokenMs)}</div><div className="l">median first token</div></div>
                  <div className="stat"><div className="n">{fmtMs(queries.summary.p50LatencyMs)}</div><div className="l">median answer</div></div>
                  <div className="stat"><div className="n">{fmtMs(queries.summary.p90LatencyMs)}</div><div className="l">90th pct answer</div></div>
                  <div className="stat"><div className="n">{queries.summary.local + queries.summary.online}</div><div className="l">AI answers</div></div>
                </div>
                {queries.summary.local + queries.summary.online > 0 && (
                  <>
                    <div className="share" aria-hidden>
                      <div style={{ flex: queries.summary.local, background: 'var(--accent)' }} />
                      <div style={{ flex: queries.summary.online, background: '#c9a3ff' }} />
                    </div>
                    <div className="muted" style={{ fontSize: 13, display: 'flex', gap: 16 }}>
                      <span><i style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: 'var(--accent)', marginRight: 6 }} />On-device {queries.summary.local}</span>
                      <span><i style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: '#c9a3ff', marginRight: 6 }} />Online {queries.summary.online}</span>
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </section>

        {/* ── Benchmark + index ── */}
        <section className="row wide">
          <Benchmark headers={headers} />
          <IndexCard models={models} headers={headers} onDone={loadModels} />
        </section>
      </main>
    </div>
  );
}

// ─────────────── Side-by-side: same question, on-device vs online ───────────────
function Benchmark({ headers }: { headers: () => Record<string, string> }) {
  const [q, setQ] = useState('What happened at Mahad in 1927?');
  type Col = { text: string; status: string; first: number | null; total: number | null; verdict: string; model: string | null };
  const empty: Col = { text: '', status: '', first: null, total: null, verdict: '', model: null };
  const [cols, setCols] = useState<Record<'local' | 'online', Col>>({ local: empty, online: empty });
  const [running, setRunning] = useState(false);

  async function runOne(target: 'local' | 'online') {
    const t0 = performance.now();
    const set = (p: Partial<Col>) => setCols((c) => ({ ...c, [target]: { ...c[target], ...p } }));
    set({ ...empty, status: 'running…' });
    try {
      const res = await fetch('/api/ask', { method: 'POST', headers: headers(), body: JSON.stringify({ question: q, lang: 'en', force: target }) });
      const reader = res.body!.getReader();
      const dec = new TextDecoder();
      let buf = '', text = '', first: number | null = null;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i: number;
        while ((i = buf.indexOf('\n')) >= 0) {
          const ev = JSON.parse(buf.slice(0, i));
          buf = buf.slice(i + 1);
          if (ev.type === 'delta') {
            if (first === null) first = Math.round(performance.now() - t0);
            text += ev.text;
            set({ text, first, status: '' });
          } else if (ev.type === 'status') set({ status: ev.text });
          else if (ev.type === 'done') set({ total: Math.round(performance.now() - t0), verdict: ev.verdict, model: ev.model, status: ev.answeredBy === 'extractive' ? 'engine unavailable — showed passages' : '' });
        }
      }
    } catch (e) {
      set({ status: `failed: ${(e as Error).message}` });
    }
  }

  async function run() {
    setRunning(true);
    await Promise.all([runOne('local'), runOne('online')]);
    setRunning(false);
  }

  return (
    <div className="card">
      <h2>Side-by-side test <span className="right">same question, same sources, two engines</span></h2>
      <div style={{ display: 'flex', gap: 10 }}>
        <input type="text" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1 }} aria-label="Test question" />
        <button className="btn2 primary" onClick={run} disabled={running || !q.trim()}>{running ? 'Running…' : 'Run'}</button>
      </div>
      <div className="bench">
        {(['local', 'online'] as const).map((k) => (
          <div className="col" key={k}>
            <h3>{k === 'local' ? 'On-device' : 'Online'}{cols[k].model && <span className="muted">· {cols[k].model}</span>}</h3>
            <div className="txt">{cols[k].text || <span className="muted">{cols[k].status || '—'}</span>}</div>
            <div className="t">
              first token {fmtMs(cols[k].first)} · total {fmtMs(cols[k].total)}{cols[k].verdict && ` · ${cols[k].verdict}`}
              {cols[k].text && cols[k].status && ` · ${cols[k].status}`}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────── Index status + re-index button ───────────────
function IndexCard({ models, headers, onDone }: { models: Models | null; headers: () => Record<string, string>; onDone: () => void }) {
  const [log, setLog] = useState('');
  const [busy, setBusy] = useState(false);
  const [withEmb, setWithEmb] = useState(true);
  const box = useRef<HTMLDivElement>(null);
  const idx = models?.index;

  async function reindex() {
    setBusy(true);
    setLog('');
    try {
      const res = await fetch('/api/admin/ingest', { method: 'POST', headers: headers(), body: JSON.stringify({ embeddings: withEmb }) });
      if (!res.ok) { setLog(`HTTP ${res.status}: ${await res.text()}`); return; }
      const reader = res.body!.getReader();
      const dec = new TextDecoder();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        setLog((l) => l + dec.decode(value, { stream: true }));
        requestAnimationFrame(() => box.current?.scrollTo(0, box.current.scrollHeight));
      }
    } finally {
      setBusy(false);
      onDone();
    }
  }

  return (
    <div className="card">
      <h2>Archive index</h2>
      {idx ? (
        <dl className="kv">
          <dt>Documents</dt><dd>{idx.documents}</dd>
          <dt>Passages</dt><dd>{idx.passages.toLocaleString()}</dd>
          <dt>Vocabulary</dt><dd>{idx.vocabulary.toLocaleString()} terms</dd>
          <dt>Search</dt><dd>{idx.vectors ? `hybrid: keywords + ${idx.embedModel} vectors` : 'keywords (BM25) only'}</dd>
          <dt>Built</dt><dd>{new Date(idx.builtAt).toLocaleString()}</dd>
        </dl>
      ) : <span className="muted">loading…</span>}
      <p className="muted" style={{ fontSize: 13 }}>Drop PDFs or text files into <code>data/docs</code> on the Jetson, then re-index.</p>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', margin: '8px 0' }}>
        <button className="btn2 primary" onClick={reindex} disabled={busy}>{busy ? 'Indexing…' : 'Re-index archive'}</button>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input type="checkbox" checked={withEmb} onChange={(e) => setWithEmb(e.target.checked)} /> build embeddings
        </label>
      </div>
      {log && <div className="logbox" ref={box}>{log}</div>}
    </div>
  );
}
