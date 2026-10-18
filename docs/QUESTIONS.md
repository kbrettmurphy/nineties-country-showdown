# Country question bank

The game has 939 questions over 912 songs at this revision. There are **two generated copies**:
`src/country/questions.js` for server validation, and
`public/country/questions.js` for the solo browser interface.

Don't hand-edit just one copy. Instead:

1. Edit the source data in `tools/questions/`:
   - `base_questions.json`, `extra_hits.py`, `extra_details.py`: the original bank.
   - `snippets.json`: the reveal lyric for each original question, keyed by question id.
   - `question_fixes.json`: wording corrections to original questions, keyed by id.
   - `new_songs.json`: songs added later, each with its reveal lyric and question type
     (`who`, `finish`, `detail` or `name`).
2. Run `npm run questions:build` (needs Python 3).
3. Run `npm test` and review both changed question files.
4. Commit both generated files together.

**Never remove, reorder or retitle a released song.** Players' no-repeat history is stored
by song topic (derived from the title), and `tests/fixtures/question-topics.json` fails the
build if a released question's id or topic changes. Add new songs to the end of
`new_songs.json`. To correct a released song's title, keep its old topic with a
`"topic"` field on that entry (see “Living in a House of Love”).

Keep songs strictly to 1990–1999 singles and check artist, credit and year. The reveal
lyric should be the line people sing along to — the full line, as sung, so reading it plays
the song in your head — and at most two short lines (25 words). Verify wording against a
lyrics source; song titles and paraphrases are not a substitute.

Finish the Lyric and Name That Song reveals must show the line the question quotes. The build
enforces this: if the snippet doesn't contain the quoted line (plus the answer, for Finish the
Lyric), the reveal becomes that completed line.
