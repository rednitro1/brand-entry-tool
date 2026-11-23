/* Stakeholders: people at the brand who match Nectar's four wedge personas, plus the
   social/community team under them.

   Order of operations, cheapest first:
     1. Apollo search by brand domain            (free)
     2. Apollo search by brand name, any company (free; catches people filed under a parent,
        e.g. "Customer Support Manager - Alani Nu" at CELSIUS)
     3. Classify titles; pick who is worth revealing (wedge personas first, capped)
     4. Apollo match on the picks                (1 credit each): LinkedIn URL + history
     5. If a wedge persona is still empty, Prospeo search on the domain (fallback)
   Titles always come from the provider record, never from secondhand notes. */

export const PERSONAS = ['cmo', 'director_social', 'chief_digital', 'director_cx'];
export const PERSONA_LABEL = {
  cmo: 'CMO',
  director_social: 'Director of Social',
  chief_digital: 'Chief Digital Officer',
  director_cx: 'Director of CX',
  team_social: 'Social / community team',
};

const SENIOR = /\b(director|head|vp|vice president|svp|evp|chief|lead)\b/i;

/* Title -> persona. Order matters: a "VP, Social & Customer Care" counts as social. */
export function classifyPersona(rawTitle) {
  const t = String(rawTitle || '').toLowerCase();
  if (!t || /\b(intern|assistant to|student|ambassador|freelance)\b/.test(t)) return null;
  if (/chief marketing officer|\bcmo\b/.test(t)) return 'cmo';
  if (/chief digital|\bcdo\b/.test(t)) return 'chief_digital';
  const social = /social|influencer|community|creator/.test(t);
  const cx = /(customer|consumer|guest|member) (experience|care|service|support|success)|\bcx\b/.test(t);
  if (social && SENIOR.test(t)) return 'director_social';
  if (cx && SENIOR.test(t)) return 'director_cx';
  if (social || cx) return 'team_social';
  return null;
}

const rankWithin = (title) => {
  const t = String(title || '').toLowerCase();
  if (/chief|\bcmo\b|\bcdo\b/.test(t)) return 0;
  if (/\b(svp|evp|vp|vice president)\b/.test(t)) return 1;
  if (/\b(head|director)\b/.test(t)) return 2;
  if (/\bmanager|lead\b/.test(t)) return 3;
  return 4;
};

/* From free search rows, choose who to reveal: up to 2 per wedge persona, then team
   members, within maxReveals credits. Dedupes by Apollo id. */
export function pickReveals(rows, { maxReveals = 6 } = {}) {
  const seen = new Set();
  const byPersona = new Map();
  for (const r of rows) {
    if (!r?.id || seen.has(r.id)) continue;
    seen.add(r.id);
    const persona = classifyPersona(r.title);
    if (!persona) continue;
    if (!byPersona.has(persona)) byPersona.set(persona, []);
    byPersona.get(persona).push({ ...r, persona });
  }
  for (const list of byPersona.values()) list.sort((a, b) => rankWithin(a.title) - rankWithin(b.title));
  const picks = [];
  for (const p of PERSONAS) picks.push(...(byPersona.get(p) || []).slice(0, 2));
  picks.push(...(byPersona.get('team_social') || []));
  return picks.slice(0, maxReveals);
}

const monthsBetween = (a, b = new Date()) => {
  const d = new Date(a);
  if (Number.isNaN(d.getTime())) return null;
  // UTC getters: '2025-10-01' parses as UTC midnight, which is Sept 30 in US time zones.
  return Math.max(0, (b.getUTCFullYear() - d.getUTCFullYear()) * 12 + (b.getUTCMonth() - d.getUTCMonth()));
};

const normTitle = (t) => String(t || '').toLowerCase().replace(/\s*[-–(].*$/, '').replace(/[^a-z ]/g, '').trim();

/* Apollo employment history repeats roles across the brand and its parent (Kira's current
   title appears under both "Alani Nutrition" and "CELSIUS ... - Alani Nu"). Role start =
   earliest start of any current entry with the same title; company start = earliest start
   at any org matching the brand or parent names. */
export function tenureFromHistory(history, { title, orgNames = [], now = new Date() } = {}) {
  const rows = (history || []).filter((e) => e?.start_date);
  const names = orgNames.map((n) => n.toLowerCase().replace(/[^a-z0-9]/g, '')).filter(Boolean);
  const atOrg = (e) => {
    const o = String(e.organization_name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const t = String(e.title || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    return names.some((n) => o.includes(n) || n.includes(o) || t.includes(n));
  };
  const want = normTitle(title);
  const roleRows = rows.filter((e) => e.current && normTitle(e.title) === want);
  const companyRows = rows.filter(atOrg);
  const earliest = (list) => list.map((e) => e.start_date).sort()[0] || null;
  const startedRole = earliest(roleRows);
  const startedCompany = earliest(companyRows);
  return {
    started_role_at: startedRole,
    started_company_at: startedCompany,
    tenure_months: startedRole ? monthsBetween(startedRole, now) : null,
    company_tenure_months: startedCompany ? monthsBetween(startedCompany, now) : null,
  };
}

export const normLinkedin = (u) => {
  if (!u) return null;
  const m = String(u).match(/linkedin\.com\/in\/([^/?#]+)/i);
  return m ? `https://www.linkedin.com/in/${decodeURIComponent(m[1]).toLowerCase()}/` : null;
};

export function stakeholderFromApollo(person, persona, { orgNames, now } = {}) {
  const tenure = tenureFromHistory(person.employment_history, { title: person.title, orgNames, now });
  return {
    full_name: person.name || [person.first_name, person.last_name].filter(Boolean).join(' '),
    title: person.title || null,
    persona,
    linkedin_url: normLinkedin(person.linkedin_url),
    ...tenure,
    found_via: 'apollo',
    verification: 'single_source',
    evidence: [{ claim: `Title "${person.title}" per Apollo`, url: normLinkedin(person.linkedin_url), label: 'single_source' }],
  };
}

export function stakeholderFromProspeo(row) {
  const p = row.person || {};
  const title = p.current_job_title || null;
  return {
    full_name: p.full_name || [p.first_name, p.last_name].filter(Boolean).join(' '),
    title,
    persona: classifyPersona(title),
    linkedin_url: normLinkedin(p.linkedin_url),
    started_role_at: null, started_company_at: null, tenure_months: null, company_tenure_months: null,
    found_via: 'prospeo',
    verification: 'single_source',
    evidence: [{ claim: `Title "${title}" per Prospeo`, url: normLinkedin(p.linkedin_url), label: 'single_source' }],
  };
}

export function coverage(stakeholders) {
  const have = new Set(stakeholders.map((s) => s.persona));
  return Object.fromEntries(PERSONAS.map((p) => [p, have.has(p)]));
}

const APOLLO_TITLES = [
  'chief marketing officer', 'cmo', 'chief digital officer', 'director of social media', 'head of social',
  'social media', 'influencer marketing', 'community', 'director of customer experience', 'consumer experience', 'customer care',
];

export async function findStakeholders({ brand, parentName = null, apollo, prospeo, log = () => {}, maxReveals = 6 }) {
  const orgNames = [brand.name, brand.domain?.split('.')[0], parentName].filter(Boolean);
  const rows = [];
  if (brand.domain) {
    log(`Searching Apollo for marketing, social, digital and CX leaders at ${brand.domain}`);
    try { rows.push(...await apollo.search({ q_organization_domains_list: [brand.domain], person_titles: APOLLO_TITLES })); }
    catch (err) { log(`Apollo domain search failed: ${err.message}`); }
  }
  log(`Searching Apollo by name: ${brand.name}`);
  try { rows.push(...await apollo.search({ q_keywords: brand.name, person_titles: APOLLO_TITLES })); }
  catch (err) { log(`Apollo name search failed: ${err.message}`); }
  log.progress?.(0.15);
  const picks = pickReveals(rows, { maxReveals });
  log(`Apollo: ${rows.length} possible matches, revealing the best ${picks.length} (1 credit each)`);

  const out = [];
  for (const [i, pick] of picks.entries()) {
    try {
      const person = await apollo.match(pick.id);
      if (person?.linkedin_url) {
        const s = stakeholderFromApollo(person, classifyPersona(person.title) || pick.persona, { orgNames });
        out.push(s);
        log(`Found ${s.full_name}, ${s.title}${PERSONA_LABEL[s.persona] && s.persona !== 'team_social' ? ` (wedge persona: ${PERSONA_LABEL[s.persona]})` : ''}`);
      } else log(`Apollo had no LinkedIn profile for ${pick.first_name}, skipped`);
    } catch (err) { log(`Apollo reveal failed for ${pick.first_name}: ${err.message}`); }
    log.progress?.(0.15 + 0.35 * ((i + 1) / picks.length));
  }

  const missing = PERSONAS.filter((p) => !coverage(out)[p]);
  if (missing.length && brand.domain) {
    log(`Not in Apollo: ${missing.map((p) => PERSONA_LABEL[p]).join(', ')}. Trying Prospeo`);
    try {
      const res = await prospeo.search({
        company: { websites: { include: [brand.domain] } },
        person_seniority: { include: ['C-Suite', 'Vice President', 'Director'] },
      });
      const known = new Set(out.map((s) => s.linkedin_url));
      for (const r of res) {
        const s = stakeholderFromProspeo(r);
        if (s.persona && s.linkedin_url && !known.has(s.linkedin_url)) { out.push(s); known.add(s.linkedin_url); }
      }
      log(`Prospeo: ${res.length} people, ${out.filter((s) => s.found_via === 'prospeo').length} matched a persona`);
    } catch (err) { log(`Prospeo search failed: ${err.message}`); }
  }
  log.progress?.(0.6);

  const cov = coverage(out);
  const gaps = PERSONAS.filter((p) => !cov[p]).map((p) => ({ persona: p, note: `No ${PERSONA_LABEL[p]} found in Apollo or Prospeo.` }));
  if (gaps.length) log(`Gaps: no ${gaps.map((g) => PERSONA_LABEL[g.persona]).join(', ')} found`);
  return { stakeholders: out, coverage: cov, gaps };
}
