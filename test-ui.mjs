import vm from 'node:vm';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { QUESTIONS } from './src/questions.js';
const app={_html:'', handlers:{},addEventListener(type,fn){this.handlers[type]=fn;},get innerHTML(){return this._html;},set innerHTML(x){this._html=x;},querySelectorAll(){return[];}};
const storage=new Map();
const ctx={
  window:{QBANK:QUESTIONS,ONLY_SOLO:true},
  document:{querySelector(sel){if(sel==='#app')return app;
    if(sel==='#player-name')return {value:'Brett'};
    if(sel==='#rounds')return {value:'10'};
    return null;}},
  localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},
  location:{search:'',pathname:'/test',origin:'http://test'},
  history:{replaceState(){}},
  URLSearchParams,crypto:webcrypto,Math,Date,Number,String,Array,Boolean,Set,JSON,
  setInterval(){},fetch:async()=>{throw new Error('unexpected network')},
  navigator:{},console
};
vm.runInNewContext(fs.readFileSync('./public/app.js','utf8'),vm.createContext(ctx));
assert.match(app.innerHTML,/Solo soundcheck/);
assert.doesNotMatch(app.innerHTML,/Host a showdown/);
const click=async (action,choice=0)=>{await app.handlers.click({target:{closest:()=>({dataset:{action,choice:String(choice)}})}})};
await click('open-solo');assert.match(app.innerHTML,/Your name/);
await click('solo');assert.match(app.innerHTML,/QUESTION 1 \/ 10/);assert.match(app.innerHTML,/class="options"/);
await click('choose',0);assert.match(app.innerHTML,/Next Question/);
assert.match(app.innerHTML,/FROM THE LYRICS/);
assert.match(app.innerHTML,/class="lyric-quote"/);
assert.doesNotMatch(app.innerHTML,/The heart was ten feet tall; the lettering was three feet high/);
await click('next');assert.match(app.innerHTML,/QUESTION 2 \/ 10/);
console.log('PASS: UI renders menu, setup, selectable answers, reveal and next question.');
