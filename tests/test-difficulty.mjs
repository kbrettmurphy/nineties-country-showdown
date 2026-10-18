import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { CountryLeaderboard } from '../src/worker.js';
import { QUESTIONS } from '../src/country/questions.js';
import { pickQuestions, measuredTiers, fromLegacyTopics } from '../src/country/shared.js';

const byId = new Map(QUESTIONS.map((q) => [q.id, q]));
const tiersOf = (order, tiers = new Map()) =>
  order.map((i) => tiers.get(QUESTIONS[i].id) || QUESTIONS[i].tier);
const ascending = (list) => list.every((t, i) => i === 0 || list[i - 1] <= t);

// Every question has a starting tier.
assert.ok(
  QUESTIONS.every((q) => [1, 2, 3].includes(q.tier)),
  'every question has a tier',
);

// Each level's recipe, played easiest to hardest, never two questions on one song.
const shapes = { beginner: [7, 3, 0], mixed: [4, 4, 2], expert: [0, 3, 7] };
for (const [level, [e, m, h]] of Object.entries(shapes)) {
  for (const count of [10, 20]) {
    const order = pickQuestions(count, [], { level });
    const tiers = tiersOf(order);
    const k = count / 10;
    assert.deepEqual(
      [1, 2, 3].map((t) => tiers.filter((x) => x === t).length),
      [e * k, m * k, h * k],
      `${level} ${count}`,
    );
    assert.ok(ascending(tiers), `${level} plays easiest first`);
    assert.equal(new Set(order.map((i) => QUESTIONS[i].topic)).size, count, 'one song once');
  }
}
// Unknown levels fall back to Mixed.
assert.deepEqual(
  tiersOf(pickQuestions(10, [], { level: 'nope' })).sort(),
  [1, 1, 1, 1, 2, 2, 2, 2, 3, 3],
);

// Real results take over once a question has enough answers.
const sample = QUESTIONS.find((q) => q.tier === 3);
const measured = measuredTiers([
  { question_id: sample.id, answered: 20, correct: 19 },
  { question_id: QUESTIONS[0].id, answered: 4, correct: 0 }, // too few answers: ignored
]);
assert.equal(measured.get(sample.id), 1);
assert.equal(measured.has(QUESTIONS[0].id), false);
assert.equal(measuredTiers([{ question_id: 5, answered: 10, correct: 5 }]).get(5), 2);
assert.equal(measuredTiers([{ question_id: 5, answered: 10, correct: 3 }]).get(5), 3);

// When a tier's fresh questions run out, borrow from the nearest tier instead of repeating.
const easy = QUESTIONS.filter((q) => q.tier === 1).map((q) => q.id);
const beginnerAfterEasy = pickQuestions(10, easy, { level: 'beginner' });
assert.ok(
  beginnerAfterEasy.every((i) => !easy.includes(QUESTIONS[i].id)),
  'no easy repeats while medium questions are fresh',
);
assert.deepEqual([...new Set(tiersOf(beginnerAfterEasy))], [2], 'Beginner borrows medium first');

// A new question on a song already heard beats a fresh song in another tier, and songs heard
// longest ago come back first.
const multi = [...Map.groupBy(QUESTIONS, (q) => q.topic).values()].find(
  (qs) => qs.length > 1 && new Set(qs.map((q) => q.tier)).size === 1,
);
const tier = multi[0].tier;
const sameTier = QUESTIONS.filter((q) => q.tier === tier);
const heardAllSongs = sameTier.filter((q) => q.id !== multi[1].id).map((q) => q.id);
const level = { 1: 'beginner', 2: 'mixed', 3: 'expert' }[tier];
const after = pickQuestions(10, heardAllSongs, { level }).map((i) => QUESTIONS[i].id);
assert.ok(after.includes(multi[1].id), 'unplayed question on a heard song is used');

// Old song history counts every question that song had at the time as played.
assert.deepEqual(
  fromLegacyTopics([multi[0].topic]).sort(),
  multi
    .filter((q) => q.id <= 939)
    .map((q) => q.id)
    .sort(),
);

// Upgrading saved data: scores become Mixed, song history becomes question history.
const db = new DatabaseSync(':memory:');
db.exec(`CREATE TABLE scores (
  name_key TEXT NOT NULL, rounds INTEGER NOT NULL, display_name TEXT NOT NULL,
  best_score INTEGER NOT NULL, best_correct INTEGER NOT NULL, games INTEGER NOT NULL,
  first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL, PRIMARY KEY(name_key, rounds))`);
db.exec(`CREATE TABLE seen (name_key TEXT NOT NULL, topic TEXT NOT NULL, seen_at INTEGER NOT NULL,
  PRIMARY KEY(name_key, topic))`);
db.prepare('INSERT INTO scores VALUES (?,?,?,?,?,?,?,?)').run('val', 10, 'Val', 1234, 9, 3, 1, 2);
db.prepare('INSERT INTO seen VALUES (?,?,?)').run('val', multi[0].topic, 5);
const stored = new Map();
const storage = {
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
};
let board = new CountryLeaderboard({ storage }, {});
board = new CountryLeaderboard({ storage }, {}); // running the upgrade twice is harmless
const list = async (query) =>
  (await board.fetch(new Request('https://board.internal/list?' + query))).json();
const post = async (path, body) =>
  (
    await board.fetch(
      new Request('https://board.internal' + path, { method: 'POST', body: JSON.stringify(body) }),
    )
  ).json();
assert.deepEqual(
  (await list('rounds=10&level=mixed')).rows.map((r) => [r.display_name, r.best_score]),
  [['Val', 1234]],
  'old scores land in Mixed',
);
assert.equal((await list('rounds=10&level=beginner')).rows.length, 0);
assert.equal((await list('rounds=10')).level, 'mixed', 'Mixed is the default board');
const merged = await post('/history/merge', { players: [{ name: 'Val', questions: [] }] });
assert.deepEqual(
  merged.histories[0].sort(),
  fromLegacyTopics([multi[0].topic]).sort(),
  'old song history carries over',
);

// A solo game records under its level, and only there.
const token = 'v'.repeat(32);
const start = await post('/solo/start', { name: 'Val', token, rounds: 10, level: 'expert' });
assert.ok(ascending(start.questionIds.map((id) => byId.get(id).tier)));
assert.ok(
  start.questionIds.every((id) => byId.get(id).tier >= 2),
  'expert skips easy',
);
for (const [i, id] of start.questionIds.entries()) {
  await post('/solo/answer', { token, sessionId: start.sessionId, questionId: id, choice: 0 });
  if (i < 9) await post('/solo/next', { token, sessionId: start.sessionId });
}
assert.deepEqual(
  (await list('rounds=10&level=expert')).rows.map((r) => r.display_name),
  ['Val'],
);
assert.equal((await list('rounds=10&level=mixed')).rows[0].best_score, 1234, 'Mixed untouched');
console.log(
  'PASS: difficulty levels shape every game, real results retier questions, tiers borrow before repeating, old scores and history upgrade.',
);
