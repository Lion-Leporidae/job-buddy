import { describe, expect, it } from 'vitest';
import { EMPTY_DOMESTIC_PROFILE } from '../types/domesticProfile';
import {
  buildProfileBackup,
  hasDomesticProfileData,
  sanitizeDomesticProfileBackup,
} from './profileBackup';

describe('complete profile backups', () => {
  it('exports all recruiting data and attachments without credentials', () => {
    const backup = buildProfileBackup({
      profile: {
        id: 'profile-1',
        documents: {
          cv: { file: { name: 'resume.pdf', size: 12, base64: 'data:application/pdf;base64,AA==' } },
        },
      } as never,
      domesticProfile: {
        ...EMPTY_DOMESTIC_PROFILE,
        nationalId: '440500200001011234',
        wechat: 'candidate-wechat',
        photo: { name: 'photo.png', size: 10, base64: 'data:image/png;base64,AA==' },
      },
      learnedMappings: { 'jobs.example': { name: 'personal.firstName' } },
      applicationHistory: [{ id: 'application-1' }] as never,
      exportedAt: '2026-08-04T00:00:00.000Z',
    });

    const json = JSON.stringify(backup);
    expect(backup.version).toBe('2.0');
    expect(backup.domesticProfile.nationalId).toBe('440500200001011234');
    expect(backup.domesticProfile.photo?.base64).toContain('base64');
    expect(backup.profile?.documents.cv.file?.name).toBe('resume.pdf');
    expect(json).not.toContain('deepseekApiKey');
    expect(json).not.toContain('geminiApiKey');
    expect(json).not.toContain('driveToken');
  });

  it('supports a domestic-only backup', () => {
    const backup = buildProfileBackup({
      profile: null,
      domesticProfile: { ...EMPTY_DOMESTIC_PROFILE, qq: '123456' },
      learnedMappings: {},
      applicationHistory: [],
    });
    expect(backup.profile).toBeNull();
    expect(backup.domesticProfile.qq).toBe('123456');
    expect(hasDomesticProfileData(backup.domesticProfile)).toBe(true);
    expect(hasDomesticProfileData(EMPTY_DOMESTIC_PROFILE)).toBe(false);
  });

  it('sanitizes imported domestic data and drops unknown or malformed values', () => {
    const restored = sanitizeDomesticProfileBackup({
      nativePlace: { province: '广东省', city: '汕头市', injected: 'no' },
      nationalId: '440500200001011234',
      heightCm: '180',
      emergencyContact: { name: '张女士', phone: '13800000000', extra: 'no' },
      photo: { name: 'photo.png', size: 10, base64: 'data:image/png;base64,AA==', extra: 'no' },
      unknownSecret: 'no',
    });

    expect(restored?.nativePlace).toEqual({ province: '广东省', city: '汕头市' });
    expect(restored?.heightCm).toBeUndefined();
    expect(restored?.emergencyContact).toEqual({
      name: '张女士',
      relationship: '',
      phone: '13800000000',
    });
    expect(restored?.photo).toEqual({
      name: 'photo.png',
      size: 10,
      base64: 'data:image/png;base64,AA==',
    });
    expect(restored).not.toHaveProperty('unknownSecret');
  });

  it('keeps old backups compatible by treating missing domestic data as absent', () => {
    expect(sanitizeDomesticProfileBackup(undefined)).toBeUndefined();
  });
});
