const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Scripts written without spaces between words, where "whole word" has no meaning.
const NO_SPACES = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}]/u;

// Pasted copy can hide a banned word in another Unicode form or behind invisible characters; fail closed means seeing through them.
const norm = s => s.normalize('NFKC').replace(/[\u00AD\u200B-\u200D\u2060\uFEFF]/g, '');

// Case-insensitive. Whole-word for spaced languages (letter/number lookarounds, not \b, so accents work);
// plain substring for CJK/Thai terms, where a word-boundary rule would let every banned claim through.
export function findProhibited(text, words) {
  const clean = norm(text);
  return words.filter(w => NO_SPACES.test(w)
    ? clean.includes(norm(w))
    : new RegExp(`(?<![\\p{L}\\p{N}])${escape(norm(w)).replace(/\s+/g, '\\s+')}(?![\\p{L}\\p{N}])`, 'iu').test(clean));
}
