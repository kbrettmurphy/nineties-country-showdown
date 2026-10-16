(() => {
'use strict';
const $ = (selector) => document.querySelector(selector);
const app = $('#app');
const letters = 'ABCD';
const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const qs = window.QBANK || [];
const soloOnly = Boolean(window.ONLY_SOLO);
const qparams = new URLSearchParams(location.search);
const inviteCode = (qparams.get('room') || '').toUpperCase().replace(/[^A-Z2-9]/g,'').slice(0,6);
let view = inviteCode ? 'setup' : 'menu';
let mode = inviteCode ? 'join' : 'solo';
let name = localStorage.getItem('country-showdown-name') || '';
let rounds = 10;
let error = '';
let serverState = null;
let code = '';
let requestInFlight = false;
let solo = null;
let previousState = '';
let pendingChoice = false;
const token = (() => {
  let t=localStorage.getItem('country-showdown-player-token');
  if(!t){const bytes=new Uint8Array(24); crypto.getRandomValues(bytes); t=[...bytes].map(b=>b.toString(16).padStart(2,'0')).join(''); localStorage.setItem('country-showdown-player-token',t);}
  return t;
})();
const logo = () => `<header class="masthead"><div class="kicker">All country. All nineties. No mercy.</div><h1 class="brand">HONKY TONK<br><span>SHOWDOWN</span></h1><div class="sub">The 90s Country Trivia Challenge</div><div class="stars">★★★★★</div></header>`;
const notice = () => error ? `<div role="alert" class="notice">${escapeHtml(error)}</div>` : '';
const back = () => `<button class="back" data-action="menu">← Back to the jukebox</button>`;
const button = (label, action, variant = '', more='') => `<button class="button ${variant}" data-action="${action}" ${more}>${label}</button>`;
const shuffle = (arr) => {
  const copy=[...arr];
  for(let i=copy.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1)); [copy[i],copy[j]]=[copy[j],copy[i]];}
  return copy;
};
const makeOrder = n => {
  const specials=shuffle(qs.map((q,i)=>({q,i})).filter(x=>x.q.category==='LYRIC DETECTIVE'||x.q.category==='DEEP CUT'));
  const used=new Set(),selected=[];
  for(const {q,i} of specials){if(selected.length>=Math.ceil(n*.55))break;if(!used.has(q.topic)){used.add(q.topic);selected.push(i);}}
  for(const i of shuffle(qs.map((_,i)=>i))){if(selected.length>=n)break;if(!used.has(qs[i].topic)){used.add(qs[i].topic);selected.push(i);}}
  return shuffle(selected);
};
const saveName = () => { const inp = $('#player-name'); if(inp) { name = inp.value.trim().replace(/\s+/g,' ').slice(0,24); localStorage.setItem('country-showdown-name', name); } return name; };
const pickRounds = () => { rounds = Number($('#rounds')?.value)===20 ? 20 : 10; };
function startSolo(){
  const order=makeOrder(rounds);
  solo={order,index:0,score:0,correct:0,phase:'question',choice:null,earned:0,endsAt:Date.now()+20000};
  view='solo'; error=''; render();
}
function revealSolo(choice){
  if(view!=='solo'||!solo||solo.phase!=='question') return;
  const question=qs[solo.order[solo.index]];
  solo.choice=choice;
  if(choice===question.a){
    solo.earned=100+Math.max(0,Math.round(60*(solo.endsAt-Date.now())/20000));
    solo.score+=solo.earned;solo.correct++;
  } else solo.earned=0;
  solo.phase='reveal'; render();
}
function nextSolo(){
  if(!solo||solo.phase!=='reveal')return;
  solo.index++;
  if(solo.index>=solo.order.length)view='soloDone';
  else {solo.phase='question';solo.choice=null;solo.earned=0;solo.endsAt=Date.now()+20000;}
  render();
}
async function api(path, payload){
  const rsp=await fetch(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...payload,token})});
  const data=await rsp.json().catch(()=>({error:'Could not read the server response.'}));
  if(!rsp.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}
async function runAction(action, payload={}){
  if(requestInFlight)return;
  requestInFlight=true;error='';
  const buttons=app.querySelectorAll('[data-action="'+action+'"]');
  buttons.forEach(el=>el.disabled=true);
  try{
    const result=await api(action==='create' ? '/api/create' : '/api/room/'+code+'/'+action, payload);
    serverState=result;code=result.code;view='room';previousState=JSON.stringify(result); history.replaceState(null,'',location.pathname+'?room='+code); render();
  }catch(e){error=e.message||'Could not connect. Check that the Cloudflare game is deployed.';render();}
  finally{requestInFlight=false;}
}
async function refresh(){
  if(view!=='room'||!code||requestInFlight)return;
  requestInFlight=true;
  try{
    const result=await api('/api/room/'+code+'/state',{});
    const str=JSON.stringify(result);
    if(str!==previousState){serverState=result;previousState=str;render();}
  }catch(e){error=e.message||'Connection interrupted.';if(view==='room') showSoftError(error);}
  finally{requestInFlight=false;}
}
function showSoftError(s){const el=$('#soft-error');if(el)el.textContent=s;}
function scoreboard(players){
  return `<div class="scoreboard">${players.map(p=>`<div class="score ${p.isYou?'you':''}"><div class="name"><span>${escapeHtml(p.name)}${p.isYou?' (you)':''}</span><span>${p.answered?'✓':''}</span></div><b>${p.score}</b><small>${p.correct} right</small></div>`).join('')}</div>`;
}
function choiceButtons(q, chosen, locked, answer){
  return `<div class="options">${q.choices.map((opt,i)=>{
    let status='';
    if(answer!==null&&answer!==undefined)status = i===answer?'good':i===chosen?'bad':'';
    else if(i===chosen)status='selected';
    return `<button class="option ${status}" data-action="choose" data-choice="${i}" ${locked?'disabled':''}>
      <span class="letter">${letters[i]}</span><span>${escapeHtml(opt)}</span></button>`;
  }).join('')}</div>`;
}
function clockBlock(category,number,total){
  return `<div class="topline"><span class="count">QUESTION ${number} / ${total}</span><span class="timer" id="clock">20s</span></div><div class="track"><div id="time-fill" style="width:100%"></div></div><div class="tag">${escapeHtml(category)}</div>`;
}
function drawMenu(){
  return `${logo()}<section class="panel"><div class="eyebrow">Pull up a stool</div><h2 class="section-title">You reckon you know 90s country?</h2><p class="section-sub">53 questions. Ten-foot hearts, deep cuts, album facts, and songs you can sing in your sleep. Twenty seconds per question. Answer quicker for more points.</p>
  <div class="actions">
  <button class="action" data-action="open-solo"><span><b>Solo soundcheck</b><small>Warm up and see your score</small></span><span class="arrow">→</span></button>
  ${soloOnly?'':`<button class="action" data-action="open-host"><span><b>Host a showdown</b><small>Face your buddy live, anywhere</small></span><span class="arrow">→</span></button>
  <button class="action" data-action="open-join"><span><b>Join a showdown</b><small>Got a room code? Get in there.</small></span><span class="arrow">→</span></button>`}
  </div></section><div style="height:18px"></div>${soloOnly?'':`<p class="muted" style="text-align:center">Two-player battles work after deploying the included Cloudflare Worker. Solo mode works right here.</p>`}`;
}
function drawSetup(){
  const isJoin=mode==='join';const isHost=mode==='host';
  return `${logo()}${back()}<section class="panel"><div class="eyebrow">${isJoin?'You got an invite':'Pick your poison'}</div><h2 class="section-title">${isJoin?'Join the competition':isHost?'Start your own room':'Solo soundcheck'}</h2>
  <p class="section-sub">${isJoin?'Enter your name and the six-character room code.':'Choose your name and how many songs worth of punishment you want.'}</p>
  <label class="field"><span>Your name</span><input class="textinput" id="player-name" placeholder="Your nickname" maxlength="24" value="${escapeHtml(name)}" autocomplete="nickname"></label>
  ${isJoin?`<label class="field"><span>Room code</span><input class="textinput" id="room-code" placeholder="ABC123" maxlength="6" value="${escapeHtml(inviteCode)}" autocapitalize="characters" style="text-transform:uppercase;letter-spacing:.22em;font-weight:800"></label>`:`<label class="field"><span>Round length</span><select class="select" id="rounds"><option value="10" ${rounds===10?'selected':''}>10 questions — Quick Draw</option><option value="20" ${rounds===20?'selected':''}>20 questions — Full Set</option></select></label>`}
  ${button(isJoin?'Join Room →':isHost?'Create Room →':'Play Solo →',isJoin?'join':isHost?'create':'solo','block')}
  <div class="notice">${notice()}</div><p class="muted">${isJoin?'Your friend needs to start the game once you join.':isHost?'Share the code with your friend, then hit Start Game.':'All the questions are about country music released in the 1990s.'}</p></section>`;
}
function drawLobby(s){
  const roomUrl = `${location.origin}${location.pathname}?room=${s.code}`;
  return `${logo()}${back()}<section class="panel"><div class="eyebrow">${s.isHost?'Your room is ready':'You made it'}</div><h2 class="section-title">The Honky Tonk Lobby</h2>
  <div class="invite"><div class="joinlabel">Share this code</div><div class="roomcode">${escapeHtml(s.code)}</div><div class="roomline">${button('Copy Invite Link','copy-link','small')}${button('Share','share','small secondary')}</div></div>
  <div class="eyebrow">Players (${s.players.length}/8)</div><div class="players">${s.players.map(p=>`<span class="chip ${p.isYou&&s.isHost?'host':''}">${escapeHtml(p.name)}${p.isYou?' (you)':''}</span>`).join('')}</div>
  ${s.isHost?button(s.players.length>=2?'Start Game →':'Waiting for a buddy…','start','block',s.players.length<2?'disabled':''):'<div class="wait"><span class="spinner"></span> Waiting for the host to start…</div>'}
  <div id="soft-error" class="notice">${notice()}</div><p class="muted" style="margin-bottom:0">${s.rounds} questions · 20 seconds per question · +100 for correct plus a speed bonus</p></section>`;
}
function drawQuestion(kind,s){
  const local = kind==='solo';
  const q= local ? qs[s.order[s.index]] : s.question;
  const revealed=local ? s.phase==='reveal' : s.phase==='reveal';
  const chosen=local ? s.choice : s.ownChoice;
  const answer = revealed ? (local ? q.a : s.reveal.correctIndex) : null;
  const ownAnswered=chosen!==null && chosen!==undefined;
  const locked=local ? revealed : revealed || ownAnswered || pendingChoice;
  const explanation=local?q.fact:s.reveal?.explanation;
  const earned=local?s.earned:s.reveal?.myResult.points;
  return `${logo()}${back()}<section class="panel">
  ${clockBlock(q.category,s.index+1,local?s.order.length:s.total)}
  <h2 class="question">${escapeHtml(q.q)}</h2>
  ${choiceButtons(q,chosen,locked,answer)}
  ${revealed?`<div class="answer-note"><strong>${answer===chosen?'NAILED IT.':'THE RIGHT ANSWER: '+escapeHtml(q.choices[answer])}</strong>${escapeHtml(explanation)}<br><span class="gain">${earned>0?'+'+earned+' points':'No points this round'}</span></div>`:
    ownAnswered?`<div class="wait"><span class="spinner"></span> Answer locked. ${local?'':'Waiting for the other players…'}</div>`:''}
  ${local&&revealed?button(s.index+1===s.order.length?'See Final Score →':'Next Question →','next','block'):''}
  ${!local&&revealed?`<div class="wait"><span class="spinner"></span> Next question coming up…</div>`:''}
  ${!local?scoreboard(s.players):`<div class="scoreboard"><div class="score you"><div class="name">Your points</div><b>${s.score}</b><small>${s.correct} correct</small></div></div>`}
  <div id="soft-error" class="notice">${notice()}</div></section>`;
}
function drawFinish(s, local){
  const players=local?[{name:'You',score:s.score,correct:s.correct,isYou:true}]:s.players;
  const winners=players[0] ? players.filter(p=>p.score===players[0].score) : [];
  const winnerLine = local ? `${s.correct} out of ${s.order.length} correct` : winners.length>1?'It’s a tie. Settle it with a rematch.':`${escapeHtml(winners[0].name)} owns the jukebox.`;
  return `${logo()}${back()}<section class="panel results"><div class="eyebrow">That's a wrap</div><div class="trophy">★</div><h2 class="section-title">${local?'Soundcheck complete':'Showdown complete'}</h2><p class="section-sub" style="margin-top:12px">${winnerLine}</p>
  <div class="podium">${players.map((p,i)=>`<div class="podiumrow"><span>${local?'':i+1+'. '}${escapeHtml(p.name)}${p.isYou&&!local?' (you)':''}<small style="display:block;color:#aeb9af;font-size:11px">${p.correct} correct</small></span><b>${p.score}</b></div>`).join('')}</div>
  ${local?button('Play Again →','restart','block'):s.isHost?button('Rematch →','rematch','block'):'<div class="wait">Waiting for the host to call a rematch…</div>'}
  <div id="soft-error" class="notice">${notice()}</div><p class="muted">${local?soloOnly?'Play again, or deploy the multiplayer kit to challenge a friend.':'Challenge your buddy using Host a Showdown on the home screen.':'New questions are picked for every rematch.'}</p></section>`;
}
function render(){
  let html='';
  if(view==='menu')html=drawMenu();
  if(view==='setup')html=drawSetup();
  if(view==='solo')html=drawQuestion('solo',solo);
  if(view==='soloDone')html=drawFinish(solo,true);
  if(view==='room'&&serverState){
    const phase=serverState.phase;
    html=phase==='lobby'?drawLobby(serverState):phase==='finished'?drawFinish(serverState,false):drawQuestion('room',serverState);
  }
  app.innerHTML=html;
  drawClock();
}
function drawClock(){
  const timer=$('#clock'); const fill=$('#time-fill');
  if(!timer || !fill) return;
  const local=view==='solo';
  const s=local?solo:serverState;
  if(!s)return;
  if(s.phase==='reveal'){
    const seconds=local?0:Math.max(0,Math.ceil((s.revealAt-Date.now())/1000));
    timer.textContent=local?'REVEAL':`NEXT ${seconds}s`;
    fill.style.width='0%';return;
  }
  const time=Math.max(0,s.endsAt-Date.now());
  const seconds=Math.ceil(time/1000);
  timer.textContent=seconds+'s';
  timer.classList.toggle('warn',seconds<=5);
  fill.style.width=(100*time/20000)+'%';
  if(local&&time<=0&&s.phase==='question')revealSolo(null);
}
app.addEventListener('click',async (evt)=>{
  const element=evt.target.closest('[data-action]');if(!element)return;
  const action=element.dataset.action;
  if(action==='menu'){view='menu';error='';code='';serverState=null;pendingChoice=false;history.replaceState(null,'',location.pathname);render();return;}
  if(['open-host','open-join','open-solo'].includes(action)){if(soloOnly&&action!=='open-solo')return;mode=action.slice(5);view='setup';error='';render();return;}
  if(action==='solo'||action==='create'||action==='join'){
    if(!saveName()){error='Enter a nickname first.';render();return;}
    if(action!=='join')pickRounds();
    if(action==='solo'){startSolo();return;}
    if(action==='create') await runAction('create',{name,rounds});
    else {
      code=($('#room-code')?.value||'').toUpperCase().replace(/[^A-Z2-9]/g,'');
      if(code.length!==6){error='The room code must be six characters.';render();return;}
      await runAction('join',{name});
    }
    return;
  }
  if(action==='choose'){
    const choice=Number(element.dataset.choice);
    if(view==='solo')revealSolo(choice);
    else if(view==='room'&&serverState?.phase==='question'&&!pendingChoice&&serverState.ownChoice===null){
      pendingChoice=true;
      app.querySelectorAll('.option').forEach(b=>b.disabled=true);
      await runAction('answer',{choice}); pendingChoice=false;
    }
    return;
  }
  if(action==='next'){nextSolo();return;}
  if(action==='restart'){startSolo();return;}
  if(['start','rematch'].includes(action)){await runAction(action,{});return;}
  if(action==='copy-link'||action==='share'){
    const url=`${location.origin}${location.pathname}?room=${serverState.code}`;
    try{
      if(action==='share'&&navigator.share)await navigator.share({title:'Honky Tonk Showdown',text:'Think you know 90s country? Join my trivia room.',url});
      else {await navigator.clipboard.writeText(url);element.textContent='Copied!';}
    }catch(e){ if(e.name!=='AbortError')showSoftError('Could not share automatically. Send them code '+serverState.code); }
  }
});
setInterval(drawClock,180);
setInterval(refresh,1200);
render();
})();
