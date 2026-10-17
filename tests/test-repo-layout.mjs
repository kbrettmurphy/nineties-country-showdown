import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { QUESTIONS } from '../src/country/questions.js';
for (const path of [
  'public/index.html',
  'public/hub.css',
  'public/numbers/index.html',
  'public/numbers/styles.css',
  'public/country/index.html',
  'public/country/app.js',
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
assert.equal(QUESTIONS.length, 454);
console.log('PASS: organized hub, Number Match wrapper, country assets and 454 questions.');
