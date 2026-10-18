// The question picker, shared by the server (solo and multiplayer rooms) and the browser
// (party mode and offline play), so both build games the same way.
// Loaded as a plain script in the browser (window.HonkyPicker) and imported on the server.
(function (root) {
  'use strict';
  root.HonkyPicker = {
    create(QUESTIONS) {
      // Difficulty levels. Each lists how many questions of each tier (1 easy, 2 medium, 3 hard)
      // make up a 10-question game; 20-question games double it. Games play easiest to hardest.
      const LEVELS = {
        beginner: { 1: 7, 2: 3 },
        mixed: { 1: 4, 2: 4, 3: 2 },
        expert: { 2: 3, 3: 7 },
      };
      const DEFAULT_LEVEL = 'mixed';
      const questionById = new Map(QUESTIONS.map((q) => [q.id, q]));
      const ARTIST_OR_TITLE = new Set(['WHO SINGS IT?', 'PICK THE HIT', 'FILL IN THE TITLE']);
      const cleanLevel = (level) => (Object.hasOwn(LEVELS, level) ? level : DEFAULT_LEVEL);
      // Real answers adjust each question's tier from the first one. The starting tier counts as
      // PRIOR_WEIGHT imaginary answers at its typical rate, and every real answer pulls the blend
      // toward what players actually do: two misses drop an easy question to medium, two right
      // answers lift a medium one to easy, and no single answer flips anything.
      const PRIOR_RATE = { 1: 0.8, 2: 0.5, 3: 0.25 };
      const PRIOR_WEIGHT = 6;
      const EASY_AT = 0.62;
      const HARD_BELOW = 0.38;
      const measuredTiers = (rows) => {
        const tiers = new Map();
        for (const r of rows || []) {
          const q = questionById.get(r.question_id);
          if (!q || !(r.answered > 0)) continue;
          const rate =
            (PRIOR_RATE[q.tier || 2] * PRIOR_WEIGHT + r.correct) / (PRIOR_WEIGHT + r.answered);
          tiers.set(q.id, rate >= EASY_AT ? 1 : rate < HARD_BELOW ? 3 : 2);
        }
        return tiers;
      };

      // Play history is a list of question ids, oldest first. Every question is remembered, so the
      // whole bank is played before anything repeats.
      const validIds = new Set(QUESTIONS.map((q) => q.id));
      const HISTORY_LIMIT = QUESTIONS.length;
      const cleanHistory = (value) =>
        Array.isArray(value)
          ? [...new Set(value.filter((id) => Number.isInteger(id) && validIds.has(id)))].slice(
              -HISTORY_LIMIT,
            )
          : [];
      // History used to be kept per song. A song heard before the switch counts all of its questions
      // from that time as played; questions added later are new.
      const LEGACY_LAST_ID = 939;
      const legacyIdsByTopic = new Map();
      for (const q of QUESTIONS) {
        if (q.id > LEGACY_LAST_ID) continue;
        if (!legacyIdsByTopic.has(q.topic)) legacyIdsByTopic.set(q.topic, []);
        legacyIdsByTopic.get(q.topic).push(q.id);
      }
      const fromLegacyTopics = (topics) =>
        Array.isArray(topics)
          ? cleanHistory(
              topics.flatMap((t) => (typeof t === 'string' && legacyIdsByTopic.get(t)) || []),
            )
          : [];

      const shuffle = (array) => {
        for (let i = array.length - 1; i > 0; i--) {
          const bytes = new Uint32Array(1);
          crypto.getRandomValues(bytes);
          const j = bytes[0] % (i + 1);
          [array[i], array[j]] = [array[j], array[i]];
        }
        return array;
      };
      // Tier counts for a game, scaled from the 10-question recipe.
      const levelSlots = (level, count) => {
        const recipe = LEVELS[cleanLevel(level)];
        const slots = [];
        for (const [tier, n] of Object.entries(recipe))
          for (let k = 0; k < Math.round((n * count) / 10); k++) slots.push(Number(tier));
        while (slots.length < count) slots.push(slots.at(-1));
        return slots.slice(0, count);
      };
      // Picks a game's questions and returns their indexes in QUESTIONS, easiest first.
      // Preference: songs never heard, then new questions on songs heard longest ago, then (only once
      // everything is used up) questions already seen, oldest first. Each slot tries its own tier,
      // then the nearest tiers, before falling back a step. Never two questions on one song.
      const pickQuestions = (count, history = [], options = {}) => {
        const level = cleanLevel(options.level);
        const tiers = options.tiers instanceof Map ? options.tiers : new Map();
        const past = cleanHistory(history);
        const seenAt = new Map(past.map((id, i) => [id, i]));
        const songHeardAt = new Map();
        for (const id of past) songHeardAt.set(questionById.get(id).topic, seenAt.get(id));
        // buckets[priority][tier] = candidates in preference order
        const buckets = [0, 1, 2].map(() => ({ 1: [], 2: [], 3: [] }));
        for (const [i, q] of shuffle(QUESTIONS.map((q, i) => [i, q]))) {
          const tier = tiers.get(q.id) || q.tier || 2;
          const priority = !songHeardAt.has(q.topic) ? 0 : !seenAt.has(q.id) ? 1 : 2;
          buckets[priority][tier].push({ i, q });
        }
        for (const byTier of [buckets[1], buckets[2]])
          for (const list of Object.values(byTier))
            list.sort((a, b) =>
              byTier === buckets[1]
                ? songHeardAt.get(a.q.topic) - songHeardAt.get(b.q.topic)
                : seenAt.get(a.q.id) - seenAt.get(b.q.id),
            );
        const nearest = (tier) =>
          [1, 2, 3].sort(
            (a, b) =>
              Math.abs(a - tier) - Math.abs(b - tier) || (level === 'expert' ? b - a : a - b),
          );
        // Lyric-driven questions (everything but the artist/title ones) get up to 40% of a game.
        // Slots fill hardest first so those harder question types land in the later questions,
        // not the warm-up; the game is sorted easiest first afterwards.
        const detailQuota = Math.ceil(count * 0.4);
        const picked = [],
          usedSongs = new Set();
        let details = 0;
        const take = (list) => {
          const open = list.filter((x) => !usedSongs.has(x.q.topic));
          if (!open.length) return null;
          const isDetail = (x) => !ARTIST_OR_TITLE.has(x.q.category);
          return (
            (details < detailQuota && open.find(isDetail)) ||
            open.find((x) => !isDetail(x)) ||
            open[0]
          );
        };
        for (const target of levelSlots(level, count).reverse()) {
          let choice = null;
          for (const tier of nearest(target)) {
            for (const priority of [0, 1]) choice ||= take(buckets[priority][tier]);
            if (choice) break;
          }
          for (const tier of nearest(target)) choice ||= take(buckets[2][tier]);
          if (!choice) break;
          usedSongs.add(choice.q.topic);
          if (!ARTIST_OR_TITLE.has(choice.q.category)) details++;
          picked.push({ ...choice, tier: tiers.get(choice.q.id) || choice.q.tier || 2 });
        }
        return shuffle(picked)
          .sort((a, b) => a.tier - b.tier)
          .map((x) => x.i);
      };
      return {
        LEVELS,
        DEFAULT_LEVEL,
        HISTORY_LIMIT,
        cleanLevel,
        measuredTiers,
        cleanHistory,
        fromLegacyTopics,
        pickQuestions,
      };
    },
  };
})(typeof window !== 'undefined' ? window : globalThis);
