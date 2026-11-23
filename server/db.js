import { createClient } from '@supabase/supabase-js';

/* Server-only data access. The browser never talks to Supabase; RLS has no policies, so
   only this service-role client can read or write. Every write supplies full rows (no
   partial upserts against NOT NULL columns). Each run writes its own rows; reads take the
   latest run's rows for a brand. */

export function makeDb(url, key) {
  const sb = createClient(url, key, { auth: { persistSession: false } });
  const must = ({ data, error }, what) => { if (error) throw new Error(`db ${what}: ${error.message}`); return data; };

  return {
    async upsertBrand(b) {
      const row = {
        slug: b.slug, name: b.name, domain: b.domain || null, linkedin_url: b.linkedinUrl || null,
        socials: b.socials || {}, gaps: b.gaps || [], is_example: Boolean(b.is_example), updated_at: new Date().toISOString(),
      };
      return must(await sb.from('brands').upsert(row, { onConflict: 'slug' }).select().single(), 'upsertBrand');
    },
    async getBrandBySlug(slug) {
      return must(await sb.from('brands').select('*').eq('slug', slug).maybeSingle(), 'getBrandBySlug');
    },
    async listBrands() {
      return must(await sb.from('brands').select('slug,name,domain,is_example,updated_at').order('is_example', { ascending: false }).order('updated_at', { ascending: false }).limit(50), 'listBrands');
    },

    async createRun({ input, ipHash, modules }) {
      const run = must(await sb.from('runs').insert({ input, ip_hash: ipHash, status: 'running', started_at: new Date().toISOString() }).select().single(), 'createRun');
      must(await sb.from('run_modules').insert(modules.map((m) => ({ run_id: run.id, module: m, status: 'queued' }))), 'createRunModules');
      return run;
    },
    async setRunBrand(runId, brandId) {
      must(await sb.from('runs').update({ brand_id: brandId }).eq('id', runId), 'setRunBrand');
    },
    async updateModule(runId, module, patch) {
      must(await sb.from('run_modules').update(patch).eq('run_id', runId).eq('module', module), `updateModule ${module}`);
    },
    async finishRun(runId, { status, costUsd, error = null }) {
      must(await sb.from('runs').update({ status, cost_usd: costUsd, error, finished_at: new Date().toISOString() }).eq('id', runId), 'finishRun');
    },
    async getRun(runId) {
      const run = must(await sb.from('runs').select('id,brand_id,input,status,cost_usd,error,started_at,finished_at,created_at').eq('id', runId).maybeSingle(), 'getRun');
      if (!run) return null;
      const modules = must(await sb.from('run_modules').select('module,status,cost_usd,log,error,detail,started_at,finished_at').eq('run_id', runId), 'getRunModules');
      const brand = run.brand_id ? must(await sb.from('brands').select('slug,name').eq('id', run.brand_id).maybeSingle(), 'getRunBrand') : null;
      return { ...run, brand, modules };
    },
    /* Spend-cap inputs: cost of everything started today (UTC) and how many are in flight. */
    async spendToday() {
      const since = new Date(); since.setUTCHours(0, 0, 0, 0);
      const rows = must(await sb.from('runs').select('cost_usd,status').gte('created_at', since.toISOString()), 'spendToday');
      return {
        spentTodayUsd: rows.reduce((s, r) => s + Number(r.cost_usd || 0), 0),
        activeRuns: rows.filter((r) => r.status === 'running' || r.status === 'queued').length,
      };
    },
    /* A process restart can orphan runs mid-flight; mark them failed so the UI isn't stuck
       on "running" and the spend cap doesn't keep reserving budget for them. */
    async failOrphanedRuns() {
      must(await sb.from('runs').update({ status: 'failed', error: 'Server restarted during the run.', finished_at: new Date().toISOString() }).eq('status', 'running'), 'failOrphanedRuns');
      must(await sb.from('run_modules').update({ status: 'failed', error: 'Server restarted during the run.' }).in('status', ['running', 'queued']), 'failOrphanedModules');
    },

    async saveProfile(brandId, runId, p) {
      must(await sb.from('brand_profiles').insert({
        brand_id: brandId, run_id: runId, summary: p.summary || [], facts: p.facts || [], conflicts: p.conflicts || [],
        sources: p.sources || [], ownership: p.ownership || {}, reporting: p.reporting || {}, rejected: p.rejected || [], cost: p.cost || {},
      }), 'saveProfile');
    },
    async saveStakeholders(brandId, runId, list) {
      if (!list.length) return [];
      const rows = list.map((s) => ({
        brand_id: brandId, run_id: runId, full_name: s.full_name, title: s.title, persona: s.persona, linkedin_url: s.linkedin_url,
        tenure_months: s.tenure_months, company_tenure_months: s.company_tenure_months ?? null,
        started_role_at: s.started_role_at, started_company_at: s.started_company_at,
        note: s.note || null, evidence: s.evidence || [], found_via: s.found_via, verification: s.verification || 'single_source',
        post_pattern: s.post_pattern || null,
      }));
      return must(await sb.from('stakeholders').insert(rows).select('id,linkedin_url'), 'saveStakeholders');
    },
    async saveStakeholderPosts(stakeholderId, posts) {
      if (!posts.length) return;
      const rows = posts.map((p) => ({
        stakeholder_id: stakeholderId, url: p.url, posted_at: p.posted_at, text: p.text, is_repost: p.is_repost,
        reactions: p.reactions, comments: p.comments, topic: p.topic,
      }));
      must(await sb.from('stakeholder_posts').upsert(rows, { onConflict: 'stakeholder_id,url' }), 'saveStakeholderPosts');
    },
    async saveSocialAccount(brandId, a) {
      must(await sb.from('social_accounts').upsert({
        brand_id: brandId, platform: a.platform, handle: a.handle, url: a.url,
        followers: a.followers, following: a.following, post_count: a.post_count,
        stats_source: a.stats_source, captured_at: new Date().toISOString(), error: a.error || null, extra: a.extra || {},
      }, { onConflict: 'brand_id,platform' }), 'saveSocialAccount');
    },

    /* Everything the brand page shows, from the latest run that produced each part. */
    async getBrandBundle(slug) {
      const brand = must(await sb.from('brands').select('*').eq('slug', slug).maybeSingle(), 'bundle brand');
      if (!brand) return null;
      const profile = must(await sb.from('brand_profiles').select('*').eq('brand_id', brand.id).order('created_at', { ascending: false }).limit(1).maybeSingle(), 'bundle profile');
      const lastPeople = must(await sb.from('stakeholders').select('run_id').eq('brand_id', brand.id).order('created_at', { ascending: false }).limit(1).maybeSingle(), 'bundle people run');
      const stakeholders = lastPeople
        ? must(await sb.from('stakeholders').select('*, stakeholder_posts(url,posted_at,text,is_repost,reactions,comments,topic)').eq('brand_id', brand.id).eq('run_id', lastPeople.run_id), 'bundle people')
        : [];
      const social = must(await sb.from('social_accounts').select('*').eq('brand_id', brand.id), 'bundle social');
      const lastRun = must(await sb.from('runs').select('id,status,cost_usd,started_at,finished_at').eq('brand_id', brand.id).order('created_at', { ascending: false }).limit(1).maybeSingle(), 'bundle run');
      return { brand, profile, stakeholders, social, lastRun };
    },
  };
}
