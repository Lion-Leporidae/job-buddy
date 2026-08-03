import { useRef, useState } from 'react';
import { useToast } from '@/src/components/ui/useToast';
import type { AwardEntry, Profile } from '@/src/types/profile';
import { AddEntryButton } from './shared/AddEntryButton';
import { ExpandableCard } from './shared/ExpandableCard';
import { fieldCls as cls } from './shared/fieldCls';
import { FormField } from './shared/FormField';
import { MonthYearPicker } from './shared/MonthYearPicker';
import { SaveButton } from './shared/SaveButton';
import { saveSection } from './shared/saveSection';
import { useScrollToNewEntry } from './shared/useScrollToNewEntry';

interface Props {
  profile: Partial<Profile>;
  onSave: (updates: Partial<Profile>) => Promise<void>;
}

type LocalAward = AwardEntry & { localId: string };

const emptyAward = (): LocalAward => ({
  localId: crypto.randomUUID(),
  name: '',
  date: '',
  description: '',
});

const initAward = (award: AwardEntry): LocalAward => ({
  ...award,
  localId: crypto.randomUUID(),
  date: award.date ?? '',
  description: award.description ?? '',
});

export function AwardsSection({ profile, onSave }: Props) {
  const [entries, setEntries] = useState<LocalAward[]>((profile.awards ?? []).map(initAward));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [newEntryTick, setNewEntryTick] = useState(0);
  const entriesContainerRef = useRef<HTMLDivElement>(null);
  const { showToast } = useToast();
  useScrollToNewEntry(entriesContainerRef, newEntryTick);

  const update = (index: number, key: keyof AwardEntry, value: string) => {
    setEntries((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, [key]: value } : row));
    setErrors((current) => ({ ...current, [`${index}.${key}`]: '' }));
  };

  const validate = () => {
    const next: Record<string, string> = {};
    entries.forEach((entry, index) => {
      if (!entry.name.trim()) next[`${index}.name`] = '获奖项不能为空';
      if (entry.date && !/^\d{4}(?:-(?:0[1-9]|1[0-2]))?$/.test(entry.date)) {
        next[`${index}.date`] = '时间格式应为年份或年月';
      }
    });
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSave = async () => {
    if (!validate()) return;
    setSaving(true);
    await saveSection(onSave, {
      awards: entries.map((entry) => ({
        name: entry.name.trim(),
        date: entry.date || undefined,
        description: entry.description?.trim() || undefined,
      })),
    }, showToast, '获奖情况已保存');
    setSaving(false);
  };

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">获奖情况</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">按简历顺序填写奖项，自动填写时会按招聘页顺序逐项匹配。</p>
      </div>
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm text-gray-600 dark:text-gray-400">获奖经历为选填项。</p>
        <AddEntryButton variant="pill" onClick={() => { setEntries((rows) => [...rows, emptyAward()]); setNewEntryTick((tick) => tick + 1); }} label="+ 添加获奖" />
      </div>
      {entries.length === 0 && <div className="mb-6 rounded-lg border border-dashed border-gray-300 dark:border-gray-700 p-6 text-center text-sm text-gray-500 dark:text-gray-400">暂无获奖经历。你可以手动添加，或通过简历导入。</div>}
      <div ref={entriesContainerRef}>
        {entries.map((entry, index) => (
          <ExpandableCard key={entry.localId} summary={entry.name || `获奖 ${index + 1}`} subtitle={entry.date || undefined} onDelete={() => setEntries((rows) => rows.filter((_, rowIndex) => rowIndex !== index))} defaultExpanded={!entry.name}>
            <FormField label="获奖项" required error={errors[`${index}.name`]}>
              <input id={index === 0 ? 'field-award-name' : undefined} className={cls(errors[`${index}.name`])} value={entry.name} onChange={(event) => update(index, 'name', event.target.value)} placeholder="例如：华数杯数学建模国家一等奖" maxLength={200} />
            </FormField>
            <FormField label="获奖时间" error={errors[`${index}.date`]}>
              <MonthYearPicker value={entry.date ?? ''} onChange={(value) => update(index, 'date', value)} error={errors[`${index}.date`]} monthOptional />
            </FormField>
            <FormField label="获奖描述">
              <textarea className={`${cls()} min-h-28 resize-y`} value={entry.description ?? ''} onChange={(event) => update(index, 'description', event.target.value)} placeholder="填写赛事级别、赛道、角色或成果" maxLength={2000} />
            </FormField>
          </ExpandableCard>
        ))}
      </div>
      <div className="mt-2 pt-4 border-t border-gray-200 dark:border-gray-700"><SaveButton onClick={handleSave} saving={saving} label="保存获奖情况" /></div>
    </div>
  );
}
