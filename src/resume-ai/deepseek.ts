import type { Profile } from '@/src/types/profile';
import type {
  AIFieldPayload,
  AIFieldResponse,
  DeepSeekModel,
  ImportError,
  KeyValidationResult,
} from './types';
import { DEFAULT_DEEPSEEK_MODEL } from './types';
import { buildPrompt } from './prompt';
import { buildAutofillPrompt } from './autofillPrompt';
import { normalizeExtractedProfile, stripMarkdown } from './normalize';

const DEEPSEEK_BASE = 'https://api.deepseek.com';
const DEEPSEEK_MODELS: DeepSeekModel[] = ['deepseek-v4-flash', 'deepseek-v4-pro'];

function authHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };
}

function importError(code: ImportError['code'], message: string): ImportError {
  return { code, message };
}

function extractText(data: unknown): string | undefined {
  return (
    (data as { choices?: { message?: { content?: string | null } }[] })?.choices?.[0]?.message
      ?.content ?? undefined
  );
}

export async function validateDeepSeekApiKey(apiKey: string): Promise<KeyValidationResult> {
  let response: Response;
  try {
    response = await fetch(`${DEEPSEEK_BASE}/models`, {
      method: 'GET',
      headers: authHeaders(apiKey),
    });
  } catch {
    return { valid: false, error: 'Network error while validating key' };
  }

  if (response.status === 401 || response.status === 403) {
    return { valid: false, error: 'API key invalid', keyInvalid: true };
  }
  if (!response.ok) return { valid: false, error: 'Network error while validating key' };

  try {
    const body = (await response.json()) as { data?: { id?: string }[] };
    const available = new Set((body.data ?? []).map((model) => model.id));
    const model = DEEPSEEK_MODELS.find((candidate) => available.has(candidate));
    if (model) return { valid: true, model };
    return {
      valid: false,
      error: 'No supported model available for this key',
      keyValidNoModel: true,
    };
  } catch {
    return { valid: false, error: 'Could not read the model list' };
  }
}

async function chat(
  apiKey: string,
  model: string,
  prompt: string,
  signal?: AbortSignal,
): Promise<string> {
  let response: Response;
  try {
    response = await fetch(`${DEEPSEEK_BASE}/chat/completions`, {
      method: 'POST',
      headers: authHeaders(apiKey),
      body: JSON.stringify({
        model: model || DEFAULT_DEEPSEEK_MODEL,
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
        thinking: { type: 'disabled' },
        temperature: 0,
        max_tokens: 12_000,
        stream: false,
      }),
      signal,
    });
  } catch (error) {
    if ((error as { name?: string })?.name === 'AbortError') throw error;
    throw importError('network', 'Connection failed. Check your internet.');
  }

  if (response.status === 401 || response.status === 403) {
    throw importError('auth', 'API key invalid. Check your key in Settings.');
  }
  if (response.status === 429) {
    throw importError(
      'rate_limit',
      'DeepSeek rate limit reached. Try again later or check your API balance.',
    );
  }
  if (!response.ok) throw importError('network', `DeepSeek request failed (${response.status}).`);

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw importError('parse', "Couldn't read the response. Try again.");
  }

  const text = extractText(data);
  if (!text) throw importError('parse', "Couldn't read the response. Try again.");
  return text;
}

export async function extractFromResumeWithDeepSeek(
  apiKey: string,
  model: string,
  documentText: string,
  currentProfile: Partial<Profile>,
  signal?: AbortSignal,
  links: string[] = [],
): Promise<Partial<Profile>> {
  const prompt = `${buildPrompt(JSON.stringify(currentProfile, null, 2), links)}\n\nResume text:\n${documentText}`;
  const text = await chat(apiKey, model, prompt, signal);
  try {
    return normalizeExtractedProfile(JSON.parse(stripMarkdown(text)) as Partial<Profile>);
  } catch {
    throw importError('parse', "Couldn't read the response. Try again.");
  }
}

export async function resolveFieldsWithDeepSeek(
  apiKey: string,
  model: string,
  fields: AIFieldPayload[],
  profile: object,
): Promise<AIFieldResponse[]> {
  const prompt = `${buildAutofillPrompt(fields, profile)}\n\nFor JSON mode, return one JSON object with this exact top-level shape: {"fields": [the response items described above]}.`;
  const text = await chat(apiKey, model, prompt);

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripMarkdown(text));
  } catch {
    return [];
  }
  const items = (parsed as { fields?: unknown })?.fields;
  if (!Array.isArray(items)) return [];

  return items.filter((item): item is AIFieldResponse => {
    if (typeof item !== 'object' || item === null) return false;
    const response = item as Record<string, unknown>;
    if (typeof response.fieldId !== 'string' || !response.fieldId) return false;
    return (
      response.confidence === 'high' ||
      response.confidence === 'low' ||
      response.confidence === null
    );
  });
}
