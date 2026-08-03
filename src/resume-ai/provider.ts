import type { AIConfig, AIFieldPayload, AIFieldResponse, KeyValidationResult } from './types';
import { toGeminiModel } from './types';
import { resolveFieldsWithAI, validateApiKey as validateGeminiApiKey } from './gemini';
import { resolveFieldsWithDeepSeek, validateDeepSeekApiKey } from './deepseek';

export function validateProviderApiKey(
  provider: AIConfig['provider'],
  apiKey: string,
): Promise<KeyValidationResult> {
  return provider === 'deepseek' ? validateDeepSeekApiKey(apiKey) : validateGeminiApiKey(apiKey);
}

export function resolveFieldsWithProvider(
  config: AIConfig,
  fields: AIFieldPayload[],
  profile: object,
): Promise<AIFieldResponse[]> {
  return config.provider === 'deepseek'
    ? resolveFieldsWithDeepSeek(config.apiKey, config.model, fields, profile)
    : resolveFieldsWithAI(config.apiKey, toGeminiModel(config.model), fields, profile);
}
