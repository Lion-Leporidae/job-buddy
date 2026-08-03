import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

import { resolveFieldsWithDeepSeek, validateDeepSeekApiKey } from './deepseek';

function response(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  };
}

beforeEach(() => fetchMock.mockReset());

describe('validateDeepSeekApiKey', () => {
  it('selects the default supported model and uses bearer authentication', async () => {
    fetchMock.mockResolvedValueOnce(
      response(200, {
        data: [{ id: 'deepseek-v4-flash' }, { id: 'deepseek-v4-pro' }],
      }),
    );
    await expect(validateDeepSeekApiKey('secret')).resolves.toEqual({
      valid: true,
      model: 'deepseek-v4-flash',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.deepseek.com/models',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer secret' }),
      }),
    );
  });

  it('marks authentication failures as invalid', async () => {
    fetchMock.mockResolvedValueOnce(response(401, {}));
    await expect(validateDeepSeekApiKey('bad')).resolves.toEqual({
      valid: false,
      error: 'API key invalid',
      keyInvalid: true,
    });
  });
});

describe('resolveFieldsWithDeepSeek', () => {
  it('unwraps and validates JSON-mode field responses', async () => {
    fetchMock.mockResolvedValueOnce(
      response(200, {
        choices: [
          {
            message: {
              content: JSON.stringify({
                fields: [
                  { fieldId: 'field_001', profilePath: 'personal.email', confidence: 'high' },
                  { fieldId: '', confidence: 'high' },
                ],
              }),
            },
          },
        ],
      }),
    );

    const result = await resolveFieldsWithDeepSeek(
      'secret',
      'deepseek-v4-flash',
      [{ fieldId: 'field_001', type: 'text', label: 'Email' }],
      { personal: { email: 'a@example.com' } },
    );

    expect(result).toEqual([
      { fieldId: 'field_001', profilePath: 'personal.email', confidence: 'high' },
    ]);
    const request = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(request.body as string)).toMatchObject({
      model: 'deepseek-v4-flash',
      response_format: { type: 'json_object' },
      thinking: { type: 'disabled' },
    });
  });
});
