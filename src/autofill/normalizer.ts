import { distance } from 'fastest-levenshtein';

export function normalize(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

export function similarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - distance(a, b) / maxLen;
}

// Normalised texts of common placeholder / sentinel options that indicate
// "no selection" and should be skipped when filling or extracting options.
export const PLACEHOLDER_OPTION_NORMS = new Set([
  '请选择', '选择',
  'pleaseselect', 'select', 'selectone', 'choose', 'chooseone',
]);
