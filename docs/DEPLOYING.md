# Deploy and troubleshoot

Production: https://games.murphsmitts.com/

Cloudflare Worker name: `nineties-country-showdown`. GitHub branch: `main`.
Cloudflare Builds deploy command: `npx wrangler deploy`.

**Normal workflow:** edit → `npm test` → `git add .` → `git commit -m "..."` →
`git push` (or VS Code Source Control → Sync). The connected Cloudflare Build
handles deployment; do not manually deploy the same files a second time.

**First time after this organizational update:** unzip over the _existing local
Git checkout_, run `npm test`, then commit and push. Keep your existing `.git`
folder. See the chat for the one-time exact commands.

If a Cloudflare build fails, open Workers & Pages → `nineties-country-showdown`
→ Builds → the failing build and read the build log. Check Node.js 22+.

### Important: preserve persisted scores

Keep `wrangler.jsonc` Durable Object bindings and class names as they are:
`ROOMS: GameRoom` and `LEADERBOARD: CountryLeaderboard`. The class exports are
reorganized but unchanged. Their storage is not bundled with or reset by the
files in this repository.

### What about Number Match?

The `/numbers/` page embeds the ChatGPT Sites game at its original URL. The
leaderboard and progress data remain on that separate host; this repository
contains only the wrapper. Don't change the DNS configuration just to edit a card.
