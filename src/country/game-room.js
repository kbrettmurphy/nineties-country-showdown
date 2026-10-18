import {
  QUESTIONS,
  DURATION_MS,
  REVEAL_MS,
  asJson,
  fail,
  shortName,
  isToken,
  HISTORY_LIMIT,
  cleanLevel,
  cleanHistory,
  fromLegacyTopics,
  pickQuestions,
} from './shared.js';

// A browser's local play history: question ids from current clients, songs from older ones.
const browserHistory = (data) =>
  Array.isArray(data?.recentQuestions)
    ? cleanHistory(data.recentQuestions)
    : fromLegacyTopics(data?.recentTopics);

export class GameRoom {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }

  leaderboard(path, body) {
    return this.env.LEADERBOARD.get(this.env.LEADERBOARD.idFromName('country-global')).fetch(
      'https://leaderboard.internal' + path,
      { method: 'POST', body: JSON.stringify(body) },
    );
  }

  // Every question any player in the room has been asked under their nickname, on any device,
  // plus difficulty tiers measured from real answers.
  async nameHistory(token, data) {
    const room = await this.ctx.storage.get('room');
    if (!room) return { history: [], tiers: [] };
    try {
      const response = await this.leaderboard('/history/merge', {
        players: room.players.map((p) => ({
          name: p.name,
          questions: p.token === token ? browserHistory(data) : room.recentByPlayer?.[p.token],
        })),
      });
      const { histories, tiers } = await response.json();
      return {
        history: Array.isArray(histories) ? histories.flat() : [],
        tiers: Array.isArray(tiers) ? tiers : [],
      };
    } catch (e) {
      console.error('Could not load player history:', e);
      return { history: [], tiers: [] };
    }
  }

  progress(room) {
    const now = Date.now();
    if (
      room.phase === 'question' &&
      (now >= room.endsAt || room.players.every((p) => room.answers[p.token]))
    ) {
      this.reveal(room);
      return true;
    }
    if (room.phase === 'reveal' && now >= room.revealAt) {
      room.index++;
      if (room.index >= room.order.length) {
        room.phase = 'finished';
        room.endsAt = null;
      } else {
        room.phase = 'question';
        room.endsAt = Date.now() + DURATION_MS;
        room.answers = {};
        room.lastRound = null;
      }
      return true;
    }
    return false;
  }

  reveal(room) {
    const question = QUESTIONS[room.order[room.index]];
    const result = {};
    for (const p of room.players) {
      const answer = room.answers[p.token];
      const correct = Boolean(answer && answer.choice === question.a);
      const speed = correct
        ? Math.max(0, Math.round((60 * (room.endsAt - answer.at)) / DURATION_MS))
        : 0;
      const points = correct ? 100 + speed : 0;
      p.score += points;
      if (correct) p.correct++;
      result[p.token] = { choice: answer?.choice ?? null, correct, points };
    }
    room.lastRound = result;
    room.phase = 'reveal';
    room.revealAt = Date.now() + REVEAL_MS;
  }

  state(room, token) {
    const me = room.players.find((p) => p.token === token);
    if (!me) return fail('You are not in this room. Rejoin to play.', 403);
    const question = ['question', 'reveal'].includes(room.phase)
      ? QUESTIONS[room.order[room.index]]
      : null;
    return asJson({
      code: room.code,
      phase: room.phase,
      isHost: room.host === token,
      rounds: room.rounds,
      level: room.level || 'mixed',
      index: room.index,
      total: room.order?.length || room.rounds,
      endsAt: room.endsAt || null,
      revealAt: room.revealAt || null,
      players: room.players
        .map((p) => ({
          name: p.name,
          score: p.score,
          correct: p.correct,
          isYou: p.token === token,
          answered: Boolean(room.answers?.[p.token]),
          result:
            room.phase === 'reveal'
              ? room.lastRound?.[p.token] || { choice: null, correct: false, points: 0 }
              : null,
        }))
        .sort((a, b) => b.score - a.score),
      question: question
        ? {
            id: question.id,
            topic: question.topic,
            category: question.category,
            q: question.q,
            choices: question.choices,
          }
        : null,
      ownChoice: room.answers?.[token]?.choice ?? null,
      reveal:
        room.phase === 'reveal'
          ? {
              correctIndex: question.a,
              topic: question.topic,
              lyric: question.lyric,
              lyricSong: question.lyricSong,
              lyricArtist: question.lyricArtist,
              myResult: room.lastRound?.[token] || { choice: null, correct: false, points: 0 },
            }
          : null,
    });
  }

  async fetch(request) {
    const action = new URL(request.url).pathname.slice(1);
    let data;
    try {
      data = await request.json();
    } catch {
      return fail('Invalid request.');
    }
    const token = data?.token;
    if (!isToken(token)) return fail('Player session missing.', 401);
    // Fetched before the room is read: awaiting another object here would let other requests
    // change the room underneath us.
    const nameHistory =
      action === 'start' || action === 'rematch'
        ? await this.nameHistory(token, data)
        : { history: [], tiers: [] };
    let room = await this.ctx.storage.get('room');
    const now = Date.now();
    if (action === 'create') {
      if (room) return fail('Room already exists.', 409);
      const name = shortName(data.name);
      if (!name) return fail('Enter your name.');
      room = {
        code: data.code,
        host: token,
        createdAt: now,
        phase: 'lobby',
        index: 0,
        matchNumber: 0,
        rounds: data.rounds === 20 ? 20 : 10,
        level: cleanLevel(data.level),
        order: [],
        answers: {},
        players: [{ token, name, score: 0, correct: 0 }],
        recentByPlayer: { [token]: browserHistory(data) },
        playedQuestions: [],
      };
      await this.ctx.storage.put('room', room);
      return this.state(room, token);
    }
    if (!room || now - room.createdAt > 86400000)
      return fail('Room not found or expired. Create a new room.', 404);
    if (action === 'join') {
      let player = room.players.find((p) => p.token === token);
      if (!player && room.phase !== 'lobby')
        return fail('This game has already started. Ask your friend for a new room.', 409);
      if (!player) {
        if (room.players.length >= 8) return fail('This room is full (8 players max).', 409);
        const name = shortName(data.name);
        if (!name) return fail('Enter your name.');
        if (room.players.some((p) => p.name.toLowerCase() === name.toLowerCase()))
          return fail('That name is taken in this room.');
        room.players.push({ token, name, score: 0, correct: 0 });
        room.recentByPlayer ||= {};
        room.recentByPlayer[token] = browserHistory(data);
        await this.ctx.storage.put('room', room);
      }
      return this.state(room, token);
    }
    if (!room.players.some((p) => p.token === token))
      return fail('Rejoin with your name to enter this room.', 403);
    const phaseBefore = room.phase;
    let changed = this.progress(room);
    if (action === 'start' || action === 'rematch') {
      if (room.host !== token) return fail('Only the host can start the game.', 403);
      if (room.players.length < 2) return fail('Waiting for at least two players.');
      if (action === 'start' && room.phase !== 'lobby') return fail('Game is already underway.');
      if (action === 'rematch' && room.phase !== 'finished')
        return fail('Finish this game before a rematch.');
      room.recentByPlayer ||= {};
      room.recentByPlayer[token] = browserHistory(data);
      const allRecent = [
        ...nameHistory.history,
        ...Object.values(room.recentByPlayer).flat(),
        ...(room.playedQuestions || []),
      ];
      room.order = pickQuestions(room.rounds, allRecent, {
        level: room.level,
        tiers: new Map(nameHistory.tiers),
      });
      room.playedQuestions = [
        ...(room.playedQuestions || []),
        ...room.order.map((i) => QUESTIONS[i].id),
      ].slice(-HISTORY_LIMIT);
      room.index = 0;
      room.phase = 'question';
      room.answers = {};
      room.lastRound = null;
      room.endsAt = now + DURATION_MS;
      room.revealAt = null;
      room.players.forEach((p) => {
        p.score = 0;
        p.correct = 0;
      });
      changed = true;
    } else if (action === 'answer') {
      if (room.phase !== 'question') return fail('This question has closed.');
      if (!Number.isInteger(data.choice) || data.choice < 0 || data.choice > 3)
        return fail('Choose one of the four answers.');
      if (room.answers[token]) return fail('Your answer is already locked.');
      if (Date.now() >= room.endsAt) {
        this.reveal(room);
        changed = true;
      } else {
        room.answers[token] = { choice: data.choice, at: Date.now() };
        changed = true;
        this.progress(room);
      }
    } else if (action !== 'state') return fail('Unknown room action.', 404);
    if (changed) await this.ctx.storage.put('room', room);
    if (phaseBefore === 'question' && room.phase === 'reveal') {
      try {
        const question = QUESTIONS[room.order[room.index]];
        const askedAt = room.endsAt - DURATION_MS;
        await this.leaderboard('/round', {
          names: room.players.map((p) => p.name),
          questionId: question.id,
          answers: room.players.map((p) => {
            const a = room.answers[p.token];
            return a ? { choice: a.choice, ms: a.at - askedAt } : { choice: null };
          }),
        });
      } catch (e) {
        console.error('Could not record the revealed question:', e);
      }
    }
    // Results are reported from the authoritative multiplayer room, never from a browser-supplied score.
    if (room.phase === 'finished' && !room.reported) {
      try {
        const result = await this.leaderboard('/record', {
          matchId: `room-${room.code}-${room.createdAt}-${room.matchNumber || 1}`,
          rounds: room.rounds,
          level: room.level || 'mixed',
          mode: 'multiplayer',
          players: room.players.map((p) => ({
            name: p.name,
            score: p.score,
            correct: p.correct,
          })),
        });
        if (result.ok) {
          room.reported = true;
          await this.ctx.storage.put('room', room);
        }
      } catch (e) {
        console.error('Leaderboard submission will retry:', e);
      }
    }
    return this.state(room, token);
  }
}

// Shared, persistent country-trivia high scores. Names are display names, not authenticated accounts.
// Scores come from timed, server-validated solo sessions or authoritative GameRoom instances.
