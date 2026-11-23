/* Thin Firecrawl v2 REST client. Every call reports credits used so the run's cost is
   real, not estimated. Response shapes recorded in fixtures/recorded/firecrawl-*.json. */

const BASE = 'https://api.firecrawl.dev/v2';

/* The current Firecrawl plan allows ~11 requests/minute. The first live run lost a key
   page to a 429, so: at most 3 requests in flight, and on 429 wait for the reset the error
   message names (capped at 65s) and retry, up to 2 times. */
export function parseRetryAfterSec(message) {
  const m = String(message || '').match(/retry after (\d+)s/i);
  return m ? Math.min(Number(m[1]) + 1, 65) : 30;
}

export function makeLimiter(max) {
  let active = 0;
  const queue = [];
  const next = () => { if (active < max && queue.length) { active++; queue.shift()(); } };
  return (fn) => new Promise((resolve, reject) => {
    queue.push(() => fn().then(resolve, reject).finally(() => { active--; next(); }));
    next();
  });
}

export function makeFirecrawl(apiKey, {
  fetchImpl = fetch,
  usdPerCredit = Number(process.env.FIRECRAWL_USD_PER_CREDIT || 0.001),
  concurrency = 3,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  onRetry = () => {},
} = {}) {
  let credits = 0;
  let retries = 0;
  const limit = makeLimiter(concurrency);

  async function postOnce(path, body) {
    const res = await fetchImpl(`${BASE}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(90_000),
    });
    const json = await res.json().catch(() => ({}));
    return { res, json };
  }

  const post = (path, body) => limit(async () => {
    for (let attempt = 0; ; attempt++) {
      const { res, json } = await postOnce(path, body);
      if (res.status === 429 && attempt < 2) {
        const sec = parseRetryAfterSec(json.error);
        retries++;
        onRetry(`firecrawl rate limit, waiting ${sec}s`);
        await sleep(sec * 1000);
        continue;
      }
      if (!res.ok || json.success === false) {
        throw new Error(`firecrawl ${path} ${res.status}: ${String(json.error || 'request failed').slice(0, 160)}`);
      }
      return json;
    }
  });

  return {
    async search(query, { limit = 5 } = {}) {
      const json = await post('/search', { query, limit });
      credits += Number(json.creditsUsed || 1);
      return (json.data?.web || []).map((r) => ({ url: cleanUrl(r.url), title: r.title || '', description: r.description || '' }));
    },
    async scrape(url, { formats = ['markdown'], onlyMainContent = true } = {}) {
      const json = await post('/scrape', { url, formats, onlyMainContent });
      credits += Number(json.data?.metadata?.creditsUsed || 1);
      return {
        url,
        markdown: json.data?.markdown || '',
        links: json.data?.links || [],
        title: json.data?.metadata?.title || '',
        publishedAt: json.data?.metadata?.publishedTime || json.data?.metadata?.['article:published_time'] || null,
      };
    },
    usage() { return { provider: 'firecrawl', credits, retries, costUsd: round4(credits * usdPerCredit) }; },
  };
}

/* Search results carry Google tracking params (srsltid, utm_*). Strip them so the same
   page found twice dedupes and evidence links stay clean. */
export function cleanUrl(raw) {
  try {
    const u = new URL(raw);
    for (const k of [...u.searchParams.keys()]) {
      if (k === 'srsltid' || k.startsWith('utm_') || k === 'gclid' || k === 'fbclid') u.searchParams.delete(k);
    }
    u.hash = '';
    return u.toString();
  } catch { return raw; }
}

export const round4 = (n) => Math.round(n * 10000) / 10000;
