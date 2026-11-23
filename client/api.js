async function call(path, opts = {}) {
  const res = await fetch(path, { ...opts, headers: { 'content-type': 'application/json', ...(opts.headers || {}) } });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(json.error || `Request failed (${res.status})`), { status: res.status });
  return json;
}

export const api = {
  brands: () => call('/api/brands'),
  brand: (slug) => call(`/api/brands/${encodeURIComponent(slug)}`),
  run: (id) => call(`/api/runs/${id}`),
  startRun: (input, accessCode) => call('/api/runs', { method: 'POST', body: JSON.stringify({ input }), headers: { 'x-access-code': accessCode } }),
};
