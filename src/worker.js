import { QUESTIONS } from './questions.js';

const DURATION_MS = 30000;
const REVEAL_MS = 5500;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const questionById = new Map(QUESTIONS.map(q=>[q.id,q]));

const asJson = (data, status = 200) => Response.json(data, {
  status,
  headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }
});
const fail = (message, status = 400) => asJson({ error: message }, status);
const shortName = (name) => typeof name === 'string' ? name.trim().replace(/\s+/g,' ').slice(0,24) : '';
const isToken = (token) => typeof token === 'string' && /^[a-zA-Z0-9_-]{16,100}$/.test(token);
const normalizeCode = (s) => String(s || '').trim().toUpperCase().replace(/[^A-Z2-9]/g, '');
const randomCode = () => {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return [...bytes].map(n => ALPHABET[n % ALPHABET.length]).join('');
};
const TOPIC_HISTORY_LIMIT = 340;
const validTopics = new Set(QUESTIONS.map(q=>q.topic));
const cleanHistory = value => Array.isArray(value)
  ? [...new Set(value.filter(topic=>typeof topic==='string' && validTopics.has(topic)))].slice(-TOPIC_HISTORY_LIMIT)
  : [];
const pickQuestions = (count, recentTopics=[]) => {
  const recent=Array.isArray(recentTopics) ? [...new Set(recentTopics.filter(t=>typeof t==='string'&&validTopics.has(t)))] : [];
  const seen=new Set(recent);
  const shuffle = array => {
    for(let i=array.length-1;i>0;i--){
      const bytes=new Uint32Array(1);crypto.getRandomValues(bytes);
      const j=bytes[0]%(i+1);[array[i],array[j]]=[array[j],array[i]];
    }
    return array;
  };
  const pool=shuffle(QUESTIONS.map((q,i)=>({q,i})));
  const fresh=pool.filter(x=>!seen.has(x.q.topic));
  const older=pool.filter(x=>seen.has(x.q.topic)).sort((a,b)=>recent.indexOf(a.q.topic)-recent.indexOf(b.q.topic));
  const selected=[], used=new Set();
  const add=(list,limit,predicate)=>{
    for(const entry of list){
      if(selected.length>=limit)break;
      if(used.has(entry.q.topic)||!predicate(entry.q))continue;
      selected.push(entry.i);used.add(entry.q.topic);
    }
  };
  const details=q=>['LYRIC DETECTIVE','DEEP CUT','ALBUMS & COLLABS'].includes(q.category);
  add(fresh,Math.ceil(count*.4),details);
  add(fresh,count,()=>true);
  if(selected.length<count)add(older,count,()=>true);
  return shuffle(selected);
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    // MurphsMitts games hub: / (launcher), /numbers/ (original game embedded),
    // and /country/ (Cloudflare-backed multiplayer trivia).
    // Keep the country API at /country/api/...; the client uses that prefix.
    if (url.pathname === '/country' || url.pathname === '/numbers') {
      return Response.redirect(url.origin + url.pathname + '/' + url.search, 308);
    }
    // Let Cloudflare's static-asset handler serve folder index pages directly.
    // Rewriting /numbers/ to /numbers/index.html (or /country/ likewise)
    // causes a loop: the default HTML handler canonically redirects index.html
    // right back to the trailing-slash URL.
    // Trivia's JS/CSS and API remain rooted at /, so only those paths are remapped.
    if (url.pathname.startsWith('/country/') &&
        url.pathname !== '/country/' &&
        url.pathname !== '/country/index.html') {
      url.pathname = url.pathname.slice('/country'.length);
    }
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(new Request(url, request));
    if (url.pathname==='/api/leaderboard' && request.method==='GET') {
      return env.LEADERBOARD.get(env.LEADERBOARD.idFromName('country-global')).fetch('https://leaderboard.internal/list'+url.search);
    }
    if (request.method !== 'POST') return fail('Use POST for game actions.', 405);
    let data;
    try { data = await request.json(); } catch { return fail('Invalid request.'); }
    const path = url.pathname.split('/').filter(Boolean);
    try {
      if(path[0]==='api' && path[1]==='solo' && ['start','answer','next'].includes(path[2]) && path.length===3) {
        return env.LEADERBOARD.get(env.LEADERBOARD.idFromName('country-global')).fetch('https://leaderboard.internal/solo/'+path[2],{
          method:'POST',body:JSON.stringify(data)
        });
      }
      if (path.length === 2 && path[1] === 'create') {
        if (!shortName(data.name) || !isToken(data.token)) return fail('Enter a name to play.');
        for(let attempt = 0; attempt < 8; attempt++) {
          const code = randomCode();
          const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
          const response = await stub.fetch('https://room.internal/create', {
            method:'POST', body: JSON.stringify({ ...data, code })
          });
          if (response.status === 409) continue;
          return response;
        }
        return fail('Could not generate a room. Try again.', 503);
      }
      if (path.length === 4 && path[1] === 'room') {
        const code = normalizeCode(path[2]);
        const action = path[3];
        if (!/^[A-HJ-NP-Z2-9]{6}$/.test(code)) return fail('Enter a valid six-character room code.');
        if (!['join','state','start','answer','rematch'].includes(action)) return fail('Unknown game action.',404);
        const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
        return stub.fetch('https://room.internal/'+action, {
          method:'POST', body: JSON.stringify({ ...data, code })
        });
      }
      return fail('Unknown endpoint.', 404);
    } catch (e) {
      console.error('Game request failure:', e);
      return fail('Game server unavailable. Please try again.', 503);
    }
  }
};

export class GameRoom {
  constructor(ctx, env){ this.ctx=ctx; this.env=env; }

  progress(room) {
    const now=Date.now();
    if(room.phase === 'question' && (now >= room.endsAt || room.players.every(p => room.answers[p.token]))) {
      this.reveal(room);
      return true;
    }
    if(room.phase === 'reveal' && now >= room.revealAt) {
      room.index++;
      if(room.index >= room.order.length){ room.phase='finished'; room.endsAt=null; }
      else { room.phase='question'; room.endsAt=Date.now()+DURATION_MS; room.answers={}; room.lastRound=null; }
      return true;
    }
    return false;
  }

  reveal(room) {
    const question=QUESTIONS[room.order[room.index]];
    const result={};
    for(const p of room.players){
      const answer=room.answers[p.token];
      const correct=Boolean(answer && answer.choice === question.a);
      const speed=correct ? Math.max(0, Math.round(60*(room.endsAt-answer.at)/DURATION_MS)) : 0;
      const points=correct ? 100+speed : 0;
      p.score+=points;
      if(correct) p.correct++;
      result[p.token]={ choice: answer?.choice ?? null, correct, points };
    }
    room.lastRound=result;
    room.phase='reveal';
    room.revealAt=Date.now()+REVEAL_MS;
  }

  state(room, token){
    const me=room.players.find(p => p.token===token);
    if(!me) return fail('You are not in this room. Rejoin to play.',403);
    const question = ['question','reveal'].includes(room.phase) ? QUESTIONS[room.order[room.index]] : null;
    return asJson({
      code:room.code,
      phase:room.phase,
      isHost:room.host===token,
      rounds:room.rounds,
      index:room.index,
      total:room.order?.length || room.rounds,
      endsAt:room.endsAt || null,
      revealAt:room.revealAt || null,
      players:room.players.map(p=>({name:p.name,score:p.score,correct:p.correct,isYou:p.token===token,answered: Boolean(room.answers?.[p.token])})).sort((a,b)=>b.score-a.score),
      question:question?{ id:question.id, topic:question.topic, category:question.category, q:question.q, choices:question.choices }:null,
      ownChoice:room.answers?.[token]?.choice ?? null,
      reveal:room.phase==='reveal'?{
        correctIndex:question.a, topic:question.topic,
        lyric:question.lyric,
        lyricSong:question.lyricSong,
        lyricArtist:question.lyricArtist,
        myResult:room.lastRound?.[token] || {choice:null,correct:false,points:0}
      }:null
    });
  }

  async fetch(request) {
    const action=new URL(request.url).pathname.slice(1);
    let data;
    try { data=await request.json(); }catch{ return fail('Invalid request.'); }
    const token=data?.token;
    if(!isToken(token)) return fail('Player session missing.',401);
    let room = await this.ctx.storage.get('room');
    const now=Date.now();
    if(action==='create'){
      if(room) return fail('Room already exists.',409);
      const name=shortName(data.name);
      if(!name) return fail('Enter your name.');
      room={code:data.code, host:token, createdAt:now, phase:'lobby', index:0,
        matchNumber:0, rounds:data.rounds===20?20:10,
        order:[], answers:{}, players:[{token,name,score:0,correct:0}], recentByPlayer:{[token]:cleanHistory(data.recentTopics)}, playedTopics:[]};
      await this.ctx.storage.put('room',room);
      return this.state(room,token);
    }
    if(!room || now-room.createdAt>86400000) return fail('Room not found or expired. Create a new room.',404);
    if(action==='join'){
      let player=room.players.find(p=>p.token===token);
      if(!player && room.phase!=='lobby') return fail('This game has already started. Ask your friend for a new room.',409);
      if(!player){
        if(room.players.length>=8) return fail('This room is full (8 players max).',409);
        const name=shortName(data.name);
        if(!name) return fail('Enter your name.');
        if(room.players.some(p=>p.name.toLowerCase()===name.toLowerCase())) return fail('That name is taken in this room.');
        room.players.push({token,name,score:0,correct:0});
        room.recentByPlayer ||= {};
        room.recentByPlayer[token]=cleanHistory(data.recentTopics);
        await this.ctx.storage.put('room',room);
      }
      return this.state(room,token);
    }
    if(!room.players.some(p=>p.token===token)) return fail('Rejoin with your name to enter this room.',403);
    let changed=this.progress(room);
    if(action==='start' || action==='rematch'){
      if(room.host!==token) return fail('Only the host can start the game.',403);
      if(room.players.length<2) return fail('Waiting for at least two players.');
      if(action==='start' && room.phase!=='lobby') return fail('Game is already underway.');
      if(action==='rematch' && room.phase!=='finished') return fail('Finish this game before a rematch.');
      room.recentByPlayer ||= {}; room.recentByPlayer[token]=cleanHistory(data.recentTopics);
      const allRecent=[...Object.values(room.recentByPlayer).flat(),...(room.playedTopics||[])];
      room.order=pickQuestions(room.rounds,allRecent);
      room.playedTopics=[...(room.playedTopics||[]),...room.order.map(i=>QUESTIONS[i].topic)].slice(-TOPIC_HISTORY_LIMIT);
      room.index=0; room.phase='question'; room.answers={}; room.lastRound=null;
      room.endsAt=now+DURATION_MS; room.revealAt=null;
      room.players.forEach(p=>{p.score=0;p.correct=0;});
      changed=true;
    }else if(action==='answer'){
      if(room.phase!=='question') return fail('This question has closed.');
      if(!Number.isInteger(data.choice) || data.choice<0 || data.choice>3) return fail('Choose one of the four answers.');
      if(room.answers[token]) return fail('Your answer is already locked.');
      if(Date.now()>=room.endsAt){this.reveal(room);changed=true;}
      else {
        room.answers[token]={choice:data.choice,at:Date.now()}; changed=true;
        this.progress(room);
      }
    }else if(action!=='state') return fail('Unknown room action.',404);
    if(changed) await this.ctx.storage.put('room',room);
    // Results are reported from the authoritative multiplayer room, never from a browser-supplied score.
    if(room.phase==='finished' && !room.reported) {
      try {
        const result=await this.env.LEADERBOARD.get(this.env.LEADERBOARD.idFromName('country-global')).fetch('https://leaderboard.internal/record',{
          method:'POST',body:JSON.stringify({matchId:`room-${room.code}-${room.createdAt}-${room.matchNumber||1}`,rounds:room.rounds,mode:'multiplayer',players:room.players.map(p=>({name:p.name,score:p.score,correct:p.correct}))})
        });
        if(result.ok) {room.reported=true;await this.ctx.storage.put('room',room);}
      }catch(e){console.error('Leaderboard submission will retry:',e);}
    }
    return this.state(room,token);
  }
}

// Shared, persistent country-trivia high scores. Names are display names, not authenticated accounts.
// Scores come from timed, server-validated solo sessions or authoritative GameRoom instances.
export class CountryLeaderboard {
  constructor(ctx,env){
    this.ctx=ctx;this.env=env;
    this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS matches (
      match_id TEXT PRIMARY KEY, finished_at INTEGER NOT NULL
    )`);
    this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS scores (
      name_key TEXT NOT NULL, rounds INTEGER NOT NULL, display_name TEXT NOT NULL,
      best_score INTEGER NOT NULL, best_correct INTEGER NOT NULL, games INTEGER NOT NULL,
      first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL,
      PRIMARY KEY(name_key, rounds)
    )`);
  }
  recordMatch(match){
    const {matchId,rounds,players}=match;
    if(typeof matchId!=='string'||matchId.length>120||![10,20].includes(rounds)||!Array.isArray(players)||players.length<1||players.length>8)return false;
    const valid=players.every(p=>shortName(p.name)&&Number.isInteger(p.score)&&p.score>=0&&p.score<=rounds*160 && Number.isInteger(p.correct)&&p.correct>=0&&p.correct<=rounds);
    if(!valid)return false;
    const sql=this.ctx.storage.sql;const timestamp=Date.now();
    this.ctx.storage.transactionSync(()=>{
      if([...sql.exec('SELECT match_id FROM matches WHERE match_id=?',matchId)].length)return;
      sql.exec('INSERT INTO matches (match_id,finished_at) VALUES (?,?)',matchId,timestamp);
      for(const player of players){
        const display=shortName(player.name);
        const key=display.toLocaleLowerCase('en-US');
        const current=[...sql.exec('SELECT best_score,best_correct FROM scores WHERE name_key=? AND rounds=?',key,rounds)][0];
        const better=!current||player.score>current.best_score;
        sql.exec(`INSERT INTO scores (name_key,rounds,display_name,best_score,best_correct,games,first_seen,last_seen)
          VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(name_key,rounds) DO UPDATE SET
          display_name=excluded.display_name, best_score=excluded.best_score,
          best_correct=excluded.best_correct, games=scores.games+1, last_seen=excluded.last_seen`,
          key,rounds,display,better?player.score:current.best_score,better?player.correct:current.best_correct,1,timestamp,timestamp);
      }
    });
    return true;
  }
  async fetch(request){
    const url=new URL(request.url);const action=url.pathname;
    if(action==='/list'){
      const rounds=url.searchParams.get('rounds')==='20'?20:10;
      const rows=[...this.ctx.storage.sql.exec('SELECT display_name,best_score,best_correct,games,last_seen FROM scores WHERE rounds=? ORDER BY best_score DESC,best_correct DESC,last_seen ASC LIMIT 100',rounds)];
      const stats=[...this.ctx.storage.sql.exec('SELECT COUNT(*) AS players,COALESCE(SUM(games),0) AS games FROM scores WHERE rounds=?',rounds)][0];
      return asJson({rounds,rows,stats});
    }
    if(request.method!=='POST')return fail('Use POST',405);
    let d;try{d=await request.json();}catch{return fail('Invalid request.');}
    if(action==='/record')return this.recordMatch(d)?asJson({ok:true}):fail('Invalid result');
    if(!action.startsWith('/solo/'))return fail('Unknown action',404);
    if(!isToken(d.token))return fail('Player session missing',401);
    if(action==='/solo/start'){
      const nick=shortName(d.name); const ids=d.questionIds;
      if(!nick||!Array.isArray(ids)||![10,20].includes(ids.length)||!ids.every(Number.isInteger))return fail('Invalid solo game');
      if(new Set(ids).size!==ids.length || new Set(ids.map(id=>questionById.get(id)?.topic)).size!==ids.length || ids.some(id=>!questionById.has(id)))return fail('Invalid question selection');
      const id=crypto.randomUUID();const now=Date.now();
      const session={id,token:d.token,name:nick,ids,index:0,score:0,correct:0,endsAt:now+DURATION_MS,createdAt:now,answered:false,lastResult:null};
      await this.ctx.storage.put('solo:'+id,session);
      return asJson({sessionId:id,endsAt:session.endsAt});
    }
    if(typeof d.sessionId!=='string'||!/^[-0-9a-f]{36}$/.test(d.sessionId))return fail('Invalid solo session');
    const key='solo:'+d.sessionId;
    const session=await this.ctx.storage.get(key);
    if(!session||session.token!==d.token||Date.now()-session.createdAt>90*60000)return fail('Solo session expired',404);
    if(action==='/solo/answer'){
      if(session.answered)return asJson(session.lastResult);
      const question=questionById.get(session.ids[session.index]);
      if(!question||d.questionId!==question.id||!(d.choice===null||(Number.isInteger(d.choice)&&d.choice>=0&&d.choice<=3)))return fail('Unexpected question');
      const now=Date.now();
      const correct=d.choice===question.a && now<=session.endsAt+1200;
      const points=correct?100+Math.max(0,Math.round(60*(session.endsAt-now)/DURATION_MS)):0;
      session.score+=points;if(correct)session.correct++;
      session.answered=true;
      session.lastResult={points,score:session.score,correct:session.correct,finished:session.index===session.ids.length-1};
      await this.ctx.storage.put(key,session);
      if(session.lastResult.finished){
        this.recordMatch({matchId:'solo-'+session.id,rounds:session.ids.length,mode:'solo',players:[{name:session.name,score:session.score,correct:session.correct}]});
      }
      return asJson(session.lastResult);
    }
    if(action==='/solo/next'){
      if(!session.answered||session.index>=session.ids.length-1)return fail('Answer this round first.');
      session.index++;session.answered=false;session.lastResult=null;session.endsAt=Date.now()+DURATION_MS;
      await this.ctx.storage.put(key,session);
      return asJson({endsAt:session.endsAt});
    }
    return fail('Unknown action',404);
  }
}
