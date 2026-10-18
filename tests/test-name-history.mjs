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
  const start = await post(board, '/solo/start', {
    name,
    token,
    rounds: 10,
    recentQuestions: [],
  });
  assert.equal(
    new Set(start.questionIds.map((id) => byId.get(id).topic)).size,
    10,
    'one song once',
  );
  const ids = [];
  for (const [i, id] of start.questionIds.entries()) {
    await post(board, '/solo/answer', {
      token,
      sessionId: start.sessionId,
      questionId: id,
      choice: 0,
    });
    ids.push(id);
    if (i < 9) await post(board, '/solo/next', { token, sessionId: start.sessionId });
  }
  return ids;
};

// Solo on one device, then a different device with the same nickname (any capitalization).
const first = await playSolo('Brett');
const second = await playSolo('brett');
assert.equal(new Set([...first, ...second]).size, 20, 'second device must not repeat questions');
assert.equal(
  new Set([...first, ...second].map((id) => byId.get(id).topic)).size,
  20,
  'fresh songs come before new questions on songs already heard',
);
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
let state = await post(room, '/start', { token: host, recentQuestions: [] });
const roomIds = store.get('room').order.map((i) => QUESTIONS[i].id);
assert.ok(
  roomIds.every((id) => !seenBy.get('brett').has(id)),
  'room must skip questions from Brett’s solo games on other devices',
);
await post(room, '/answer', { token: host, choice: 0 });
state = await post(room, '/answer', { token: guest, choice: 1 });
// The reveal also records how the question played: both players, one pick each.
const roomQ = QUESTIONS[store.get('room').order[0]];
const roomStats = board.listStats().find((x) => x.question_id === roomQ.id);
assert.equal(roomStats.shown, 2);
assert.equal(roomStats.answered, 2);
assert.equal(roomStats.correct, [0, 1].filter((c) => c === roomQ.a).length);
assert.equal(roomStats.picks[roomQ.choices[0]], 1);
assert.equal(roomStats.picks[roomQ.choices[1]], 1);
assert.ok(roomStats.avg_ms >= 0 && roomStats.avg_ms <= 30000);
assert.equal(state.phase, 'reveal');
const russ = await post(board, '/history/merge', { players: [{ name: 'Russ', questions: [] }] });
assert.deepEqual(
  russ.histories[0],
  [roomIds[0]],
  'revealed question is remembered for every player',
);

// Keep playing solo on fresh devices: no question repeats until the whole bank has been asked.
const total = QUESTIONS.length;
const all = seenBy.get('brett');
all.add(roomIds[0]);
while (all.size + 10 <= total) {
  const ids = await playSolo('Brett');
  for (const id of ids) {
    assert.ok(!all.has(id), `repeat after ${all.size} of ${total} questions`);
    all.add(id);
  }
}
// Every solo answer was recorded too, once per question asked.
const stats = board.listStats();
const shown = stats.reduce((n, x) => n + x.shown, 0);
assert.equal(shown, all.size - 1 + 2, 'one stat per solo question plus two players in the room');
assert.ok(stats.every((x) => x.correct <= x.answered && x.answered <= x.shown));
assert.ok(
  stats.every((x) => x.question && x.answer),
  'stats carry the question text',
);
console.log(
  `PASS: question history follows the nickname across devices and solo/multiplayer, answer stats recorded; ${all.size} of ${total} questions before any repeat.`,
);
