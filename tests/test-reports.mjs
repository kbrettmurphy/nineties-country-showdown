import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import worker, { CountryLeaderboard } from '../src/worker.js';
import { QUESTIONS } from '../src/country/questions.js';

const db = new DatabaseSync(':memory:');
const board = new CountryLeaderboard(
  {
    storage: {
      sql: {
        exec: (statement, ...args) => {
          const prepared = db.prepare(statement);
          return /^\s*(SELECT|PRAGMA)/i.test(statement)
            ? prepared.all(...args)
            : (prepared.run(...args), []);
        },
      },
      transactionSync: (fn) => fn(),
    },
  },
  {},
);
const env = {
  REPORTS_KEY: 'test-key',
  LEADERBOARD: {
    idFromName: () => 'country-global',
    get: () => ({ fetch: (url, init) => board.fetch(new Request(url, init)) }),
  },
};
const post = async (path, body) => {
  const res = await worker.fetch(
    new Request('https://games.murphsmitts.com/country/api/' + path, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
    env,
  );
  return { status: res.status, data: await res.json() };
};
const q = QUESTIONS[816];
const token = 'r'.repeat(32);

let r = await post('report', {
  token,
  name: 'brett',
  questionId: q.id,
  reason: 'title',
  note: 'x',
});
assert.equal(r.status, 200, JSON.stringify(r.data));
r = await post('report', { token, name: 'brett', questionId: q.id, reason: 'nope' });
assert.equal(r.status, 400, 'unknown reason is rejected');
r = await post('report', { token, name: 'brett', questionId: 999999, reason: 'lyric' });
assert.equal(r.status, 400, 'unknown question is rejected');
r = await post('report', { name: 'brett', questionId: q.id, reason: 'lyric' });
assert.equal(r.status, 401, 'reports need a player session');
// Same player, same question: updates the existing report instead of piling up.
r = await post('report', {
  token,
  name: 'brett',
  questionId: q.id,
  reason: 'title',
  note: 'It’s “Living in a House of Love”',
});
assert.equal(r.status, 200);

r = await post('reports/list', {});
assert.equal(r.status, 403, 'listing needs the key');
r = await post('reports/list', { key: 'wrong' });
assert.equal(r.status, 403, 'listing rejects a wrong key');
r = await post('reports/list', { key: 'test-key' });
assert.equal(r.status, 200);
assert.equal(r.data.reports.length, 1);
const [report] = r.data.reports;
assert.equal(report.note, 'It’s “Living in a House of Love”');
assert.equal(report.song, q.lyricSong);
assert.equal(report.answer, q.choices[q.a]);
assert.equal(report.name, 'brett');
assert.equal(report.token, undefined, 'player tokens are never exposed');

r = await post('reports/resolve', { key: 'test-key', id: report.id });
assert.equal(r.status, 200);
assert.equal((await post('reports/list', { key: 'test-key' })).data.reports.length, 0);
assert.equal(
  (await post('reports/list', { key: 'test-key', status: 'fixed' })).data.reports.length,
  1,
);
r = await post('reports/list', { key: 'test-key' });
assert.equal((await post('reports/stats', {})).status, 403, 'answer stats need the key');
r = await post('reports/stats', { key: 'test-key' });
assert.equal(r.status, 200);
assert.deepEqual(r.data.stats, []);
const noKeyEnv = { ...env, REPORTS_KEY: undefined };
const res = await worker.fetch(
  new Request('https://games.murphsmitts.com/country/api/reports/list', {
    method: 'POST',
    body: JSON.stringify({ key: '' }),
  }),
  noKeyEnv,
);
assert.equal(res.status, 503, 'reports stay locked when no key is configured');
// Song requests from the song check page.
r = await post('reports/song-request', { title: 'Fancy', artist: 'Reba McEntire' });
assert.equal(r.status, 403, 'song requests need the reports key');
r = await post('reports/song-request', { key: 'test-key', title: '  ' });
assert.equal(r.status, 400, 'a title is required');
r = await post('reports/song-request', { key: 'test-key', title: 'Fancy', artist: 'Reba' });
assert.equal(r.status, 200, JSON.stringify(r.data));
// Asking again for the same title updates it instead of adding a second row.
await post('reports/song-request', { key: 'test-key', title: 'fancy', artist: '' });
r = await post('reports/song-requests', { key: 'test-key' });
assert.equal(r.data.requests.length, 1);
assert.equal(r.data.requests[0].artist, 'Reba', 'a blank artist keeps the earlier one');
r = await post('reports/song-request-status', {
  key: 'test-key',
  id: r.data.requests[0].id,
  status: 'added',
});
assert.equal(r.status, 200);
assert.equal((await post('reports/song-requests', { key: 'test-key' })).data.requests.length, 0);
assert.equal(
  (await post('reports/song-requests', { key: 'test-key', status: 'added' })).data.requests.length,
  1,
);
console.log(
  'PASS: players can report questions; only the reports key can read or resolve them or request songs.',
);
