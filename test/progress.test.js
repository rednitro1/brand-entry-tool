import test from 'node:test';
import assert from 'node:assert/strict';
import { makeLiveLog, scrubLine } from '../server/runner.js';
import { overallProgress, moduleFraction, mergeLogs, parseLine } from '../shared/progress.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function recDb({ delayMs = 0 } = {}) {
  const writes = [];
  return {
    writes,
    async updateModule(_r, _m, patch) { if (delayMs) await wait(delayMs); writes.push(patch); },
  };
}

test('live log: lines and progress reach the db while the module runs', async () => {
  const db = recDb();
  const live = makeLiveLog({ db, runId: 'r', name: 'profile', flushMs: 10 });
  live.say('Searching: Alani Nu');
  live.say.progress(0.2);
  await wait(30);
  assert.equal(db.writes.length, 1, 'batched into one write');
  assert.equal(db.writes[0].log.length, 1);
  assert.equal(db.writes[0].progress, 0.2);
  await live.close();
});

test('live log: progress never moves backwards and caps below 1 until the module ends', async () => {
  const db = recDb();
  const live = makeLiveLog({ db, runId: 'r', name: 'x', flushMs: 5 });
  live.say.progress(0.5); live.say.progress(0.3); live.say.progress(7);
  await wait(20);
  assert.equal(db.writes.at(-1).progress, 0.99);
  await live.close();
});

test('live log: close() waits for a slow in-flight write so it cannot land after the final row', async () => {
  const db = recDb({ delayMs: 40 });
  const live = makeLiveLog({ db, runId: 'r', name: 'x', flushMs: 1 });
  live.say('first');
  await wait(5); // flush started, write still in flight
  live.say('second'); // scheduled, will be cancelled by close
  const lines = await live.close();
  db.writes.push({ final: true });
  assert.equal(lines.length, 2);
  assert.equal(db.writes.at(-1).final, true, 'final row is the last write');
  assert.equal(db.writes.filter((w) => !w.final).length, 1, 'pending flush was cancelled');
});

test('live log: a failed flush does not throw into the module', async () => {
  const db = { async updateModule() { throw new Error('db down'); } };
  const live = makeLiveLog({ db, runId: 'r', name: 'x', flushMs: 1 });
  live.say('hello');
  await wait(10);
  assert.deepEqual((await live.close()).length, 1);
});

test('scrubLine masks anything that looks like a credential and trims length', () => {
  assert.equal(scrubLine('GET https://api.apify.com/v2/runs?token=abc123def'), 'GET https://api.apify.com/v2/runs?token=***');
  assert.equal(scrubLine('key sk-ant-api03-AAAAAAAAAAAA leaked'), 'key *** leaked');
  assert.equal(scrubLine('x'.repeat(500)).length, 240);
});

test('overallProgress: weighted by module, 1 when the run is finished', () => {
  assert.equal(overallProgress(null), 0);
  const run = { status: 'running', modules: [
    { module: 'resolve', status: 'done' },
    { module: 'profile', status: 'running', progress: 0.5 },
    { module: 'stakeholders', status: 'queued' },
    { module: 'social', status: 'failed' },
  ] };
  assert.ok(Math.abs(overallProgress(run) - (0.1 + 0.225 + 0 + 0.15)) < 1e-9);
  assert.equal(overallProgress({ ...run, status: 'partial' }), 1);
  assert.equal(moduleFraction({ status: 'skipped' }), 1);
});

test('mergeLogs: one timeline across modules, old-format lines still readable', () => {
  const merged = mergeLogs([
    { module: 'social', log: ['2026-11-22T10:00:05.000Z TikTok @alaninu: 1,100,000 followers'] },
    { module: 'resolve', log: ['2026-11-22T10:00:01.000Z Looking up "Alani Nu"'] },
  ]);
  assert.deepEqual(merged.map((l) => l.module), ['resolve', 'social']);
  assert.deepEqual(parseLine('10:00:01 official site: alaninu.com'), { at: null, clock: '10:00:01', text: 'official site: alaninu.com' });
});
