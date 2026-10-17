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
  let leaderboard = null;
  let boardRounds = 10;
  let boardLoading = false;
  const countryPrefix =
    location.pathname === '/country' || location.pathname.startsWith('/country/') ? '/country' : '';
  const HISTORY_KEY = 'honky-tonk-played-topics-v3';
  const HISTORY_LIMIT = 340;
  const validTopics = new Set(qs.map((q) => q.topic));
  function readHistory() {
    try {
      const saved = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
      if (!Array.isArray(saved)) return [];
      return [...new Set(saved.filter((t) => typeof t === 'string' && validTopics.has(t)))].slice(
        -HISTORY_LIMIT,
      );
    } catch {
      return [];
    }
  }
  function rememberTopic(topic) {
    if (!validTopics.has(topic)) return;
    const previous = readHistory().filter((t) => t !== topic);
    previous.push(topic);
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(previous.slice(-HISTORY_LIMIT)));
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
  // Prefer fresh recordings across games. Only recycle a recently played recording
  // when the remaining fresh pool cannot fill a complete round.
  const makeOrder = (n) => {
    const past = readHistory();
    const seen = new Set(past);
    const pool = shuffle(qs.map((q, i) => ({ q, i })));
    const fresh = pool.filter((x) => !seen.has(x.q.topic));
    const older = pool
      .filter((x) => seen.has(x.q.topic))
      .sort((a, b) => past.indexOf(a.q.topic) - past.indexOf(b.q.topic));
    const chosen = [],
      used = new Set();
    const add = (list, limit, filter) => {
      for (const entry of list) {
        if (chosen.length >= limit) break;
        if (used.has(entry.q.topic) || !filter(entry.q)) continue;
        chosen.push(entry.i);
        used.add(entry.q.topic);
      }
    };
    const isDetail = (q) =>
      q.category === 'LYRIC DETECTIVE' ||
      q.category === 'DEEP CUT' ||
      q.category === 'ALBUMS & COLLABS';
    add(fresh, Math.ceil(n * 0.4), isDetail);
    add(fresh, n, () => true);
    if (chosen.length < n) add(older, n, () => true);
    return shuffle(chosen);
  };
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
    const order = makeOrder(rounds);
    let sessionId = null,
      endsAt = Date.now() + 30000;
    if (!soloOnly) {
      try {
        const response = await api('/api/solo/start', {
          name,
          questionIds: order.map((i) => qs[i].id),
        });
        sessionId = response.sessionId;
        endsAt = response.endsAt;
      } catch (e) {
        error = 'Leaderboard connection unavailable; playing unranked. ' + e.message;
      }
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
    rememberTopic(question.topic);
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
  async function loadLeaderboard(length = 10) {
    boardRounds = length;
    view = 'leaderboard';
    leaderboard = null;
    boardLoading = true;
    error = '';
    render();
    try {
      const res = await fetch(countryPrefix + '/api/leaderboard?rounds=' + length, {
        cache: 'no-store',
      });
      const data = await res.json();
      if (!res.ok) throw Error(data.error || 'Leaderboard unavailable');
      if (view === 'leaderboard' && boardRounds === length) leaderboard = data;
    } catch (e) {
      error = e.message || 'Could not load standings.';
    } finally {
      boardLoading = false;
      if (view === 'leaderboard') render();
    }
  }
  async function runAction(action, payload = {}) {
    if (requestInFlight) return;
    requestInFlight = true;
    error = '';
    const buttons = app.querySelectorAll('[data-action="' + action + '"]');
    buttons.forEach((el) => (el.disabled = true));
    try {
      const result = await api(
        action === 'create' ? '/api/create' : '/api/room/' + code + '/' + action,
        ['create', 'join', 'rematch'].includes(action)
          ? { ...payload, recentTopics: readHistory() }
          : payload,
      );
      serverState = result;
      code = result.code;
      view = 'room';
      if (result.reveal?.topic) rememberTopic(result.reveal.topic);
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
  async function refresh() {
    if (view !== 'room' || !code || requestInFlight) return;
    requestInFlight = true;
    try {
      const result = await api('/api/room/' + code + '/state', {});
      const str = JSON.stringify(result);
      if (str !== previousState) {
        serverState = result;
        previousState = str;
        if (result.reveal?.topic) rememberTopic(result.reveal.topic);
        render();
      }
    } catch (e) {
      error = e.message || 'Connection interrupted.';
      if (view === 'room') showSoftError(error);
    } finally {
      requestInFlight = false;
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
      : `<button class="action" data-action="open-host"><span><b>Host a showdown</b><small>Face your buddy live, anywhere</small></span><span class="arrow">→</span></button>
  <button class="action" data-action="open-join"><span><b>Join a showdown</b><small>Got a room code? Get in there.</small></span><span class="arrow">→</span></button>
  <button class="action" data-action="leaderboard"><span><b>Leaderboard</b><small>See who's playing and the all-time high scores</small></span><span class="arrow">→</span></button>`
  }
  </div></section>${gameShelf()}${soloOnly ? '<p class="muted" style="text-align:center">Offline solo mode. Scores are not uploaded from this version.</p>' : ''}`;
  }
  function drawSetup() {
    const isJoin = mode === 'join';
    const isHost = mode === 'host';
    return `${logo()}${back()}<section class="panel"><div class="eyebrow">${isJoin ? 'You got an invite' : 'Pick your poison'}</div><h2 class="section-title">${isJoin ? 'Join the competition' : isHost ? 'Start your own room' : 'Solo soundcheck'}</h2>
  <p class="section-sub">${isJoin ? 'Enter your name and the six-character room code.' : 'Choose your name and how many songs worth of punishment you want.'}</p>
  <label class="field"><span>Your name</span><input class="textinput" id="player-name" placeholder="Your nickname" maxlength="24" value="${escapeHtml(name)}" autocomplete="nickname"></label>
  ${isJoin ? `<label class="field"><span>Room code</span><input class="textinput" id="room-code" placeholder="ABC123" maxlength="6" value="${escapeHtml(inviteCode)}" autocapitalize="characters" style="text-transform:uppercase;letter-spacing:.22em;font-weight:800"></label>` : `<label class="field"><span>Round length</span><select class="select" id="rounds"><option value="10" ${rounds === 10 ? 'selected' : ''}>10 questions — Quick Draw</option><option value="20" ${rounds === 20 ? 'selected' : ''}>20 questions — Full Set</option></select></label>`}
  ${button(isJoin ? 'Join Room →' : isHost ? 'Create Room →' : 'Play Solo →', isJoin ? 'join' : isHost ? 'create' : 'solo', 'block')}
  <div class="notice">${notice()}</div><p class="muted">${isJoin ? 'Your friend needs to start the game once you join.' : isHost ? 'Share the code with your friend, then hit Start Game.' : 'All the questions are about country music released in the 1990s.'}</p></section>`;
  }
  function drawLobby(s) {
    const roomUrl = `${location.origin}${location.pathname}?room=${s.code}`;
    return `${logo()}${back()}<section class="panel"><div class="eyebrow">${s.isHost ? 'Your room is ready' : 'You made it'}</div><h2 class="section-title">The Honky Tonk Lobby</h2>
  <div class="invite"><div class="joinlabel">Share this code</div><div class="roomcode">${escapeHtml(s.code)}</div><div class="roomline">${button('Copy Invite Link', 'copy-link', 'small')}${button('Share', 'share', 'small secondary')}</div></div>
  <div class="eyebrow">Players (${s.players.length}/8)</div><div class="players">${s.players.map((p) => `<span class="chip ${p.isYou && s.isHost ? 'host' : ''}">${escapeHtml(p.name)}${p.isYou ? ' (you)' : ''}</span>`).join('')}</div>
  ${s.isHost ? button(s.players.length >= 2 ? 'Start Game →' : 'Waiting for a buddy…', 'start', 'block', s.players.length < 2 ? 'disabled' : '') : '<div class="wait"><span class="spinner"></span> Waiting for the host to start…</div>'}
  <div id="soft-error" class="notice">${notice()}</div><p class="muted" style="margin-bottom:0">${s.rounds} questions · 30 seconds per question · +100 for correct plus a speed bonus</p></section>`;
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
    <blockquote class="lyric-quote">“${escapeHtml(lyric)}”</blockquote>
    <div class="lyric-credit">${escapeHtml(lyricSong)} · ${escapeHtml(lyricArtist)} <a class="full-lyrics" href="${escapeHtml(searchLyrics)}" target="_blank" rel="noopener noreferrer">Full lyrics ↗</a></div>
    <span class="gain">${earned > 0 ? '+' + earned + ' points' : 'No points this round'}</span>
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
    return `${logo()}${back()}<section class="panel results"><div class="eyebrow">That's a wrap</div><div class="trophy" aria-hidden="true"><svg viewBox="0 0 100 100" width="64" height="64" focusable="false"><polygon points="50,5 61.8,36 95,36 68,56 79,89 50,69 21,89 32,56 5,36 38.2,36" fill="currentColor"/></svg></div><h2 class="section-title">${local ? 'Soundcheck complete' : 'Showdown complete'}</h2><p class="section-sub" style="margin-top:12px">${winnerLine}</p>
  <div class="podium">${players.map((p, i) => `<div class="podiumrow"><span>${local ? '' : i + 1 + '. '}${escapeHtml(p.name)}${p.isYou && !local ? ' (you)' : ''}<small style="display:block;color:#aeb9af;font-size:11px">${p.correct} correct</small></span><b>${p.score}</b></div>`).join('')}</div>
  ${local ? button('Play Again →', 'restart', 'block') : s.isHost ? button('Rematch →', 'rematch', 'block') : '<div class="wait">Waiting for the host to call a rematch…</div>'}
  ${soloOnly ? '' : button('View leaderboard →', 'leaderboard', 'block secondary')}

  <div id="soft-error" class="notice">${notice()}</div><p class="muted">${local ? (soloOnly ? 'Offline solo round complete.' : 'Challenge your buddy using Host a Showdown on the home screen.') : 'New questions are picked for every rematch.'}</p></section>`;
  }
  function drawLeaderboard() {
    const rows = leaderboard?.rows || [];
    const stats = leaderboard?.stats || { players: 0, games: 0 };
    return `${logo()}${back()}<section class="panel leaderboard-panel">
    <div class="eyebrow">The all-time jukebox</div><h2 class="section-title">High Score Hall of Fame</h2>
    <p class="section-sub">Highest completed score per name. Both solo and multiplayer count. Names are public; no login is required.</p>
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
    <p class="muted board-note">High scores begin with this leaderboard update; past games cannot be recovered automatically. Reusing someone else's nickname merges records, so this is a friendly honor-system leaderboard.</p>
  </section>`;
  }
  function render() {
    let html = '';
    document.body?.classList?.toggle('in-leaderboard', view === 'leaderboard');
    document.body?.classList?.toggle('in-menu', view === 'menu');
    document.body?.classList?.toggle('in-setup', view === 'setup');
    document.body?.classList?.toggle('in-lobby', view === 'room' && serverState?.phase === 'lobby');
    document.body?.classList?.toggle(
      'in-round',
      view === 'solo' || (view === 'room' && ['question', 'reveal'].includes(serverState?.phase)),
    );
    document.body?.classList?.toggle(
      'in-results',
      view === 'soloDone' || (view === 'room' && serverState?.phase === 'finished'),
    );
    if (view === 'menu') html = drawMenu();
    if (view === 'leaderboard') html = drawLeaderboard();
    if (view === 'setup') html = drawSetup();
    if (view === 'solo') html = drawQuestion('solo', solo);
    if (view === 'soloDone') html = drawFinish(solo, true);
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
      await loadLeaderboard(10);
      return;
    }
    if (action === 'board10' || action === 'board20') {
      await loadLeaderboard(action === 'board20' ? 20 : 10);
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
      if (action === 'create') await runAction('create', { name, rounds });
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
