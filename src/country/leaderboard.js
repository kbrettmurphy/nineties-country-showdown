import {
  DURATION_MS,
  QUESTIONS,
  questionById,
  asJson,
  fail,
  shortName,
  isToken,
  cleanHistory,
  pickQuestions,
} from './shared.js';

export class CountryLeaderboard {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS matches (
      match_id TEXT PRIMARY KEY, finished_at INTEGER NOT NULL
    )`);
    this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS scores (
      name_key TEXT NOT NULL, rounds INTEGER NOT NULL, display_name TEXT NOT NULL,
      best_score INTEGER NOT NULL, best_correct INTEGER NOT NULL, games INTEGER NOT NULL,
      first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL,
      PRIMARY KEY(name_key, rounds)
    )`);
    // Songs each nickname has already been asked, so repeats are avoided across devices and browsers.
    this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS seen (
      name_key TEXT NOT NULL, topic TEXT NOT NULL, seen_at INTEGER NOT NULL,
      PRIMARY KEY(name_key, topic)
    )`);
    this.renamePlayer('gay', 'Russ');
  }
  // One-off moderation rename; merges into an existing entry for the new name if there is one.
  renamePlayer(from, to) {
    const sql = this.ctx.storage.sql;
    const fromKey = from.toLocaleLowerCase('en-US');
    const toKey = to.toLocaleLowerCase('en-US');
    this.ctx.storage.transactionSync(() => {
      for (const old of [...sql.exec('SELECT * FROM scores WHERE name_key=?', fromKey)]) {
        sql.exec(
          `INSERT INTO scores (name_key,rounds,display_name,best_score,best_correct,games,first_seen,last_seen)
          VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(name_key,rounds) DO UPDATE SET
          best_correct=CASE WHEN excluded.best_score>scores.best_score THEN excluded.best_correct ELSE scores.best_correct END,
          best_score=MAX(scores.best_score,excluded.best_score), games=scores.games+excluded.games,
          first_seen=MIN(scores.first_seen,excluded.first_seen), last_seen=MAX(scores.last_seen,excluded.last_seen)`,
          toKey,
          old.rounds,
          to,
          old.best_score,
          old.best_correct,
          old.games,
          old.first_seen,
          old.last_seen,
        );
        sql.exec('DELETE FROM scores WHERE name_key=? AND rounds=?', fromKey, old.rounds);
      }
    });
  }
  // Adds a browser's local history (older than anything recorded here) and returns the
  // nickname's full history, oldest first.
  mergeHistory(name, topics) {
    const display = shortName(name);
    if (!display) return cleanHistory(topics);
    const key = display.toLocaleLowerCase('en-US');
    const sql = this.ctx.storage.sql;
    const local = cleanHistory(topics);
    this.ctx.storage.transactionSync(() => {
      local.forEach((topic, i) =>
        sql.exec(
          'INSERT OR IGNORE INTO seen (name_key,topic,seen_at) VALUES (?,?,?)',
          key,
          topic,
          i,
        ),
      );
    });
    return [...sql.exec('SELECT topic FROM seen WHERE name_key=? ORDER BY seen_at ASC', key)].map(
      (r) => r.topic,
    );
  }
  markSeen(names, topic) {
    if (!Array.isArray(names) || !cleanHistory([topic]).length) return;
    const sql = this.ctx.storage.sql;
    const now = Date.now();
    for (const name of names.slice(0, 8)) {
      const display = shortName(name);
      if (!display) continue;
      sql.exec(
        `INSERT INTO seen (name_key,topic,seen_at) VALUES (?,?,?)
        ON CONFLICT(name_key,topic) DO UPDATE SET seen_at=excluded.seen_at`,
        display.toLocaleLowerCase('en-US'),
        topic,
        now,
      );
    }
  }
  recordMatch(match) {
    const { matchId, rounds, players } = match;
    if (
      typeof matchId !== 'string' ||
      matchId.length > 120 ||
      ![10, 20].includes(rounds) ||
      !Array.isArray(players) ||
      players.length < 1 ||
      players.length > 8
    )
      return false;
    const valid = players.every(
      (p) =>
        shortName(p.name) &&
        Number.isInteger(p.score) &&
        p.score >= 0 &&
        p.score <= rounds * 160 &&
        Number.isInteger(p.correct) &&
        p.correct >= 0 &&
        p.correct <= rounds,
    );
    if (!valid) return false;
    const sql = this.ctx.storage.sql;
    const timestamp = Date.now();
    this.ctx.storage.transactionSync(() => {
      if ([...sql.exec('SELECT match_id FROM matches WHERE match_id=?', matchId)].length) return;
      sql.exec('INSERT INTO matches (match_id,finished_at) VALUES (?,?)', matchId, timestamp);
      for (const player of players) {
        const display = shortName(player.name);
        const key = display.toLocaleLowerCase('en-US');
        const current = [
          ...sql.exec(
            'SELECT best_score,best_correct FROM scores WHERE name_key=? AND rounds=?',
            key,
            rounds,
          ),
        ][0];
        const better = !current || player.score > current.best_score;
        sql.exec(
          `INSERT INTO scores (name_key,rounds,display_name,best_score,best_correct,games,first_seen,last_seen)
          VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(name_key,rounds) DO UPDATE SET
          display_name=excluded.display_name, best_score=excluded.best_score,
          best_correct=excluded.best_correct, games=scores.games+1, last_seen=excluded.last_seen`,
          key,
          rounds,
          display,
          better ? player.score : current.best_score,
          better ? player.correct : current.best_correct,
          1,
          timestamp,
          timestamp,
        );
      }
    });
    return true;
  }
  async fetch(request) {
    const url = new URL(request.url);
    const action = url.pathname;
    if (action === '/list') {
      const rounds = url.searchParams.get('rounds') === '20' ? 20 : 10;
      const rows = [
        ...this.ctx.storage.sql.exec(
          'SELECT display_name,best_score,best_correct,games,last_seen FROM scores WHERE rounds=? ORDER BY best_score DESC,best_correct DESC,last_seen ASC LIMIT 100',
          rounds,
        ),
      ];
      const stats = [
        ...this.ctx.storage.sql.exec(
          'SELECT COUNT(*) AS players,COALESCE(SUM(games),0) AS games FROM scores WHERE rounds=?',
          rounds,
        ),
      ][0];
      return asJson({ rounds, rows, stats });
    }
    if (request.method !== 'POST') return fail('Use POST', 405);
    let d;
    try {
      d = await request.json();
    } catch {
      return fail('Invalid request.');
    }
    if (action === '/record')
      return this.recordMatch(d) ? asJson({ ok: true }) : fail('Invalid result');
    if (action === '/history/merge') {
      const players = Array.isArray(d.players) ? d.players.slice(0, 8) : [];
      return asJson({ histories: players.map((p) => this.mergeHistory(p?.name, p?.topics)) });
    }
    if (action === '/history/seen') {
      this.markSeen(d.names, d.topic);
      return asJson({ ok: true });
    }
    if (!action.startsWith('/solo/')) return fail('Unknown action', 404);
    if (!isToken(d.token)) return fail('Player session missing', 401);
    if (action === '/solo/start') {
      const nick = shortName(d.name);
      // Current clients let the server pick from the nickname's history; older cached clients send ids.
      const ids = Array.isArray(d.questionIds)
        ? d.questionIds
        : [10, 20].includes(d.rounds)
          ? pickQuestions(d.rounds, this.mergeHistory(nick, d.recentTopics)).map(
              (i) => QUESTIONS[i].id,
            )
          : null;
      if (
        !nick ||
        !Array.isArray(ids) ||
        ![10, 20].includes(ids.length) ||
        !ids.every(Number.isInteger)
      )
        return fail('Invalid solo game');
      if (
        new Set(ids).size !== ids.length ||
        new Set(ids.map((id) => questionById.get(id)?.topic)).size !== ids.length ||
        ids.some((id) => !questionById.has(id))
      )
        return fail('Invalid question selection');
      const id = crypto.randomUUID();
      const now = Date.now();
      const session = {
        id,
        token: d.token,
        name: nick,
        ids,
        index: 0,
        score: 0,
        correct: 0,
        endsAt: now + DURATION_MS,
        createdAt: now,
        answered: false,
        lastResult: null,
      };
      await this.ctx.storage.put('solo:' + id, session);
      return asJson({ sessionId: id, endsAt: session.endsAt, questionIds: ids });
    }
    if (typeof d.sessionId !== 'string' || !/^[-0-9a-f]{36}$/.test(d.sessionId))
      return fail('Invalid solo session');
    const key = 'solo:' + d.sessionId;
    const session = await this.ctx.storage.get(key);
    if (!session || session.token !== d.token || Date.now() - session.createdAt > 90 * 60000)
      return fail('Solo session expired', 404);
    if (action === '/solo/answer') {
      if (session.answered) return asJson(session.lastResult);
      const question = questionById.get(session.ids[session.index]);
      if (
        !question ||
        d.questionId !== question.id ||
        !(d.choice === null || (Number.isInteger(d.choice) && d.choice >= 0 && d.choice <= 3))
      )
        return fail('Unexpected question');
      const now = Date.now();
      const correct = d.choice === question.a && now <= session.endsAt + 1200;
      const points = correct
        ? 100 + Math.max(0, Math.round((60 * (session.endsAt - now)) / DURATION_MS))
        : 0;
      session.score += points;
      if (correct) session.correct++;
      session.answered = true;
      this.markSeen([session.name], question.topic);
      session.lastResult = {
        points,
        score: session.score,
        correct: session.correct,
        finished: session.index === session.ids.length - 1,
      };
      await this.ctx.storage.put(key, session);
      if (session.lastResult.finished) {
        this.recordMatch({
          matchId: 'solo-' + session.id,
          rounds: session.ids.length,
          mode: 'solo',
          players: [{ name: session.name, score: session.score, correct: session.correct }],
        });
      }
      return asJson(session.lastResult);
    }
    if (action === '/solo/next') {
      if (!session.answered || session.index >= session.ids.length - 1)
        return fail('Answer this round first.');
      session.index++;
      session.answered = false;
      session.lastResult = null;
      session.endsAt = Date.now() + DURATION_MS;
      await this.ctx.storage.put(key, session);
      return asJson({ endsAt: session.endsAt });
    }
    return fail('Unknown action', 404);
  }
}
