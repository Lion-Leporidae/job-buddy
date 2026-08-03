import { useRef, useState } from 'react';
import { useToast } from '@/src/components/ui/useToast';
import type { Profile, ProjectEntry } from '@/src/types/profile';
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

type LocalProject = Omit<ProjectEntry, 'technologies'> & {
  localId: string;
  technologies: string;
};

const emptyProject = (): LocalProject => ({
  localId: crypto.randomUUID(),
  name: '',
  role: '',
  startDate: '',
  endDate: '',
  isCurrent: false,
  technologies: '',
  url: '',
  description: '',
});

const initProject = (project: ProjectEntry): LocalProject => ({
  ...project,
  localId: crypto.randomUUID(),
  role: project.role ?? '',
  startDate: project.startDate ?? '',
  endDate: project.endDate ?? '',
  isCurrent: project.isCurrent ?? false,
  technologies: (project.technologies ?? []).join(', '),
  url: project.url ?? '',
  description: project.description ?? '',
});

const parseTechnologies = (value: string) => {
  const seen = new Set<string>();
  return value
    .split(/[,，;；\n]/)
    .map((item) => item.trim())
    .filter((item) => {
      const key = item.toLocaleLowerCase();
      if (!item || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
};

export function ProjectExperienceSection({ profile, onSave }: Props) {
  const [entries, setEntries] = useState<LocalProject[]>((profile.projects ?? []).map(initProject));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [newEntryTick, setNewEntryTick] = useState(0);
  const entriesContainerRef = useRef<HTMLDivElement>(null);
  const { showToast } = useToast();
  useScrollToNewEntry(entriesContainerRef, newEntryTick);

  const updateEntry = (index: number, key: keyof LocalProject, value: string | boolean) => {
    setEntries((rows) =>
      rows.map((row, rowIndex) => (rowIndex === index ? { ...row, [key]: value } : row)),
    );
    setErrors((current) => ({ ...current, [`${index}.${key}`]: '' }));
  };

  const moveEntry = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= entries.length) return;
    setEntries((rows) => {
      const next = [...rows];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
    setErrors({});
  };

  const validate = () => {
    const nextErrors: Record<string, string> = {};
    entries.forEach((entry, index) => {
      if (!entry.name.trim()) nextErrors[`${index}.name`] = '项目名称不能为空';
      if (entry.startDate && !/^\d{4}(?:-(?:0[1-9]|1[0-2]))?$/.test(entry.startDate)) {
        nextErrors[`${index}.startDate`] = 'Use YYYY or YYYY-MM';
      }
      if (
        !entry.isCurrent &&
        entry.endDate &&
        !/^\d{4}(?:-(?:0[1-9]|1[0-2]))?$/.test(entry.endDate)
      ) {
        nextErrors[`${index}.endDate`] = 'Use YYYY or YYYY-MM';
      } else if (
        !entry.isCurrent &&
        entry.startDate &&
        entry.endDate &&
        entry.endDate < entry.startDate
      ) {
        nextErrors[`${index}.endDate`] = 'End date cannot be before start date';
      }
      const urlValue = entry.url?.trim() ?? '';
      if (urlValue) {
        try {
          const url = new URL(urlValue);
          if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Unsupported protocol');
        } catch {
          nextErrors[`${index}.url`] = 'Enter a valid http(s) URL';
        }
      }
    });
    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const handleSave = async () => {
    if (!validate()) return;
    setSaving(true);
    await saveSection(
      onSave,
      {
        projects: entries.map((entry) => ({
          name: entry.name.trim(),
          role: entry.role?.trim() || undefined,
          startDate: entry.startDate || undefined,
          endDate: entry.isCurrent ? undefined : entry.endDate || undefined,
          isCurrent: Boolean(entry.isCurrent),
          technologies: parseTechnologies(entry.technologies),
          url: entry.url?.trim() || undefined,
          description: entry.description?.trim() || undefined,
        })),
      },
      showToast,
      '项目经历已保存',
    );
    setSaving(false);
  };

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
          项目经历
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          结构化项目既可逐条填写招聘网站的项目表单，也可合并填写单个项目经历文本框。
        </p>
      </div>

      <div className="flex items-center justify-between mb-3">
        <p className="text-sm text-gray-600 dark:text-gray-400">项目经历为选填项。</p>
        <AddEntryButton
          variant="pill"
          onClick={() => {
            setEntries((rows) => [...rows, emptyProject()]);
            setNewEntryTick((tick) => tick + 1);
          }}
          label="+ 添加项目"
        />
      </div>

      {entries.length === 0 && (
        <div className="mb-6 rounded-lg border border-dashed border-gray-300 dark:border-gray-700 p-6 text-center text-sm text-gray-500 dark:text-gray-400">
          暂无项目。你可以手动添加，或通过简历导入。
        </div>
      )}

      <div ref={entriesContainerRef}>
        {entries.map((entry, index) => (
          <ExpandableCard
            key={entry.localId}
            summary={entry.name || `项目 ${index + 1}`}
            subtitle={[entry.role, entry.technologies].filter(Boolean).join(' · ')}
            onDelete={() => setEntries((rows) => rows.filter((_, rowIndex) => rowIndex !== index))}
            defaultExpanded={!entry.name}
          >
            <div className="flex justify-end gap-2 mb-4">
              <button
                type="button"
                disabled={index === 0}
                onClick={() => moveEntry(index, -1)}
                className="text-xs px-2.5 py-1 rounded border border-gray-300 dark:border-gray-600 disabled:opacity-40"
              >
                上移
              </button>
              <button
                type="button"
                disabled={index === entries.length - 1}
                onClick={() => moveEntry(index, 1)}
                className="text-xs px-2.5 py-1 rounded border border-gray-300 dark:border-gray-600 disabled:opacity-40"
              >
                下移
              </button>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <FormField label="项目名称" required error={errors[`${index}.name`]}>
                <input
                  id={index === 0 ? 'field-project-name' : undefined}
                  className={cls(errors[`${index}.name`])}
                  value={entry.name}
                  onChange={(event) => updateEntry(index, 'name', event.target.value)}
                  maxLength={160}
                  placeholder="AI recruiting assistant"
                />
              </FormField>
              <FormField label="担任角色">
                <input
                  className={cls()}
                  value={entry.role}
                  onChange={(event) => updateEntry(index, 'role', event.target.value)}
                  maxLength={120}
                  placeholder="Backend / Algorithm Engineer"
                />
              </FormField>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <FormField label="开始时间" error={errors[`${index}.startDate`]}>
                <MonthYearPicker
                  monthOptional
                  value={entry.startDate ?? ''}
                  onChange={(value) => updateEntry(index, 'startDate', value)}
                  error={errors[`${index}.startDate`]}
                />
              </FormField>
              <FormField label="结束时间" error={errors[`${index}.endDate`]}>
                <MonthYearPicker
                  monthOptional
                  disabled={entry.isCurrent}
                  value={entry.endDate ?? ''}
                  onChange={(value) => updateEntry(index, 'endDate', value)}
                  error={errors[`${index}.endDate`]}
                />
              </FormField>
            </div>

            <label className="flex items-center gap-2 mb-4 cursor-pointer">
              <input
                type="checkbox"
                checked={Boolean(entry.isCurrent)}
                onChange={(event) => updateEntry(index, 'isCurrent', event.target.checked)}
                className="rounded border-gray-300 text-blue-600"
              />
              <span className="text-sm text-gray-700 dark:text-gray-300">项目仍在进行</span>
            </label>

            <FormField label="技术栈">
              <input
                className={cls()}
                value={entry.technologies}
                onChange={(event) => updateEntry(index, 'technologies', event.target.value)}
                placeholder="Java, Spring Boot, Redis, MySQL"
              />
            </FormField>
            <FormField label="项目链接" error={errors[`${index}.url`]}>
              <input
                type="url"
                className={cls(errors[`${index}.url`])}
                value={entry.url}
                onChange={(event) => updateEntry(index, 'url', event.target.value)}
                placeholder="https://github.com/you/project"
              />
            </FormField>
            <FormField label="项目描述">
              <textarea
                className={`${cls()} min-h-[140px] resize-y`}
                value={entry.description}
                onChange={(event) => updateEntry(index, 'description', event.target.value)}
                maxLength={3000}
                placeholder={
                  'Describe the problem, your work, technical decisions, and measurable outcomes.\nUse separate lines for bullet points if needed.'
                }
              />
            </FormField>
          </ExpandableCard>
        ))}
      </div>

      <SaveButton onClick={handleSave} saving={saving} label="保存项目经历" />
    </div>
  );
}
