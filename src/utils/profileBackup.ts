import type { Profile, DocumentFile } from '../types/profile';
import type { DomesticProfile } from '../types/domesticProfile';
import { EMPTY_DOMESTIC_PROFILE, normalizeDomesticProfile } from '../types/domesticProfile';
import type { ApplicationEntry, LearnedMappings } from '../types/storage';

export interface ProfileBackup {
  _comment: string;
  version: '2.0';
  profileId?: string;
  exportedAt: string;
  profile: Profile | null;
  domesticProfile: DomesticProfile;
  learnedMappings: LearnedMappings;
  applicationHistory: ApplicationEntry[];
}

interface BuildProfileBackupInput {
  profile: Profile | null;
  domesticProfile: DomesticProfile;
  learnedMappings: LearnedMappings;
  applicationHistory: ApplicationEntry[];
  exportedAt?: string;
}

export function buildProfileBackup(input: BuildProfileBackupInput): ProfileBackup {
  return {
    _comment:
      'Job Buddy 完整个人资料备份，包含身份证号和附件等敏感信息，但不包含任何 API Key 或登录令牌。',
    version: '2.0',
    ...(input.profile?.id && { profileId: input.profile.id }),
    exportedAt: input.exportedAt ?? new Date().toISOString(),
    profile: input.profile,
    domesticProfile: input.domesticProfile,
    learnedMappings: input.learnedMappings,
    applicationHistory: input.applicationHistory,
  };
}

export function hasDomesticProfileData(profile: DomesticProfile): boolean {
  return JSON.stringify(profile) !== JSON.stringify(EMPTY_DOMESTIC_PROFILE);
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function documentFile(value: unknown): DocumentFile | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.name !== 'string' ||
    typeof candidate.size !== 'number' ||
    !Number.isFinite(candidate.size) ||
    typeof candidate.base64 !== 'string'
  ) {
    return undefined;
  }
  return { name: candidate.name, size: candidate.size, base64: candidate.base64 };
}

/** Accepts only known domestic-profile fields from an untrusted backup. */
export function sanitizeDomesticProfileBackup(value: unknown): DomesticProfile | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const nativePlace = (raw.nativePlace ?? {}) as Record<string, unknown>;
  const household = (raw.householdRegistration ?? {}) as Record<string, unknown>;
  const studentOrigin = (raw.studentOrigin ?? {}) as Record<string, unknown>;
  const emergency = (raw.emergencyContact ?? {}) as Record<string, unknown>;

  return normalizeDomesticProfile({
    nativePlace: {
      province: stringValue(nativePlace.province),
      city: stringValue(nativePlace.city),
    },
    politicalStatus: stringValue(raw.politicalStatus),
    maritalStatus: stringValue(raw.maritalStatus),
    householdRegistration: {
      province: stringValue(household.province),
      city: stringValue(household.city),
    },
    studentOrigin: {
      province: stringValue(studentOrigin.province),
      city: stringValue(studentOrigin.city),
    },
    heightCm: optionalNumber(raw.heightCm),
    weightKg: optionalNumber(raw.weightKg),
    qq: stringValue(raw.qq),
    wechat: stringValue(raw.wechat),
    nationalId: stringValue(raw.nationalId),
    emergencyContact: {
      name: stringValue(emergency.name),
      relationship: stringValue(emergency.relationship),
      phone: stringValue(emergency.phone),
    },
    photo: documentFile(raw.photo),
  });
}
