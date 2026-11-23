/* Page stats per platform: followers, following, post count. Start simple; post-level
   analysis comes later. Each platform is independent: one failing never blocks the others.
   Sources (recorded responses in fixtures/recorded/):
     instagram  apify/instagram-profile-scraper   (age-gated accounts: counts only, no post count)
     tiktok     clockworks/tiktok-profile-scraper (1 result is enough for authorMeta)
     x          apidojo/twitter-user-scraper      (follower/following list extraction OFF)
     linkedin   Firecrawl Alexandria orbisearch companies/enrich (follower_count) */

const num = (v) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : null);

export function mapInstagram(items, handle) {
  const p = items.find((i) => String(i.username || '').toLowerCase() === handle.toLowerCase()) || items[0];
  if (!p) throw new Error('no profile returned');
  const restricted = Boolean(p.isRestrictedProfile);
  return {
    followers: num(p.followersCount), following: num(p.followsCount), post_count: num(p.postsCount),
    extra: {
      verified: Boolean(p.verified),
      restricted,
      note: restricted ? `Instagram restricts this account (${p.restrictionReason || 'restricted'}). Post count and posts are not available to public scrapers.` : null,
    },
  };
}

export function mapTiktok(items) {
  const am = items.find((i) => i.authorMeta)?.authorMeta;
  if (!am) throw new Error(items[0]?.error || 'no profile returned');
  return { followers: num(am.fans), following: num(am.following), post_count: num(am.video), extra: { likes: num(am.heart), verified: Boolean(am.verified) } };
}

export function mapX(items) {
  const u = items.find((i) => i.type === 'user') || items[0];
  if (!u || u.followers === undefined) throw new Error(u?.error || 'no profile returned');
  return { followers: num(u.followers), following: num(u.following), post_count: num(u.statusesCount), extra: { verified: Boolean(u.isBlueVerified || u.isVerified) } };
}

export function mapLinkedin(data) {
  const r = data && typeof data.data === 'object' && !Array.isArray(data.data) ? data.data : data;
  if (!r || r.follower_count === undefined) throw new Error('no follower count returned');
  return { followers: num(r.follower_count), following: null, post_count: null, extra: { employees: num(r.employee_count), size: r.company_size?.label || null } };
}

const SOURCES = {
  instagram: {
    source: 'apify/instagram-profile-scraper',
    pull: ({ apify }, s) => apify.run('apify~instagram-profile-scraper', { usernames: [s.handle] }).then((it) => mapInstagram(it, s.handle)),
  },
  tiktok: {
    source: 'clockworks/tiktok-profile-scraper',
    pull: ({ apify }, s) => apify.run('clockworks~tiktok-profile-scraper', { profiles: [s.handle], resultsPerPage: 1, profileScrapeSections: ['videos'] }).then(mapTiktok),
  },
  x: {
    source: 'apidojo/twitter-user-scraper',
    pull: ({ apify }, s) => apify.run('apidojo~twitter-user-scraper', { twitterHandles: [s.handle], maxItems: 1, getFollowers: false, getFollowing: false, getRetweeters: false }).then(mapX),
  },
  linkedin: {
    source: 'firecrawl:orbisearch/companies/enrich',
    pull: ({ fc }, s) => fc.alexandria('orbisearch', 'companies/enrich', { linkedin_url: s.url }).then(mapLinkedin),
  },
};

export const PLATFORMS = Object.keys(SOURCES);

/* Returns one row per platform: stats, or an error/"not found" row so the UI shows a gap. */
export async function pullPageStats({ socials, apify, fc, log = () => {} }) {
  return Promise.all(PLATFORMS.map(async (platform) => {
    const s = socials?.[platform];
    const base = { platform, stats_source: SOURCES[platform].source };
    if (!s) return { ...base, handle: '', url: '', followers: null, following: null, post_count: null, error: 'No account found on the brand site or in search.' };
    try {
      const stats = await SOURCES[platform].pull({ apify, fc }, s);
      log(`${platform} @${s.handle}: ${stats.followers ?? '?'} followers`);
      return { ...base, handle: s.handle, url: s.url, ...stats, error: null };
    } catch (err) {
      log(`${platform} failed: ${err.message}`);
      return { ...base, handle: s.handle, url: s.url, followers: null, following: null, post_count: null, error: err.message };
    }
  }));
}
