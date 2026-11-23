import { z } from 'zod';
import { validateClaims, hostOf, urlKey, stripEmDashes } from '../evidence.js';

/* Brand profile: who they are, what they do, recent changes (acquisitions, launches,
   leadership moves). Firecrawl finds and fetches sources; Claude extracts claims, each
   with a verbatim quote; evidence.js keeps only the claims whose quote is really on the
   cited page. Summary points survive only if a fact behind them survived. */

const MAX_PAGES = 10;
const MAX_CHARS_PER_PAGE = 14_000;

/* Ownership as of today decides where quarterly numbers come from:
     subsidiary          -> the parent's quarterly reports (and any brand breakout in them)
     independent_public  -> the company's own quarterly reports
     independent_private / unknown -> no public quarterly reporting; the UI says so
   The status must rest on a fact that survives the receipts check, or it drops to unknown. */
export const OwnershipSchema = z.object({
  status: z.enum(['subsidiary', 'independent_public', 'independent_private', 'unknown']),
  parent_company: z.string().nullable().describe('Current owner if status is subsidiary, else null'),
  parent_domain: z.string().nullable().describe('Parent website domain if a source states it, e.g. celsiusholdingsinc.com, else null'),
  ticker: z.string().nullable().describe('Stock ticker of the reporting entity (parent if subsidiary, else the company) if a source states it'),
  as_of: z.string().nullable().describe('Date of the most recent source supporting this status, YYYY-MM-DD or YYYY-MM'),
  fact_ids: z.array(z.string()).describe('ids of the facts that support this status'),
  reasoning: z.string().describe('One sentence. If sources disagree, say which newer or primary source wins'),
});

export const ProfileSchema = z.object({
  ownership: OwnershipSchema,
  facts: z.array(z.object({
    id: z.string().describe('f1, f2, ...'),
    claim: z.string().describe('One factual statement, plain language'),
    kind: z.enum(['about', 'acquisition', 'launch', 'leadership', 'financial', 'other']),
    date: z.string().nullable().describe('YYYY-MM-DD or YYYY-MM if the source states it, else null'),
    url: z.string().describe('Exact URL of the source page this came from, copied from the SOURCE header'),
    quote: z.string().describe('Verbatim sentence or phrase copied character-for-character from that page that supports the claim'),
    inferred: z.boolean().describe('true if the claim is an inference from wording rather than stated outright'),
    vendor: z.boolean().describe('true if the source is a vendor/agency/third party promoting its own work with the brand'),
  })),
  conflicts: z.array(z.object({
    topic: z.string(),
    sources: z.array(z.object({ url: z.string(), says: z.string() })),
    resolution: z.string().describe('Which source to prefer and why (primary over secondary), or "unresolved"'),
  })),
  summary_points: z.array(z.object({
    text: z.string().describe('One sentence for the brand summary'),
    fact_ids: z.array(z.string()).describe('ids of the facts this sentence rests on'),
  })),
});

const SYSTEM = `You research consumer brands for a B2B sales team. You extract facts ONLY from the source pages provided.
Rules:
- Every fact must cite exactly one provided SOURCE url and include a verbatim quote copied from that page. Never paraphrase inside "quote".
- If sources disagree (names, titles, dates, who replaced whom), record a conflict with both URLs. Prefer the company's own releases and filings over articles and notes.
- Mark inferences (e.g. a seat swap implied by press-release wording) with inferred=true.
- Mark claims from vendors/agencies promoting their own work with the brand vendor=true.
- Titles of people must be quoted exactly as the source writes them.
- Ownership: decide who owns the company TODAY. A newer acquisition or divestiture beats an older or undated profile ("Type: Private" on a stale page loses to a dated acquisition release). Use subsidiary only if a source says the company is owned by or was acquired by another company and nothing newer reverses it. Use independent_public only if a source says the company itself is publicly traded. Use independent_private only if a source says it is privately held or independently owned. Otherwise unknown. Cite the supporting fact ids.
- If something is not in the sources, leave it out. Do not use outside knowledge.
- Do not use em dashes.`;

/* Pure: which entity files the quarterly reports, given ownership that survived the
   receipts check. Returns null when there is no public reporting to look for. */
export function reportingEntity(ownership, acceptedFactIds, brand) {
  const backed = (ownership?.fact_ids || []).some((id) => acceptedFactIds.has(id));
  if (!ownership || !backed) return null;
  if (ownership.status === 'subsidiary' && ownership.parent_company && !slugEq(ownership.parent_company, brand.name)) {
    return { kind: 'parent', name: ownership.parent_company, domain: cleanDomain(ownership.parent_domain), ticker: ownership.ticker };
  }
  if (ownership.status === 'independent_public') {
    return { kind: 'self', name: brand.name, domain: brand.domain, ticker: ownership.ticker };
  }
  return null;
}

export function reportingQuery(entity, brand, year = new Date().getFullYear()) {
  const who = entity.ticker ? `${entity.name} (${entity.ticker})` : entity.name;
  return entity.kind === 'parent'
    ? `${who} quarterly results ${year} ${brand.name} net sales`
    : `${who} quarterly results ${year} earnings release`;
}

/* Prefer the reporting entity's own IR site or a wire release, then anything else. */
export function rankReportPages(hits, entity) {
  const primary = (u) => {
    const h = hostOf(u);
    return (entity.domain && (h === entity.domain || h.endsWith(`.${entity.domain}`))) ||
      /businesswire\.com|prnewswire\.com|globenewswire\.com|sec\.gov|q4cdn\.com/.test(h) || /^ir\.|^investors?\./.test(h);
  };
  return [...hits].sort((a, b) => Number(primary(b.url)) - Number(primary(a.url)));
}

function cleanDomain(d) {
  return d ? String(d).replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '').toLowerCase() : null;
}

/* The first live Alani Nu run missed the newest leadership move and the latest quarter:
   generic queries rank older, better-linked pages first. The dated queries below pull
   current-year news and earnings releases (which also name the parent company). */
export function profileQueries(brand, year = new Date().getFullYear()) {
  const n = brand.name;
  return [
    { q: `${n} brand founded company about`, limit: 5 },
    { q: `${n} acquisition OR acquired OR "parent company"`, limit: 5 },
    { q: `${n} launch OR new flavor OR new product ${year}`, limit: 5 },
    { q: `${n} "chief marketing officer" OR CMO OR "head of social" appointed`, limit: 5 },
    { q: `${n} named chief marketing officer ${year}`, limit: 5 },
    { q: `${n} net sales quarter results ${year}`, limit: 5 },
  ];
}

/* Choose which pages to fetch: dedupe, skip retailers and social sites, keep the brand's
   own site first, and cap the count so a run's cost is bounded. */
export function choosePages(results, brand, max = MAX_PAGES) {
  const skip = /amazon\.|target\.com|walmart\.com|gnc\.com|vitaminshoppe\.com|instagram\.com|tiktok\.com|facebook\.com|x\.com|twitter\.com|youtube\.com|reddit\.com|pinterest\./;
  const seen = new Set();
  const own = [];
  const rest = [];
  for (const r of results) {
    const k = urlKey(r.url);
    if (seen.has(k) || skip.test(hostOf(r.url))) continue;
    seen.add(k);
    (brand.domain && hostOf(r.url).endsWith(brand.domain) ? own : rest).push(r);
  }
  return [...own.slice(0, 2), ...rest].slice(0, max);
}

export function buildSourcesPrompt(brand, pages) {
  const blocks = pages.map((p, i) => {
    const text = p.markdown.length > MAX_CHARS_PER_PAGE ? `${p.markdown.slice(0, MAX_CHARS_PER_PAGE)}\n[... page truncated at ${MAX_CHARS_PER_PAGE} chars]` : p.markdown;
    return `=== SOURCE ${i + 1} ===\nURL: ${p.url}\nTITLE: ${p.title || ''}\n${text}`;
  });
  return `Brand: ${brand.name}${brand.domain ? ` (official site ${brand.domain})` : ''}\nToday: ${new Date().toISOString().slice(0, 10)}\n\n${blocks.join('\n\n')}\n\nExtract the brand profile facts, conflicts and summary points.`;
}

/* Pure post-processing, separated so it's testable against fixtures. */
export function finalizeProfile(raw, pages, brand, reporting = null) {
  const own = raw.ownership || { status: 'unknown', fact_ids: [] };
  const brandDomains = [brand.domain].filter(Boolean);
  const primaryHints = [cleanDomain(own.parent_domain)].filter(Boolean);
  const { accepted, rejected } = validateClaims(raw.facts, pages, { brandDomains, primaryHints });
  const ok = new Set(accepted.map((f) => f.id));
  const summary = raw.summary_points
    .filter((s) => s.fact_ids.some((id) => ok.has(id)))
    .map((s) => ({ text: stripEmDashes(s.text), fact_ids: s.fact_ids.filter((id) => ok.has(id)) }));
  const fetched = new Set(pages.map((p) => urlKey(p.url)));
  const conflicts = raw.conflicts
    .map((c) => ({ ...c, sources: c.sources.filter((s) => fetched.has(urlKey(s.url))) }))
    .filter((c) => c.sources.length >= 2);

  // Ownership only counts if a fact behind it kept its receipt.
  const ownFacts = (own.fact_ids || []).filter((id) => ok.has(id));
  const ownership = ownFacts.length
    ? { ...own, fact_ids: ownFacts, reasoning: stripEmDashes(own.reasoning) }
    : { status: 'unknown', parent_company: null, parent_domain: null, ticker: null, as_of: null, fact_ids: [],
        reasoning: own.status !== 'unknown' ? `Model said ${own.status} but no supporting source passed the receipts check.` : 'No source states who owns the company.' };

  return {
    ownership,
    reporting: reporting || describeReporting(ownership, brand, null),
    summary,
    facts: accepted.map((f) => ({ ...f, claim: stripEmDashes(f.claim) })),
    rejected,
    conflicts,
    sources: pages.map((p) => ({ url: p.url, title: p.title, kind: brandDomains.some((d) => hostOf(p.url).endsWith(d)) ? 'primary' : 'other' })),
  };
}

/* What the UI says about quarterly numbers, for every ownership outcome. */
export function describeReporting(ownership, brand, result) {
  const entity = reportingEntity(ownership, new Set(ownership.fact_ids || []), brand);
  if (!entity) {
    const why = ownership.status === 'independent_private'
      ? `${brand.name} is privately held, so there are no public quarterly reports.`
      : `Ownership could not be confirmed from sources, so no quarterly reports were pulled.`;
    return { status: 'none_public', entity: null, note: why, urls: [] };
  }
  if (!result || result.urls.length === 0) {
    return { status: 'not_found', entity, note: `No ${entity.kind === 'parent' ? `${entity.name} ` : ''}quarterly report found for the current year.`, urls: [] };
  }
  const note = entity.kind === 'parent'
    ? (result.brandFacts > 0
        ? `From ${entity.name}'s quarterly reporting, which breaks out ${brand.name}.`
        : `${entity.name}'s quarterly report was found but does not break out ${brand.name}. Parent totals are not shown as brand numbers.`)
    : `From ${brand.name}'s own quarterly reporting.`;
  return { status: 'found', entity, note, urls: result.urls };
}

export async function buildProfile({ brand, fc, claude, log = () => {} }) {
  const results = [];
  for (const { q, limit } of profileQueries(brand)) {
    try { results.push(...await fc.search(q, { limit })); } catch (err) { log(`search failed (${q}): ${err.message}`); }
  }
  if (brand.siteUrl) results.unshift({ url: brand.siteUrl, title: `${brand.name} official site` });
  const chosen = choosePages(results, brand);
  log(`${results.length} search results -> fetching ${chosen.length} pages`);

  const pages = await fetchPages(chosen, fc, log);
  if (pages.length === 0) throw new Error('No readable sources found for this brand.');
  const truncated = pages.filter((p) => p.markdown.length > MAX_CHARS_PER_PAGE).length;
  if (truncated) log(`${truncated} long page(s) truncated to ${MAX_CHARS_PER_PAGE} chars for the model`);

  const { parsed } = await claude.structured({ system: SYSTEM, user: buildSourcesPrompt(brand, pages), schema: ProfileSchema, effort: 'medium' });

  // Decide ownership on receipts-checked facts before spending anything on reports.
  const firstPass = finalizeProfile(parsed, pages, brand);
  const own = firstPass.ownership;
  log(`ownership: ${own.status}${own.parent_company ? ` (parent: ${own.parent_company})` : ''}${own.as_of ? ` as of ${own.as_of}` : ''}`);
  const entity = reportingEntity(own, new Set(own.fact_ids), brand);
  if (!entity) {
    log('no public quarterly reporting to pull');
    return firstPass;
  }

  /* Pass 2: quarterly reports from the reporting entity. A sub-brand's latest numbers
     live in the parent's release, which brand-name searches don't surface (Alani Nu's
     Q3 2026 net sales are only in Celsius Holdings' earnings materials). */
  let reportResult = { urls: [], brandFacts: 0 };
  try {
    const hits = rankReportPages(await fc.search(reportingQuery(entity, brand), { limit: 6 }), entity);
    const have = new Set(pages.map((p) => urlKey(p.url)));
    const fresh = hits.filter((r) => !have.has(urlKey(r.url))).slice(0, 2);
    const extra = await fetchPages(fresh, fc, log);
    if (extra.length) {
      const { parsed: p2 } = await claude.structured({
        system: SYSTEM,
        user: `${buildSourcesPrompt(brand, extra)}\nThese are quarterly reports from ${entity.name}. Extract ${brand.name}'s most recent reported results (kind=financial). Only state a number as ${brand.name}'s if the source attributes it to ${brand.name}. Use ids q1, q2, ...`,
        schema: ProfileSchema, effort: 'low',
      });
      parsed.facts.push(...p2.facts);
      parsed.summary_points.push(...p2.summary_points);
      parsed.conflicts.push(...p2.conflicts);
      pages.push(...extra);
      const kept = validateClaims(p2.facts, extra, { primaryHints: [entity.domain].filter(Boolean) }).accepted;
      reportResult = { urls: extra.map((p) => p.url), brandFacts: kept.filter((f) => f.kind === 'financial').length };
      log(`reports (${entity.name}): ${extra.length} page(s), ${reportResult.brandFacts} ${brand.name} financial fact(s)`);
    } else log(`reports (${entity.name}): none found`);
  } catch (err) { log(`report pass skipped: ${err.message}`); }

  const profile = finalizeProfile(parsed, pages, brand, describeReporting(own, brand, reportResult));
  profile.ownership = own; // keep the first-pass decision; pass 2 is about numbers, not ownership
  log(`facts: ${profile.facts.length} kept, ${profile.rejected.length} rejected (no receipt); conflicts: ${profile.conflicts.length}`);
  return profile;
}

async function fetchPages(list, fc, log) {
  const pages = [];
  await Promise.all(list.map(async (r) => {
    try {
      const p = await fc.scrape(r.url, { formats: ['markdown'] });
      if (p.markdown && p.markdown.length > 200) pages.push({ url: r.url, title: p.title || r.title, markdown: p.markdown, publishedAt: p.publishedAt });
      else log(`skipped thin page: ${r.url}`);
    } catch (err) { log(`fetch failed ${r.url}: ${err.message}`); }
  }));
  return pages;
}

const slugEq = (a, b) => String(a).toLowerCase().replace(/[^a-z0-9]/g, '').includes(String(b).toLowerCase().replace(/[^a-z0-9]/g, ''));
