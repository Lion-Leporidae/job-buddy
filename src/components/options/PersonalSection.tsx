import { useState } from 'react';
import { useToast } from '@/src/components/ui/useToast';
import type { Profile, PhoneNumber } from '@/src/types/profile';
import { findCountry } from '@/src/data/countries';
import { SearchableCallingCodeSelect } from './shared/SearchableCallingCodeSelect';
import { ETHNICITIES } from '@/src/data/ethnicities';
import { FormField } from './shared/FormField';
import { saveSection } from './shared/saveSection';
import { SaveButton } from './shared/SaveButton';
import { DateOfBirthPicker } from './shared/DateOfBirthPicker';
import { fieldCls as cls } from './shared/fieldCls';

interface Props {
  profile: Partial<Profile>;
  onSave: (updates: Partial<Profile>) => Promise<void>;
}

const CURRENT_YEAR = new Date().getFullYear();

// ── Backward-compat phone initialiser ──────────────────────────────────────
// Existing stored profiles may have phone as a plain string. Gracefully
// migrate: preserve the number digits in the number field, default to US (+1).
function initPhone(raw: unknown): { country: string; callingCode: string; number: string } {
  if (raw && typeof raw === 'object' && 'countryCode' in (raw as object)) {
    const ph = raw as Partial<PhoneNumber>;
    const country = findCountry(ph.countryCode ?? 'US');
    return {
      country: country.code,
      callingCode: country.callingCode,
      number: ph.number ?? '',
    };
  }
  return {
    country: 'US',
    callingCode: '+1',
    number: typeof raw === 'string' ? raw : '',
  };
}

export function PersonalSection({ profile, onSave }: Props) {
  const p = profile.personal;
  const initPh = initPhone(p?.phone);

  const [form, setForm] = useState({
    firstName: p?.firstName ?? '',
    lastName: p?.lastName ?? '',
    email: p?.email ?? '',
    phoneCountry: initPh.country,
    phoneCallingCode: initPh.callingCode,
    phoneNumber: initPh.number,
    dateOfBirth: p?.dateOfBirth ?? '',
    gender: p?.gender ?? '',
    ethnicity: p?.ethnicity ?? '',
    veteranStatus: p?.veteranStatus ?? '',
    disabilityStatus: p?.disabilityStatus ?? '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { showToast } = useToast();
  const [saving, setSaving] = useState(false);
  // True when DateOfBirthPicker has some-but-not-all of day/month/year filled.
  const [dobIsPartial, setDobIsPartial] = useState(false);

  const fieldError = (key: string, value: string): string => {
    switch (key) {
      case 'firstName': return !value.trim() ? '名字不能为空' : '';
      case 'lastName':  return !value.trim() ? '姓氏不能为空' : '';
      case 'email':
        if (!value.trim()) return '邮箱不能为空';
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return '请输入有效的邮箱地址';
        return '';
      case 'phoneNumber':
        if (!value.trim()) return '手机号码不能为空';
        if (value.length < 4) return '请输入有效的手机号码';
        return '';
      case 'dateOfBirth': {
        if (!value) return '';
        const year = parseInt(value.split('-')[0] ?? '', 10);
        if (year > CURRENT_YEAR) return `出生年份不能晚于 ${CURRENT_YEAR} 年`;
        if (year < CURRENT_YEAR - 100) return `出生年份不能早于 ${CURRENT_YEAR - 100} 年`;
        return '';
      }
      default: return '';
    }
  };

  const set = (key: string, value: string) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => ({ ...e, [key]: fieldError(key, value) }));
  };

  const handleCountryChange = (code: string) => {
    const country = findCountry(code);
    setForm((f) => ({
      ...f,
      phoneCountry: country.code,
      phoneCallingCode: country.callingCode,
    }));
    if (errors.phoneNumber) setErrors((e) => ({ ...e, phoneNumber: '' }));
  };

  const handlePhoneNumberChange = (value: string) => {
    // Strip anything that isn't a digit
    set('phoneNumber', value.replace(/\D/g, ''));
  };

  // Blur handler: validates the current stored value so that focusing a
  // required field and leaving it blank (without typing) still shows an error.
  const handleBlur = (key: string) => {
    setErrors((e) => ({ ...e, [key]: fieldError(key, (form as Record<string, string>)[key] ?? '') }));
  };

  const validate = () => {
    const e: Record<string, string> = {};

    if (!form.firstName.trim()) e.firstName = '名字不能为空';
    else if (form.firstName.length > 100) e.firstName = '名字不能超过 100 个字符';

    if (!form.lastName.trim()) e.lastName = '姓氏不能为空';
    else if (form.lastName.length > 100) e.lastName = '姓氏不能超过 100 个字符';

    if (!form.email.trim()) e.email = '邮箱不能为空';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) e.email = '请输入有效的邮箱地址';
    else if (form.email.length > 254) e.email = '邮箱不能超过 254 个字符';

    if (!form.phoneNumber.trim()) {
      e.phoneNumber = '手机号码不能为空';
    } else if (form.phoneNumber.length < 4) {
      e.phoneNumber = '请输入有效的手机号码';
    }

    if (form.dateOfBirth) {
      const year = parseInt(form.dateOfBirth.split('-')[0] ?? '', 10);
      if (!isNaN(year)) {
        if (year > CURRENT_YEAR) e.dateOfBirth = `出生年份不能晚于 ${CURRENT_YEAR} 年`;
        else if (year < CURRENT_YEAR - 100) e.dateOfBirth = `出生年份不能早于 ${CURRENT_YEAR - 100} 年`;
      }
    } else if (dobIsPartial) {
      // Partial DOB: range errors take precedence (set above); only fill in
      // the partial-completion message if nothing more specific applies.
      e.dateOfBirth = '请完整填写年、月、日，或全部留空';
    }

    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSave = async () => {
    if (!validate()) return;
    setSaving(true);
    await saveSection(onSave, {
      personal: {
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        email: form.email.trim(),
        phone: {
          countryCode: form.phoneCountry,
          callingCode: form.phoneCallingCode,
          number: form.phoneNumber.trim(),
        },
        dateOfBirth: form.dateOfBirth || undefined,
        gender: form.gender || undefined,
        ethnicity: form.ethnicity || undefined,
        veteranStatus: form.veteranStatus || undefined,
        disabilityStatus: form.disabilityStatus || undefined,
      },
      }, showToast, '基本信息已保存');
    setSaving(false);
  };

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">基本信息</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">填写求职申请中常用的基本个人信息</p>
      </div>

      {/* Name */}
      <div className="grid grid-cols-2 gap-4">
        <FormField label="名" required error={errors.firstName}>
          <input
            className={cls(errors.firstName)}
            value={form.firstName}
            onChange={(e) => set('firstName', e.target.value)}
            onBlur={() => handleBlur('firstName')}
            id="field-firstName"
            placeholder="John"
            maxLength={100}
          />
        </FormField>
        <FormField label="姓" required error={errors.lastName}>
          <input
            className={cls(errors.lastName)}
            value={form.lastName}
            onChange={(e) => set('lastName', e.target.value)}
            onBlur={() => handleBlur('lastName')}
            id="field-lastName"
            placeholder="Smith"
            maxLength={100}
          />
        </FormField>
      </div>

      {/* Email */}
      <FormField label="邮箱" required error={errors.email}>
        <input
          type="email"
          className={cls(errors.email)}
          value={form.email}
          onChange={(e) => set('email', e.target.value)}
          onBlur={() => handleBlur('email')}
          id="field-email"
          placeholder="john.smith@example.com"
          maxLength={254}
        />
      </FormField>

      {/* Phone — searchable country selector + number input */}
      <FormField label="手机号码" required error={errors.phoneNumber}>
        <div
          className={`flex items-stretch rounded-lg border ${
            errors.phoneNumber ? 'border-red-300 dark:border-red-500' : 'border-gray-300 dark:border-gray-600'
          } focus-within:ring-2 ${
            errors.phoneNumber ? 'focus-within:ring-red-500' : 'focus-within:ring-blue-500'
          } focus-within:border-transparent`}
        >
          <SearchableCallingCodeSelect
            value={form.phoneCountry}
            onChange={handleCountryChange}
          />
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={15}
            className="rounded-r-lg flex-1 px-3 py-2 text-sm focus:outline-none bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
            value={form.phoneNumber}
            onChange={(e) => handlePhoneNumberChange(e.target.value)}
            onBlur={() => handleBlur('phoneNumber')}
            id="field-phone"
            placeholder="5551234567"
          />
        </div>
      </FormField>

      {/* Date of Birth */}
      <FormField
        label="出生日期"
        error={errors.dateOfBirth}
      >
        <DateOfBirthPicker
          id="field-dateOfBirth"
          value={form.dateOfBirth}
          onChange={(v) => set('dateOfBirth', v)}
          onPartialChange={(partial) => {
            setDobIsPartial(partial);
            // Live feedback: surface or clear the partial-completion error as
            // the user types, but don't stomp on more specific range errors.
            setErrors((e) => {
              const existing = e.dateOfBirth;
              if (partial) {
                if (!existing) return { ...e, dateOfBirth: '请完整填写年、月、日，或全部留空' };
                return e;
              }
              if (existing === '请完整填写年、月、日，或全部留空') {
                return { ...e, dateOfBirth: '' };
              }
              return e;
            });
          }}
          error={errors.dateOfBirth}
        />
      </FormField>

      {/* Gender & Ethnicity */}
      <div className="grid grid-cols-2 gap-4">
        <FormField label="性别">
          <select
            id="field-gender"
            className={cls()}
            value={form.gender}
            onChange={(e) => set('gender', e.target.value)}
          >
            <option value="">请选择性别…</option>
            <option value="male">男</option>
            <option value="female">女</option>
            <option value="other">其他</option>
            <option value="prefer_not_to_say">不愿透露</option>
          </select>
        </FormField>

        <FormField label="民族 / 族裔">
          <select
            id="field-ethnicity"
            className={cls()}
            value={form.ethnicity}
            onChange={(e) => set('ethnicity', e.target.value)}
          >
            <option value="">请选择民族 / 族裔…</option>
            {ETHNICITIES.map((eth) => (
              <option key={eth} value={eth}>
                {eth}
              </option>
            ))}
            <option value="prefer_not_to_say">不愿透露</option>
          </select>
        </FormField>
      </div>

      {/* Veteran & Disability */}
      <div className="grid grid-cols-2 gap-4">
        <FormField label="退役军人状态">
          <select
            id="field-veteranStatus"
            className={cls()}
            value={form.veteranStatus}
            onChange={(e) => set('veteranStatus', e.target.value)}
          >
            <option value="">请选择退役军人状态…</option>
            <option value="yes">是</option>
            <option value="no">否</option>
            <option value="prefer_not_to_say">不愿透露</option>
          </select>
        </FormField>
        <FormField label="残障状态">
          <select
            id="field-disabilityStatus"
            className={cls()}
            value={form.disabilityStatus}
            onChange={(e) => set('disabilityStatus', e.target.value)}
          >
            <option value="">请选择残障状态…</option>
            <option value="yes">是</option>
            <option value="no">否</option>
            <option value="prefer_not_to_say">不愿透露</option>
          </select>
        </FormField>
      </div>

      <div className="mt-6 pt-4 border-t border-gray-200 dark:border-gray-700 flex items-center gap-3">
        <SaveButton onClick={handleSave} saving={saving} label="保存基本信息" />
      </div>
    </div>
  );
}
