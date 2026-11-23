/* Brand input -> canonical brand: name, official domain, LinkedIn company URL and social
   handles. Handles come from the brand's own site footer, never guessed from the name
   (Alani Nu's handles are "alaninutrition", not "alaninu"). */

const RETAIL_AND_DIRECTORY = [
  'amazon.', 'target.com', 'walmart.com', 'gnc.com', 'vitaminshoppe.com', 'costco.com', 'kroger.com',
  'cvs.com', 'walgreens.com', 'wikipedia.org', 'linkedin.com', 'instagram.com', 'tiktok.com', 'x.com',
  'twitter.com', 'facebook.com', 'youtube.com', 'reddit.com', 'crunchbase.com', 'bloomberg.com',
  'pitchbook.com', 'zoominfo.com', 'ebay.com', 'iherb.com', 'bodybuilding.com', 'instacart.com',
];

export function slugify(s) {
  return String(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}

export function parseInput(raw) {
  const input = String(raw || '').trim();
  if (!input) throw new Error('Enter a brand name or a LinkedIn company URL.');
  const m = input.match(/linkedin\.com\/company\/([^/?#\s]+)/i);
  if (m) {
    const slug = decodeURIComponent(m[1]).toLowerCase();
    return { kind: 'linkedin', linkedinSlug: slug, linkedinUrl: `https://www.linkedin.com/company/${slug}/`, name: titleFromSlug(slug) };
  }
  if (/^https?:\/\//i.test(input) || /linkedin\.com/i.test(input)) {
    throw new Error('Only LinkedIn company URLs (linkedin.com/company/...) are accepted as links. Otherwise type the brand name.');
  }
  if (input.length > 80) throw new Error('Brand name is too long.');
  return { kind: 'name', name: input };
}

function titleFromSlug(slug) {
  return slug.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

const tokens = (s) => slugify(s).split('-').filter((t) => t.length > 1);

/* Official site = first result whose host isn't a retailer/directory and that shares a
   token with the brand name. Falls back to null rather than guessing a retailer page. */
export function pickOfficialSite(results, brandName) {
  const want = tokens(brandName);
  const joined = want.join('');
  for (const r of results) {
    let host;
    try { host = new URL(r.url).hostname.replace(/^www\./, ''); } catch { continue; }
    if (RETAIL_AND_DIRECTORY.some((d) => host.includes(d))) continue;
    const bare = host.split('.').slice(0, -1).join('');
    if (want.some((t) => bare.includes(t)) || (joined && bare.includes(joined))) {
      return { domain: host, url: `https://${host}/` };
    }
  }
  return null;
}

const SOCIAL_PATTERNS = {
  instagram: { re: /instagram\.com\/([A-Za-z0-9._]{1,30})\/?(?:[?#].*)?$/i, reserved: ['p', 'reel', 'reels', 'tv', 'stories', 'explore', 'accounts', 'share'] },
  tiktok: { re: /tiktok\.com\/@([A-Za-z0-9._]{2,24})\/?(?:[?#].*)?$/i, reserved: [] },
  x: { re: /(?:twitter|x)\.com\/([A-Za-z0-9_]{1,15})\/?(?:[?#].*)?$/i, reserved: ['intent', 'share', 'home', 'search', 'i', 'hashtag'] },
  linkedin: { re: /linkedin\.com\/company\/([^/?#]+)\/?(?:[?#].*)?$/i, reserved: [] },
};

const SOCIAL_URL = {
  instagram: (h) => `https://www.instagram.com/${h}/`,
  tiktok: (h) => `https://www.tiktok.com/@${h}`,
  x: (h) => `https://x.com/${h}`,
  linkedin: (h) => `https://www.linkedin.com/company/${h}/`,
};

/* From a page's links, the most frequent profile link per platform wins (footers repeat
   the brand's own account; a single embedded creator link shouldn't). */
export function extractSocialLinks(links) {
  const out = {};
  for (const [platform, { re, reserved }] of Object.entries(SOCIAL_PATTERNS)) {
    const counts = new Map();
    for (const link of links || []) {
      const m = String(link).match(re);
      if (!m) continue;
      const handle = (platform === 'linkedin' ? decodeURIComponent(m[1]) : m[1]).toLowerCase();
      if (reserved.includes(handle)) continue;
      counts.set(handle, (counts.get(handle) || 0) + 1);
    }
    const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (best) out[platform] = { handle: best[0], url: SOCIAL_URL[platform](best[0]), source: 'official_site' };
  }
  return out;
}

export async function resolveBrand({ input, fc, log = () => {} }) {
  const parsed = parseInput(input);
  const evidence = [];

  const siteResults = await fc.search(`${parsed.name} official site`, { limit: 8 });
  const site = pickOfficialSite(siteResults, parsed.name);
  log(site ? `official site: ${site.domain}` : 'official site not found in search results');

  let socials = {};
  if (site) {
    const page = await fc.scrape(site.url, { formats: ['links'], onlyMainContent: false });
    socials = extractSocialLinks(page.links);
    evidence.push({ claim: 'Social handles taken from the official site', url: site.url, label: 'verified' });
    log(`socials from site: ${Object.keys(socials).join(', ') || 'none'}`);
  }

  if (parsed.kind === 'linkedin') {
    socials.linkedin = { handle: parsed.linkedinSlug, url: parsed.linkedinUrl, source: 'user_input' };
  } else if (!socials.linkedin) {
    // Many brand sites don't link LinkedIn. Search for the company page instead.
    const li = await fc.search(`site:linkedin.com/company ${parsed.name}`, { limit: 5 });
    const found = extractSocialLinks(li.map((r) => r.url)).linkedin;
    if (found) {
      socials.linkedin = { ...found, source: 'search', label: 'single_source' };
      log(`linkedin via search: ${found.url} (unverified match)`);
    }
  }

  return {
    name: parsed.name,
    slug: slugify(parsed.name),
    domain: site?.domain || null,
    siteUrl: site?.url || null,
    linkedinUrl: socials.linkedin?.url || null,
    socials,
    evidence,
  };
}
