import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { QUESTIONS } from '../src/country/questions.js';
for (const path of [
  'public/index.html',
  'public/hub.css',
  'public/tip/index.html',
  'public/tip/tip.css',
  'public/numbers/index.html',
  'public/numbers/styles.css',
  'public/country/index.html',
  'public/country/app.js',
  'public/country/picker.js',
  'public/country/styles.css',
  'public/country/questions.js',
  'src/worker.js',
]) {
  assert(existsSync(path), `missing ${path}`);
}
const trivia = readFileSync('public/country/index.html', 'utf8');
assert.match(trivia, /\.\/app\.js/);
assert.match(trivia, /\.\/styles\.css/);
assert.match(trivia, /\.\/questions\.js/);
// Players' no-repeat history is stored by song topic, so a released question must keep its id and
// topic forever. New questions are only ever appended.
const released = JSON.parse(readFileSync('tests/fixtures/question-topics.json', 'utf8'));
for (const [id, topic] of released) {
  assert.equal(QUESTIONS[id - 1]?.id, id, `question ${id} moved`);
  assert.equal(QUESTIONS[id - 1].topic, topic, `question ${id} changed song topic`);
}
assert.equal(new Set(QUESTIONS.map((q) => q.id)).size, QUESTIONS.length, 'question ids are unique');
const songs = new Set(QUESTIONS.map((q) => q.topic)).size;
assert.ok(songs >= 800, `expected 800+ songs, got ${songs}`);
const client = readFileSync('public/country/questions.js', 'utf8');
assert.equal(
  JSON.stringify(JSON.parse(client.slice(client.indexOf('['), client.lastIndexOf(']') + 1))),
  JSON.stringify(QUESTIONS),
  'browser and server question banks must match',
);
console.log(
  `PASS: organized hub, Number Match wrapper, country assets, ${QUESTIONS.length} questions over ${songs} songs, released topics unchanged.`,
);
