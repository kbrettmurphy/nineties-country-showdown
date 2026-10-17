import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { CountryLeaderboard } from '../src/worker.js';
import { QUESTIONS } from '../src/country/questions.js';
const db = new DatabaseSync(':memory:');
const stored = new Map();
const ctx = {
  storage: {
    sql: {
      exec: (statement, ...args) => {
        const prepared = db.prepare(statement);
        return /^\s*(SELECT|PRAGMA)/i.test(statement)
          ? prepared.all(...args)
          : (prepared.run(...args), []);
      },
    },
    get: async (key) => structuredClone(stored.get(key)),
    put: async (key, value) => stored.set(key, structuredClone(value)),
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
};
const board = new CountryLeaderboard(ctx, {});
const send = async (path, d, method = 'POST') => {
  const res = await board.fetch(
    new Request('https://board.internal' + path, {
      method,
      ...(method === 'POST' ? { body: JSON.stringify(d) } : {}),
    }),
  );
  const json = await res.json();
  return { status: res.status, data: json };
};
const nick = 'Brett';
const token = 'a'.repeat(32);
const distinct = [...new Map(QUESTIONS.map((q) => [q.topic, q])).values()].slice(0, 20);
const ids = distinct.map((q) => q.id);
let r = await send('/solo/start', { name: nick, token, questionIds: ids.slice(0, 10) });
assert.equal(r.status, 200);
let sessionId = r.data.sessionId;
for (let i = 0; i < 10; i++) {
  const a = await send('/solo/answer', {
    token,
    sessionId,
    questionId: ids[i],
    choice: distinct[i].a,
  });
  assert.equal(a.status, 200);
  assert(a.data.points >= 100);
  const again = await send('/solo/answer', { token, sessionId, questionId: ids[i], choice: 0 });
  assert.equal(again.data.score, a.data.score, 'double answer must not increase score');
  if (i < 9) {
    const n = await send('/solo/next', { token, sessionId });
    assert.equal(n.status, 200);
  }
}
let listed = await send('/list?rounds=10', null, 'GET');
assert.equal(listed.data.rows.length, 1);
assert.equal(listed.data.rows[0].games, 1);
assert.equal(listed.data.rows[0].display_name, nick);
assert.equal(listed.data.stats.players, 1);
let record = {
  matchId: 'match-01',
  rounds: 10,
  players: [
    { name: 'Chris', score: 700, correct: 5 },
    { name: 'Brett', score: 1200, correct: 8 },
  ],
};
assert.equal((await send('/record', record)).status, 200);
assert.equal((await send('/record', record)).status, 200);
listed = await send('/list?rounds=10', null, 'GET');
assert.equal(listed.data.rows.length, 2);
assert.equal(listed.data.rows.find((x) => x.display_name === 'Brett').games, 2);
assert.equal(listed.data.rows.find((x) => x.display_name === 'Chris').games, 1);
assert.equal(listed.data.stats.games, 3);
let invalid = await send('/record', {
  matchId: 'bogus',
  rounds: 10,
  players: [{ name: 'Bad', score: 100000, correct: 10 }],
});
assert.equal(invalid.status, 400);
let empty20 = await send('/list?rounds=20', null, 'GET');
assert.equal(empty20.data.rows.length, 0);
const wrongToken = await send('/solo/answer', {
  token: 'b'.repeat(32),
  sessionId,
  questionId: ids[0],
  choice: 0,
});
assert.notEqual(wrongToken.status, 200);
console.log(
  'PASS: persistent 10/20 leaderboard, solo verification, multiplayer records, duplicate prevention, private tokens, high score and play counts.',
);
{
  const t = Date.now();
  board.recordMatch({
    matchId: 'rename-a',
    rounds: 20,
    players: [{ name: 'gay', score: 393, correct: 3 }],
  });
  board.recordMatch({
    matchId: 'rename-b',
    rounds: 20,
    players: [{ name: 'Russ', score: 300, correct: 2 }],
  });
  board.recordMatch({
    matchId: 'rename-c',
    rounds: 20,
    players: [{ name: 'Russ', score: 250, correct: 2 }],
  });
  board.renamePlayer('gay', 'Russ');
  const rows = db
    .prepare('SELECT * FROM scores WHERE rounds=20 AND name_key IN (?,?)')
    .all('gay', 'russ');
  assert.equal(rows.length, 1, 'renamed entry merges into the existing one');
  assert.equal(rows[0].display_name, 'Russ');
  assert.equal(rows[0].best_score, 393);
  assert.equal(rows[0].best_correct, 3);
  assert.equal(rows[0].games, 3);
  assert.ok(rows[0].last_seen >= t);
  console.log('PASS: moderation rename merges leaderboard entries.');
}
