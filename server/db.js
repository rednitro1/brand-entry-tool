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
    /* Accounts list: one row per brand with its owner and wedge-persona count from the
       latest profile / stakeholder rows. */
    async listBrands() {
      const brands = must(await sb.from('brands').select('id,slug,name,domain,is_example,updated_at').order('is_example', { ascending: false }).order('updated_at', { ascending: false }).limit(50), 'listBrands');
      if (!brands.length) return [];
      const ids = brands.map((b) => b.id);
      const profiles = must(await sb.from('brand_profiles').select('brand_id,ownership,created_at').in('brand_id', ids).order('created_at', { ascending: false }), 'listBrands profiles');
      const people = must(await sb.from('stakeholders').select('brand_id,run_id,persona,created_at').in('brand_id', ids).order('created_at', { ascending: false }), 'listBrands people');
      const active = must(await sb.from('runs').select('brand_id').in('brand_id', ids).in('status', ['queued', 'running']), 'listBrands active');
      return summarizeBrands(brands, profiles, people, active);
    },
    /* Spend tab. No IP hashes, no raw inputs: brand name, status, timing and costs only. */
    async listRuns() {
      const runs = must(await sb.from('runs').select('id,brand_id,status,cost_usd,started_at,finished_at,created_at').order('created_at', { ascending: false }).limit(200), 'listRuns');
      const runIds = runs.map((r) => r.id);
      const brandIds = [...new Set(runs.map((r) => r.brand_id).filter(Boolean))];
      const mods = runIds.length ? must(await sb.from('run_modules').select('run_id,module,status,cost_usd').in('run_id', runIds), 'listRuns modules') : [];
      const drafts = must(await sb.from('strategies').select('id,brand_id,status,cost_usd,created_at,finished_at').order('created_at', { ascending: false }).limit(200), 'listRuns drafts');
      const allBrandIds = [...new Set([...brandIds, ...drafts.map((d) => d.brand_id)])];
      const brands = allBrandIds.length ? must(await sb.from('brands').select('id,name,slug').in('id', allBrandIds), 'listRuns brands') : [];
      return [...shapeRuns(runs, mods, brands), ...shapeDrafts(drafts, brands)].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
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
      const modules = must(await sb.from('run_modules').select('module,status,progress,cost_usd,log,error,detail,started_at,finished_at').eq('run_id', runId), 'getRunModules');
      const brand = run.brand_id ? must(await sb.from('brands').select('slug,name').eq('id', run.brand_id).maybeSingle(), 'getRunBrand') : null;
      return { ...run, brand, modules };
    },
    /* Spend-cap inputs: cost of everything started today (UTC) and how many are in flight. */
    async spendToday() {
      const since = new Date(); since.setUTCHours(0, 0, 0, 0);
      const rows = must(await sb.from('runs').select('cost_usd,status').gte('created_at', since.toISOString()), 'spendToday');
      const drafts = must(await sb.from('strategies').select('cost_usd,status').gte('created_at', since.toISOString()), 'spendToday drafts');
      return {
        spentTodayUsd: [...rows, ...drafts].reduce((s, r) => s + Number(r.cost_usd || 0), 0),
        activeRuns: rows.filter((r) => r.status === 'running' || r.status === 'queued').length,
        activeDrafts: drafts.filter((r) => r.status === 'running').length,
      };
    },
    /* A process restart can orphan runs mid-flight; mark them failed so the UI isn't stuck
       on "running" and the spend cap doesn't keep reserving budget for them. */
    async failOrphanedRuns() {
      must(await sb.from('runs').update({ status: 'failed', error: 'Server restarted during the run.', finished_at: new Date().toISOString() }).eq('status', 'running'), 'failOrphanedRuns');
      must(await sb.from('run_modules').update({ status: 'failed', error: 'Server restarted during the run.' }).in('status', ['running', 'queued']), 'failOrphanedModules');
      must(await sb.from('strategies').update({ status: 'failed', error: 'Server restarted while drafting.', finished_at: new Date().toISOString() }).eq('status', 'running'), 'failOrphanedDrafts');
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
    /* Brand page posts go under the brand's social_accounts row for that platform. */
    async saveBrandPosts(brandId, platform, posts) {
      if (!posts.length) return;
      const acct = must(await sb.from('social_accounts').select('id').eq('brand_id', brandId).eq('platform', platform).maybeSingle(), 'saveBrandPosts account');
      if (!acct) return;
      const rows = posts.map((p) => ({
        id: p.id, social_account_id: acct.id, url: p.url, type: p.type || null, caption: p.text || null,
        posted_at: p.posted_at, likes: p.reactions, comments: p.comments, is_repost: p.is_repost, author: p.author || null,
        captured_at: new Date().toISOString(),
      }));
      must(await sb.from('social_posts').upsert(rows, { onConflict: 'social_account_id,id' }), 'saveBrandPosts');
    },

    /* Playbook: versioned; the latest row is the live one. */
    async getPlaybook() {
      return must(await sb.from('playbooks').select('id,content,note,created_at').order('created_at', { ascending: false }).limit(1).maybeSingle(), 'getPlaybook');
    },
    async savePlaybook(content, note = null) {
      return must(await sb.from('playbooks').insert({ content, note }).select('id,content,note,created_at').single(), 'savePlaybook');
    },

    /* Engagement drafts (strategies rows), drafted in the background like runs. */
    async createDraft({ brandId, model, picks = [], playbookId = null }) {
      return must(await sb.from('strategies').insert({ brand_id: brandId, model, output: {}, status: 'running', picks, playbook_id: playbookId }).select('id,status,created_at').single(), 'createDraft');
    },
    async finishDraft(id, { status, output = {}, picks = [], rejected = [], costUsd = 0, inputTokens = null, outputTokens = null, error = null }) {
      must(await sb.from('strategies').update({
        status, output, picks, rejected_claims: rejected, cost_usd: costUsd, input_tokens: inputTokens, output_tokens: outputTokens,
        error, finished_at: new Date().toISOString(),
      }).eq('id', id), 'finishDraft');
    },
    async getDraft(id) {
      return must(await sb.from('strategies').select('id,brand_id,status,model,output,picks,rejected_claims,cost_usd,error,created_at,finished_at').eq('id', id).maybeSingle(), 'getDraft');
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
      const li = social.find((x) => x.platform === 'linkedin');
      const brandPosts = li
        ? must(await sb.from('social_posts').select('id,url,caption,posted_at,likes,comments,is_repost,author').eq('social_account_id', li.id).order('posted_at', { ascending: false }).limit(100), 'bundle brand posts')
        : [];
      const draft = must(await sb.from('strategies').select('id,status,model,output,picks,rejected_claims,cost_usd,error,created_at,finished_at').eq('brand_id', brand.id).order('created_at', { ascending: false }).limit(1).maybeSingle(), 'bundle draft');
      const lastRun = must(await sb.from('runs').select('id,status,cost_usd,started_at,finished_at,created_at').eq('brand_id', brand.id).order('created_at', { ascending: false }).limit(1).maybeSingle(), 'bundle run');
      return { brand, profile, stakeholders, social, lastRun, brandPosts, draft };
    },
  };
}

export const WEDGE = new Set(['cmo', 'director_social', 'chief_digital', 'director_cx']);

/* Pure helpers (tested): latest profile per brand for the owner; wedge count from that
   brand's latest stakeholder run only. */
export function summarizeBrands(brands, profiles, people, active = []) {
  const running = new Set(active.map((r) => r.brand_id));
  return brands.map((b) => {
    const prof = profiles.find((p) => p.brand_id === b.id);
    const latestRun = people.find((p) => p.brand_id === b.id)?.run_id;
    const mine = people.filter((p) => p.brand_id === b.id && p.run_id === latestRun);
    const own = prof?.ownership || {};
    const owner = own.status === 'subsidiary' ? own.parent_company
      : own.status === 'independent_public' ? 'Public'
        : own.status === 'independent_private' ? 'Private' : null;
    return {
      slug: b.slug, name: b.name, domain: b.domain, is_example: b.is_example, updated_at: b.updated_at,
      owner, wedge_count: mine.filter((p) => WEDGE.has(p.persona)).length, people_count: mine.length,
      running: running.has(b.id),
    };
  });
}

export function shapeRuns(runs, mods, brands) {
  const brandById = Object.fromEntries(brands.map((b) => [b.id, b]));
  return runs.map((r) => ({
    id: r.id,
    kind: 'run',
    brand: brandById[r.brand_id] ? { name: brandById[r.brand_id].name, slug: brandById[r.brand_id].slug } : null,
    status: r.status,
    cost_usd: Number(r.cost_usd || 0),
    started_at: r.started_at,
    finished_at: r.finished_at,
    created_at: r.created_at,
    modules: mods.filter((m) => m.run_id === r.id).map((m) => ({ module: m.module, status: m.status, cost_usd: Number(m.cost_usd || 0) })),
  }));
}

/* Drafts appear on the Spend tab beside research runs. */
export function shapeDrafts(drafts, brands) {
  const brandById = Object.fromEntries(brands.map((b) => [b.id, b]));
  return drafts.map((d) => ({
    id: d.id,
    kind: 'draft',
    brand: brandById[d.brand_id] ? { name: brandById[d.brand_id].name, slug: brandById[d.brand_id].slug } : null,
    status: d.status === 'running' ? 'running' : d.status,
    cost_usd: Number(d.cost_usd || 0),
    started_at: d.created_at,
    finished_at: d.finished_at,
    created_at: d.created_at,
    modules: [],
  }));
}
