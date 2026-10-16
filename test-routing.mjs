import assert from 'node:assert/strict';
import worker from './src/worker.js';
let seen=[];
const env={ASSETS:{fetch:async req=>{const p=new URL(req.url).pathname;seen.push(p);return new Response('asset-ok');}}};
for(const [url,path] of [
  ['https://games.murphsmitts.com/','/'],
  ['https://games.murphsmitts.com/numbers/','/numbers/'],
  ['https://games.murphsmitts.com/country/','/country/'],
  ['https://games.murphsmitts.com/country/app.js','/app.js'],
  ['https://games.murphsmitts.com/country/styles.css','/styles.css'],
  ['https://games.murphsmitts.com/country/questions.js','/questions.js'],
  ['https://nineties-country-showdown.example.workers.dev/','/'],
  ['https://nineties-country-showdown.example.workers.dev/numbers/','/numbers/'],
  ['https://nineties-country-showdown.example.workers.dev/country/','/country/'],
]){
  const response=await worker.fetch(new Request(url),env);
  assert.equal(response.status,200,url);
  assert.equal(seen.at(-1),path,url);
}
for(const path of ['country','numbers']){
 const r=await worker.fetch(new Request('https://games.murphsmitts.com/'+path+'?x=1'),env);
 assert.equal(r.status,308);
 assert.equal(r.headers.get('location'),'https://games.murphsmitts.com/'+path+'/?x=1');
}
const apiResponse=await worker.fetch(new Request('https://games.murphsmitts.com/country/api/wrong',{method:'POST',headers:{'content-type':'application/json'},body:'{}'}),env);
assert.equal(apiResponse.status,404);
console.log('PASS: hub, numbers, trivia, static assets, prefix redirects and API routing.');
