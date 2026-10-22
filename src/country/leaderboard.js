import {
  DURATION_MS,
  QUESTIONS,
  questionById,
  asJson,
  fail,
  shortName,
  isToken,
  cleanLevel,
  measuredTiers,
  cleanHistory,
  fromLegacyTopics,
  pickQuestions,
} from './shared.js';

const REPORT_REASONS = ['lyric', 'title', 'artist', 'answer', 'year', 'other'];

export class CountryLeaderboard {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS matches (
      match_id TEXT PRIMARY KEY, finished_at INTEGER NOT NULL
    )`);
    // Best score per nickname, difficulty level and game length.
    this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS scores (
      name_key TEXT NOT NULL, level TEXT NOT NULL DEFAULT 'mixed', rounds INTEGER NOT NULL,
      display_name TEXT NOT NULL, best_score INTEGER NOT NULL, best_correct INTEGER NOT NULL,
      games INTEGER NOT NULL, first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL,
      PRIMARY KEY(name_key, level, rounds)
    )`);
    // Questions each nickname has already been asked, so repeats are avoided across devices.
    this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS seen_questions (
      name_key TEXT NOT NULL, question_id INTEGER NOT NULL, seen_at INTEGER NOT NULL,
      PRIMARY KEY(name_key, question_id)
    )`);
    this.migrate();
    // Players' reports of wrong lyrics, titles, artists or answers, reviewed on the reports page.
    this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT, question_id INTEGER NOT NULL, reason TEXT NOT NULL,
      note TEXT NOT NULL, name TEXT NOT NULL, token TEXT NOT NULL, created_at INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'open', UNIQUE(token, question_id)
    )`);
    // Songs the owner heard and wants added, sent from the song check page (public/country/songs/).
    this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS song_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, artist TEXT NOT NULL,
      title_key TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'open'
    )`);
    // How each question plays in real games: times asked, answered, right, time taken, and
    // which choices people pick. Totals only, no player names. Picks are keyed by choice text so
    // they stay correct even if a rebuild reorders a question's choices.
    this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS question_stats (
      question_id INTEGER PRIMARY KEY, shown INTEGER NOT NULL DEFAULT 0,
      answered INTEGER NOT NULL DEFAULT 0, correct INTEGER NOT NULL DEFAULT 0,
      total_ms INTEGER NOT NULL DEFAULT 0
    )`);
    this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS question_picks (
      question_id INTEGER NOT NULL, choice TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY(question_id, choice)
    )`);
    this.renamePlayer('gay', 'Russ');
  }
  // One-time upgrades of data saved by earlier versions. Each checks whether it already ran.
  migrate() {
    const sql = this.ctx.storage.sql;
    const tables = new Set(
      [...sql.exec("SELECT name FROM sqlite_master WHERE type='table'")].map((r) => r.name),
    );
    this.ctx.storage.transactionSync(() => {
      // Scores from before difficulty levels were all full-range games: they become Mixed.
      const columns = [...sql.exec('PRAGMA table_info(scores)')].map((c) => c.name);
      if (!columns.includes('level')) {
        sql.exec(`CREATE TABLE scores_new (
          name_key TEXT NOT NULL, level TEXT NOT NULL DEFAULT 'mixed', rounds INTEGER NOT NULL,
          display_name TEXT NOT NULL, best_score INTEGER NOT NULL, best_correct INTEGER NOT NULL,
          games INTEGER NOT NULL, first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL,
          PRIMARY KEY(name_key, level, rounds)
        )`);
        sql.exec(`INSERT INTO scores_new (name_key,level,rounds,display_name,best_score,best_correct,games,first_seen,last_seen)
          SELECT name_key,'mixed',rounds,display_name,best_score,best_correct,games,first_seen,last_seen FROM scores`);
        sql.exec('DROP TABLE scores');
        sql.exec('ALTER TABLE scores_new RENAME TO scores');
      }
      // Song history becomes question history; the old table is emptied once copied.
      if (tables.has('seen')) {
        for (const row of [...sql.exec('SELECT name_key,topic,seen_at FROM seen')])
          for (const id of fromLegacyTopics([row.topic]))
            sql.exec(
              'INSERT OR IGNORE INTO seen_questions (name_key,question_id,seen_at) VALUES (?,?,?)',
              row.name_key,
              id,
              row.seen_at,
            );
        sql.exec('DROP TABLE seen');
      }
    });
  }
  // Difficulty tiers measured from real answers, as [questionId, tier] pairs.
  tiers() {
    return [
      ...measuredTiers([
        ...this.ctx.storage.sql.exec('SELECT question_id,answered,correct FROM question_stats'),
      ]),
    ];
  }
  // One-off moderation rename; merges into an existing entry for the new name if there is one.
  renamePlayer(from, to) {
    const sql = this.ctx.storage.sql;
    const fromKey = from.toLocaleLowerCase('en-US');
    const toKey = to.toLocaleLowerCase('en-US');
    this.ctx.storage.transactionSync(() => {
      for (const old of [...sql.exec('SELECT * FROM scores WHERE name_key=?', fromKey)]) {
        sql.exec(
          `INSERT INTO scores (name_key,level,rounds,display_name,best_score,best_correct,games,first_seen,last_seen)
          VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(name_key,level,rounds) DO UPDATE SET
          best_correct=CASE WHEN excluded.best_score>scores.best_score THEN excluded.best_correct ELSE scores.best_correct END,
          best_score=MAX(scores.best_score,excluded.best_score), games=scores.games+excluded.games,
          first_seen=MIN(scores.first_seen,excluded.first_seen), last_seen=MAX(scores.last_seen,excluded.last_seen)`,
          toKey,
          old.level,
          old.rounds,
          to,
          old.best_score,
          old.best_correct,
          old.games,
          old.first_seen,
          old.last_seen,
        );
        sql.exec(
          'DELETE FROM scores WHERE name_key=? AND level=? AND rounds=?',
          fromKey,
          old.level,
          old.rounds,
        );
      }
    });
  }
  // Adds a browser's local history of question ids (older than anything recorded here) and
  // returns the nickname's full history, oldest first.
  mergeHistory(name, questions) {
    const local = cleanHistory(questions);
    const display = shortName(name);
    if (!display) return local;
    const key = display.toLocaleLowerCase('en-US');
    const sql = this.ctx.storage.sql;
    this.ctx.storage.transactionSync(() => {
      local.forEach((id, i) =>
        sql.exec(
          'INSERT OR IGNORE INTO seen_questions (name_key,question_id,seen_at) VALUES (?,?,?)',
          key,
          id,
          i,
        ),
      );
    });
    return cleanHistory(
      [
        ...sql.exec(
          'SELECT question_id FROM seen_questions WHERE name_key=? ORDER BY seen_at ASC',
          key,
        ),
      ].map((r) => r.question_id),
    );
  }
  markSeen(names, questionId) {
    if (!Array.isArray(names) || !cleanHistory([questionId]).length) return;
    const sql = this.ctx.storage.sql;
    const now = Date.now();
    for (const name of names.slice(0, 8)) {
      const display = shortName(name);
      if (!display) continue;
      sql.exec(
        `INSERT INTO seen_questions (name_key,question_id,seen_at) VALUES (?,?,?)
        ON CONFLICT(name_key,question_id) DO UPDATE SET seen_at=excluded.seen_at`,
        display.toLocaleLowerCase('en-US'),
        questionId,
        now,
      );
    }
  }
  report(d) {
    const question = questionById.get(d.questionId);
    if (!question) return fail('Unknown question.');
    if (!REPORT_REASONS.includes(d.reason)) return fail('Pick what’s wrong.');
    const note = typeof d.note === 'string' ? d.note.trim().slice(0, 500) : '';
    const sql = this.ctx.storage.sql;
    const now = Date.now();
    const recent = [
      ...sql.exec(
        'SELECT COUNT(*) AS n FROM reports WHERE token=? AND created_at>?',
        d.token,
        now - 86400000,
      ),
    ][0].n;
    if (recent >= 40) return fail('Thanks — that’s plenty of reports for today.', 429);
    // One report per player per question; sending again updates it and reopens it.
    sql.exec(
      `INSERT INTO reports (question_id,reason,note,name,token,created_at) VALUES (?,?,?,?,?,?)
      ON CONFLICT(token,question_id) DO UPDATE SET reason=excluded.reason, note=excluded.note,
      name=excluded.name, created_at=excluded.created_at, status='open'`,
      question.id,
      d.reason,
      note,
      shortName(d.name) || 'Anonymous',
      d.token,
      now,
    );
    return asJson({ ok: true });
  }
  // answers: one { choice: 0-3 | null (no answer), ms: time taken } per player who saw it.
  recordAnswers(questionId, answers) {
    const question = questionById.get(questionId);
    if (!question || !Array.isArray(answers)) return;
    const sql = this.ctx.storage.sql;
    this.ctx.storage.transactionSync(() => {
      for (const a of answers.slice(0, 8)) {
        const picked = Number.isInteger(a?.choice) && a.choice >= 0 && a.choice <= 3;
        const ms = picked ? Math.max(0, Math.min(DURATION_MS, Math.round(Number(a.ms) || 0))) : 0;
        sql.exec(
          `INSERT INTO question_stats (question_id,shown,answered,correct,total_ms) VALUES (?,1,?,?,?)
          ON CONFLICT(question_id) DO UPDATE SET shown=shown+1, answered=answered+excluded.answered,
          correct=correct+excluded.correct, total_ms=total_ms+excluded.total_ms`,
          question.id,
          picked ? 1 : 0,
          picked && a.choice === question.a ? 1 : 0,
          ms,
        );
        if (picked)
          sql.exec(
            `INSERT INTO question_picks (question_id,choice,n) VALUES (?,?,1)
            ON CONFLICT(question_id,choice) DO UPDATE SET n=n+1`,
            question.id,
            question.choices[a.choice],
          );
      }
    });
  }
  listStats() {
    const sql = this.ctx.storage.sql;
    const picks = new Map();
    for (const p of sql.exec('SELECT question_id,choice,n FROM question_picks')) {
      if (!picks.has(p.question_id)) picks.set(p.question_id, {});
      picks.get(p.question_id)[p.choice] = p.n;
    }
    return [...sql.exec('SELECT * FROM question_stats ORDER BY shown DESC')].map((r) => {
      const q = questionById.get(r.question_id);
      return {
        question_id: r.question_id,
        shown: r.shown,
        answered: r.answered,
        correct: r.correct,
        avg_ms: r.answered ? Math.round(r.total_ms / r.answered) : null,
        picks: picks.get(r.question_id) || {},
        category: q?.category,
        question: q?.q,
        answer: q?.choices[q.a],
        song: q?.lyricSong,
        artist: q?.lyricArtist,
      };
    });
  }
  requestSong(d) {
    const title = typeof d.title === 'string' ? d.title.trim().slice(0, 120) : '';
    const artist = typeof d.artist === 'string' ? d.artist.trim().slice(0, 120) : '';
    const key = title.toLocaleLowerCase('en-US').replace(/\s+/g, ' ');
    if (!key) return fail('Enter a song title.');
    // Asking again for the same title updates the artist and reopens it.
    this.ctx.storage.sql.exec(
      `INSERT INTO song_requests (title,artist,title_key,created_at) VALUES (?,?,?,?)
      ON CONFLICT(title_key) DO UPDATE SET title=excluded.title,
      artist=CASE WHEN excluded.artist='' THEN artist ELSE excluded.artist END,
      created_at=excluded.created_at, status='open'`,
      title,
      artist,
      key,
      Date.now(),
    );
    return asJson({ ok: true });
  }
  listSongRequests(status) {
    return [
      ...this.ctx.storage.sql.exec(
        `SELECT id,title,artist,created_at,status FROM song_requests
        WHERE status=? ORDER BY created_at DESC LIMIT 500`,
        ['added', 'skipped'].includes(status) ? status : 'open',
      ),
    ];
  }
  listReports(status) {
    const rows = [
      ...this.ctx.storage.sql.exec(
        `SELECT id,question_id,reason,note,name,created_at,status FROM reports
        WHERE status=? ORDER BY created_at DESC LIMIT 500`,
        status === 'fixed' ? 'fixed' : 'open',
      ),
    ];
    return rows.map((r) => {
      const q = questionById.get(r.question_id);
      return {
        ...r,
        category: q?.category,
        question: q?.q,
        answer: q?.choices[q.a],
        lyric: q?.lyric,
        song: q?.lyricSong,
        artist: q?.lyricArtist,
      };
    });
  }
  recordMatch(match) {
    const { matchId, rounds, players } = match;
    const level = cleanLevel(match.level);
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
            'SELECT best_score,best_correct FROM scores WHERE name_key=? AND level=? AND rounds=?',
            key,
            level,
            rounds,
          ),
        ][0];
        const better = !current || player.score > current.best_score;
        sql.exec(
          `INSERT INTO scores (name_key,level,rounds,display_name,best_score,best_correct,games,first_seen,last_seen)
          VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(name_key,level,rounds) DO UPDATE SET
          display_name=excluded.display_name, best_score=excluded.best_score,
          best_correct=excluded.best_correct, games=scores.games+1, last_seen=excluded.last_seen`,
          key,
          level,
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
      const level = cleanLevel(url.searchParams.get('level'));
      const rows = [
        ...this.ctx.storage.sql.exec(
          'SELECT display_name,best_score,best_correct,games,last_seen FROM scores WHERE level=? AND rounds=? ORDER BY best_score DESC,best_correct DESC,last_seen ASC LIMIT 100',
          level,
          rounds,
        ),
      ];
      const stats = [
        ...this.ctx.storage.sql.exec(
          'SELECT COUNT(*) AS players,COALESCE(SUM(games),0) AS games FROM scores WHERE level=? AND rounds=?',
          level,
          rounds,
        ),
      ][0];
      return asJson({ level, rounds, rows, stats });
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
      return asJson({
        histories: players.map((p) => this.mergeHistory(p?.name, p?.questions)),
        tiers: this.tiers(),
      });
    }
    if (action === '/report') {
      if (!isToken(d.token)) return fail('Player session missing', 401);
      return this.report(d);
    }
    if (action === '/reports/list') return asJson({ reports: this.listReports(d.status) });
    if (action === '/reports/resolve') {
      if (!Number.isInteger(d.id)) return fail('Missing report id.');
      this.ctx.storage.sql.exec(
        'UPDATE reports SET status=? WHERE id=?',
        d.status === 'open' ? 'open' : 'fixed',
        d.id,
      );
      return asJson({ ok: true });
    }
    if (action === '/reports/stats') return asJson({ stats: this.listStats() });
    if (action === '/reports/song-request') return this.requestSong(d);
    if (action === '/reports/song-requests')
      return asJson({ requests: this.listSongRequests(d.status) });
    if (action === '/reports/song-request-status') {
      if (!Number.isInteger(d.id)) return fail('Missing request id.');
      this.ctx.storage.sql.exec(
        'UPDATE song_requests SET status=? WHERE id=?',
        ['added', 'skipped'].includes(d.status) ? d.status : 'open',
        d.id,
      );
      return asJson({ ok: true });
    }
    // Called by a GameRoom when a multiplayer question is revealed.
    if (action === '/round') {
      this.markSeen(d.names, d.questionId);
      this.recordAnswers(d.questionId, d.answers);
      return asJson({ ok: true });
    }
    if (action === '/history/seen') {
      this.markSeen(d.names, d.questionId);
      return asJson({ ok: true });
    }
    if (!action.startsWith('/solo/')) return fail('Unknown action', 404);
    if (!isToken(d.token)) return fail('Player session missing', 401);
    if (action === '/solo/start') {
      const nick = shortName(d.name);
      // The server picks from the nickname's history. Older cached clients send their own picks,
      // or a song history instead of question ids.
      const level = cleanLevel(d.level);
      const local = Array.isArray(d.recentQuestions)
        ? d.recentQuestions
        : fromLegacyTopics(d.recentTopics);
      const ids = Array.isArray(d.questionIds)
        ? d.questionIds
        : [10, 20].includes(d.rounds)
          ? pickQuestions(d.rounds, this.mergeHistory(nick, local), {
              level,
              tiers: new Map(this.tiers()),
            }).map((i) => QUESTIONS[i].id)
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
        level,
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
      this.markSeen([session.name], question.id);
      // A late answer scored as a miss counts as no answer.
      const onTime = d.choice !== null && now <= session.endsAt + 1200;
      this.recordAnswers(question.id, [
        { choice: onTime ? d.choice : null, ms: DURATION_MS - (session.endsAt - now) },
      ]);
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
          level: session.level,
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
