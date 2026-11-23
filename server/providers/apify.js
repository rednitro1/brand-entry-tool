/* Apify actor runner. Starts a run and waits for it (waitForFinish caps at 60s per
   request on Apify's side, so it re-polls), then reads the dataset. The run object carries
   usageTotalUsd, so cost is the real charge, not an estimate. */

const BASE = 'https://api.apify.com/v2';

export function makeApify(token, { fetchImpl = fetch, maxWaitMs = 4 * 60 * 1000 } = {}) {
  let costUsd = 0;
  const headers = { Authorization: `Bearer ${token}`, 'content-type': 'application/json' };

  async function req(url, opts = {}) {
    const res = await fetchImpl(url, { ...opts, headers, signal: AbortSignal.timeout(90_000) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`apify ${res.status}: ${json.error?.message || 'request failed'}`);
    return json;
  }

  return {
    async run(actorId, input) {
      const started = Date.now();
      let run = (await req(`${BASE}/acts/${actorId}/runs?waitForFinish=60`, { method: 'POST', body: JSON.stringify(input) })).data;
      while (!['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT'].includes(run.status)) {
        if (Date.now() - started > maxWaitMs) throw new Error(`apify ${actorId} still ${run.status} after ${maxWaitMs / 1000}s`);
        run = (await req(`${BASE}/actor-runs/${run.id}?waitForFinish=60`)).data;
      }
      costUsd += Number(run.usageTotalUsd || 0);
      if (run.status !== 'SUCCEEDED') throw new Error(`apify ${actorId} run ended ${run.status}`);
      const items = await req(`${BASE}/datasets/${run.defaultDatasetId}/items?clean=true&format=json`);
      return Array.isArray(items) ? items : [];
    },
    usage() { return { provider: 'apify', costUsd: Math.round(costUsd * 10000) / 10000 }; },
  };
}
