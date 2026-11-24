/* Signals: what changed at an account recently, pulled out of the saved research so it
   isn't buried in the summary. Pure and free (no AI call); shared by the browser and the
   tests. Every signal points at its receipt: a fact (with its source quote) or a person's
   job history from Apollo. */

/* A LinkedIn post announcing an open role ("The Alani social team is hiring!"). It's a
   signal that the workload is growing, not something to react to as content. */
const HIRING = /\b(?:(?:we(?:'re| are)|is|are|now|team(?:'s)? (?:is )?)\s*hiring\b|hiring (?:a|an|for|our)\b|join (?:our|the|my) (?:\w+ ){0,2}team\b|open (?:role|roles|position|positions)\b|job opening|apply (?:below|here|now|today)\b|we(?:'re| are) looking for (?:a|an)\b)/i;
export const isHiringPost = (text) => HIRING.test(String(text || ''));

export const SIGNAL_GROUPS = [
  ['people', 'People moves', 'New seats and leadership changes'],
  ['hiring', 'Hiring', 'Open roles posted on LinkedIn: a sign the workload is growing'],
  ['corporate', 'Corporate events', 'Acquisitions, stakes and ownership changes'],
  ['launch', 'Launches', 'New products and campaigns'],
  ['financial', 'Financial results', 'Reported numbers'],
];

const KIND_GROUP = { leadership: 'people', acquisition: 'corporate', launch: 'launch', financial: 'financial' };
/* Leadership and corporate facts only count when the wording says something changed:
   "Kyle Watson was named Chief Brand Officer" is a signal, "John Fieldly is CEO" is not. */
const CHANGE = {
  people: /\b(appoint\w*|became|becomes|named|names|join(s|ed|ing)?|hire[ds]?|hiring|promot\w*|step(s|ped)? down|depart\w*|leav(es|ing)|left|replac\w*|succeed\w*|successor|retir\w*|resign\w*|tapped|tap(s)?|tak(es|ing) over|took over|new (chief|ceo|cmo|cfo|coo|cto|president|head|vp|vice president|director))\b/i,
  corporate: /\b(acqui\w*|merg\w*|stake|invest\w*|bought|buy(s|ing)?|purchas\w*|deal|sold|sell(s|ing)?|divest\w*|spin(s|ning)? off|spun off|takeover|funding|rais(es|ed|ing))\b/i,
};
const NEW_SEAT_MONTHS = 12; // "in the role under a year"
const RECENT_MONTHS = 24; // older signals are tucked under "show older"

/* 'YYYY', 'YYYY-MM' or 'YYYY-MM-DD' to a UTC date; null if unusable. */
export function parseDate(s) {
  const m = String(s || '').match(/^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?/);
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), m[2] ? Number(m[2]) - 1 : 0, m[3] ? Number(m[3]) : 1));
}

export function monthsAgo(date, now = new Date()) {
  if (!date) return null;
  return (now.getUTCFullYear() - date.getUTCFullYear()) * 12 + (now.getUTCMonth() - date.getUTCMonth());
}

/* Returns { groups: [{ key, title, sub, items }], count } with items newest first,
   undated last. Each item: { group, date, months, text, recent, older, ref } where ref is
   { type: 'fact', fact } or { type: 'person', person }. */
export function buildSignals(bundle, now = new Date()) {
  const items = [];
  for (const f of bundle?.profile?.facts || []) {
    const group = KIND_GROUP[f.kind];
    if (!group) continue;
    if (CHANGE[group] && !CHANGE[group].test(f.claim || '')) continue;
    const date = parseDate(f.date);
    items.push({ group, date, text: f.claim, ref: { type: 'fact', fact: f } });
  }
  // Hiring posts from the team and the brand page, past year, one per post URL.
  const seen = new Set();
  const posts = [
    ...(bundle?.stakeholders || []).flatMap((s) => (s.stakeholder_posts || []).map((p) => ({ url: p.url, posted_at: p.posted_at, text: p.text, author: s.full_name }))),
    ...(bundle?.brandPosts || []).map((p) => ({ url: p.url, posted_at: p.posted_at, text: p.caption, author: `${bundle?.brand?.name || 'Brand'} page` })),
  ];
  for (const p of posts) {
    if (!p.url || seen.has(p.url) || !isHiringPost(p.text)) continue;
    const date = p.posted_at ? new Date(p.posted_at) : null;
    const m = monthsAgo(date, now);
    if (m === null || m < 0 || m > 12) continue;
    seen.add(p.url);
    const excerpt = String(p.text).replace(/\s+/g, ' ').trim();
    items.push({ group: 'hiring', date, text: `${p.author} posted an opening: "${excerpt.length > 110 ? `${excerpt.slice(0, 110).trimEnd()}…` : excerpt}"`, ref: { type: 'post', post: p } });
  }
  for (const s of bundle?.stakeholders || []) {
    const date = parseDate(s.started_role_at);
    const m = monthsAgo(date, now);
    if (m === null || m < 0 || m > NEW_SEAT_MONTHS) continue;
    // Same start month for the company and the role = a new hire; otherwise a move inside.
    const companyStart = parseDate(s.started_company_at);
    const newHire = companyStart && monthsAgo(companyStart, now) === m;
    items.push({
      group: 'people', date,
      text: `${s.full_name} ${newHire ? 'joined as' : 'moved into the role of'} ${s.title}`,
      ref: { type: 'person', person: s },
    });
  }
  for (const it of items) {
    it.months = monthsAgo(it.date, now);
    it.recent = it.months !== null && it.months <= 6;
    it.older = it.months !== null && it.months > RECENT_MONTHS;
  }
  const order = (a, b) => (a.date && b.date ? b.date - a.date : a.date ? -1 : b.date ? 1 : 0);
  const groups = SIGNAL_GROUPS.map(([key, title, sub]) => ({ key, title, sub, items: items.filter((i) => i.group === key).sort(order) }))
    .filter((g) => g.items.length);
  return { groups, count: items.filter((i) => !i.older).length };
}
