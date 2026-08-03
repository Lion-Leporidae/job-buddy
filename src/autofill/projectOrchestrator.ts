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

const PROJECT_CONFIG: RepeatedSectionConfig = {
  sectionPattern: /(project|项目)/i,
  maxRows: 10,
  maxFieldsPerRow: 20,
  minFieldsPerRow: 2,
  itemLabel: '项目',
};

export const isSafeProjectAddButton = (element: HTMLElement) =>
  isSafeSectionAddButton(element, PROJECT_CONFIG);
export const findProjectAddButton = () => findSectionAddButton(PROJECT_CONFIG);
export const findProjectRows = (fields: HTMLElement[]) => findSectionRows(fields, PROJECT_CONFIG);
export const buildProjectIndexMap = (fields: HTMLElement[]) =>
  buildSectionIndexMap(fields, PROJECT_CONFIG);
export const ensureProjectRows = (count: number) => ensureSectionRows(count, PROJECT_CONFIG);
export const bindProjectPath = (path: string | null, index?: number) => {
  if (index == null || !path) return path;
  if (path === 'derived.currentTitle') return `projects.${index}.role`;
  if (path === 'professional.summary') return `projects.${index}.description.summary`;
  return bindIndexedPath(path, 'projects', index);
};
export const projectContextLabel = (label: string, index?: number) =>
  indexedContextLabel(label, '项目', index);
