import { describe, expect, it } from 'vitest';
import { deriveHighestEducation } from './highestEducation';

describe('deriveHighestEducation', () => {
  it('selects the highest recognized education level', () => {
    expect(deriveHighestEducation([
      { institution: 'A', degree: '本科', fieldOfStudy: '计算机', startDate: '2018' },
      { institution: 'B', degree: 'Master of Science', fieldOfStudy: 'AI', startDate: '2022' },
    ])).toBe('硕士');
  });

  it('returns empty when no degree level can be recognized', () => {
    expect(deriveHighestEducation([
      { institution: 'A', degree: '课程学习', fieldOfStudy: '计算机', startDate: '2020' },
    ])).toBe('');
  });
});
