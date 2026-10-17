# Country question bank

The game has 454 questions at this revision. There are **two generated copies**:
`src/country/questions.js` for server validation, and
`public/country/questions.js` for the solo browser interface.

Don't hand-edit just one copy. Instead:

1. Review `tools/questions/base_questions.json` for original lyric/deep-cut items.
2. Review `tools/questions/extra_hits.py`, `extra_details.py`, and
   `lyric_upgrades.json` for additional recordings, questions and lyric excerpts.
3. Run `npm run questions:build` (needs Python 3).
4. Run `npm test` and review both changed question files.
5. Commit and push both generated files together.

Keep questions strictly within 1990–1999, check artist/album/year, and keep
excerpts short, accurate and attributed. Song titles and personal interpretations
are not a substitute for verified lyric text.
