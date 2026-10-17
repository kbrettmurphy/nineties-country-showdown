import assert from 'node:assert/strict';
import { QUESTIONS } from './src/questions.js';
import { GameRoom } from './src/worker.js';
const tokenA='a'.repeat(32),tokenB='b'.repeat(32);
const chosen=[...new Set(QUESTIONS.map(q=>q.topic))].slice(0,45);
const shared=new Map();
const ctx={storage:{get:async key=>shared.get(key),put:async(key,val)=>shared.set(key,structuredClone(val))}};
const room=new GameRoom(ctx,{LEADERBOARD:{idFromName:()=> 'leaderboard', get:()=>({fetch:async()=>Response.json({ok:true})})}});
const call=async(action,data)=>{
  const r=await room.fetch(new Request('https://room.internal/'+action,{method:'POST',body:JSON.stringify(data)}));
  const body=await r.json();
  assert.equal(r.status,200,`${action}: ${JSON.stringify(body)}`);
  return body;
};
await call('create',{token:tokenA,name:'North Carolina',rounds:20,code:'AFC234',recentTopics:chosen.slice(0,23)});
await call('join',{token:tokenB,name:'Texas',recentTopics:chosen.slice(23)});
await call('start',{token:tokenA,recentTopics:chosen.slice(0,23)});
const first=shared.get('room').order.map(i=>QUESTIONS[i]);
assert.equal(first.length,20);
assert(first.every(q=>!chosen.includes(q.topic)),'must avoid topics that either player saw before the room');
const st=await call('state',{token:tokenA});
assert.equal(st.question.topic,first[0].topic);
const seen=new Set();
for (let i=0;i<20;i++) {
 const current=shared.get('room');
 if(i>0){current.revealAt=Date.now()-1;shared.set('room',current);await call('state',{token:tokenA});}
 const now=shared.get('room');
 assert(!seen.has(QUESTIONS[now.order[now.index]].topic));
 seen.add(QUESTIONS[now.order[now.index]].topic);
 now.endsAt=Date.now()-1;shared.set('room',now);await call('state',{token:tokenA});
}
const end=shared.get('room');end.revealAt=Date.now()-1;shared.set('room',end);await call('state',{token:tokenA});
await call('rematch',{token:tokenA,recentTopics:chosen.slice(0,23)});
const second=shared.get('room').order.map(i=>QUESTIONS[i].topic);
assert(second.every(t=>!seen.has(t)),'rematches must avoid earlier room games');
assert(second.every(t=>!chosen.includes(t)),'rematches must avoid both player histories');
console.log('PASS: player history merges across states, both opponents, and rematches; 20 fresh tracks each round.');
