import type { AIConfig, AIFieldPayload, AIFieldResponse, AIPagePlan, AIPageSnapshot, KeyValidationResult } from './types';
import { toGeminiModel } from './types';
import { planPageWithGemini, resolveFieldsWithAI, validateApiKey as validateGeminiApiKey } from './gemini';
import { planPageWithDeepSeek, resolveFieldsWithDeepSeek, validateDeepSeekApiKey } from './deepseek';
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

function leafPaths(value: unknown, prefix = ''): string[] {
  if (value == null) return [];
  if (typeof value !== 'object') return prefix ? [prefix] : [];
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => leafPaths(item, prefix ? `${prefix}.${index}` : String(index)));
  }
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    leafPaths(child, prefix ? `${prefix}.${key}` : key),
  );
}

function virtualPaths(profile: object): string[] {
  const source = profile as {
    projects?: unknown[];
    workHistory?: unknown[];
    education?: unknown[];
    awards?: unknown[];
  };
  const paths = [
    'derived.fullName.zh',
    'personal.phone.full',
    'address.countryName',
    'derived.highestEducation',
    'projects.formatted',
    'awards.formatted',
    'domestic.nativePlace.full',
    'domestic.householdRegistration.full',
    'domestic.studentOrigin.full',
  ];
  source.projects?.forEach((_, index) => paths.push(
    `projects.${index}.description.summary`,
    `projects.${index}.description.responsibilities`,
    `projects.${index}.startDate.formatted`,
    `projects.${index}.endDate.formatted`,
  ));
  source.workHistory?.forEach((_, index) => paths.push(
    `workHistory.${index}.startDate.formatted`,
    `workHistory.${index}.endDate.formatted`,
  ));
  source.education?.forEach((_, index) => paths.push(
    `education.${index}.startDate.formatted`,
    `education.${index}.endDate.formatted`,
  ));
  source.awards?.forEach((_, index) => paths.push(`awards.${index}.date.formatted`));
  return paths;
}

export function planPageWithProvider(
  config: AIConfig,
  snapshot: AIPageSnapshot,
  profile: object,
): Promise<AIPagePlan> {
  const fields: AIFieldPayload[] = snapshot.fields.map((field) => ({
    fieldId: field.fieldId,
    type: field.type,
    label: field.label,
    ...(field.placeholder && { placeholder: field.placeholder }),
    ...(field.name && { name: field.name }),
    ...(field.nearbyText && { nearbyText: field.nearbyText }),
    ...(field.options && { options: field.options }),
  }));
  const compactProfile = buildEconomyProfile(profile, compactAIFields(fields));
  const allowedProfilePaths = [...new Set([...leafPaths(compactProfile), ...virtualPaths(compactProfile)])];
  return config.provider === 'deepseek'
    ? planPageWithDeepSeek(config.apiKey, config.model, snapshot, compactProfile, allowedProfilePaths)
    : planPageWithGemini(config.apiKey, toGeminiModel(config.model), snapshot, compactProfile, allowedProfilePaths);
}
