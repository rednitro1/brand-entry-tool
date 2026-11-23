import test from 'node:test';
import assert from 'node:assert/strict';
import { reportingEntity, reportingQuery, rankReportPages, finalizeProfile, describeReporting } from '../server/modules/profile.js';

const brand = { name: 'Alani Nu', domain: 'alaninu.com' };
const own = (o) => ({ status: 'unknown', parent_company: null, parent_domain: null, ticker: null, as_of: null, fact_ids: ['f1'], reasoning: 'x', ...o });
const ok = new Set(['f1']);

test('subsidiary with a backed fact -> parent files the reports', () => {
  const e = reportingEntity(own({ status: 'subsidiary', parent_company: 'Celsius Holdings, Inc.', parent_domain: 'https://www.celsiusholdingsinc.com/', ticker: 'CELH' }), ok, brand);
  assert.deepEqual(e, { kind: 'parent', name: 'Celsius Holdings, Inc.', domain: 'celsiusholdingsinc.com', ticker: 'CELH' });
  assert.match(reportingQuery(e, brand, 2026), /Celsius Holdings, Inc\. \(CELH\) quarterly results 2026 Alani Nu/);
});

test('independent public -> the company files its own reports', () => {
  const e = reportingEntity(own({ status: 'independent_public', ticker: 'CELH' }), ok, { name: 'Celsius', domain: 'celsius.com' });
  assert.equal(e.kind, 'self');
  assert.match(reportingQuery(e, { name: 'Celsius' }, 2026), /^Celsius \(CELH\) quarterly results 2026 earnings release$/);
});

test('private / unknown / unbacked / self-named parent -> no reports pulled', () => {
  assert.equal(reportingEntity(own({ status: 'independent_private' }), ok, brand), null);
  assert.equal(reportingEntity(own({ status: 'unknown' }), ok, brand), null);
  assert.equal(reportingEntity(own({ status: 'subsidiary', parent_company: 'Celsius' }), new Set(), brand), null, 'no receipt, no parent');
  assert.equal(reportingEntity(own({ status: 'subsidiary', parent_company: 'Alani Nu LLC' }), ok, brand), null, 'parent is just the brand itself');
  assert.equal(reportingEntity(null, ok, brand), null);
});

test('rankReportPages puts IR / wire / SEC first', () => {
  const ranked = rankReportPages([
    { url: 'https://finance.yahoo.com/x' },
    { url: 'https://ir.celsiusholdingsinc.com/news/q3' },
    { url: 'https://www.businesswire.com/x' },
  ], { domain: 'celsiusholdingsinc.com' });
  assert.deepEqual(ranked.map((r) => new URL(r.url).hostname), ['ir.celsiusholdingsinc.com', 'www.businesswire.com', 'finance.yahoo.com']);
});

const pages = [{ url: 'https://www.businesswire.com/a', markdown: 'Celsius Holdings, Inc. today announced it has completed its acquisition of Alani Nu.' }];
const raw = (ownership) => ({ ownership, facts: [{ id: 'f1', claim: 'Celsius owns Alani Nu', kind: 'acquisition', date: '2025-04', url: pages[0].url, quote: 'today announced it has completed its acquisition of Alani Nu', inferred: false, vendor: false }], conflicts: [], summary_points: [] });

test('finalizeProfile: ownership claim without a surviving receipt downgrades to unknown', () => {
  const p = finalizeProfile(raw(own({ status: 'subsidiary', parent_company: 'Celsius', fact_ids: ['f9'] })), pages, brand);
  assert.equal(p.ownership.status, 'unknown');
  assert.match(p.ownership.reasoning, /no supporting source passed/);
  assert.equal(p.reporting.status, 'none_public');
});

test('describeReporting covers every outcome with a plain note', () => {
  const sub = own({ status: 'subsidiary', parent_company: 'Celsius Holdings' });
  assert.equal(describeReporting(sub, brand, { urls: ['u'], brandFacts: 2 }).status, 'found');
  assert.match(describeReporting(sub, brand, { urls: ['u'], brandFacts: 0 }).note, /does not break out Alani Nu/);
  assert.equal(describeReporting(sub, brand, { urls: [], brandFacts: 0 }).status, 'not_found');
  assert.match(describeReporting(own({ status: 'independent_private' }), brand, null).note, /privately held/);
  assert.match(describeReporting(own({ status: 'unknown' }), brand, null).note, /could not be confirmed/);
});
