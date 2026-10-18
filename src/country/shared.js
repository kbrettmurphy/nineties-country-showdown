import { QUESTIONS } from './questions.js';
import '../../public/country/picker.js';

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
const {
  LEVELS,
  DEFAULT_LEVEL,
  HISTORY_LIMIT,
  cleanLevel,
  measuredTiers,
  cleanHistory,
  fromLegacyTopics,
  pickQuestions,
} = globalThis.HonkyPicker.create(QUESTIONS);

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
  HISTORY_LIMIT,
  LEVELS,
  DEFAULT_LEVEL,
  cleanLevel,
  measuredTiers,
  cleanHistory,
  fromLegacyTopics,
  pickQuestions,
};
