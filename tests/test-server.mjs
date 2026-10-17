import assert from 'node:assert/strict';
import { GameRoom } from '../src/worker.js';
import { QUESTIONS } from '../src/country/questions.js';
const store = new Map();
const ctx = {
  storage: {
    get: async (key) => store.get(key),
    put: async (key, val) => store.set(key, structuredClone(val)),
  },
};
const room = new GameRoom(ctx, {
  LEADERBOARD: {
    idFromName: () => 'leaderboard',
    get: () => ({ fetch: async () => Response.json({ ok: true }) }),
  },
});
const request = (action, data) =>
  room.fetch(
    new Request('https://internal/' + action, { method: 'POST', body: JSON.stringify(data) }),
  );
const call = async (action, data) => {
  const response = await request(action, data);
  const body = await response.json();
  if (!response.ok) throw Error(`${action}: ${JSON.stringify(body)}`);
  return body;
};
const a = 'a'.repeat(32),
  b = 'b'.repeat(32);
let state = await call('create', { token: a, name: 'NC', rounds: 10, code: 'ABC234' });
assert.equal(state.phase, 'lobby');
state = await call('join', { token: b, name: 'Texas' });
assert.equal(state.players.length, 2);
state = await call('start', { token: a });
assert.equal(state.phase, 'question');
assert.equal(state.total, 10);
assert.equal(state.question.choices.length, 4);
assert.equal(state.reveal, null, 'no lyric should be revealed before answers lock');
const first = store.get('room');
assert.equal(
  new Set(first.order.map((i) => QUESTIONS[i].topic)).size,
  10,
  'must not repeat song/topic in a game',
);
const firstTopics = new Set(first.order.map((i) => QUESTIONS[i].topic));
const q = QUESTIONS[first.order[0]];
state = await call('answer', { token: a, choice: q.a });
assert.equal(state.phase, 'question');
assert.equal(state.ownChoice, q.a);
assert.ok(
  state.players.every((p) => p.result === null),
  'other players picks stay hidden until reveal',
);
state = await call('answer', { token: b, choice: (q.a + 1) % 4 });
assert.equal(state.phase, 'reveal');
assert.equal(state.reveal.correctIndex, q.a);
assert.equal(state.reveal.lyric, q.lyric);
assert.equal(state.reveal.lyricSong, q.lyricSong);
assert.equal(state.reveal.lyricArtist, q.lyricArtist);
assert.equal(state.reveal.explanation, undefined, 'old prose explanation is gone');
assert.deepEqual(
  state.players.map((p) => [p.name, p.result.choice, p.result.correct]).sort(),
  [
    ['NC', q.a, true],
    ['Texas', (q.a + 1) % 4, false],
  ],
  'everyone sees every pick at reveal',
);
assert.equal(state.players.find((p) => p.isYou).score, 0);
state = await call('state', { token: a });
assert(state.players.find((p) => p.isYou).score >= 100);
for (let n = 1; n < 10; n++) {
  const curr = store.get('room');
  curr.revealAt = Date.now() - 1;
  store.set('room', curr);
  state = await call('state', { token: a });
  assert.equal(state.phase, 'question');
  const curr2 = store.get('room');
  curr2.endsAt = Date.now() - 1;
  store.set('room', curr2);
  state = await call('state', { token: a });
  assert.equal(state.phase, 'reveal');
}
let curr = store.get('room');
curr.revealAt = Date.now() - 1;
store.set('room', curr);
state = await call('state', { token: b });
assert.equal(state.phase, 'finished');
state = await call('rematch', { token: a });
assert.equal(state.phase, 'question');
const second = store.get('room');
assert(
  second.order.every((i) => !firstTopics.has(QUESTIONS[i].topic)),
  'rematch must prefer songs not played in previous rounds',
);
state = await call('join', { token: b });
assert.equal(state.phase, 'question', 'returning player should reconnect');
console.log(
  'PASS: create, join, privacy, start, answers, scoring, all 10 rounds, finish, rematch, reconnect.',
);
