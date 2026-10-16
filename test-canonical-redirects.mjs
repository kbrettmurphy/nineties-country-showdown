import assert from 'node:assert/strict';
import worker from './src/worker.js';

// Mimic Cloudflare Workers static-assets' default HTML canonicalization:
// requests for folder/index.html redirect to folder/.
const delivered = [];
const env = { ASSETS: { fetch: async request => {
  const url = new URL(request.url);
  const path = url.pathname;
  if (path.endsWith('/index.html')) {
    return Response.redirect(url.origin + path.slice(0, -'index.html'.length) + url.search, 307);
  }
  if (['/', '/numbers/', '/country/', '/app.js', '/styles.css', '/questions.js'].includes(path)) {
    delivered.push(path);
    return new Response(`Asset ${path}`, { status: 200 });
  }
  return new Response('Not Found', { status: 404 });
}}};

async function visit(path) {
  let url = `https://preview.example.workers.dev${path}`;
  const seen = new Set();
  for (let n = 0; n < 8; n++) {
    assert(!seen.has(url), `redirect loop detected at ${url}`);
    seen.add(url);
    const result = await worker.fetch(new Request(url), env);
    if (result.status < 300 || result.status >= 400) {
      assert.equal(result.status, 200, `${path} should resolve to asset`);
      return await result.text();
    }
    url = result.headers.get('Location');
    assert(url, 'redirect must have Location');
  }
  assert.fail('too many redirects');
}

for (const path of ['/', '/numbers', '/numbers/', '/country', '/country/', '/country/app.js', '/country/styles.css', '/country/questions.js']) {
  assert((await visit(path)).startsWith('Asset '));
}
assert(delivered.includes('/numbers/'));
assert(delivered.includes('/country/'));
console.log('PASS: Cloudflare HTML canonicalization simulation: all game paths load without redirect loops.');
