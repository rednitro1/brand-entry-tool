import test from 'node:test';
import assert from 'node:assert/strict';
import { makeFirecrawl, parseRetryAfterSec, makeLimiter } from '../server/providers/firecrawl.js';

const ok = (body) => ({ ok: true, status: 200, json: async () => body });
const limited = { ok: false, status: 429, json: async () => ({ success: false, error: 'Rate limit exceeded. please retry after 5s, resets at ...' }) };

test('parseRetryAfterSec reads the reset, caps it, defaults to 30', () => {
  assert.equal(parseRetryAfterSec('please retry after 55s'), 56);
  assert.equal(parseRetryAfterSec('retry after 300s'), 65);
  assert.equal(parseRetryAfterSec('boom'), 30);
});

test('429 is retried after the named wait, then succeeds', async () => {
  const responses = [limited, ok({ success: true, creditsUsed: 2, data: { web: [{ url: 'https://a.com/?srsltid=x', title: 'A' }] } })];
  const waits = [];
  const fc = makeFirecrawl('k', { fetchImpl: async () => responses.shift(), sleep: async (ms) => waits.push(ms) });
  const r = await fc.search('q');
  assert.equal(r[0].url, 'https://a.com/');
  assert.deepEqual(waits, [6000]);
  assert.equal(fc.usage().retries, 1);
  assert.equal(fc.usage().credits, 2);
});

test('429 three times -> throws with status, no infinite loop', async () => {
  const fc = makeFirecrawl('k', { fetchImpl: async () => limited, sleep: async () => {} });
  await assert.rejects(fc.search('q'), /429/);
});

test('limiter never runs more than max at once', async () => {
  const run = makeLimiter(3);
  let active = 0; let peak = 0;
  await Promise.all(Array.from({ length: 10 }, () => run(async () => {
    active++; peak = Math.max(peak, active);
    await new Promise((r) => setTimeout(r, 5));
    active--;
  })));
  assert.equal(peak, 3);
});
