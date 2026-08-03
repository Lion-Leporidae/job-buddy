import { describe, it, expect } from 'vitest';
import { buildAutofillPrompt, AUTOFILL_SYSTEM_PROMPT } from './autofillPrompt';

describe('buildAutofillPrompt', () => {
  it('prefixes the system prompt before the fields/profile payload', () => {
    const prompt = buildAutofillPrompt([{ fieldId: 'field_001' }], {
      personal: { firstName: 'Jane' },
    });
    expect(prompt.startsWith(AUTOFILL_SYSTEM_PROMPT)).toBe(true);
  });

  it('embeds the fields and profile as JSON after the system prompt', () => {
    const prompt = buildAutofillPrompt([{ fieldId: 'field_001' }], {
      personal: { firstName: 'Jane' },
    });
    expect(prompt).toContain('"field_001"');
    expect(prompt).toContain('"Jane"');
  });

  it('documents both combined and indexed project paths', () => {
    expect(AUTOFILL_SYSTEM_PROMPT).toContain('projects.formatted');
    expect(AUTOFILL_SYSTEM_PROMPT).toContain('projects.N.name');
  });

  it('documents awards and domestic education paths', () => {
    expect(AUTOFILL_SYSTEM_PROMPT).toContain('awards.formatted');
    expect(AUTOFILL_SYSTEM_PROMPT).toContain('awards.N.name');
    expect(AUTOFILL_SYSTEM_PROMPT).toContain('education.N.institution');
    expect(AUTOFILL_SYSTEM_PROMPT).toContain('educationType');
  });
});
