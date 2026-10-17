import vm from 'node:vm';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { QUESTIONS } from '../src/country/questions.js';

// Regression: tapping an answer while the background poll was in flight used to be dropped,
// leaving the buttons disabled so the player could not answer.
const app = {
  _html: '',
  handlers: {},
  addEventListener(type, fn) {
    this.handlers[type] = fn;
  },
  get innerHTML() {
    return this._html;
  },
  set innerHTML(x) {
    this._html = x;
  },
  querySelectorAll() {
    return [];
  },
};
const q = QUESTIONS[0];
const roomState = (ownChoice = null) => ({
  code: 'ABC234',
  phase: 'question',
  isHost: false,
  rounds: 10,
  index: 0,
  total: 10,
  endsAt: Date.now() + 30000,
  revealAt: null,
  players: [{ name: 'Russ', score: 0, correct: 0, isYou: true, answered: ownChoice !== null }],
  question: { id: q.id, topic: q.topic, category: q.category, q: q.q, choices: q.choices },
  ownChoice,
  reveal: null,
});
const requests = [];
let releasePoll;
const intervals = [];
const storage = new Map();
const ctx = {
  window: { QBANK: QUESTIONS },
  document: {
    querySelector(sel) {
      if (sel === '#app') return app;
      if (sel === '#player-name') return { value: 'Russ' };
      if (sel === '#room-code') return { value: 'ABC234' };
      return null;
    },
  },
  localStorage: { getItem: (k) => storage.get(k) || null, setItem: (k, v) => storage.set(k, v) },
  location: { search: '?room=ABC234', pathname: '/country/', origin: 'http://test' },
  history: { replaceState() {} },
  URLSearchParams,
  crypto: webcrypto,
  Math,
  Date,
  Number,
  String,
  Array,
  Boolean,
  Set,
  Map,
  JSON,
  setInterval(fn, ms) {
    intervals.push({ fn, ms });
  },
  fetch: async (url, init) => {
    const body = JSON.parse(init.body);
    requests.push({ url, body });
    if (url.endsWith('/state'))
      await new Promise((resolve) => {
        releasePoll = resolve;
      });
    const json = url.endsWith('/answer') ? roomState(body.choice) : roomState();
    return { ok: true, json: async () => json };
  },
  navigator: {},
  console,
};
vm.runInNewContext(fs.readFileSync('./public/country/app.js', 'utf8'), vm.createContext(ctx));
const click = (action, choice = 0) =>
  app.handlers.click({
    target: { closest: () => ({ dataset: { action, choice: String(choice) } }) },
  });
await click('join');
assert.match(app.innerHTML, /class="options"/);
assert.doesNotMatch(app.innerHTML, /option selected/, 'nothing pre-selected on a new question');
const poll = intervals.find((i) => i.ms === 1200).fn;
const polling = poll();
const tap = click('choose', 2);
releasePoll();
await polling;
await tap;
const answer = requests.find((r) => r.url.endsWith('/answer'));
assert.ok(answer, 'answer tapped during a poll must still be sent');
assert.equal(answer.body.choice, 2);
assert.match(app.innerHTML, /option selected/);
console.log('PASS: answers tapped while the room is polling are sent, not dropped.');
