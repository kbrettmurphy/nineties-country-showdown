import { QUESTIONS } from './questions.js';

const DURATION_MS = 30000;
const REVEAL_MS = 5500;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const questionById = new Map(QUESTIONS.map((q) => [q.id, q]));

const asJson = (data, status = 200) =>
  Response.json(data, {
    status,
    headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
  });
const fail = (message, status = 400) => asJson({ error: message }, status);
const shortName = (name) =>
  typeof name === 'string' ? name.trim().replace(/\s+/g, ' ').slice(0, 24) : '';
const isToken = (token) => typeof token === 'string' && /^[a-zA-Z0-9_-]{16,100}$/.test(token);
const normalizeCode = (s) =>
  String(s || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z2-9]/g, '');
const randomCode = () => {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return [...bytes].map((n) => ALPHABET[n % ALPHABET.length]).join('');
};
const validTopics = new Set(QUESTIONS.map((q) => q.topic));
// Remember every song, so the whole bank is played before anything repeats.
const TOPIC_HISTORY_LIMIT = validTopics.size;
const cleanHistory = (value) =>
  Array.isArray(value)
    ? [
        ...new Set(value.filter((topic) => typeof topic === 'string' && validTopics.has(topic))),
      ].slice(-TOPIC_HISTORY_LIMIT)
    : [];
const pickQuestions = (count, recentTopics = []) => {
  const recent = Array.isArray(recentTopics)
    ? [...new Set(recentTopics.filter((t) => typeof t === 'string' && validTopics.has(t)))]
    : [];
  const seen = new Set(recent);
  const shuffle = (array) => {
    for (let i = array.length - 1; i > 0; i--) {
      const bytes = new Uint32Array(1);
      crypto.getRandomValues(bytes);
      const j = bytes[0] % (i + 1);
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  };
  const pool = shuffle(QUESTIONS.map((q, i) => ({ q, i })));
  const fresh = pool.filter((x) => !seen.has(x.q.topic));
  const older = pool
    .filter((x) => seen.has(x.q.topic))
    .sort((a, b) => recent.indexOf(a.q.topic) - recent.indexOf(b.q.topic));
  const selected = [],
    used = new Set();
  const add = (list, limit, predicate) => {
    for (const entry of list) {
      if (selected.length >= limit) break;
      if (used.has(entry.q.topic) || !predicate(entry.q)) continue;
      selected.push(entry.i);
      used.add(entry.q.topic);
    }
  };
  // Lyric-driven questions (everything except plain “who sings it”) get up to 40% of a game.
  const details = (q) => q.category !== 'WHO SINGS IT?';
  add(fresh, Math.ceil(count * 0.4), details);
  add(fresh, count, () => true);
  if (selected.length < count) add(older, count, () => true);
  return shuffle(selected);
};

export {
  QUESTIONS,
  DURATION_MS,
  REVEAL_MS,
  questionById,
  asJson,
  fail,
  shortName,
  isToken,
  normalizeCode,
  randomCode,
  TOPIC_HISTORY_LIMIT,
  cleanHistory,
  pickQuestions,
};
