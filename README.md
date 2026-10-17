# MurphsMitts Games — 90s Country Showdown UI + Rotation Update

Includes the existing multi-game Cloudflare Worker and Number Match iframe integration. The `games.murphsmitts.com` DNS and the ChatGPT Sites Number Match project are unchanged.

## What's new

- End-of-game trophy star is centered with SVG geometry rather than a font glyph.
- On a question, the header, options, answer summary, lyric snippet, and scoreboard are sized for a `100dvh` screen. On exceptionally small/zoomed viewports the question panel can scroll internally.
- After answering, the four large options collapse into a short "Your pick" summary. Solo play keeps the Next Question button underneath the lyric reveal.
- Improved short lyric hooks on **70** artist-question songs and two additional lyric-detail reveals, including The Kinleys' "Please" and John Michael Montgomery's "Sold" row question. Snippets are short; a "Full lyrics" link on every reveal searches for the complete song text without copying whole copyrighted verses into the game. Unverified lyrics are not invented, and some original short hooks remain.
- Songs and questions you recently played are stored locally in your browser, for solo and multiplayer. Host and guest histories are combined before room questions are picked; rematches avoid the room's preceding questions. When a history covers most of the bank, older questions can return.
- Kept all **454** questions, 30-second timer, 10/20-question matches, multiplayer rooms, scores, and Number Match progress/leaderboard on its existing origin.

## Install from Mac

Download ZIP and unzip it over the existing `~/Downloads/90s-country-showdown` folder. From Terminal:

```bash
cd ~/Downloads
unzip -o MurphsMitts_Games_Trivia_Polish.zip
cd 90s-country-showdown
npm test
npx wrangler@latest deploy
# The connected GitHub main branch also needs the same files:
git add .
git commit -m "Improve country lyric reveals, layout and repeat rotation"
git push
```

For automatic Cloudflare Builds, the `git push` may trigger a second deployment; that is fine. If the push automatically deploys, manual deployment may be skipped.

## Verify

- `https://games.murphsmitts.com/` — main games hub
- `/numbers/` — embedded Number Match with original saved-name restore
- `/country/` — play 10 rounds; Next Question should remain visible on a common phone viewport
- Complete another game/rematch; previously played recordings should be avoided until fresh options are exhausted

Because the game history is browser-local, switching browsers/devices or clearing site data resets a particular player's recent-history list. Both multiplayer players send their recent histories when they join; the session's own round history lives in the Durable Object room.

All five automated tests pass. They exercise API routing, song-rotation history, multiplayer scoring, the UI markup, and Cloudflare folder routing. They do not replace a live mobile browser check.

---

# MurphsMitts Games — staging integration (original Number Match artwork)

## Goal

- `https://games.murphsmitts.com/` — game launcher (new)
- `https://games.murphsmitts.com/numbers/` — Number Match (original ChatGPT Sites app embedded in a full-screen iframe)
- `https://games.murphsmitts.com/country/` — Honky Tonk Showdown (454 questions, 30-second timer, lyric reveals, multiplayer)

**IMPORTANT:** The `/numbers/` integration is intentionally a **staging bridge**, not a copy of Number Match's source code. Embedding its **original ChatGPT Sites URL** continues using the original game backend and leaderboard database. It does not automatically import browser-local saved progress, because the embedded game has a different storage context from the home-screen shortcut. Some sites disallow iframe embedding. Until the user verifies it on an actual phone/computer, it is **not verified to work**. The full source export is preserved separately for a proper migration if framing is blocked.

This ZIP contains the updated trivia Worker, hub, and Numbers wrapper only. It does **not** upload your Number Match database or transplant its persistence. No known app data is changed.

## Verify locally

```sh
node test-server.mjs
node test-ui.mjs
node test-routing.mjs
```

## Deploy a test URL first (without changing DNS)

From the existing local Git checkout directory (`~/Downloads/90s-country-showdown`), unzip this package into `~/Downloads`. The project folder name in the ZIP is still `90s-country-showdown` so it overwrites working source, **not** `.git` or the local repository configuration.

```sh
cd ~/Downloads
unzip -o MurphsMitts_Games_Hub_Logo_Progress_Staging.zip
cd 90s-country-showdown
node test-server.mjs && node test-ui.mjs && node test-routing.mjs && node test-canonical-redirects.mjs
npx wrangler@latest deploy
```

Wrangler will report a `workers.dev` URL. Test its **three paths** BEFORE editing DNS: `/`, `/numbers/`, and `/country/`. Confirm `/numbers/` isn't blocked in an iframe. `workers.dev` is explicitly enabled for this preview.

**2026-10-16 redirect-loop fix:** Previous staging builds rewrote `/numbers/` and `/country/` to their physical `index.html` paths. Cloudflare canonicalized those paths back to the folders, creating a redirect loop. The Worker now passes the folder URLs to the static asset handler unchanged; `test-canonical-redirects.mjs` simulates Cloudflare canonical redirects to guard against regressions. This deploy will also register `games.murphsmitts.com/*`, but it **does not override DNS-only** routing before the proxy is enabled, so your existing `games.murphsmitts.com` ChatGPT Sites site remains live during the test.

## Cutover, ONLY after preview works

1. Confirm that Number Match appears **inside** `/numbers/`, not only at the fallback external link, and confirm the game and leaderboard operate normally.
2. In Cloudflare DNS, edit **only** the existing `games` CNAME record (`custom-domains.chatgpt.site`) from DNS-only to **Proxied** (orange cloud). Do not delete or retarget the record during this test.
3. Verify `/`, `/numbers/`, and `/country/` on the custom domain. If any fail, immediately change the `games` CNAME back to **DNS only**. This restores access to the previous ChatGPT Sites homepage while the new Worker remains deployed and available at its preview URL.
4. Once verified, commit/push the changes to the existing GitHub repository. Cloudflare Builds will use `main` to redeploy thereafter. You can commit earlier, but a GitHub automatic deployment could replace the Worker before you finish previewing.

## Limitations / long-term plan

- **Framing is unverified**. If ChatGPT Sites sends restrictive `X-Frame-Options` or Content-Security-Policy headers, `/numbers/` may show a blank frame. In that case, use the exported source ZIP to migrate Number Match fully, rather than relying on the wrapper.
- The original Number Match uses a **D1 leaderboard database** in its ChatGPT Sites hosting, and **localStorage** for local progress. The exported source includes the app and database schema, but not the production database rows. Those require a separate export/import before full self-hosted migration, and per-device browser progress requires its own transfer process if the origin changes.
- This launcher is deliberately independent of the exported Number Match build/dependencies, so all country Worker tests and multiplayer remain intact.

## Number Match player progress / saved data

The `/numbers/` page embeds the **original** ChatGPT Sites Number Match game, which stores the current game, journey/stamps, settings and lifetime statistics in **origin-scoped browser localStorage**. The original home-screen-installed app may have a separate browser storage container. An iframe inside `workers.dev` (and later `games.murphsmitts.com`) cannot assume access to that old localStorage, and may be subject to third-party storage restrictions. **Do not remove the original home-screen icon or clear its data.**

To recover server-synced island and stage, enter the **same existing leaderboard player name**. The source game's `useLeaderboard` logic calls the existing leaderboard recovery endpoint, while `restoreCloudProgress()` moves the new board forward to the backed-up island/stage. It does NOT recover the exact in-progress board, all stamps, hints, statistics, and other local-only state. These require an intentional export/import flow built into the original app or original-home-screen-to-new-site migration.

The stage/test environment retains the original game inside an iframe to preserve its existing backend and avoid creating an empty leaderboard DB. Do not switch DNS before verifying the impact on progress and leaderboard.

The games homepage preserves the original blue split **1 | 9** Number Match mark (CSS recreation from the user's original GamesHub source) against the new dark-blue background.


## Country trivia Hall of Fame (new)

- Cloudflare `CountryLeaderboard` SQLite-backed Durable Object holds shared high scores.
- The **10-question** and **20-question** boards are independent. Each nickname appears once per board with its best completed score, total completed games, and correct count for the personal best.
- Score submissions from live rooms are sent by `GameRoom`, not players' browsers. Ranked solo games start timed server sessions and submit each answer in order.
- It is a casual, **public nickname** leaderboard without accounts. Duplicate names merge. Do not enter private names. A determined player could still reverse-engineer the publicly downloadable question bank.
- Existing matches cannot be imported; scores start when this release reaches production. Clicking the link without completing a game doesn't create an entry.
- Browser game history and Number Match progress are separate and unchanged. Number Match remains hosted on ChatGPT Sites, embedded in `/numbers/`.

## Repository layout

This is presently a single **games-hub Worker repository**, despite its historic name `nineties-country-showdown`:

- `public/index.html`: two-game homepage
- `public/country/index.html`: trivia page shell; `public/app.js`, `public/questions.js`, `public/styles.css`: actual trivia UI
- `public/numbers/index.html`: Number Match iframe wrapper only (its actual game and database still live on ChatGPT Sites)
- `src/worker.js`: routing, multiplayer rooms, and persistent leaderboards
- `src/questions.js`: server-side trivia bank
- `wrangler.jsonc`: Cloudflare Worker name, domain route, Durable Object bindings

The project uses GitHub's `main` branch as the **Cloudflare automatic deployment source** after Workers Builds is connected. To prevent live changes being overwritten by the next build, update `main` and let Cloudflare deploy; don't make a manual Wrangler deployment without a matching commit. The deployed Worker is still named `nineties-country-showdown`; a repository rename is optional but should be a separate, planned change.
