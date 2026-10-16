import assert from 'node:assert/strict';
import worker from './src/worker.js';
let seen=[];
const env={ASSETS:{fetch:async req=>{seen.push(new URL(req.url).pathname);return new Response('asset-ok');}}};
for(const [url,path] of [
  ['https://example.workers.dev/','/'],
  ['https://example.workers.dev/app.js','/app.js'],
  ['https://games.murphsmitts.com/country/','/'],
  ['https://games.murphsmitts.com/country/app.js','/app.js'],
  ['https://games.murphsmitts.com/country/styles.css','/styles.css'],
  ['https://games.murphsmitts.com/country/questions.js','/questions.js']
]){
  const response=await worker.fetch(new Request(url),env);
  assert.equal(response.status,200,url);
  assert.equal(seen.at(-1),path,url);
}
const redirect=await worker.fetch(new Request('https://games.murphsmitts.com/country'),env);
assert.equal(redirect.status,308);
assert.equal(redirect.headers.get('location'),'https://games.murphsmitts.com/country/');
console.log('PASS: standalone path, games.murphsmitts.com/country/, assets, and prefix redirect.');
