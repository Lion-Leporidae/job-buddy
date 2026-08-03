import { describe, expect, it } from 'vitest';
import { autofillMaxTokens, buildEconomyProfile, compactAIFields } from './economy';

describe('AI economy mode', () => {
  const profile = {
    personal: { firstName: '小明', email: 'x@example.com' },
    documents: { cv: { file: { name: 'resume.pdf', base64: 'data:application/pdf;base64,SECRET' } } },
    domestic: {
      nationalId: '440000000000000000',
      emergencyContact: { name: '家长', phone: '13800000000' },
      photo: { name: 'photo.png', base64: 'data:image/png;base64,PHOTOSECRET' },
    },
    projects: [{ name: 'A', description: 'x'.repeat(900) }],
  };

  it('permanently removes documents, photo and every base64 payload', () => {
    const value = buildEconomyProfile(profile, [{ fieldId: '1', type: 'text', label: '姓名' }]);
    const json = JSON.stringify(value);
    expect(json).not.toContain('documents');
    expect(json).not.toContain('photo.png');
    expect(json).not.toContain('base64');
    expect(json).not.toContain('SECRET');
  });

  it('only includes high-risk domestic values for explicit matching candidates', () => {
    const normal = JSON.stringify(buildEconomyProfile(profile, [{ fieldId: '1', type: 'text', label: '姓名' }]));
    expect(normal).not.toContain('440000000000000000');
    expect(normal).not.toContain('13800000000');
    const requested = JSON.stringify(buildEconomyProfile(profile, [
      { fieldId: '1', type: 'text', label: '身份证号' },
      { fieldId: '2', type: 'text', label: '紧急联系人电话' },
    ]));
    expect(requested).toContain('440000000000000000');
    expect(requested).toContain('13800000000');
  });

  it('clips long signals, options, arrays and profile strings', () => {
    const fields = compactAIFields([{
      fieldId: '1', type: 'select', label: 'L'.repeat(300), nearbyText: 'N'.repeat(500),
      options: Array.from({ length: 70 }, (_, index) => ({ label: `选项${index}`, value: String(index) })),
    }]);
    expect(fields[0].label.length).toBeLessThanOrEqual(121);
    expect(fields[0].nearbyText!.length).toBeLessThanOrEqual(181);
    expect(fields[0].options).toHaveLength(40);
    const compact = buildEconomyProfile(profile, fields) as typeof profile;
    expect(compact.projects[0].description.length).toBeLessThanOrEqual(601);
  });

  it('uses a bounded field-count-based output budget', () => {
    expect(autofillMaxTokens(0)).toBe(300);
    expect(autofillMaxTokens(10)).toBe(1050);
    expect(autofillMaxTokens(100)).toBe(2500);
  });
});
