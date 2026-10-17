#!/usr/bin/env bash
# One-time cleanup after copying the reorganized project into the existing Git checkout.
# Does not touch .git, Wrangler settings, Number Match's hosted game, or saved game data.
set -euo pipefail
cd "$(dirname "$0")/.."
for required in public/country/app.js src/country/game-room.js tests/test-server.mjs; do
  if [[ ! -f "$required" ]]; then
    echo "Missing new file: $required. Stopping without deleting anything." >&2
    exit 1
  fi
done
obsolete=(
  public/app.js public/styles.css public/questions.js src/questions.js
  base_questions.json lyric_snippets.json lyric_upgrades.json
  extra_hits.py extra_details.py build_questions.py make_questions.py build.py
  test-canonical-redirects.mjs test-history.mjs test-leaderboard.mjs
  test-routing.mjs test-server.mjs test-ui.mjs
)
for path in "${obsolete[@]}"; do
  if [[ -f "$path" ]]; then
    rm -- "$path"
    printf 'Moved to organized folders: %s\n' "$path"
  fi
done
echo 'Old layout cleaned. Your Git repository and deployment settings are untouched.'
