import { QUESTIONS } from './questions.js';

const DURATION_MS = 30000;
const REVEAL_MS = 5500;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

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
const pickQuestions = (count) => {
  const specials = QUESTIONS.map((q,i)=>({q,i})).filter(({q})=>
    q.category==='LYRIC DETECTIVE' || q.category==='DEEP CUT');
  const shuffle = arr => {
    for(let i=arr.length-1;i>0;i--){
      const bytes=new Uint32Array(1);crypto.getRandomValues(bytes);
      const j=bytes[0]%(i+1);[arr[i],arr[j]]=[arr[j],arr[i]];
    }
    return arr;
  };
  const usedTopics = new Set();
  const selected = [];
  const target = Math.ceil(count * .55);
  for(const {q,i} of shuffle(specials)){
    if(selected.length>=target) break;
    if(usedTopics.has(q.topic))continue;
    usedTopics.add(q.topic);selected.push(i);
  }
  const rest=shuffle(QUESTIONS.map((_,i)=>i).filter(i=>!selected.includes(i)));
  for(const i of rest){
    if(selected.length>=count)break;
    if(usedTopics.has(QUESTIONS[i].topic))continue;
    usedTopics.add(QUESTIONS[i].topic);selected.push(i);
  }
  return shuffle(selected);
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    // Supports both the standalone workers.dev site and a path-based route such as
    // games.murphsmitts.com/country/. This does NOT intercept the number game at /.
    if (url.pathname === '/country') return Response.redirect(url.origin + '/country/' + url.search, 308);
    if (url.pathname === '/country/' || url.pathname.startsWith('/country/')) {
      url.pathname = url.pathname.slice('/country'.length) || '/';
    }
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(new Request(url, request));
    if (request.method !== 'POST') return fail('Use POST for game actions.', 405);
    let data;
    try { data = await request.json(); } catch { return fail('Invalid request.'); }
    const path = url.pathname.split('/').filter(Boolean);
    try {
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
      question:question?{ category:question.category, q:question.q, choices:question.choices }:null,
      ownChoice:room.answers?.[token]?.choice ?? null,
      reveal:room.phase==='reveal'?{
        correctIndex:question.a,
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
        rounds:data.rounds===20?20:10,
        order:[], answers:{}, players:[{token,name,score:0,correct:0}]};
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
      room.order=pickQuestions(room.rounds); room.index=0; room.phase='question'; room.answers={}; room.lastRound=null;
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
    return this.state(room,token);
  }
}
