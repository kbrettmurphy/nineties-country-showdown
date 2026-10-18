# Country question bank

The game has 2,489 questions over 1,102 songs at this revision. There are **two generated copies**:
`src/country/questions.js` for server validation, and
`public/country/questions.js` for the solo browser interface.

Don't hand-edit just one copy. Instead:

1. Edit the source data in `tools/questions/`:
   - `base_questions.json`, `extra_hits.py`, `extra_details.py`: the original bank.
   - `snippets.json`: the reveal lyric for each original question, keyed by question id.
   - `question_fixes.json`: wording corrections to original questions, keyed by id.
   - `new_songs.json`: songs added later, each with its reveal lyric and question type
     (`who`, `finish`, `detail` or `name`).
   - `extra_questions.json`: more questions on songs already in the game, and newer songs,
     as `who` (who sings it), `pick` (which of these was this artist's hit) or `title`
     (fill in the title). Each entry stores its own question, right answer and three wrong
     choices, so released questions never change. **Append only.**
   - `song_fame.json`: how big each song was (1 huge, 2 solid hit, 3 deep cut). Every new
     song needs an entry.
2. Run `npm run questions:build` (needs Python 3).
3. Run `npm test` and review both changed question files.
4. Commit both generated files together.

**Never remove, reorder or retitle a released song.** Players' no-repeat history is stored
by question id, and `tests/fixtures/question-topics.json` fails the build if a released
question's id or topic changes. Add new songs to the end of
`new_songs.json`. To correct a released song's title, keep its old topic with a
`"topic"` field on that entry (see “Living in a House of Love”).

Keep songs strictly to 1990–1999 singles and check artist, credit and year. The reveal
lyric should be the line people sing along to — the full line, as sung, so reading it plays
the song in your head — and at most two short lines (25 words). Verify wording against a
lyrics source; song titles and paraphrases are not a substitute.

## Difficulty

Each question gets a starting tier (1 easy, 2 medium, 3 hard) from its song's fame and its
type: artist and title questions follow the fame, lyric questions too, and story-detail
questions sit one step harder. In the game, once a question has 10 real answers its share
answered right takes over: 70% or more is easy, under 40% is hard
(`public/country/picker.js`).

Beginner games are 7 easy + 3 medium, Mixed 4 easy + 4 medium + 2 hard, Expert 3 medium +
7 hard (doubled for 20 questions), played easiest first. Games prefer songs a player has
never heard, then new questions on songs heard longest ago, and repeat a question only once
everything else is used up. When a tier runs dry, the nearest tier fills in.
