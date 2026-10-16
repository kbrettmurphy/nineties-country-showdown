# Honky Tonk Showdown — 90s Country Trivia

A mobile-friendly 90s country game with **454 selectable-answer trivia questions**,
**30 seconds per question**, short **lyric excerpts after every answer**, solo mode,
and synced live head-to-head rooms. Covers well-known hits, deeper cuts, lyrics,
artists and classic 90s albums. No login or Supabase project required.

## Where it goes

- Main game: `https://games.murphsmitts.com/country/`
- Standalone game: your existing `https://nineties-country-showdown.<account>.workers.dev/`
- Existing number game at `https://games.murphsmitts.com/` is **NOT replaced**.

The Wrangler config maps **only** `games.murphsmitts.com/country*` to the trivia
Worker, leaving other paths alone. Cloudflare needs the `murphsmitts.com` zone
and the `games` DNS record to be managed in your Cloudflare account for the
route to deploy. It also keeps the regular `workers.dev` address active.

The trivia homepage includes a link back to the existing games homepage.
For the number game homepage to show a **Honky Tonk Showdown** tile as well,
add an ordinary link to `/country/` in the separate number-game project.
That separate project is intentionally untouched here.

## One-time GitHub + Cloudflare setup

The `nineties-country-showdown` repository must contain the **actual files in
this folder at the repository root**: `wrangler.jsonc`, `package.json`, `src/`,
`public/`, and the supporting files. An empty GitHub repository has no
initialized `main` branch, so Cloudflare cannot select a production branch yet.

After the files are committed to `main`:

1. Open the **existing** Worker `nineties-country-showdown` in Cloudflare.
2. Settings → Builds → Connect → `kbrettmurphy/nineties-country-showdown`.
3. Production branch: `main`. Disable builds: **off**.
4. Build command: leave **empty** (no compile step needed).
5. Deploy command: `npx wrangler@latest deploy` (or Cloudflare default `npx wrangler deploy`).
6. Preview builds: optional; leaving disabled is fine.
7. Connect and check build logs / website after first deploy.

The name in `wrangler.jsonc` **must match** the existing Worker name. We use
`nineties-country-showdown`. Pushes to `main` will then trigger deployment.

If the Cloudflare form says **internal error**, confirm the repo has a commit
and initialized `main` branch, refresh and select `main`. If it still fails,
check Cloudflare GitHub app access to the repository and try again; Cloudflare
may also have a transient dashboard error.

No Cloudflare API token, OAuth access code or password needs to be shared with a chatbot.

## Standalone deployment from your computer (alternative)

```sh
npx wrangler@latest login
npx wrangler@latest deploy
```

## Test / question bank

```sh
python build_questions.py
node test-server.mjs
node test-ui.mjs
node test-routing.mjs
```

- `base_questions.json`: 53 original questions (including original lyric reveals).
- `extra_hits.py`: curated artist/song questions from 1990s country radio.
- `extra_details.py`: harder lyric-detail questions with a brief lyric reveal.
- `build_questions.py`: syncs the identical bank to `src/questions.js` and
  `public/questions.js`. Don't edit generated JS directly.
- `src/worker.js`: room creation, Durable Objects, score calculation, **30s**
  countdown and route prefix.
- `public/app.js`: solo and shared-room UI, **30s** countdown, answer reveal.
- `wrangler.jsonc`: Worker name, static assets, Durable Object binding, and
  path-specific route for `games.murphsmitts.com/country*`.

Only one question about a given song is selected per match, even when the bank
has several possible questions about that recording. Ten- and 20-question games,
room invite codes, points and rematches work as in the original version.

### Note about lyric reveals

The reveals are intentionally short lyric hooks/excerpts, rather than complete
verses. Some questions about performers or albums use the song's title refrain.
If you notice a lyric excerpt that needs correction, update the entry in the
question source and run `python build_questions.py` to regenerate both copies.

## Play rules

- Host creates a room and shares its six-character code or invite URL.
- Other player joins and host starts a 10- or 20-question match.
- Each player has 30 seconds to answer; earlier correct answers earn more points.
- Correct answers: 100 points + up to 60 speed points; incorrect: 0.
- The correct selection, a brief lyric excerpt and song credit appear after
  each round. The next multiplayer question starts after 5.5 seconds.
- The host can start a rematch after the final scoreboard.
- Room data expires after 24 hours; up to eight players per room.

No number-game source files or existing `games.murphsmitts.com` root routes
were modified as part of this trivia project.
