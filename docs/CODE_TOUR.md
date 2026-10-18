# Code tour for beginners

```text
90s-country-showdown/
├── public/                     # Browser files served by Cloudflare
│   ├── index.html              # Game-selection homepage
│   ├── hub.css                 # Homepage styling
│   ├── numbers/                # Number Match frame (not its game engine)
│   │   ├── index.html
│   │   └── styles.css
│   └── country/                # Honky Tonk Showdown UI
│       ├── index.html          # Page and script links
│       ├── app.js              # Buttons, answers, screen changes
│       ├── picker.js           # Picks each game's questions (shared with the server)
│       ├── styles.css          # Fonts, colors, layout and breakpoints
│       └── questions.js       # Generated solo question bank
├── src/                        # Server-side code running on Cloudflare
│   ├── worker.js               # URL routing and API dispatch
│   └── country/
│       ├── questions.js        # Generated multiplayer question bank
│       ├── shared.js           # Timer, validation, question selection
│       ├── game-room.js        # Multiplayer rooms and scoring
│       └── leaderboard.js      # Persistent leaderboard and solo scoring
├── tools/questions/            # Question-writing and generation inputs
├── tools/package_offline.py    # Optional offline HTML builder
├── tests/                      # Automated tests
├── docs/                       # Guides
├── wrangler.jsonc              # Cloudflare Worker settings
└── package.json                # npm commands
```

## What to edit first

- **Colors and typography:** `public/country/styles.css` or `public/hub.css`.
- **Trivia buttons/screens:** `public/country/app.js`.
- **Add or correct questions:** inputs in `tools/questions/`, then `npm run questions:build`.
- **30-second timer:** `DURATION_MS` in `src/country/shared.js`.
- **Scores and leaderboard:** `src/country/leaderboard.js`.
- **Who plays against whom:** `src/country/game-room.js`.

## Browser vs server

`public` is code players' browsers download. `src` runs on Cloudflare's server.
The two question banks intentionally mirror each other: client data powers solo
views; the server validates scored answers. Don't edit only one generated copy.

A `Durable Object` is Cloudflare's small persistent unit of server-side state.
The game uses `GameRoom` for a shared match and `CountryLeaderboard` for scores.

## Editing in VS Code

1. File → Open Folder → your existing `90s-country-showdown` clone.
2. Open the Explorer to browse folders, or press Cmd+P and type a filename.
3. Open Terminal → New Terminal, then run `npm test` after changes.
4. Click **Source Control** (branch icon). Review the diff, enter a commit message,
   commit, and select **Sync Changes**. No new ZIP is needed.
5. Cloudflare builds and publishes the new commit from `main`.

Use **branches** for experiments you don't want to deploy immediately. Only push
to `main` when it's ready to become public.
