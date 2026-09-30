'use client';

import { useState } from 'react';

/** Single-series sparkline with a hover readout. Values are in `unit`; nulls leave gaps. */
export default function Sparkline({ values, max, unit = '', color = 'var(--accent)', label }: {
  values: (number | null)[];
  max?: number;
  unit?: string;
  color?: string;
  label: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 240, H = 44, pad = 3;
  const n = Math.max(values.length, 2);
  const nums = values.filter((v): v is number => v !== null);
  const top = max ?? Math.max(1, ...nums) * 1.15;
  const x = (i: number) => pad + (i * (W - 2 * pad)) / (n - 1);
  const y = (v: number) => H - pad - (Math.min(v, top) / top) * (H - 2 * pad);

  let d = '';
  values.forEach((v, i) => {
    if (v === null) return;
    const prev = i > 0 ? values[i - 1] : null;
    d += `${prev === null || i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)} `;
  });
  const lastIdx = values.map((v, i) => (v === null ? -1 : i)).filter((i) => i >= 0).pop();
  const hv = hover !== null ? values[hover] : null;

  return (
    <div style={{ position: 'relative' }}>
      <svg
        className="spark"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`${label} over the last ${values.length} samples`}
        onPointerMove={(e) => {
          const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const i = Math.round(((e.clientX - r.left) / r.width) * (n - 1));
          setHover(Math.max(0, Math.min(values.length - 1, i)));
        }}
        onPointerLeave={() => setHover(null)}
      >
        <line x1={pad} x2={W - pad} y1={H - pad} y2={H - pad} stroke="var(--line)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        <path d={d} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        {lastIdx !== undefined && values[lastIdx] !== null && hover === null && (
          <circle cx={x(lastIdx)} cy={y(values[lastIdx] as number)} r={3} fill={color} />
        )}
        {hover !== null && (
          <line x1={x(hover)} x2={x(hover)} y1={0} y2={H} stroke="var(--text-2)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        )}
      </svg>
      {hover !== null && (
        <div style={{ position: 'absolute', top: -22, right: 0, fontSize: 12, color: 'var(--text)', background: 'var(--panel-2)', border: '1px solid var(--line)', borderRadius: 6, padding: '1px 6px' }}>
          {hv === null ? 'n/a' : `${hv.toFixed(hv < 10 ? 1 : 0)}${unit}`} · {((values.length - 1 - hover) * 2)} s ago
        </div>
      )}
    </div>
  );
}
