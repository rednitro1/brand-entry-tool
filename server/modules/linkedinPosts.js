/* A stakeholder's recent public LinkedIn posts (read-only, via Firecrawl's harvestapi
   provider) and the pattern in them. The tool never posts, comments or connects; it only
   reads public posts so the strategy step can cite them as receipts. */

const TOPICS = [
  ['promotion', /\b(promotion|promoted|new role|excited to share (that )?i|thrilled to announce my|starting a new position|joined the team as)\b/i],
  // Phrases, not single words: "strategy" or "learned" appear in graduation and promo posts too.
  ['tactics', /\b(how (we|i|our team)|lessons (we |i )?learned|tips (for|on)|playbook|framework|case study|here'?s what (we|i) (learned|did)|our approach to|workflow)\b/i],
  ['company_win', /\b(record|award|named|brand of the year|revenue|milestone|results|launch(ed)?|surpassed|billion)\b/i],
  ['team', /\b(team|grateful|proud of|speak(ing)? at|panel|conference|celebrat)\b/i],
];

export function classifyTopic(text) {
  for (const [topic, re] of TOPICS) if (re.test(String(text || ''))) return topic;
  return 'other';
}

const slugOf = (u) => {
  const m = String(u || '').match(/linkedin\.com\/(?:in|posts)\/([^/_?#]+)/i);
  return m ? decodeURIComponent(m[1]).toLowerCase() : null;
};

/* harvestapi doesn't flag reposts: a post in Kira's feed authored by john-fieldly or
   celsius-inc- has no repostId. The author slug in the post URL is the reliable signal. */
export function mapPost(el, profileUrl) {
  const owner = slugOf(profileUrl);
  const authorSlug = slugOf(el.linkedinUrl) || slugOf(el.author?.linkedinUrl);
  const isRepost = Boolean(el.repostId || el.repost) || (owner && authorSlug && authorSlug !== owner);
  return {
    url: el.linkedinUrl,
    posted_at: el.postedAt?.date || null,
    text: el.content || '',
    is_repost: Boolean(isRepost),
    original_author: isRepost ? (el.author?.name || authorSlug) : null,
    reactions: Number.isFinite(el.engagement?.likes) ? el.engagement.likes : null,
    comments: Number.isFinite(el.engagement?.comments) ? el.engagement.comments : null,
    topic: classifyTopic(el.content),
  };
}

/* The receipts the strategy step needs: how often they post, what about, and the most
   recent post of their own (the comment target). */
export function postPattern(posts, now = new Date()) {
  const own = posts.filter((p) => !p.is_repost);
  const lastYear = own.filter((p) => p.posted_at && now - new Date(p.posted_at) < 365 * 864e5);
  const byTopic = {};
  for (const p of own) byTopic[p.topic] = (byTopic[p.topic] || 0) + 1;
  const sorted = [...own].sort((a, b) => String(b.posted_at).localeCompare(String(a.posted_at)));
  return {
    total: posts.length,
    own: own.length,
    reposts: posts.length - own.length,
    own_last_12_months: lastYear.length,
    by_topic: byTopic,
    posts_tactics: (byTopic.tactics || 0) > 0,
    latest_own: sorted[0] ? { url: sorted[0].url, posted_at: sorted[0].posted_at, topic: sorted[0].topic } : null,
  };
}

export async function fetchRecentPosts({ fc, profileUrl, name = 'profile', log = () => {} }) {
  const data = await fc.alexandria('harvestapi', 'linkedin/profile-posts', { profile: profileUrl });
  const posts = (data?.elements || []).map((el) => mapPost(el, profileUrl)).filter((p) => p.url);
  const reposts = posts.filter((p) => p.is_repost).length;
  log(`${name}: ${posts.length} recent LinkedIn posts (${posts.length - reposts} own, ${reposts} reposts)`);
  return { posts, pattern: postPattern(posts) };
}

/* The brand's own LinkedIn page posts. Reposts carry a repostId; their text is the
   brand's caption (often empty), so the original's text is kept as a fallback. */
export function mapCompanyPost(el) {
  const isRepost = Boolean(el.repostId || el.repost);
  const text = el.content || (isRepost ? el.repost?.content : '') || '';
  return {
    id: String(el.id || el.linkedinUrl),
    url: el.linkedinUrl,
    posted_at: el.postedAt?.date || null,
    text,
    is_repost: isRepost,
    author: el.author?.name || null,
    reactions: Number.isFinite(el.engagement?.likes) ? el.engagement.likes : null,
    comments: Number.isFinite(el.engagement?.comments) ? el.engagement.comments : null,
    type: el.postImages ? 'image' : 'text',
    topic: classifyTopic(text),
  };
}

export async function fetchCompanyPosts({ fc, companyUrl, name = 'the brand', log = () => {} }) {
  const data = await fc.alexandria('harvestapi', 'linkedin/company-posts', { company: companyUrl });
  const posts = (data?.elements || []).map(mapCompanyPost).filter((p) => p.url);
  const recent = posts.filter((p) => p.posted_at && Date.now() - new Date(p.posted_at) < 90 * 864e5).length;
  log(`${name} LinkedIn page: ${posts.length} recent posts, ${recent} in the last 3 months`);
  return posts;
}

/* Posts in the last N days (default 90), the window the activity table and picks use. */
export const withinDays = (iso, days = 90, now = new Date()) => Boolean(iso) && now - new Date(iso) < days * 864e5 && new Date(iso) <= now;
