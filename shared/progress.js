/* Shared by the server (tests) and the browser (progress bar). Weights follow where the
   time actually goes in a live run: the profile (search, fetch, two Claude passes) is
   the long pole; resolve is a few seconds. */

export const MODULE_WEIGHTS = { resolve: 0.1, profile: 0.45, stakeholders: 0.3, social: 0.15 };
const FINISHED = new Set(['done', 'failed', 'skipped']);

export function moduleFraction(m) {
  if (!m) return 0;
  if (FINISHED.has(m.status)) return 1;
  if (m.status !== 'running') return 0;
  return Math.max(0, Math.min(0.99, Number(m.progress) || 0));
}

/* 0..1 for the whole run. A finished run is always 1. */
export function overallProgress(run) {
  if (!run) return 0;
  if (FINISHED.has(run.status) || run.status === 'partial') return 1;
  const byModule = Object.fromEntries((run.modules || []).map((m) => [m.module, m]));
  let total = 0;
  for (const [name, w] of Object.entries(MODULE_WEIGHTS)) total += w * moduleFraction(byModule[name]);
  return Math.min(0.99, total);
}

/* Log lines are stored as "<ISO time> <message>". Older runs stored "HH:MM:SS message". */
export function parseLine(line) {
  const m = /^(\d{4}-\d{2}-\d{2}T[\d:.]+Z) (.*)$/s.exec(String(line));
  if (m) return { at: m[1], text: m[2] };
  const old = /^(\d{2}:\d{2}:\d{2}) (.*)$/s.exec(String(line));
  return old ? { at: null, clock: old[1], text: old[2] } : { at: null, text: String(line) };
}

/* Every module's lines merged into one timeline, oldest first. */
export function mergeLogs(modules = []) {
  const out = [];
  for (const m of modules) for (const line of m.log || []) out.push({ module: m.module, ...parseLine(line) });
  return out.sort((a, b) => (a.at && b.at ? a.at.localeCompare(b.at) : 0));
}
