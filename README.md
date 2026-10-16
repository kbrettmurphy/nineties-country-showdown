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
