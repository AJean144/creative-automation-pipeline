const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Scripts written without spaces between words, where "whole word" has no meaning.
const NO_SPACES = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}]/u;

// Case-insensitive. Whole-word for spaced languages (letter/number lookarounds, not \b, so accents work);
// plain substring for CJK/Thai terms, where a word-boundary rule would let every banned claim through.
export function findProhibited(text, words) {
  return words.filter(w => NO_SPACES.test(w)
    ? text.includes(w)
    : new RegExp(`(?<![\\p{L}\\p{N}])${escape(w)}(?![\\p{L}\\p{N}])`, 'iu').test(text));
}
