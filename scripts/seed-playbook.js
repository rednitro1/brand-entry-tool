/* Inserts the first Playbook version (from public Nectar sources, every proof item with a
   source URL) if the database has none. Safe to re-run: it never overwrites a saved one. */
import { loadEnv } from '../server/env.js';
loadEnv();
const { makeDb } = await import('../server/db.js');
const { SEED_PLAYBOOK, parsePlaybook } = await import('../server/playbook.js');

const db = makeDb(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const existing = await db.getPlaybook();
if (existing) {
  console.log(`A playbook already exists (${existing.id}, saved ${existing.created_at}); not overwriting.`);
} else {
  const row = await db.savePlaybook(parsePlaybook(SEED_PLAYBOOK), 'Seed from nectarsocial.com/customers, Menlo Ventures and GV (draft, check me)');
  console.log(`Seeded playbook ${row.id} with ${row.content.proof.length} proof items.`);
}
