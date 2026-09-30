import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './config';

export interface QueryRecord {
  ts: number;
  question: string;
  lang: string;
  mode: string;
  answeredBy: 'local' | 'online' | 'extractive' | 'refused';
  model: string | null;
  latencyMs: number;
  firstTokenMs: number | null;
  retrievalMs: number;
  sources: number;
  cited: number;
  verdict: 'grounded' | 'refused' | 'uncited' | 'extractive' | 'error';
  fallbacks: string[];
  usedVectors: boolean;
}

const MAX = 200;
const g = globalThis as unknown as { __queryLog?: QueryRecord[] };
const log: QueryRecord[] = (g.__queryLog ??= []);
const FILE = path.join(DATA_DIR, 'querylog.jsonl');

export function recordQuery(r: QueryRecord) {
  log.unshift(r);
  if (log.length > MAX) log.length = MAX;
  try {
    fs.appendFileSync(FILE, JSON.stringify(r) + '\n');
  } catch {
    /* read-only data dir is fine */
  }
}

export function recentQueries(n = 50) {
  return log.slice(0, n);
}

export function querySummary() {
  const last = log.slice(0, 100);
  const by = (k: QueryRecord['verdict']) => last.filter((q) => q.verdict === k).length;
  const answered = last.filter((q) => q.answeredBy === 'local' || q.answeredBy === 'online');
  const lat = answered.map((q) => q.latencyMs).sort((a, b) => a - b);
  const ft = answered.map((q) => q.firstTokenMs ?? 0).filter(Boolean).sort((a, b) => a - b);
  const p = (arr: number[], q: number) => (arr.length ? arr[Math.min(arr.length - 1, Math.floor(q * arr.length))] : null);
  return {
    total: last.length,
    grounded: by('grounded'),
    refused: by('refused') + by('uncited'),
    extractive: by('extractive'),
    errors: by('error'),
    local: last.filter((q) => q.answeredBy === 'local').length,
    online: last.filter((q) => q.answeredBy === 'online').length,
    p50LatencyMs: p(lat, 0.5),
    p90LatencyMs: p(lat, 0.9),
    p50FirstTokenMs: p(ft, 0.5),
  };
}
