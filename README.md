# Murph’s Games

The source for **games.murphsmitts.com**. One Cloudflare Worker serves the hub and
Honky Tonk Showdown. Number Match is still embedded from its original ChatGPT Sites
host, preserving its existing progress recovery and leaderboard.

## Where things live

| URL         | Code                                  | Storage                            |
| ----------- | ------------------------------------- | ---------------------------------- |
| `/`         | `public/index.html`, `public/hub.css` | none                               |
| `/numbers/` | `public/numbers/` (iframe wrapper)    | **original ChatGPT Sites** backend |
| `/country/` | `public/country/`                     | Cloudflare Durable Objects         |

## Start here

- **[Code tour](docs/CODE_TOUR.md)** — how the parts work and where to make edits.
- **[Deploying](docs/DEPLOYING.md)** — GitHub → Cloudflare automatic deployment.
- **[Questions](docs/QUESTIONS.md)** — maintain the trivia bank without losing answers.

### Check your work

Install Node.js 22+ and run from the repository folder:

```bash
npm test            # server, UI, routes and leaderboard tests, without packages
npm install         # once: install Wrangler + Prettier
npm run format      # format hand-written JS, CSS, HTML, tests and docs
npm run format:check
npm run dev         # local Cloudflare Worker preview
```

To publish, commit and push to **`main`**. Cloudflare Builds is connected to this
GitHub repository. Do **not** manually run `wrangler deploy` for ordinary updates;
a manual deployment that isn't committed can be overwritten by the next build.

### Important operational constraints

- Keep the **Worker name** `nineties-country-showdown` and the Durable Object class
  names `GameRoom` and `CountryLeaderboard` until you intentionally plan a storage
  migration. Renaming them blindly could affect persistent rooms and leaderboard.
- The repository name is historical; it now serves **both** games. Changing the
  repository's GitHub display name is optional, independent of the Worker name.
- Don't unpublish the original Number Match ChatGPT Sites project: `/numbers/` embeds it.
- The `tools/questions/` files generate _both_ client and server question banks.
  Edit the inputs, then run `npm run questions:build`.
- Commit **generated files** when changing question data so both modes match.
