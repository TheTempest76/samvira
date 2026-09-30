import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Reads live hardware stats from sysfs/procfs. Works on any Linux box;
 * the GPU load and power rails only exist on Jetson boards. Anything that
 * can't be read comes back as null and the dashboard shows "n/a".
 */

const read = (p: string) => {
  try {
    return fs.readFileSync(/*turbopackIgnore: true*/ p, 'utf8').trim();
  } catch {
    return null;
  }
};

// CPU usage from /proc/stat deltas between calls
let prevCpu: { idle: number; total: number } | null = null;
function cpuPercent(): number | null {
  const line = read('/proc/stat')?.split('\n')[0];
  if (!line) return null;
  const v = line.split(/\s+/).slice(1).map(Number);
  const idle = v[3] + (v[4] || 0);
  const total = v.reduce((a, b) => a + b, 0);
  const prev = prevCpu;
  prevCpu = { idle, total };
  if (!prev || total === prev.total) return null;
  return Math.max(0, Math.min(100, 100 * (1 - (idle - prev.idle) / (total - prev.total))));
}

function memory() {
  const txt = read('/proc/meminfo');
  if (!txt) return { totalMb: Math.round(os.totalmem() / 1048576), usedMb: Math.round((os.totalmem() - os.freemem()) / 1048576) };
  const kb = (k: string) => Number(txt.match(new RegExp(`^${k}:\\s+(\\d+)`, 'm'))?.[1] ?? 0);
  const total = kb('MemTotal'), avail = kb('MemAvailable');
  return { totalMb: Math.round(total / 1024), usedMb: Math.round((total - avail) / 1024) };
}

// Jetson GPU load: value 0–1000 in a sysfs "load" file. The path differs across JetPack releases.
let gpuLoadPath: string | null | undefined;
function findGpuLoad(): string | null {
  if (gpuLoadPath !== undefined) return gpuLoadPath;
  const candidates = [
    '/sys/devices/platform/bus@0/17000000.gpu/load', // Orin, JetPack 6
    '/sys/devices/platform/17000000.ga10b/load', // Orin, JetPack 5
    '/sys/devices/platform/17000000.gv11b/load', // Xavier
    '/sys/devices/gpu.0/load', // Nano / TX
    '/sys/devices/platform/gpu.0/load',
  ];
  gpuLoadPath = candidates.find((p) => fs.existsSync(/*turbopackIgnore: true*/ p)) ?? null;
  return gpuLoadPath;
}
function gpuPercent(): number | null {
  const p = findGpuLoad();
  const v = p ? Number(read(p)) : NaN;
  return Number.isFinite(v) ? v / 10 : null;
}

function temperatures() {
  const out: { name: string; c: number }[] = [];
  const base = '/sys/class/thermal';
  let zones: string[] = [];
  try {
    zones = fs.readdirSync(/*turbopackIgnore: true*/ base).filter((z) => z.startsWith('thermal_zone'));
  } catch {
    return out;
  }
  for (const z of zones) {
    const type = read(path.join(base, z, 'type'));
    const t = Number(read(path.join(base, z, 'temp')));
    if (type && Number.isFinite(t) && t > 0 && t < 150000) out.push({ name: type.replace(/-therm$/i, ''), c: t / 1000 });
  }
  return out;
}

// Board power from the INA3221 monitor (Orin Nano dev kit). Looks for a VDD_IN rail.
function power() {
  const roots = ['/sys/bus/i2c/drivers/ina3221'];
  for (const root of roots) {
    let devs: string[] = [];
    try {
      devs = fs.readdirSync(/*turbopackIgnore: true*/ root).filter((d) => /^\d+-/.test(d));
    } catch {
      continue;
    }
    for (const d of devs) {
      const hw = path.join(root, d, 'hwmon');
      let hwdirs: string[] = [];
      try {
        hwdirs = fs.readdirSync(/*turbopackIgnore: true*/ hw);
      } catch {
        continue;
      }
      for (const h of hwdirs) {
        const dir = path.join(hw, h);
        const rails: { name: string; w: number }[] = [];
        for (let i = 1; i <= 4; i++) {
          const label = read(path.join(dir, `in${i}_label`));
          const mv = Number(read(path.join(dir, `in${i}_input`)));
          const ma = Number(read(path.join(dir, `curr${i}_input`)));
          if (label && Number.isFinite(mv) && Number.isFinite(ma)) rails.push({ name: label, w: (mv * ma) / 1e6 });
        }
        if (rails.length) {
          const total = rails.find((r) => /VDD_IN|POM_5V_IN/i.test(r.name));
          return { totalW: total ? total.w : null, rails };
        }
      }
    }
  }
  return { totalW: null, rails: [] as { name: string; w: number }[] };
}

export function systemSnapshot() {
  const model = read('/proc/device-tree/model')?.replace(/\0/g, '') ?? os.hostname();
  const temps = temperatures();
  const hottest = temps.length ? temps.reduce((a, b) => (b.c > a.c ? b : a)) : null;
  const release = read('/etc/nv_tegra_release')?.split('\n')[0] ?? null;
  return {
    ts: Date.now(),
    board: model,
    isJetson: /jetson|nvidia/i.test(model) || release !== null,
    l4t: release,
    uptimeS: Math.round(os.uptime()),
    cpuPct: cpuPercent(),
    cores: os.cpus().length,
    load1: os.loadavg()[0],
    gpuPct: gpuPercent(),
    mem: memory(),
    temps,
    hottest,
    power: power(),
  };
}
export type SystemSnapshot = ReturnType<typeof systemSnapshot>;
