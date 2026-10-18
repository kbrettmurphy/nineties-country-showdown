// Cloudflare Worker entrypoint for the shared games hub.
// Keep this small: game rules and persistent storage live in src/country/.
import { asJson, fail, shortName, isToken, normalizeCode, randomCode } from './country/shared.js';

export { GameRoom } from './country/game-room.js';
export { CountryLeaderboard } from './country/leaderboard.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    // Murph’s Games hub: / (launcher), /numbers/ (original game embedded),
    // and /country/ (Cloudflare-backed multiplayer trivia).
    // Keep the country API at /country/api/...; the client uses that prefix.
    if (['/country', '/numbers', '/tip'].includes(url.pathname)) {
      return Response.redirect(url.origin + url.pathname + '/' + url.search, 308);
    }
    // Let Cloudflare's static-asset handler serve folder index pages directly.
    // Rewriting /numbers/ to /numbers/index.html (or /country/ likewise)
    // causes a loop: the default HTML handler canonically redirects index.html
    // right back to the trailing-slash URL.
    // The trivia assets now live in public/country/. Only /country/api/*
    // is rewritten to the internal API router; the browser assets use their real paths.
    if (url.pathname.startsWith('/country/api/')) {
      url.pathname = url.pathname.slice('/country'.length);
    }
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(new Request(url, request));
    if (url.pathname === '/api/leaderboard' && request.method === 'GET') {
      return env.LEADERBOARD.get(env.LEADERBOARD.idFromName('country-global')).fetch(
        'https://leaderboard.internal/list' + url.search,
      );
    }
    if (request.method !== 'POST') return fail('Use POST for game actions.', 405);
    let data;
    try {
      data = await request.json();
    } catch {
      return fail('Invalid request.');
    }
    const path = url.pathname.split('/').filter(Boolean);
    try {
      if (
        path[0] === 'api' &&
        path[1] === 'solo' &&
        ['start', 'answer', 'next'].includes(path[2]) &&
        path.length === 3
      ) {
        return env.LEADERBOARD.get(env.LEADERBOARD.idFromName('country-global')).fetch(
          'https://leaderboard.internal/solo/' + path[2],
          {
            method: 'POST',
            body: JSON.stringify(data),
          },
        );
      }
      const board = () => env.LEADERBOARD.get(env.LEADERBOARD.idFromName('country-global'));
      if (path.length === 2 && path[1] === 'report') {
        return board().fetch('https://leaderboard.internal/report', {
          method: 'POST',
          body: JSON.stringify(data),
        });
      }
      // Reports page (public/country/reports/): reading and resolving needs the REPORTS_KEY secret.
      if (
        path[1] === 'reports' &&
        ['list', 'resolve', 'stats'].includes(path[2]) &&
        path.length === 3
      ) {
        if (!env.REPORTS_KEY) return fail('Reports key is not configured.', 503);
        if (typeof data.key !== 'string' || data.key !== env.REPORTS_KEY)
          return fail('Wrong reports key.', 403);
        return board().fetch('https://leaderboard.internal/reports/' + path[2], {
          method: 'POST',
          body: JSON.stringify(data),
        });
      }
      if (path.length === 2 && path[1] === 'create') {
        if (!shortName(data.name) || !isToken(data.token)) return fail('Enter a name to play.');
        for (let attempt = 0; attempt < 8; attempt++) {
          const code = randomCode();
          const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
          const response = await stub.fetch('https://room.internal/create', {
            method: 'POST',
            body: JSON.stringify({ ...data, code }),
          });
          if (response.status === 409) continue;
          return response;
        }
        return fail('Could not generate a room. Try again.', 503);
      }
      if (path.length === 4 && path[1] === 'room') {
        const code = normalizeCode(path[2]);
        const action = path[3];
        if (!/^[A-HJ-NP-Z2-9]{6}$/.test(code))
          return fail('Enter a valid six-character room code.');
        if (!['join', 'state', 'start', 'answer', 'rematch'].includes(action))
          return fail('Unknown game action.', 404);
        const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
        return stub.fetch('https://room.internal/' + action, {
          method: 'POST',
          body: JSON.stringify({ ...data, code }),
        });
      }
      return fail('Unknown endpoint.', 404);
    } catch (e) {
      console.error('Game request failure:', e);
      return fail('Game server unavailable. Please try again.', 503);
    }
  },
};
