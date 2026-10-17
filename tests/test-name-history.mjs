import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { CountryLeaderboard, GameRoom } from '../src/worker.js';
import { QUESTIONS } from '../src/country/questions.js';

// Real leaderboard + real game room wired together, with each "device" starting from an empty
// browser history, to prove repeats are avoided by nickname rather than by browser.
const db = new DatabaseSync(':memory:');
const kv = new Map();
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
      get: async (key) => structuredClone(kv.get(key)),
      put: async (key, value) => kv.set(key, structuredClone(value)),
      transactionSync: (fn) => {
        db.exec('BEGIN');
        try {
          const result = fn();
          db.exec('COMMIT');
          return result;
        } catch (e) {
          db.exec('ROLLBACK');
          throw e;
        }
      },
    },
  },
  {},
);
const env = {
  LEADERBOARD: {
    idFromName: () => 'country-global',
    get: () => ({ fetch: (url, init) => board.fetch(new Request(url, init)) }),
  },
};
const byId = new Map(QUESTIONS.map((q) => [q.id, q]));
const post = async (target, path, body) => {
  const res = await target.fetch(
    new Request('https://internal' + path, { method: 'POST', body: JSON.stringify(body) }),
  );
  const data = await res.json();
  assert.equal(res.status, 200, `${path}: ${JSON.stringify(data)}`);
  return data;
};
let device = 0;
const freshToken = () => String(++device).padStart(32, 'd');
const seenBy = new Map();
const playSolo = async (name) => {
  const token = freshToken();
  const start = await post(board, '/solo/start', { name, token, rounds: 10, recentTopics: [] });
  const topics = [];
  for (const [i, id] of start.questionIds.entries()) {
    await post(board, '/solo/answer', {
      token,
      sessionId: start.sessionId,
      questionId: id,
      choice: 0,
    });
    topics.push(byId.get(id).topic);
    if (i < 9) await post(board, '/solo/next', { token, sessionId: start.sessionId });
  }
  return topics;
};

// Solo on one device, then a different device with the same nickname (any capitalization).
const first = await playSolo('Brett');
const second = await playSolo('brett');
assert.equal(new Set([...first, ...second]).size, 20, 'second device must not repeat songs');
seenBy.set('brett', new Set([...first, ...second]));

// Multiplayer with brand-new browsers: the room still avoids everything Brett has played.
const store = new Map();
const room = new GameRoom(
  {
    storage: {
      get: async (key) => structuredClone(store.get(key)),
      put: async (key, value) => store.set(key, structuredClone(value)),
    },
  },
  env,
);
const host = freshToken(),
  guest = freshToken();
await post(room, '/create', { token: host, name: 'Brett', rounds: 10, code: 'HIST22' });
await post(room, '/join', { token: guest, name: 'Russ' });
let state = await post(room, '/start', { token: host, recentTopics: [] });
const roomTopics = store.get('room').order.map((i) => QUESTIONS[i].topic);
assert.ok(
  roomTopics.every((t) => !seenBy.get('brett').has(t)),
  'room must skip songs from Brett’s solo games on other devices',
);
await post(room, '/answer', { token: host, choice: 0 });
state = await post(room, '/answer', { token: guest, choice: 1 });
assert.equal(state.phase, 'reveal');
const russ = await post(board, '/history/merge', { players: [{ name: 'Russ', topics: [] }] });
assert.deepEqual(
  russ.histories[0],
  [roomTopics[0]],
  'revealed song is remembered for every player',
);

// Keep playing solo on fresh devices: no song repeats until the whole bank has been asked.
const total = new Set(QUESTIONS.map((q) => q.topic)).size;
const all = seenBy.get('brett');
all.add(roomTopics[0]);
while (all.size + 10 <= total) {
  const topics = await playSolo('Brett');
  for (const t of topics) {
    assert.ok(!all.has(t), `repeat after ${all.size} of ${total} songs`);
    all.add(t);
  }
}
console.log(
  `PASS: song history follows the nickname across devices and solo/multiplayer; ${all.size} of ${total} songs before any repeat.`,
);
