import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeBrands, shapeRuns } from '../server/db.js';

test('shapeRuns: no ip hash or raw input leaks, costs numeric, modules attached', () => {
  const out = shapeRuns(
    [{ id: 'r1', brand_id: 'b1', status: 'done', cost_usd: '0.6123', ip_hash: 'secret', input: 'raw input', started_at: 'a', finished_at: 'b', created_at: 'c' },
     { id: 'r2', brand_id: null, status: 'failed', cost_usd: null, started_at: 'a', finished_at: null, created_at: 'c' }],
    [{ run_id: 'r1', module: 'profile', status: 'done', cost_usd: '0.48' }],
    [{ id: 'b1', name: 'Alani Nu', slug: 'alani-nu' }],
  );
  assert.ok(!JSON.stringify(out).includes('secret'));
  assert.ok(!JSON.stringify(out).includes('raw input'));
  assert.equal(out[0].cost_usd, 0.6123);
  assert.deepEqual(out[0].brand, { name: 'Alani Nu', slug: 'alani-nu' });
  assert.equal(out[0].modules[0].cost_usd, 0.48);
  assert.equal(out[1].brand, null);
  assert.equal(out[1].cost_usd, 0);
});

test('summarizeBrands: owner from latest profile, wedge count from latest stakeholder run only', () => {
  const out = summarizeBrands(
    [{ id: 'b1', slug: 'alani-nu', name: 'Alani Nu' }, { id: 'b2', slug: 'x', name: 'X' }],
    [{ brand_id: 'b1', ownership: { status: 'subsidiary', parent_company: 'Celsius Holdings' } }],
    [
      { brand_id: 'b1', run_id: 'new', persona: 'director_social' },
      { brand_id: 'b1', run_id: 'new', persona: 'team_social' },
      { brand_id: 'b1', run_id: 'old', persona: 'cmo' },
    ],
  );
  assert.equal(out[0].owner, 'Celsius Holdings');
  assert.equal(out[0].wedge_count, 1);
  assert.equal(out[0].people_count, 2);
  assert.equal(out[1].owner, null);
  assert.equal(out[1].wedge_count, 0);
});
