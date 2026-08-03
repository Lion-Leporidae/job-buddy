import { useToast } from '@/src/components/ui/useToast';
import { useState, useRef } from 'react';
import type { Profile, CustomLink } from '@/src/types/profile';
import { FormField } from './shared/FormField';
import { RemoveButton } from './shared/RemoveButton';
import { saveSection } from './shared/saveSection';
import { SaveButton } from './shared/SaveButton';
import { AddEntryButton } from './shared/AddEntryButton';
import { fieldCls as cls } from './shared/fieldCls';
import { useScrollToNewEntry } from './shared/useScrollToNewEntry';

interface Props {
  profile: Partial<Profile>;
  onSave: (updates: Partial<Profile>) => Promise<void>;
}

export function LinksSection({ profile, onSave }: Props) {
  const l = profile.links;
  const [form, setForm] = useState({
    linkedin:  l?.linkedin  ?? '',
    portfolio: l?.portfolio ?? '',
  });
  const [custom, setCustom] = useState<CustomLink[]>(l?.custom?.length ? l.custom : [{ label: '', url: '' }]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { showToast } = useToast();
  const [saving, setSaving] = useState(false);

  const [newEntryTick, setNewEntryTick] = useState(0);
  const customContainerRef = useRef<HTMLDivElement>(null);
  useScrollToNewEntry(customContainerRef, newEntryTick);

  const isValidUrl = (url: string): boolean => {
    const normalized = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    try { return new URL(normalized).hostname.includes('.'); } catch { return false; }
  };

  const fieldError = (key: string, value: string): string => {
    if (key === 'linkedin') {
      if (!value.trim()) return 'LinkedIn 链接不能为空';
      if (!value.includes('linkedin.com')) return '请输入有效的 LinkedIn 链接';
    }
    if (key === 'portfolio' && value.trim() && !isValidUrl(value.trim()))
      return '请输入有效链接';
    return '';
  };

  const set = (key: string, value: string) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => ({ ...e, [key]: fieldError(key, value) }));
  };

  const handleBlur = (key: string) => {
    setErrors((e) => ({ ...e, [key]: fieldError(key, (form as Record<string, string>)[key] ?? '') }));
  };

  const updateCustom = (idx: number, key: keyof CustomLink, value: string) => {
    setCustom((rows) => rows.map((r, i) => (i === idx ? { ...r, [key]: value } : r)));
    if (key === 'url') {
      const err = value.trim() && !isValidUrl(value.trim()) ? '请输入有效链接' : '';
      setErrors((e) => ({ ...e, [`custom.${idx}.url`]: err }));
    }
  };

  const handleCustomUrlBlur = (idx: number, url: string) => {
    const err = url.trim() && !isValidUrl(url.trim()) ? '请输入有效链接' : '';
    setErrors((e) => ({ ...e, [`custom.${idx}.url`]: err }));
  };

  const validate = () => {
    const e: Record<string, string> = {};
    if (!form.linkedin.trim()) {
      e.linkedin = 'LinkedIn 链接不能为空';
    } else if (!form.linkedin.includes('linkedin.com')) {
      e.linkedin = '请输入有效的 LinkedIn 链接';
    }
    if (form.portfolio.trim() && !isValidUrl(form.portfolio.trim()))
      e.portfolio = '请输入有效链接';
    custom.forEach((c, idx) => {
      if (c.url.trim() && !isValidUrl(c.url.trim()))
        e[`custom.${idx}.url`] = '请输入有效链接';
    });
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSave = async () => {
    if (!validate()) return;
    setSaving(true);
    await saveSection(onSave, {
      links: {
        linkedin:  form.linkedin.trim(),
        portfolio: form.portfolio || undefined,
        custom:    custom.filter((c) => c.label && c.url),
        // Preserve any IT-specific fields that may exist in older profiles
        github:   l?.github,
        twitter:  l?.twitter,
        dribbble: l?.dribbble,
        behance:  l?.behance,
      },
    }, showToast, '个人链接已保存');
    setSaving(false);
  };

  const PLATFORMS = [
    { key: 'linkedin',  label: 'LinkedIn',   required: true,  placeholder: 'https://www.linkedin.com/in/johnsmith' },
    { key: 'portfolio', label: '个人作品集',   required: false, placeholder: 'https://johnsmith.dev' },
  ] as const;

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">个人链接</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">填写求职时使用的个人主页和作品链接</p>
      </div>

      {PLATFORMS.map(({ key, label, required, placeholder }) => (
        <FormField key={key} label={label} required={required} error={errors[key]}>
          <input
            id={key === 'linkedin' ? 'field-linkedin' : key === 'portfolio' ? 'field-portfolio' : undefined}
            type="url"
            className={cls(errors[key])}
            value={form[key]}
            onChange={(e) => set(key, e.target.value)}
            onBlur={() => handleBlur(key)}
            placeholder={placeholder}
            maxLength={255}
          />
        </FormField>
      ))}

      <div className="mb-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-medium text-gray-700 dark:text-gray-300">自定义链接</p>
          <AddEntryButton
            variant="pill"
            onClick={() => { setCustom((rows) => [...rows, { label: '', url: '' }]); setNewEntryTick((t) => t + 1); }}
            label="+ 添加链接"
          />
        </div>
        <div ref={customContainerRef}>
        {custom.map((c, idx) => (
            <div key={idx} className="p-4 border border-gray-200 dark:border-gray-700 rounded-lg mb-3">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-medium text-gray-600 dark:text-gray-400">链接 {idx + 1}</span>
                <RemoveButton onClick={() => setCustom((rows) => rows.filter((_, i) => i !== idx))} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <FormField label="名称">
                  <input
                    className={cls()}
                    value={c.label}
                    onChange={(e) => updateCustom(idx, 'label', e.target.value)}
                    placeholder="例如：个人博客"
                    maxLength={100}
                  />
                </FormField>
                <FormField label="URL" error={errors[`custom.${idx}.url`]}>
                  <input
                    type="url"
                    className={cls(errors[`custom.${idx}.url`])}
                    value={c.url}
                    onChange={(e) => updateCustom(idx, 'url', e.target.value)}
                    onBlur={(e) => handleCustomUrlBlur(idx, e.target.value)}
                    placeholder="https://blog.johnsmith.dev"
                    maxLength={255}
                  />
                </FormField>
              </div>
            </div>
          ))}
        </div>{/* customContainerRef */}
      </div>

      <div className="mt-2 pt-4 border-t border-gray-200 dark:border-gray-700 flex items-center gap-3">
        <SaveButton onClick={handleSave} saving={saving} label="保存个人链接" />
      </div>
    </div>
  );
}
