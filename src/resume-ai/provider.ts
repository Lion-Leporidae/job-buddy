import type { AIConfig, AIFieldPayload, AIFieldResponse, KeyValidationResult } from './types';
import { toGeminiModel } from './types';
import { resolveFieldsWithAI, validateApiKey as validateGeminiApiKey } from './gemini';
import { resolveFieldsWithDeepSeek, validateDeepSeekApiKey } from './deepseek';
import { buildEconomyProfile, compactAIFields } from './economy';

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
  const compactFields = compactAIFields(fields);
  const compactProfile = buildEconomyProfile(profile, compactFields);
  return config.provider === 'deepseek'
    ? resolveFieldsWithDeepSeek(config.apiKey, config.model, compactFields, compactProfile)
    : resolveFieldsWithAI(config.apiKey, toGeminiModel(config.model), compactFields, compactProfile);
}
