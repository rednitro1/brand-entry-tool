/* Apollo (primary) and Prospeo (fallback) people clients, called directly with Ben's own
   keys. Response shapes are recorded in fixtures/recorded/apollo-*.json / prospeo-*.json.

   Cost model learned from live calls:
   - Apollo mixed_people/api_search: free, but last names are obfuscated and there is no
     LinkedIn URL. people/match (1 credit) reveals name, LinkedIn URL and employment history.
   - Prospeo search-person: LinkedIn URL in the search result itself; 1 credit per page that
     returns results, free on NO_RESULTS. Rate-limited, so 429s wait and retry. */

const sleepDefault = (ms) => new Promise((r) => setTimeout(r, ms));

async function postJson(fetchImpl, url, headers, body, { sleep = sleepDefault, retries = 2 } = {}) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
    const json = await res.json().catch(() => ({}));
    const rateLimited = res.status === 429 || /rate limit/i.test(String(json.error_code || json.message || json.error || ''));
    if (rateLimited && attempt < retries) { await sleep(5000 * (attempt + 1)); continue; }
    return { status: res.status, ok: res.ok, json };
  }
}

export function makeApollo(apiKey, { fetchImpl = fetch, sleep, usdPerCredit = Number(process.env.APOLLO_USD_PER_CREDIT || 0.02) } = {}) {
  let credits = 0;
  const headers = { 'x-api-key': apiKey, 'Cache-Control': 'no-cache' };
  return {
    /* Free. Returns [{id, first_name, last_name_obfuscated, title, organization:{name}}]. */
    async search(params) {
      const { ok, status, json } = await postJson(fetchImpl, 'https://api.apollo.io/api/v1/mixed_people/api_search', headers,
        { per_page: 25, page: 1, include_similar_titles: true, ...params }, { sleep });
      if (!ok) throw new Error(`apollo search ${status}: ${String(json.error || json.message || '').slice(0, 160)}`);
      return json.people || [];
    },
    /* 1 credit. Reveals one person by Apollo id. No emails or phones are requested. */
    async match(id) {
      const url = `https://api.apollo.io/api/v1/people/match?id=${encodeURIComponent(id)}&reveal_personal_emails=false&reveal_phone_number=false`;
      const { ok, status, json } = await postJson(fetchImpl, url, headers, undefined, { sleep });
      if (!ok) throw new Error(`apollo match ${status}: ${String(json.error || json.message || '').slice(0, 160)}`);
      credits += 1;
      return json.person || null;
    },
    usage() { return { provider: 'apollo', credits, costUsd: Math.round(credits * usdPerCredit * 10000) / 10000 }; },
  };
}

export function makeProspeo(apiKey, { fetchImpl = fetch, sleep, usdPerCredit = Number(process.env.PROSPEO_USD_PER_CREDIT || 0.01) } = {}) {
  let credits = 0;
  return {
    /* Returns [{person:{full_name, current_job_title, linkedin_url}, company:{name, domain}}].
       NO_RESULTS is a normal empty answer, not an error. */
    async search(filters, page = 1) {
      const { ok, status, json } = await postJson(fetchImpl, 'https://api.prospeo.io/search-person', { 'X-KEY': apiKey }, { page, filters }, { sleep });
      if (json.error_code === 'NO_RESULTS') return [];
      if (!ok || json.error) throw new Error(`prospeo search ${status}: ${json.error_code || 'failed'}`);
      if (!json.free) credits += 1;
      return json.results || [];
    },
    usage() { return { provider: 'prospeo', credits, costUsd: Math.round(credits * usdPerCredit * 10000) / 10000 }; },
  };
}
