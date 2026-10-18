(() => {
  'use strict';
  const $ = (selector) => document.querySelector(selector);
  const app = $('#app');
  const letters = 'ABCD';
  const escapeHtml = (s) =>
    String(s ?? '').replace(
      /[&<>"']/g,
      (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch],
    );
  const qs = window.QBANK || [];
  const picker = window.HonkyPicker.create(qs);
  const LEVEL_LABELS = { beginner: 'Beginner', mixed: 'Mixed', expert: 'Expert' };
  let level = picker.cleanLevel(localStorage.getItem('country-showdown-level'));
  const soloOnly = Boolean(window.ONLY_SOLO);
  const qparams = new URLSearchParams(location.search);
  const inviteCode = (qparams.get('room') || '')
    .toUpperCase()
    .replace(/[^A-Z2-9]/g, '')
    .slice(0, 6);
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
  let refreshing = null;
  let reportTarget = null;
  let leaderboard = null;
  // Party mode: one phone passed around the table. Runs entirely on this device and never
  // touches the leaderboard, but still marks songs as played so they don't repeat here.
  let party = null;
  const partyDraft = (() => {
    try {
      const saved = JSON.parse(localStorage.getItem('country-showdown-party') || 'null');
      if (saved && Array.isArray(saved.names)) return saved;
    } catch {}
    return { names: [name, ''], style: 'buzz', choices: 'hidden', turns: 3, level: 'mixed' };
  })();
  // Lobby arrivals: when each player was first seen, so a new chip can pop for a few seconds.
  const arrivals = new Map();
  function justJoined(roomCode, p) {
    const key = roomCode + ':' + p.name;
    const firstLoad = ![...arrivals.keys()].some((k) => k.startsWith(roomCode + ':'));
    if (!arrivals.has(key)) {
      arrivals.set(key, firstLoad || p.isYou ? 0 : Date.now());
      // Redraw once the highlight expires; the lobby only re-renders when the room changes.
      if (arrivals.get(key)) setTimeout(() => view === 'room' && render(), 4100);
    }
    return Date.now() - arrivals.get(key) < 4000;
  }
  let boardRounds = 10;
  let boardLevel = level;
  let boardLoading = false;
  const countryPrefix =
    location.pathname === '/country' || location.pathname.startsWith('/country/') ? '/country' : '';
  // Questions played on this device, oldest first. Older versions kept songs instead; those
  // carry over once.
  const HISTORY_KEY = 'honky-tonk-played-questions-v1';
  const LEGACY_HISTORY_KEY = 'honky-tonk-played-topics-v3';
  function readHistory() {
    try {
      const saved = localStorage.getItem(HISTORY_KEY);
      if (saved) return picker.cleanHistory(JSON.parse(saved));
      const legacy = picker.fromLegacyTopics(
        JSON.parse(localStorage.getItem(LEGACY_HISTORY_KEY) || '[]'),
      );
      localStorage.setItem(HISTORY_KEY, JSON.stringify(legacy));
      return legacy;
    } catch {
      return [];
    }
  }
  function rememberQuestion(id) {
    const previous = readHistory().filter((x) => x !== id);
    previous.push(id);
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(picker.cleanHistory(previous)));
    } catch {}
  }
  const token = (() => {
    let t = localStorage.getItem('country-showdown-player-token');
    if (!t) {
      const bytes = new Uint8Array(24);
      crypto.getRandomValues(bytes);
      t = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
      localStorage.setItem('country-showdown-player-token', t);
    }
    return t;
  })();
  const logo = () =>
    `<header class="masthead"><div class="kicker">All country. All nineties. No mercy.</div><h1 class="brand">HONKY TONK<br><span>SHOWDOWN</span></h1><div class="sub">The 90s Country Trivia Challenge</div><div class="stars">★★★★★</div></header>`;
  const notice = () => (error ? `<div role="alert" class="notice">${escapeHtml(error)}</div>` : '');
  const back = () => `<button class="back" data-action="menu">← Back to the jukebox</button>`;
  const button = (label, action, variant = '', more = '') =>
    `<button class="button ${variant}" data-action="${action}" ${more}>${label}</button>`;
  const shuffle = (arr) => {
    const copy = [...arr];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  };
  // Offline and party games pick on this device, the same way the server does.
  const makeOrder = (n, gameLevel = level) =>
    picker.pickQuestions(n, readHistory(), { level: gameLevel });
  const saveName = () => {
    const inp = $('#player-name');
    if (inp) {
      name = inp.value.trim().replace(/\s+/g, ' ').slice(0, 24);
      localStorage.setItem('country-showdown-name', name);
    }
    return name;
  };
  const pickRounds = () => {
    rounds = Number($('#rounds')?.value) === 20 ? 20 : 10;
  };
  async function startSolo() {
    let order = null,
      sessionId = null,
      endsAt = Date.now() + 30000;
    if (!soloOnly) {
      try {
        // The server picks from everything this nickname has played, on any device.
        const response = await api('/api/solo/start', {
          name,
          rounds,
          level,
          recentQuestions: readHistory(),
        });
        const indexById = new Map(qs.map((q, i) => [q.id, i]));
        order = response.questionIds.map((id) => indexById.get(id));
        sessionId = response.sessionId;
        endsAt = response.endsAt;
      } catch (e) {
        order = null;
        error = 'Leaderboard connection unavailable; playing unranked. ' + e.message;
      }
    }
    if (!order || order.some((i) => i === undefined)) {
      order = makeOrder(rounds);
      sessionId = null;
    }
    solo = {
      order,
      index: 0,
      score: 0,
      correct: 0,
      phase: 'question',
      choice: null,
      earned: 0,
      endsAt,
      sessionId,
      level,
      submitting: false,
      rankingError: '',
    };
    view = 'solo';
    render();
  }
  async function revealSolo(choice) {
    if (view !== 'solo' || !solo || solo.phase !== 'question') return;
    const question = qs[solo.order[solo.index]];
    solo.choice = choice;
    if (choice === question.a) {
      solo.earned = 100 + Math.max(0, Math.round((60 * (solo.endsAt - Date.now())) / 30000));
      solo.score += solo.earned;
      solo.correct++;
    } else solo.earned = 0;
    rememberQuestion(question.id);
    solo.phase = 'reveal';
    if (solo.sessionId) {
      solo.submitting = true;
      render();
      try {
        const result = await api('/api/solo/answer', {
          sessionId: solo.sessionId,
          questionId: question.id,
          choice,
        });
        solo.score = result.score;
        solo.correct = result.correct;
        solo.earned = result.points;
      } catch (e) {
        solo.sessionId = null;
        solo.rankingError = 'Could not save ranked result; this round is unranked.';
      }
      solo.submitting = false;
    }
    render();
  }
  async function nextSolo() {
    if (!solo || solo.phase !== 'reveal') return;
    if (solo.submitting) return;
    if (solo.index + 1 >= solo.order.length) {
      view = 'soloDone';
      render();
      return;
    }
    if (solo.sessionId) {
      try {
        const next = await api('/api/solo/next', { sessionId: solo.sessionId });
        solo.endsAt = next.endsAt;
      } catch (e) {
        solo.sessionId = null;
        solo.rankingError = 'Connection interrupted; remaining questions will be unranked.';
        solo.endsAt = Date.now() + 30000;
      }
    } else solo.endsAt = Date.now() + 30000;
    solo.index++;
    solo.phase = 'question';
    solo.choice = null;
    solo.earned = 0;
    render();
  }
  async function api(path, payload) {
    const rsp = await fetch(countryPrefix + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...payload, token }),
    });
    const data = await rsp.json().catch(() => ({ error: 'Could not read the server response.' }));
    if (!rsp.ok) throw new Error(data.error || 'Something went wrong.');
    return data;
  }
  async function loadLeaderboard(length = boardRounds, lvl = boardLevel) {
    boardRounds = length;
    boardLevel = lvl;
    view = 'leaderboard';
    leaderboard = null;
    boardLoading = true;
    error = '';
    render();
    try {
      const res = await fetch(
        countryPrefix + '/api/leaderboard?rounds=' + length + '&level=' + lvl,
        {
          cache: 'no-store',
        },
      );
      const data = await res.json();
      if (!res.ok) throw Error(data.error || 'Leaderboard unavailable');
      if (view === 'leaderboard' && boardRounds === length && boardLevel === lvl)
        leaderboard = data;
    } catch (e) {
      error = e.message || 'Could not load standings.';
    } finally {
      boardLoading = false;
      if (view === 'leaderboard') render();
    }
  }
  async function runAction(action, payload = {}) {
    // A background poll may be mid-flight; wait for it rather than dropping the tap.
    while (refreshing) await refreshing;
    if (requestInFlight) return;
    requestInFlight = true;
    error = '';
    const buttons = app.querySelectorAll('[data-action="' + action + '"]');
    buttons.forEach((el) => (el.disabled = true));
    try {
      const result = await api(
        action === 'create' ? '/api/create' : '/api/room/' + code + '/' + action,
        ['create', 'join', 'rematch'].includes(action)
          ? { ...payload, recentQuestions: readHistory() }
          : payload,
      );
      serverState = result;
      code = result.code;
      view = 'room';
      if (result.reveal && result.question) rememberQuestion(result.question.id);
      previousState = JSON.stringify(result);
      history.replaceState(null, '', location.pathname + '?room=' + code);
      render();
    } catch (e) {
      error = e.message || 'Could not connect. Check that the Cloudflare game is deployed.';
      render();
    } finally {
      requestInFlight = false;
    }
  }
  function refresh() {
    if (view !== 'room' || !code || requestInFlight) return;
    requestInFlight = true;
    refreshing = poll();
    return refreshing;
  }
  async function poll() {
    try {
      const result = await api('/api/room/' + code + '/state', {});
      const str = JSON.stringify(result);
      if (str !== previousState) {
        serverState = result;
        previousState = str;
        if (result.reveal && result.question) rememberQuestion(result.question.id);
        render();
      }
    } catch (e) {
      error = e.message || 'Connection interrupted.';
      if (view === 'room') showSoftError(error);
    } finally {
      requestInFlight = false;
      refreshing = null;
    }
  }
  function showSoftError(s) {
    const el = $('#soft-error');
    if (el) el.textContent = s;
  }
  function scoreboard(players, q) {
    return `<div class="scoreboard">${players
      .map((p) => {
        const r = q && p.result;
        const pick = r
          ? `<span class="pick">${r.correct ? '✓' : '✕'} ${escapeHtml(r.choice === null ? 'No answer' : q.choices[r.choice])}</span>`
          : '';
        return `<div class="score ${p.isYou ? 'you' : ''} ${r ? (r.correct ? 'right' : 'wrong') : ''}"><div class="name"><span>${escapeHtml(p.name)}${p.isYou ? ' (you)' : ''}</span><span>${p.answered && !r ? '✓' : ''}</span></div><b>${p.score}</b><small>${p.correct} right</small>${pick}</div>`;
      })
      .join('')}</div>`;
  }
  function choiceButtons(q, chosen, locked, answer) {
    return `<div class="options">${q.choices
      .map((opt, i) => {
        let status = '';
        if (answer !== null && answer !== undefined)
          status = i === answer ? 'good' : i === chosen ? 'bad' : '';
        else if (i === chosen) status = 'selected';
        return `<button class="option ${status}" data-action="choose" data-choice="${i}" ${locked ? 'disabled' : ''}>
      <span class="letter">${letters[i]}</span><span>${escapeHtml(opt)}</span></button>`;
      })
      .join('')}</div>`;
  }
  function clockBlock(category, number, total) {
    return `<div class="topline"><span class="count">QUESTION ${number} / ${total}</span><span class="timer" id="clock">30s</span></div><div class="track"><div id="time-fill" style="width:100%"></div></div><div class="tag">${escapeHtml(category)}</div>`;
  }
  const gameShelf = () =>
    countryPrefix
      ? '<p class="shelf-link"><a href="https://games.murphsmitts.com/">← Back to Murph’s Games</a></p>'
      : '';
  function drawMenu() {
    return `${logo()}<section class="panel"><div class="eyebrow">Pull up a stool</div><h2 class="section-title">You reckon you know 90s country?</h2><p class="section-sub">${qs.length} questions. Ten-foot hearts, deep cuts, album facts, and songs you can sing in your sleep. Thirty seconds per question. Answer quicker for more points.</p>
  <div class="actions">
  <button class="action" data-action="open-solo"><span><b>Solo soundcheck</b><small>Warm up and see your score</small></span><span class="arrow">→</span></button>
  ${
    soloOnly
      ? ''
      : `<button class="action" data-action="open-host"><span><b>Host a showdown</b><small>Face up to 7 friends live, anywhere</small></span><span class="arrow">→</span></button>
  <button class="action" data-action="open-join"><span><b>Join a showdown</b><small>Got a room code? Get in there.</small></span><span class="arrow">→</span></button>`
  }
  <button class="action" data-action="open-party"><span><b>Party mode</b><small>One phone, the whole table. Pass it around.</small></span><span class="arrow">→</span></button>
  ${
    soloOnly
      ? ''
      : `<button class="action" data-action="leaderboard"><span><b>Leaderboard</b><small>See who's playing and the all-time high scores</small></span><span class="arrow">→</span></button>`
  }
  </div></section>${gameShelf()}${soloOnly ? '<p class="muted" style="text-align:center">Offline solo mode. Scores are not uploaded from this version.</p>' : ''}`;
  }
  function drawSetup() {
    const isJoin = mode === 'join';
    const isHost = mode === 'host';
    return `${logo()}${back()}<section class="panel"><div class="eyebrow">${isJoin ? 'You got an invite' : 'Pick your poison'}</div><h2 class="section-title">${isJoin ? 'Join the competition' : isHost ? 'Start your own room' : 'Solo soundcheck'}</h2>
  <p class="section-sub">${isJoin ? 'Enter your name and the six-character room code.' : 'Choose your name and how many songs worth of punishment you want.'}</p>
  <label class="field"><span>Your name</span><input class="textinput" id="player-name" placeholder="Your nickname" maxlength="24" value="${escapeHtml(name)}" autocomplete="nickname"></label>
  ${isJoin ? `<label class="field"><span>Room code</span><input class="textinput" id="room-code" placeholder="ABC123" maxlength="6" value="${escapeHtml(inviteCode)}" autocapitalize="characters" style="text-transform:uppercase;letter-spacing:.22em;font-weight:800"></label>` : `<label class="field"><span>Round length</span><select class="select" id="rounds"><option value="10" ${rounds === 10 ? 'selected' : ''}>10 questions — Quick Draw</option><option value="20" ${rounds === 20 ? 'selected' : ''}>20 questions — Full Set</option></select></label>${levelField(level, 'set-level')}`}
  ${button(isJoin ? 'Join Room →' : isHost ? 'Create Room →' : 'Play Solo →', isJoin ? 'join' : isHost ? 'create' : 'solo', 'block')}
  <div class="notice">${notice()}</div><p class="muted">${isJoin ? 'The host starts the game once everyone’s in.' : isHost ? 'Share the code with up to 7 friends, then hit Start Game.' : 'All the questions are about country music released in the 1990s.'}</p></section>`;
  }
  function drawLobby(s) {
    const roomUrl = `${location.origin}${location.pathname}?room=${s.code}`;
    return `${logo()}${back()}<section class="panel"><div class="eyebrow">${s.isHost ? 'Your room is ready' : 'You made it'}</div><h2 class="section-title">The Honky Tonk Lobby</h2>
  <div class="invite"><div class="joinlabel">Share this code</div><div class="roomcode">${escapeHtml(s.code)}</div><div class="roomline">${button('Copy Invite Link', 'copy-link', 'small')}${button('Share', 'share', 'small secondary')}</div></div>
  <div class="eyebrow">Players (${s.players.length}/8)</div><div class="players">${s.players.map((p) => `<span class="chip ${p.isYou && s.isHost ? 'host' : ''} ${justJoined(s.code, p) ? 'new' : ''}">${escapeHtml(p.name)}${p.isYou ? ' (you)' : ''}</span>`).join('')}</div>
  ${s.isHost ? button(s.players.length >= 2 ? `Start Game · ${s.players.length} players →` : 'Waiting for players to join…', 'start', 'block', s.players.length < 2 ? 'disabled' : '') : '<div class="wait"><span class="spinner"></span> Waiting for the host to start…</div>'}
  <div id="soft-error" class="notice">${notice()}</div><p class="muted" style="margin-bottom:0">${LEVEL_LABELS[s.level] || 'Mixed'} · ${s.rounds} questions · 30 seconds per question · +100 for correct plus a speed bonus</p></section>`;
  }
  function drawQuestion(kind, s) {
    const local = kind === 'solo';
    const q = local ? qs[s.order[s.index]] : s.question;
    const revealed = local ? s.phase === 'reveal' : s.phase === 'reveal';
    const chosen = local ? s.choice : s.ownChoice;
    const answer = revealed ? (local ? q.a : s.reveal.correctIndex) : null;
    const ownAnswered = chosen !== null && chosen !== undefined;
    const locked = local ? revealed : revealed || ownAnswered || pendingChoice;
    const lyric = local ? q.lyric : s.reveal?.lyric;
    const lyricSong = local ? q.lyricSong : s.reveal?.lyricSong;
    const lyricArtist = local ? q.lyricArtist : s.reveal?.lyricArtist;
    const earned = local ? s.earned : s.reveal?.myResult.points;
    if (revealed) reportTarget = { id: q.id, song: lyricSong, artist: lyricArtist, live: !local };
    // Solo only: in a matchup the reveal moves on in seconds, so leaving to listen costs the next question.
    const listenUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent((lyricArtist || '') + ' ' + (lyricSong || '') + ' official audio')}`;
    const searchLyrics = `https://www.google.com/search?q=${encodeURIComponent((lyricArtist || '') + ' ' + (lyricSong || '') + ' lyrics')}`;
    return `${logo()}${back()}<section class="panel round-panel">
  ${clockBlock(q.category, s.index + 1, local ? s.order.length : s.total)}
  <h2 class="question">${escapeHtml(q.q)}</h2>
  ${revealed ? `<div class="answered-summary ${answer === chosen ? 'right' : 'wrong'}"><span>YOUR PICK: <b>${escapeHtml(chosen === null || chosen === undefined ? 'No answer' : q.choices[chosen])}</b></span><span>${answer === chosen ? '✓ CORRECT' : '✕ MISSED'}</span></div>` : choiceButtons(q, chosen, locked, answer)}
  ${
    revealed
      ? `<div class="answer-note ${answer === chosen ? 'right' : 'wrong'}">
    <div class="answer-result">${answer === chosen ? '✓ NAILED IT' : '✕ NOT QUITE'}</div>
    <strong>RIGHT ANSWER: ${escapeHtml(q.choices[answer])}</strong>
    <div class="lyric-label">${String(lyric).trim().split(/\s+/).length <= 3 ? 'THE SONG HOOK' : 'FROM THE LYRICS'}</div>
    <blockquote class="lyric-quote">“${escapeHtml(lyric).replaceAll(' / ', '<br>')}”</blockquote>
    <div class="lyric-credit">${escapeHtml(lyricSong)} · ${escapeHtml(lyricArtist)} <a class="full-lyrics" href="${escapeHtml(searchLyrics)}" target="_blank" rel="noopener noreferrer">Full lyrics ↗</a>${local ? `<a class="full-lyrics" href="${escapeHtml(listenUrl)}" target="_blank" rel="noopener noreferrer">Listen ↗</a>` : ''}</div>
    <span class="gain"><span>${earned > 0 ? '+' + earned + ' points' : 'No points this round'}</span>${soloOnly ? '' : '<button class="report-link" data-action="report">Report a question error</button>'}</span>
  </div>`
      : ownAnswered
        ? `<div class="wait"><span class="spinner"></span> Answer locked. ${local ? '' : 'Waiting for the other players…'}</div>`
        : ''
  }
  ${local && revealed ? button(s.index + 1 === s.order.length ? 'See Final Score →' : 'Next Question →', 'next', 'block', s.submitting ? 'disabled' : '') : ''}
  ${!local && revealed ? `<div class="wait"><span class="spinner"></span> Next question coming up…</div>` : ''}
  ${!local ? scoreboard(s.players, revealed ? q : null) : `<div class="scoreboard"><div class="score you"><div class="name">Your points</div><b>${s.score}</b><small>${s.correct} correct</small></div></div>`}
  <div id="soft-error" class="notice">${notice()}${local && s.rankingError ? escapeHtml(s.rankingError) : ''}</div></section>`;
  }
  function drawFinish(s, local) {
    const players = local
      ? [{ name: name || 'You', score: s.score, correct: s.correct, isYou: true }]
      : s.players;
    const winners = players[0] ? players.filter((p) => p.score === players[0].score) : [];
    const winnerLine = local
      ? `${s.correct} out of ${s.order.length} correct`
      : winners.length > 1
        ? 'It’s a tie. Settle it with a rematch.'
        : `${escapeHtml(winners[0].name)} owns the jukebox.`;
    return `${logo()}${back()}<section class="panel results"><div class="eyebrow">That's a wrap · ${LEVEL_LABELS[s.level] || 'Mixed'}</div><div class="trophy" aria-hidden="true"><svg viewBox="0 0 100 100" width="64" height="64" focusable="false"><polygon points="50,5 61.8,36 95,36 68,56 79,89 50,69 21,89 32,56 5,36 38.2,36" fill="currentColor"/></svg></div><h2 class="section-title">${local ? 'Soundcheck complete' : 'Showdown complete'}</h2><p class="section-sub" style="margin-top:12px">${winnerLine}</p>
  <div class="podium">${players.map((p, i) => `<div class="podiumrow"><span>${local ? '' : i + 1 + '. '}${escapeHtml(p.name)}${p.isYou && !local ? ' (you)' : ''}<small style="display:block;color:#aeb9af;font-size:11px">${p.correct} correct</small></span><b>${p.score}</b></div>`).join('')}</div>
  ${local ? button('Play Again →', 'restart', 'block') : s.isHost ? button('Rematch →', 'rematch', 'block') : '<div class="wait">Waiting for the host to call a rematch…</div>'}
  ${soloOnly ? '' : button('View leaderboard →', 'leaderboard', 'block secondary')}

  <div id="soft-error" class="notice">${notice()}</div><p class="muted">${local ? (soloOnly ? 'Offline solo round complete.' : 'Challenge your friends with Host a Showdown on the home screen.') : 'New questions are picked for every rematch.'}</p>${soloOnly ? '' : '<a class="tip-link" href="/tip/">Enjoying the Showdown? Tip the jukebox →</a>'}</section>`;
  }
  const PARTY_POINTS = 100;
  const PARTY_POINTS_WITH_CHOICES = 50;
  const seg = (field, value, options, action = 'party-set') =>
    `<div class="seg" role="group">${options
      .map(
        ([v, label]) =>
          `<button type="button" data-action="${action}" data-field="${field}" data-value="${v}" aria-pressed="${String(v) === String(value)}">${label}</button>`,
      )
      .join('')}</div>`;
  const LEVEL_HELP = {
    beginner: 'Mostly easy. The big radio hits.',
    mixed: 'Starts with the hits and builds to deep cuts.',
    expert: 'Mostly hard. Deep cuts and verse details.',
  };
  const levelField = (value, action) =>
    `<div class="field"><span>Difficulty</span>${seg('level', value, Object.entries(LEVEL_LABELS), action)}<small class="seg-help">${LEVEL_HELP[value]}</small></div>`;
  function syncPartyDraft() {
    const inputs = app.querySelectorAll('.party-name');
    if (inputs.length) partyDraft.names = [...inputs].map((el) => el.value);
    savePartyDraft();
  }
  function savePartyDraft() {
    try {
      localStorage.setItem('country-showdown-party', JSON.stringify(partyDraft));
    } catch {}
  }
  function drawPartySetup() {
    const d = partyDraft;
    const filled = d.names.filter((n) => n.trim()).length || d.names.length;
    return `${logo()}${back()}<section class="panel"><div class="eyebrow">One phone, the whole table</div><h2 class="section-title">Party mode</h2>
  <p class="section-sub">Pass the phone around. Whoever has it reads the question, and the table answers out loud. Party games don't count toward the leaderboard.</p>
  <div class="field"><span>Players</span><div class="party-names">${d.names
    .map(
      (n, i) =>
        `<div class="party-row"><input class="textinput party-name" maxlength="24" placeholder="Player ${i + 1}" value="${escapeHtml(n)}">${d.names.length > 2 ? `<button type="button" class="party-remove" data-action="party-remove" data-index="${i}" aria-label="Remove player ${i + 1}">✕</button>` : ''}</div>`,
    )
    .join(
      '',
    )}</div>${d.names.length < 8 ? button('+ Add player', 'party-add', 'small secondary') : ''}</div>
  <div class="field"><span>How to play</span>${seg('style', d.style, [
    ['buzz', 'Buzz in'],
    ['hot', 'Hot seat'],
  ])}<small class="seg-help">${d.style === 'buzz' ? 'The reader asks the whole table. First right answer gets the points.' : 'The reader asks one player. Everyone gets a turn in the hot seat.'}</small></div>
  <div class="field"><span>Multiple choice</span>${seg('choices', d.choices, [
    ['hidden', 'Only if stuck'],
    ['shown', 'From the start'],
  ])}<small class="seg-help">${d.choices === 'hidden' ? `Answer cold for ${PARTY_POINTS}. If nobody knows, the reader can read the choices, then it's worth ${PARTY_POINTS_WITH_CHOICES}.` : `The reader reads all four choices every time. ${PARTY_POINTS} points per right answer.`}</small></div>
  ${levelField(picker.cleanLevel(d.level), 'party-set')}
  <div class="field"><span>Turns to read</span>${seg('turns', d.turns, [
    [2, '2 each'],
    [3, '3 each'],
    [5, '5 each'],
  ])}<small class="seg-help">${filled * d.turns} questions with ${filled} players.</small></div>
  ${button("Let's Party →", 'party-start', 'block')}
  <div class="notice">${notice()}</div></section>`;
  }
  function startParty() {
    syncPartyDraft();
    const names = [];
    for (const raw of partyDraft.names) {
      const n = raw.trim().replace(/\s+/g, ' ').slice(0, 24);
      if (!n) continue;
      let unique = n;
      for (let k = 2; names.includes(unique); k++) unique = `${n} ${k}`;
      names.push(unique);
    }
    if (names.length < 2) {
      error = 'Party mode needs at least two players.';
      render();
      return;
    }
    error = '';
    party = {
      players: names.map((n) => ({ name: n, score: 0, correct: 0 })),
      style: partyDraft.style,
      choicesFirst: partyDraft.choices === 'shown',
      level: picker.cleanLevel(partyDraft.level),
      order: makeOrder(names.length * partyDraft.turns, partyDraft.level),
      index: 0,
      phase: 'pass',
      choicesShown: false,
      endsAt: 0,
      winner: null,
      earned: 0,
    };
    view = 'party';
    render();
  }
  const partyReader = (p) => p.index % p.players.length;
  // Hot seat: the guesser rotates through everyone but the reader, so pairings vary.
  const partyGuesser = (p) => {
    const n = p.players.length;
    const step = 1 + (Math.floor(p.index / n) % (n - 1));
    return (partyReader(p) + step) % n;
  };
  function scoreParty(winner) {
    const p = party;
    const q = qs[p.order[p.index]];
    p.winner = winner;
    p.earned = 0;
    if (winner !== null) {
      p.earned = p.choicesShown && !p.choicesFirst ? PARTY_POINTS_WITH_CHOICES : PARTY_POINTS;
      p.players[winner].score += p.earned;
      p.players[winner].correct++;
    }
    rememberQuestion(q.id);
    p.phase = 'reveal';
    render();
  }
  function partyScoreboard(p, highlight) {
    return `<div class="scoreboard">${p.players
      .map(
        (pl, i) =>
          `<div class="score ${i === highlight ? 'right' : ''}"><div class="name"><span>${escapeHtml(pl.name)}</span><span>${i === partyReader(p) && p.phase !== 'reveal' ? '📣' : ''}</span></div><b>${pl.score}</b><small>${pl.correct} right</small></div>`,
      )
      .join('')}</div>`;
  }
  function drawParty() {
    const p = party;
    const q = qs[p.order[p.index]];
    const reader = p.players[partyReader(p)];
    const guesser = p.style === 'hot' ? p.players[partyGuesser(p)] : null;
    const total = p.order.length;
    if (p.phase === 'pass') {
      return `${logo()}${back()}<section class="panel pass-panel"><div class="eyebrow">Question ${p.index + 1} of ${total}</div>
  <div class="pass-label">Pass the phone to</div><div class="pass-name">${escapeHtml(reader.name)}</div>
  <p class="section-sub">${guesser ? `${escapeHtml(reader.name)} reads to <b>${escapeHtml(guesser.name)}</b>. No peeking, everybody else.` : `${escapeHtml(reader.name)} reads to the table. No peeking, everybody else.`}</p>
  ${button("I've got the phone →", 'party-go', 'block')}
  ${partyScoreboard(p, null)}</section>`;
    }
    if (p.phase === 'question') {
      const choices = p.choicesShown
        ? `<ol class="party-choices">${q.choices.map((c, i) => `<li class="${i === q.a ? 'good' : ''}"><span class="letter">${letters[i]}</span>${escapeHtml(c)}</li>`).join('')}</ol>`
        : `<div class="party-answer"><span>Answer · just for the reader</span><b>${escapeHtml(q.choices[q.a])}</b></div>${button('Nobody knows? Show the choices', 'party-choices', 'block secondary')}`;
      const award = guesser
        ? `<div class="award-label">Did ${escapeHtml(guesser.name)} get it?</div><div class="award-row">${button('✓ Got it', 'party-award', 'award-yes', `data-player="${partyGuesser(p)}"`)}${button('✕ Missed', 'party-award', 'award-no', 'data-player="none"')}</div>`
        : `<div class="award-label">Who got it first?</div><div class="award-grid">${p.players
            .map((pl, i) =>
              i === partyReader(p)
                ? ''
                : button(escapeHtml(pl.name), 'party-award', 'secondary', `data-player="${i}"`),
            )
            .join(
              '',
            )}${button('Nobody got it', 'party-award', 'award-no', 'data-player="none"')}</div>`;
      return `${logo()}${back()}<section class="panel round-panel party-panel">
  ${clockBlock(q.category, p.index + 1, total)}
  <div class="reader-line">📣 ${escapeHtml(reader.name)} reads${guesser ? ` to ${escapeHtml(guesser.name)}` : ' to the table'}</div>
  <h2 class="question">${escapeHtml(q.q)}</h2>
  ${choices}
  ${award}
  </section>`;
    }
    const lyricSong = q.lyricSong;
    const lyricArtist = q.lyricArtist;
    reportTarget = { id: q.id, song: lyricSong, artist: lyricArtist, live: false };
    const searchLyrics = `https://www.google.com/search?q=${encodeURIComponent(lyricArtist + ' ' + lyricSong + ' lyrics')}`;
    const won = p.winner !== null;
    const last = p.index + 1 >= total;
    const nextReader = p.players[(p.index + 1) % p.players.length];
    return `${logo()}${back()}<section class="panel round-panel party-panel">
  <div class="answer-note ${won ? 'right' : 'wrong'}">
    <div class="answer-result">${won ? `✓ ${escapeHtml(p.players[p.winner].name)} got it · +${p.earned}` : guesser ? `✕ ${escapeHtml(guesser.name)} missed it` : '✕ Nobody got it'}</div>
    <strong>RIGHT ANSWER: ${escapeHtml(q.choices[q.a])}</strong>
    <div class="lyric-label">${String(q.lyric).trim().split(/\s+/).length <= 3 ? 'THE SONG HOOK' : 'FROM THE LYRICS'}</div>
    <blockquote class="lyric-quote">“${escapeHtml(q.lyric).replaceAll(' / ', '<br>')}”</blockquote>
    <div class="lyric-credit">${escapeHtml(lyricSong)} · ${escapeHtml(lyricArtist)} <a class="full-lyrics" href="${escapeHtml(searchLyrics)}" target="_blank" rel="noopener noreferrer">Full lyrics ↗</a></div>
    ${soloOnly ? '' : '<span class="gain"><span></span><button class="report-link" data-action="report">Report a question error</button></span>'}
  </div>
  ${button(last ? 'See Final Scores →' : `Pass to ${escapeHtml(nextReader.name)} →`, 'party-next', 'block')}
  ${partyScoreboard(p, won ? p.winner : null)}
  </section>`;
  }
  function drawPartyFinish() {
    const players = [...party.players].sort((a, b) => b.score - a.score);
    const winners = players.filter((pl) => pl.score === players[0].score);
    const line =
      players[0].score === 0
        ? 'Nobody scored. Rough night at the honky tonk.'
        : winners.length > 1
          ? `It’s a tie between ${winners.map((w) => escapeHtml(w.name)).join(' and ')}. Run it back.`
          : `${escapeHtml(winners[0].name)} owns the jukebox.`;
    return `${logo()}${back()}<section class="panel results"><div class="eyebrow">That's a wrap · ${LEVEL_LABELS[party.level]}</div><div class="trophy" aria-hidden="true"><svg viewBox="0 0 100 100" width="64" height="64" focusable="false"><polygon points="50,5 61.8,36 95,36 68,56 79,89 50,69 21,89 32,56 5,36 38.2,36" fill="currentColor"/></svg></div><h2 class="section-title">Party's over</h2><p class="section-sub" style="margin-top:12px">${line}</p>
  <div class="podium">${players.map((pl, i) => `<div class="podiumrow"><span>${i + 1}. ${escapeHtml(pl.name)}<small style="display:block;color:#aeb9af;font-size:11px">${pl.correct} right</small></span><b>${pl.score}</b></div>`).join('')}</div>
  ${button('Play Again →', 'party-start', 'block')}
  ${button('Change Players or Rules', 'open-party', 'block secondary')}
  <p class="muted">Party games don't count toward the leaderboard.</p>${soloOnly ? '' : '<a class="tip-link" href="/tip/">Enjoying the Showdown? Tip the jukebox →</a>'}</section>`;
  }
  function drawLeaderboard() {
    const rows = leaderboard?.rows || [];
    const stats = leaderboard?.stats || { players: 0, games: 0 };
    return `${logo()}${back()}<section class="panel leaderboard-panel">
    <div class="eyebrow">The all-time jukebox</div><h2 class="section-title">High Score Hall of Fame</h2>
    <p class="section-sub">Highest completed score per name. Solo and multiplayer both count.</p>
    <div class="board-tabs">${Object.entries(LEVEL_LABELS)
      .map(
        ([key, label]) =>
          `<button data-action="board-level" data-level="${key}" class="${boardLevel === key ? 'active' : ''}" aria-pressed="${boardLevel === key}">${label}</button>`,
      )
      .join('')}</div>
    <div class="board-tabs"><button data-action="board10" class="${boardRounds === 10 ? 'active' : ''}" aria-pressed="${boardRounds === 10}">10 questions</button><button data-action="board20" class="${boardRounds === 20 ? 'active' : ''}" aria-pressed="${boardRounds === 20}">20 questions</button></div>
    ${
      boardLoading
        ? '<p class="muted">Loading scores…</p>'
        : error
          ? notice()
          : `
    <div class="board-stats"><span><b>${Number(stats.players) || 0}</b> players</span><span><b>${Number(stats.games) || 0}</b> completed games</span></div>
    <div class="leader-rows">${rows.length ? rows.map((p, i) => `<div class="leader-row"><span class="leader-rank">${i + 1}</span><div class="leader-person"><b>${escapeHtml(p.display_name)}</b><small>${Number(p.games)} ${p.games === 1 ? 'game' : 'games'} · ${Number(p.best_correct)} correct · last played ${new Date(Number(p.last_seen)).toLocaleDateString()}</small></div><strong>${Number(p.best_score)}</strong></div>`).join('') : '<p class="muted">No scores yet. Finish a game to claim the first spot.</p>'}</div>`
    }
  </section>`;
  }
  const REPORT_REASONS = [
    ['lyric', 'Lyric is wrong'],
    ['title', 'Song title is wrong'],
    ['artist', 'Artist is wrong'],
    ['answer', 'Answer is wrong'],
    ['year', 'Not a 90s song'],
    ['other', 'Something else'],
  ];
  // Lives outside #app so a multiplayer round moving on doesn't wipe it mid-report.
  function openReport(target) {
    document.querySelector('.report-backdrop')?.remove();
    const wrap = document.createElement('div');
    wrap.className = 'report-backdrop';
    wrap.innerHTML = `<div class="report-dialog" role="dialog" aria-modal="true" aria-labelledby="report-title">
  <div class="eyebrow">Report a question error</div>
  <h3 id="report-title">What’s wrong with this one?</h3>
  <p class="report-song">“${escapeHtml(target.song)}” · ${escapeHtml(target.artist)}</p>
  <div class="report-reasons">${REPORT_REASONS.map(([key, label]) => `<button type="button" class="report-reason" data-reason="${key}" aria-pressed="false">${label}</button>`).join('')}</div>
  <label class="field"><span>Details (optional)</span><textarea class="textinput report-note" maxlength="500" rows="3" placeholder="What should it say?"></textarea></label>
  <p class="report-status" role="status">${target.live ? 'The game keeps going behind this.' : ''}</p>
  <div class="report-actions"><button type="button" class="button secondary small" data-report="cancel">Cancel</button><button type="button" class="button small" data-report="send" disabled>Send report</button></div>
</div>`;
    let reason = null;
    const close = () => {
      wrap.remove();
      document.removeEventListener('keydown', onKey);
    };
    const onKey = (e) => e.key === 'Escape' && close();
    document.addEventListener('keydown', onKey);
    wrap.addEventListener('click', async (e) => {
      if (e.target === wrap) return close();
      const pick = e.target.closest('[data-reason]');
      if (pick) {
        reason = pick.dataset.reason;
        wrap
          .querySelectorAll('[data-reason]')
          .forEach((b) => b.setAttribute('aria-pressed', String(b === pick)));
        wrap.querySelector('[data-report="send"]').disabled = false;
        return;
      }
      const act = e.target.closest('[data-report]')?.dataset.report;
      if (act === 'cancel') return close();
      if (act !== 'send' || !reason) return;
      const send = wrap.querySelector('[data-report="send"]');
      const status = wrap.querySelector('.report-status');
      send.disabled = true;
      try {
        await api('/api/report', {
          questionId: target.id,
          reason,
          note: wrap.querySelector('.report-note').value,
          name,
        });
        status.textContent = 'Thanks — report sent.';
        setTimeout(close, 1200);
      } catch (err) {
        status.textContent = err.message || 'Could not send. Try again.';
        send.disabled = false;
      }
    });
    document.body.appendChild(wrap);
    wrap.querySelector('[data-reason]').focus();
  }
  function render() {
    let html = '';
    document.body?.classList?.toggle('in-leaderboard', view === 'leaderboard');
    document.body?.classList?.toggle('in-menu', view === 'menu');
    document.body?.classList?.toggle('in-setup', view === 'setup' || view === 'partySetup');
    document.body?.classList?.toggle('in-lobby', view === 'room' && serverState?.phase === 'lobby');
    document.body?.classList?.toggle(
      'in-round',
      view === 'solo' ||
        (view === 'party' && party?.phase !== 'pass') ||
        (view === 'room' && ['question', 'reveal'].includes(serverState?.phase)),
    );
    document.body?.classList?.toggle(
      'in-results',
      view === 'soloDone' ||
        view === 'partyDone' ||
        (view === 'room' && serverState?.phase === 'finished'),
    );
    if (view === 'menu') html = drawMenu();
    if (view === 'leaderboard') html = drawLeaderboard();
    if (view === 'setup') html = drawSetup();
    if (view === 'solo') html = drawQuestion('solo', solo);
    if (view === 'soloDone') html = drawFinish(solo, true);
    if (view === 'partySetup') html = drawPartySetup();
    if (view === 'party') html = drawParty();
    if (view === 'partyDone') html = drawPartyFinish();
    if (view === 'room' && serverState) {
      const phase = serverState.phase;
      html =
        phase === 'lobby'
          ? drawLobby(serverState)
          : phase === 'finished'
            ? drawFinish(serverState, false)
            : drawQuestion('room', serverState);
    }
    app.innerHTML = html;
    drawClock();
  }
  function drawClock() {
    const timer = $('#clock');
    const fill = $('#time-fill');
    if (!timer || !fill) return;
    if (view === 'party') {
      // Party clock is just pressure: the reader still decides who got it after time runs out.
      if (party?.phase !== 'question') return;
      const left = Math.max(0, party.endsAt - Date.now());
      const secs = Math.ceil(left / 1000);
      timer.textContent = left > 0 ? secs + 's' : "TIME'S UP";
      timer.classList.toggle('warn', secs <= 5);
      fill.style.width = (100 * left) / 30000 + '%';
      return;
    }
    const local = view === 'solo';
    const s = local ? solo : serverState;
    if (!s) return;
    if (s.phase === 'reveal') {
      const seconds = local ? 0 : Math.max(0, Math.ceil((s.revealAt - Date.now()) / 1000));
      timer.textContent = local ? 'REVEAL' : `NEXT ${seconds}s`;
      fill.style.width = '0%';
      return;
    }
    const time = Math.max(0, s.endsAt - Date.now());
    const seconds = Math.ceil(time / 1000);
    timer.textContent = seconds + 's';
    timer.classList.toggle('warn', seconds <= 5);
    fill.style.width = (100 * time) / 30000 + '%';
    if (local && time <= 0 && s.phase === 'question') revealSolo(null);
  }
  app.addEventListener('click', async (evt) => {
    const element = evt.target.closest('[data-action]');
    if (!element) return;
    const action = element.dataset.action;
    if (action === 'leaderboard') {
      await loadLeaderboard(10, level);
      return;
    }
    if (action === 'board10' || action === 'board20') {
      await loadLeaderboard(action === 'board20' ? 20 : 10);
      return;
    }
    if (action === 'board-level') {
      await loadLeaderboard(boardRounds, picker.cleanLevel(element.dataset.level));
      return;
    }
    if (action === 'set-level') {
      // Keep what's typed: the setup screen redraws.
      name = ($('#player-name')?.value ?? name).trim().replace(/\s+/g, ' ').slice(0, 24);
      pickRounds();
      level = picker.cleanLevel(element.dataset.value);
      try {
        localStorage.setItem('country-showdown-level', level);
      } catch {}
      render();
      return;
    }
    if (action === 'menu') {
      view = 'menu';
      error = '';
      code = '';
      serverState = null;
      pendingChoice = false;
      history.replaceState(null, '', location.pathname);
      render();
      return;
    }
    if (['open-host', 'open-join', 'open-solo'].includes(action)) {
      if (soloOnly && action !== 'open-solo') return;
      mode = action.slice(5);
      view = 'setup';
      error = '';
      render();
      return;
    }
    if (action === 'solo' || action === 'create' || action === 'join') {
      if (!saveName()) {
        error = 'Enter a nickname first.';
        render();
        return;
      }
      if (action !== 'join') pickRounds();
      if (action === 'solo') {
        await startSolo();
        return;
      }
      if (action === 'create') await runAction('create', { name, rounds, level });
      else {
        code = ($('#room-code')?.value || '').toUpperCase().replace(/[^A-Z2-9]/g, '');
        if (code.length !== 6) {
          error = 'The room code must be six characters.';
          render();
          return;
        }
        await runAction('join', { name });
      }
      return;
    }
    if (action === 'choose') {
      const choice = Number(element.dataset.choice);
      if (view === 'solo') revealSolo(choice);
      else if (
        view === 'room' &&
        serverState?.phase === 'question' &&
        !pendingChoice &&
        serverState.ownChoice === null
      ) {
        pendingChoice = true;
        app.querySelectorAll('.option').forEach((b) => (b.disabled = true));
        await runAction('answer', { choice });
        pendingChoice = false;
      }
      return;
    }
    if (action === 'open-party') {
      view = 'partySetup';
      error = '';
      render();
      return;
    }
    if (action.startsWith('party-')) {
      if (view === 'partySetup') syncPartyDraft();
      if (action === 'party-add' && partyDraft.names.length < 8) partyDraft.names.push('');
      if (action === 'party-remove' && partyDraft.names.length > 2)
        partyDraft.names.splice(Number(element.dataset.index), 1);
      if (action === 'party-set') {
        const v = element.dataset.value;
        partyDraft[element.dataset.field] = element.dataset.field === 'turns' ? Number(v) : v;
      }
      if (action === 'party-start') return startParty();
      if (action === 'party-go' && party?.phase === 'pass') {
        party.phase = 'question';
        party.choicesShown = party.choicesFirst;
        party.endsAt = Date.now() + 30000;
      }
      if (action === 'party-choices' && party?.phase === 'question') party.choicesShown = true;
      if (action === 'party-award' && party?.phase === 'question') {
        const who = element.dataset.player;
        return scoreParty(who === 'none' ? null : Number(who));
      }
      if (action === 'party-next' && party?.phase === 'reveal') {
        if (party.index + 1 >= party.order.length) view = 'partyDone';
        else {
          party.index++;
          party.phase = 'pass';
          party.winner = null;
          party.earned = 0;
        }
      }
      if (view === 'partySetup') savePartyDraft();
      render();
      return;
    }
    if (action === 'report') {
      if (reportTarget) openReport({ ...reportTarget });
      return;
    }
    if (action === 'next') {
      nextSolo();
      return;
    }
    if (action === 'restart') {
      await startSolo();
      return;
    }
    if (['start', 'rematch'].includes(action)) {
      await runAction(action, {});
      return;
    }
    if (action === 'copy-link' || action === 'share') {
      const url = `${location.origin}${location.pathname}?room=${serverState.code}`;
      try {
        if (action === 'share' && navigator.share)
          await navigator.share({
            title: 'Honky Tonk Showdown',
            text: 'Think you know 90s country? Join my trivia room.',
            url,
          });
        else {
          await navigator.clipboard.writeText(url);
          element.textContent = 'Copied!';
        }
      } catch (e) {
        if (e.name !== 'AbortError')
          showSoftError('Could not share automatically. Send them code ' + serverState.code);
      }
    }
  });
  setInterval(drawClock, 180);
  setInterval(refresh, 1200);
  render();
})();
