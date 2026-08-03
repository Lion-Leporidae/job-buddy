export interface ChinaRegion {
  province: string;
  city: string;
}

export interface DomesticProfile {
  nativePlace: ChinaRegion;
  politicalStatus: string;
  maritalStatus: string;
  householdRegistration: ChinaRegion;
  studentOrigin: ChinaRegion;
  heightCm?: number;
  weightKg?: number;
  qq: string;
  wechat: string;
  nationalId: string;
  emergencyContact: {
    name: string;
    relationship: string;
    phone: string;
  };
  /** Local-only job application portrait; excluded from exports and Drive sync. */
  photo?: DocumentFile;
}

export const EMPTY_DOMESTIC_PROFILE: DomesticProfile = {
  nativePlace: { province: '', city: '' },
  politicalStatus: '',
  maritalStatus: '',
  householdRegistration: { province: '', city: '' },
  studentOrigin: { province: '', city: '' },
  qq: '',
  wechat: '',
  nationalId: '',
  emergencyContact: { name: '', relationship: '', phone: '' },
};

export function normalizeDomesticProfile(value?: Partial<DomesticProfile> | null): DomesticProfile {
  return {
    nativePlace: { ...EMPTY_DOMESTIC_PROFILE.nativePlace, ...value?.nativePlace },
    politicalStatus: value?.politicalStatus ?? '',
    maritalStatus: value?.maritalStatus ?? '',
    householdRegistration: {
      ...EMPTY_DOMESTIC_PROFILE.householdRegistration,
      ...value?.householdRegistration,
    },
    studentOrigin: { ...EMPTY_DOMESTIC_PROFILE.studentOrigin, ...value?.studentOrigin },
    heightCm: value?.heightCm,
    weightKg: value?.weightKg,
    qq: value?.qq ?? '',
    wechat: value?.wechat ?? '',
    nationalId: value?.nationalId ?? '',
    emergencyContact: {
      ...EMPTY_DOMESTIC_PROFILE.emergencyContact,
      ...value?.emergencyContact,
    },
    photo: value?.photo,
  };
}
import type { DocumentFile } from './profile';
