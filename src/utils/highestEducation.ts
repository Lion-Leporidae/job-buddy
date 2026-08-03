import type { EducationEntry } from '../types/profile';

const LEVELS: { label: string; score: number; patterns: RegExp[] }[] = [
  { label: '博士', score: 6, patterns: [/博士/i, /ph\.?d/i, /doctor/i] },
  { label: '硕士', score: 5, patterns: [/硕士/i, /master/i, /m\.?sc/i, /m\.?eng/i, /mba/i] },
  { label: '本科', score: 4, patterns: [/本科/i, /学士/i, /bachelor/i, /b\.?sc/i, /b\.?eng/i] },
  { label: '大专', score: 3, patterns: [/大专/i, /专科/i, /associate/i, /diploma/i] },
  { label: '高中', score: 2, patterns: [/高中/i, /high school/i] },
  { label: '中专/中职', score: 1, patterns: [/中专/i, /中职/i, /secondary vocational/i] },
];

export function deriveHighestEducation(education: EducationEntry[] = []): string {
  let best: { label: string; score: number } | undefined;
  for (const entry of education) {
    const text = `${entry.degree ?? ''} ${entry.fieldOfStudy ?? ''}`;
    const match = LEVELS.find((level) => level.patterns.some((pattern) => pattern.test(text)));
    if (match && (!best || match.score > best.score)) best = match;
  }
  return best?.label ?? '';
}
