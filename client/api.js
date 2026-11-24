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
api.runs = () => call('/api/runs');
api.playbook = () => call('/api/playbook');
api.savePlaybook = (content, accessCode, note) => call('/api/playbook', { method: 'POST', body: JSON.stringify({ content, note }), headers: { 'x-access-code': accessCode } });
api.getDraft = (id) => call(`/api/drafts/${id}`);
api.draft = (slug, pickUrls, accessCode) => call(`/api/brands/${encodeURIComponent(slug)}/engagement`, { method: 'POST', body: JSON.stringify({ pickUrls }), headers: { 'x-access-code': accessCode } });
