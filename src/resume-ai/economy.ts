import type { AIFieldPayload, AIOptionPayload } from './types';

const MAX_LABEL = 120;
const MAX_SHORT_SIGNAL = 80;
const MAX_NEARBY = 180;
const MAX_OPTIONS = 40;
const MAX_STRING = 600;
const MAX_ARRAY = 12;

const NATIONAL_ID_RE = /(national\s*id|identity|id\s*card|身份证|证件号码)/i;
const EMERGENCY_RE = /(emergency|紧急联系人|紧急联络)/i;

function clip(value: string | undefined, max: number): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

function compactOption(option: AIOptionPayload): AIOptionPayload {
  return {
    label: clip(option.label, MAX_SHORT_SIGNAL) ?? '',
    value: clip(option.value, MAX_SHORT_SIGNAL) ?? '',
  };
}

export function compactAIFields(fields: AIFieldPayload[]): AIFieldPayload[] {
  return fields.map((field) => {
    const seen = new Set<string>();
    const options = field.options
      ?.map(compactOption)
      .filter((option) => {
        const key = `${option.label}\u0000${option.value}`;
        if ((!option.label && !option.value) || seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, MAX_OPTIONS);
    return {
      fieldId: field.fieldId,
      type: field.type,
      label: clip(field.label, MAX_LABEL) ?? field.fieldId,
      ...(clip(field.placeholder, MAX_SHORT_SIGNAL) && {
        placeholder: clip(field.placeholder, MAX_SHORT_SIGNAL),
      }),
      ...(clip(field.name, MAX_SHORT_SIGNAL) && { name: clip(field.name, MAX_SHORT_SIGNAL) }),
      ...(clip(field.nearbyText, MAX_NEARBY) && {
        nearbyText: clip(field.nearbyText, MAX_NEARBY),
      }),
      ...(options?.length && { options }),
    };
  });
}

function candidateText(fields: AIFieldPayload[]): string {
  return fields
    .flatMap((field) => [field.label, field.placeholder, field.name, field.nearbyText])
    .filter(Boolean)
    .join(' ');
}

function sanitizeValue(
  value: unknown,
  path: string[],
  includeNationalId: boolean,
  includeEmergency: boolean,
): unknown {
  const key = path.at(-1) ?? '';
  if (key.toLowerCase() === 'base64') return undefined;
  if (path[0] === 'documents') return undefined;
  if (path[0] === 'domestic' && path[1] === 'photo') return undefined;
  if (path[0] === 'domestic' && key === 'nationalId' && !includeNationalId) return undefined;
  if (path[0] === 'domestic' && path[1] === 'emergencyContact' && !includeEmergency) {
    return undefined;
  }
  if (typeof value === 'string') return clip(value, MAX_STRING);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (value == null) return undefined;
  if (Array.isArray(value)) {
    const items = value
      .slice(0, MAX_ARRAY)
      .map((item, index) => sanitizeValue(item, [...path, String(index)], includeNationalId, includeEmergency))
      .filter((item) => item !== undefined);
    return items.length ? items : undefined;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .map(([childKey, childValue]) => [
        childKey,
        sanitizeValue(childValue, [...path, childKey], includeNationalId, includeEmergency),
      ] as const)
      .filter(([, childValue]) => childValue !== undefined);
    return entries.length ? Object.fromEntries(entries) : undefined;
  }
  return undefined;
}

export function buildEconomyProfile(profile: object, fields: AIFieldPayload[]): object {
  const text = candidateText(fields);
  return (sanitizeValue(profile, [], NATIONAL_ID_RE.test(text), EMERGENCY_RE.test(text)) as object)
    ?? {};
}

export function autofillMaxTokens(fieldCount: number): number {
  return Math.min(2500, Math.max(300, 150 + Math.max(0, fieldCount) * 90));
}
