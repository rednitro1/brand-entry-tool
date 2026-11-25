async function call(path, opts = {}) {
  const res = await fetch(path, { ...opts, headers: { 'content-type': 'application/json', ...(opts.headers || {}) } });
  const json = await res.json().catch(() => ({}));
  if (res.status === 401 && json.login) window.dispatchEvent(new Event('auth-required'));
  if (!res.ok) throw Object.assign(new Error(json.error || `Request failed (${res.status})`), { status: res.status });
  return json;
}

export const api = {
  brands: () => call('/api/brands'),
  brand: (slug) => call(`/api/brands/${encodeURIComponent(slug)}`),
  run: (id) => call(`/api/runs/${id}`),
  startRun: (input) => call('/api/runs', { method: 'POST', body: JSON.stringify({ input }) }),
  session: () => call('/api/session'),
  login: (code) => call('/api/login', { method: 'POST', body: JSON.stringify({ code }) }),
  logout: () => call('/api/logout', { method: 'POST' }),
};
api.runs = () => call('/api/runs');
api.playbook = () => call('/api/playbook');
api.savePlaybook = (content, note) => call('/api/playbook', { method: 'POST', body: JSON.stringify({ content, note }) });
api.getDraft = (id) => call(`/api/drafts/${id}`);
api.draft = (slug, pickUrls) => call(`/api/brands/${encodeURIComponent(slug)}/engagement`, { method: 'POST', body: JSON.stringify({ pickUrls }) });
