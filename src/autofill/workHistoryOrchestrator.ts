import {
  bindIndexedPath,
  buildSectionIndexMap,
  ensureSectionRows,
  findSectionAddButton,
  findSectionRows,
  indexedContextLabel,
  isSafeSectionAddButton,
  type RepeatedSectionConfig,
} from './repeatedSectionOrchestrator';

const WORK_HISTORY_CONFIG: RepeatedSectionConfig = {
  sectionPattern: /(internship|work\s*(experience|history)|employment|实习经历|工作经历|实习经验|工作经验)/i,
  maxRows: 10,
  maxFieldsPerRow: 25,
  minFieldsPerRow: 3,
  itemLabel: '实习/工作经历',
};

export const isSafeWorkHistoryAddButton = (element: HTMLElement) =>
  isSafeSectionAddButton(element, WORK_HISTORY_CONFIG);
export const findWorkHistoryAddButton = () => findSectionAddButton(WORK_HISTORY_CONFIG);
export const findWorkHistoryRows = (fields: HTMLElement[]) =>
  findSectionRows(fields, WORK_HISTORY_CONFIG);
export const buildWorkHistoryIndexMap = (fields: HTMLElement[]) =>
  buildSectionIndexMap(fields, WORK_HISTORY_CONFIG);
export const ensureWorkHistoryRows = (count: number) =>
  ensureSectionRows(count, WORK_HISTORY_CONFIG);
export const bindWorkHistoryPath = (path: string | null, index?: number) => {
  if (index == null || !path) return path;
  if (path === 'derived.currentCompany') return `workHistory.${index}.company`;
  if (path === 'derived.currentTitle') return `workHistory.${index}.title`;
  if (path === 'professional.summary') return `workHistory.${index}.description`;
  return bindIndexedPath(path, 'workHistory', index);
};
export const workHistoryContextLabel = (label: string, index?: number) =>
  indexedContextLabel(label, '实习/工作经历', index);
