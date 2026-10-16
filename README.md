# Honky Tonk Showdown

A 90s-country-only trivia game with a **solo mode and live head-to-head multiplayer**. It includes **53 questions** (lyric details, deep cuts, artists, albums, duets). Play ten or twenty per game, with a 20-second timer and points for correct answers plus a speed bonus.

**No Supabase, paid subscriptions, logins, external database, or API keys required.** Cloudflare Workers hosts the site and Durable Objects keeps each room synchronized. The game is designed for casual friendly competition, not an anti-cheat tournament.

## Get two phones playing together

1. On your Mac, unzip the project and open Terminal in the `90s-country-showdown` folder.
2. Make sure Node.js is installed, then run:

   ```bash
   npx wrangler@latest login
   npx wrangler@latest deploy
   ```

   The first command authorizes your Cloudflare account through a browser. The second publishes the app and its multiplayer Worker together. No Cloudflare Pages project or SQL setup is needed.
3. The deploy command displays your new address, typically `https://nineties-country-showdown.<your-subdomain>.workers.dev`. Open it on both phones.
4. You choose **Host a Showdown** and enter a nickname. Choose **10 questions** or **20 questions**, then create the room.
5. Send your buddy the **Copy Invite Link** / **Share** link, or just tell him the six-character code.
6. He chooses **Join a Showdown** (or taps the invite link), enters his name, and joins. As host, press **Start Game**.

Both phones show the same question and countdown, lock answers separately, then reveal the correct answer and scores. Points = **100 per correct answer + 0 to 60 speed points**. The next question advances automatically after 5.5 seconds. There is a final leaderboard and host-controlled rematch.

**Important:** The zip is a complete *deployable* game, not a pre-hosted live website. Multiplayer becomes available at your Cloudflare URL *after* deploying it. Opening `public/index.html` directly lets you play solo locally, but multiplayer API calls require deployment. The separate standalone solo HTML also works without deployment.

## Costs and hosting

Cloudflare's **Workers Free** tier currently supports SQLite-backed Durable Objects and includes sufficient request and storage allowances for casual two-player trivia. Usage is subject to Cloudflare's published limits and future pricing changes. This game is independent of any existing Supabase project.

- Cloudflare Durable Objects pricing: https://developers.cloudflare.com/durable-objects/platform/pricing/
- Worker with static assets: https://developers.cloudflare.com/workers/static-assets/

## Test or develop locally

```bash
npx wrangler@latest dev
```

Open the local URL displayed by Wrangler. To run the included server logic test:

```bash
node test-server.mjs
```

The test covers creating and joining a room, starting, answer locking, correctness/scoring, ten rounds, game completion, rematches, and reconnection.

## Modify the game

- `src/questions.js` contains the server's question bank.
- `public/questions.js` contains the same bank for solo mode.
- `src/worker.js` implements room logic, scoring, and timers.
- `public/app.js` handles the game UI.
- `public/styles.css` handles mobile styling.
- `wrangler.jsonc` configures Cloudflare deployment.

When changing questions, update **both** question files to keep solo and live play consistent. Each question has a `q`, four `choices`, correct zero-based `a`, `fact`, `topic`, and `category`. Songs do not repeat within a single game; each new match draws different questions.

## Room rules

- Up to 8 players, though designed with two in mind.
- Six-character room invite codes.
- Rooms are valid for 24 hours; create a new room after that.
- Games cannot accept new players once they start, but participants can reconnect using the same browser/session.
- No accounts or chat; player names and game scores are stored temporarily with the room.
- The solo bank lives in the public site's JavaScript so, like most casual trivia games, the game relies on the honor system against intentional source inspection.

## Troubleshooting

**The link fails:** Check that `npx wrangler@latest deploy` completed successfully and use the `workers.dev` address from the deployment output.

**One player cannot join:** Check the full six-character code and verify that the game has not started. Reuse the same browser on reconnect.

**The game looks frozen:** Ensure both devices have internet service. Reloading the deployed URL should recover your room via its invite link.

**Workers asks about creating a workers.dev subdomain:** Follow its account setup prompts. Do not copy these files into an existing Murph's Mitts Worker unless you intend to replace that Worker. This project uses a separate Worker name by default.
