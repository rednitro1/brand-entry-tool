/* "Show the receipts." Every claim the LLM returns must point at a page we actually
   fetched, and its quote must actually appear on that page. Claims that fail are not
   shown as facts; they go to `rejected` with the reason, so the UI and the write-up can
   show what the model tried to assert without support. */

export function normalizeText(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[‘’‛]/g, "'").replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/[*_`]/g, '')          // markdown emphasis: delete, so "**Title**," stays "title,"
    .replace(/[#>\[\]()]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/ ([,.;:!?])/g, '$1')
    .trim();
}

export function urlKey(u) {
  try {
    const x = new URL(u);
    return `${x.hostname.replace(/^www\./, '')}${x.pathname.replace(/\/+$/, '')}`.toLowerCase();
  } catch { return String(u || '').toLowerCase(); }
}

export const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; } };

/* A quote matches if the normalized quote appears in the normalized page. Long quotes
   may be lightly paraphrased at the edges, so for quotes over 12 words we accept an
   exact run of the middle 70% of words. */
export function quoteAppears(quote, pageText) {
  const q = normalizeText(quote);
  const p = normalizeText(pageText);
  if (!q || q.length < 12) return false;
  if (p.includes(q)) return true;
  const words = q.split(' ');
  if (words.length > 12) {
    const cut = Math.floor(words.length * 0.15);
    return p.includes(words.slice(cut, words.length - cut).join(' '));
  }
  return false;
}

/* Source kinds, from most to least trustworthy. "primary" = the brand's own site, its
   parent company's site/IR, or a wire press release issued by them. */
const WIRE = ['businesswire.com', 'prnewswire.com', 'globenewswire.com', 'accessnewswire.com'];

export function classifySource(url, { brandDomains = [], primaryHints = [] } = {}) {
  const h = hostOf(url);
  if (brandDomains.some((d) => d && (h === d || h.endsWith(`.${d}`)))) return 'primary';
  if (WIRE.some((w) => h.endsWith(w))) return 'primary';
  if (primaryHints.some((d) => d && (h === d || h.endsWith(`.${d}`)))) return 'primary';
  if (/linkedin\.com$/.test(h)) return 'profile';
  return 'press';
}

/* claims: [{claim, url, quote, kind?, inferred?, vendor?}]
   pages:  [{url, markdown}]
   Returns {accepted, rejected}. Accepted claims get a `label`:
     inferred       model marked it as an inference from wording
     vendor_claim   source is a vendor/third party selling to the brand
     verified       quote found on a primary source, or on 2+ distinct domains
     single_source  quote found on exactly one non-primary domain */
export function validateClaims(claims, pages, opts = {}) {
  const byKey = new Map(pages.map((p) => [urlKey(p.url), p]));
  const accepted = [];
  const rejected = [];

  for (const c of claims || []) {
    if (!c?.url) { rejected.push({ ...c, reason: 'no evidence URL' }); continue; }
    const page = byKey.get(urlKey(c.url));
    if (!page) { rejected.push({ ...c, reason: 'URL was not among the fetched sources' }); continue; }
    if (!quoteAppears(c.quote, page.markdown)) { rejected.push({ ...c, reason: 'quote not found on the cited page' }); continue; }

    // Corroboration: the same quote (or its core) on another fetched page from a different domain.
    const corroborating = pages
      .filter((p) => hostOf(p.url) !== hostOf(c.url) && quoteAppears(c.quote, p.markdown))
      .map((p) => p.url);
    const sourceKind = classifySource(c.url, opts);

    let label;
    if (c.inferred) label = 'inferred';
    else if (c.vendor) label = 'vendor_claim';
    else if (sourceKind === 'primary' || corroborating.length > 0) label = 'verified';
    else label = 'single_source';

    accepted.push({ ...c, url: page.url, label, source_kind: sourceKind, corroborating });
  }
  return { accepted, rejected };
}

/* Em dashes read as AI-written in Ben's outreach rules. Applied to any generated copy. */
export function stripEmDashes(s) {
  return String(s || '').replace(/\s*—\s*/g, ', ').replace(/–/g, '-');
}
