import { extractSignals } from './signals';

export interface RepeatedSectionConfig {
  sectionPattern: RegExp;
  maxRows: number;
  maxFieldsPerRow: number;
  minFieldsPerRow: number;
  itemLabel: string;
}

const ADD_RE = /(add|new|create|新增|添加|增加)/i;
const DANGEROUS_RE = /(delete|remove|submit|save|cancel|删除|移除|提交|保存|取消)/i;
const WAIT_MS = 1800;
const FIELD_SELECTOR = 'input, textarea, select, [role="textbox"], [role="combobox"]';
const ADD_CONTROL_SELECTOR = [
  'button',
  '[role="button"]',
  'input[type="button"]',
  'a',
  '.add-entry',
  '[class*="add-entry"]',
  '[data-action*="add" i]',
].join(', ');
const EXPLICIT_ROW_SELECTOR = [
  '.repeat-wrap',
  '.repeat-item',
  '.experience-item',
  '[class*="repeat-item"]',
  '[class*="experience-item"]',
  '[data-repeat-item]',
  '[data-entry-index]',
].join(', ');

function elementText(element: Element): string {
  const input = element as HTMLInputElement;
  return [element.textContent, element.getAttribute('aria-label'), element.getAttribute('title'), input.value]
    .filter(Boolean)
    .join(' ')
    .trim();
}

function isVisible(element: HTMLElement): boolean {
  if ((element as HTMLButtonElement).disabled) return false;
  if (element.closest('[hidden], [aria-hidden="true"]')) return false;
  const style = window.getComputedStyle(element);
  return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
}

function sectionAncestor(element: HTMLElement, config: RepeatedSectionConfig): HTMLElement | null {
  let current: HTMLElement | null = element;
  for (let depth = 0; current && depth < 10; depth += 1, current = current.parentElement) {
    // Never use the document-wide containers as semantic context: another
    // unrelated section elsewhere on the page could contain the keyword.
    if (current === document.body || current === document.documentElement) return null;
    const className = typeof current.className === 'string' ? current.className : '';
    const isBoundary =
      current.matches('section, fieldset, [data-section], [data-section-id]') ||
      /(^|[-_\s])(section|block|module)([-_\s]|$)/i.test(className);
    if (isBoundary) {
      // Section titles are rendered first. Limit the context window so values,
      // picker overlays, or descriptions later in another section cannot
      // inject words such as "project" and create a false positive.
      return config.sectionPattern.test(elementText(current).slice(0, 240)) ? current : null;
    }
  }
  return null;
}

export function isSafeSectionAddButton(
  element: HTMLElement,
  config: RepeatedSectionConfig,
): boolean {
  if (!isVisible(element)) return false;
  const ownText = elementText(element);
  if (!ownText || !ADD_RE.test(ownText) || DANGEROUS_RE.test(ownText)) return false;
  return config.sectionPattern.test(ownText) || sectionAncestor(element, config) !== null;
}

export function findSectionAddButton(config: RepeatedSectionConfig): HTMLElement | null {
  const candidates = Array.from(
    document.querySelectorAll<HTMLElement>(ADD_CONTROL_SELECTOR),
  );
  return candidates.find((candidate) => isSafeSectionAddButton(candidate, config)) ?? null;
}

function hasSectionContext(element: HTMLElement, config: RepeatedSectionConfig): boolean {
  const signals = extractSignals(element);
  return config.sectionPattern.test(
    [signals.label, signals.ariaLabel, signals.placeholder, signals.name, signals.id, signals.nearbyText]
      .filter(Boolean)
      .join(' '),
  );
}

function findSectionRoot(fields: HTMLElement[], config: RepeatedSectionConfig): HTMLElement | null {
  const button = findSectionAddButton(config);
  if (button) return sectionAncestor(button, config);

  const contextual = fields.find((field) => hasSectionContext(field, config));
  if (!contextual) return null;
  return sectionAncestor(contextual, config);
}

function nearestRow(
  field: HTMLElement,
  fields: HTMLElement[],
  section: HTMLElement,
  config: RepeatedSectionConfig,
): HTMLElement | null {
  let current = field.parentElement;
  let best: HTMLElement | null = null;
  let bestCount = 0;
  while (current && current !== section && section.contains(current)) {
    const count = fields.reduce((total, candidate) => total + (current!.contains(candidate) ? 1 : 0), 0);
    const repeatedChildBranches = Array.from(current.children).filter((child) => {
      const childElement = child as HTMLElement;
      return fields.reduce(
        (total, candidate) => total + (childElement.contains(candidate) ? 1 : 0),
        0,
      ) >= config.minFieldsPerRow;
    }).length;
    if (
      count >= config.minFieldsPerRow &&
      count <= config.maxFieldsPerRow &&
      repeatedChildBranches < 2 &&
      count >= bestCount
    ) {
      best = current;
      bestCount = count;
    }
    current = current.parentElement;
  }
  return best;
}

export function findSectionRows(
  fields: HTMLElement[],
  config: RepeatedSectionConfig,
): HTMLElement[] {
  const section = findSectionRoot(fields, config);
  if (!section) return [];
  const sectionFields = fields.filter((field) => section.contains(field));
  const explicitRows = Array.from(section.querySelectorAll<HTMLElement>(EXPLICIT_ROW_SELECTOR))
    .filter((row) => {
      const fieldCount = sectionFields.filter((field) => row.contains(field)).length;
      return fieldCount >= config.minFieldsPerRow && fieldCount <= config.maxFieldsPerRow;
    })
    .filter((row, _, all) => !all.some((other) => other !== row && row.contains(other)))
    .sort((a, b) =>
      a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
    );
  if (explicitRows.length > 0) return explicitRows;

  const rows = new Set<HTMLElement>();
  for (const field of sectionFields) {
    const row = nearestRow(field, sectionFields, section, config);
    if (row) rows.add(row);
  }
  return [...rows]
    .filter((row, _, all) => !all.some((other) => other !== row && row.contains(other)))
    .sort((a, b) =>
      a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
    );
}

export function buildSectionIndexMap(
  fields: HTMLElement[],
  config: RepeatedSectionConfig,
): Map<HTMLElement, number> {
  const result = new Map<HTMLElement, number>();
  findSectionRows(fields, config).forEach((row, index) => {
    fields.forEach((field) => {
      if (row.contains(field)) result.set(field, index);
    });
  });
  return result;
}

function currentFields(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(FIELD_SELECTOR));
}

function waitForNewRow(previousCount: number, config: RepeatedSectionConfig): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    let observer: MutationObserver;
    let timer: ReturnType<typeof setTimeout>;
    const rowCount = () => findSectionRows(currentFields(), config).length;
    const finish = (changed: boolean) => {
      if (settled) return;
      settled = true;
      observer.disconnect();
      clearTimeout(timer);
      resolve(changed);
    };
    observer = new MutationObserver(() => {
      if (rowCount() > previousCount) finish(true);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    timer = setTimeout(() => finish(rowCount() > previousCount), WAIT_MS);
  });
}

export async function ensureSectionRows(
  itemCount: number,
  config: RepeatedSectionConfig,
): Promise<number> {
  const target = Math.min(Math.max(itemCount, 0), config.maxRows);
  if (target === 0) return 0;
  let clicks = 0;

  while (clicks < target) {
    const currentRows = findSectionRows(currentFields(), config).length;
    if (currentRows >= target) break;
    const button = findSectionAddButton(config);
    if (!button) break;
    button.click();
    clicks += 1;
    if (!(await waitForNewRow(currentRows, config))) break;
  }
  return clicks;
}

export function bindIndexedPath(path: string | null, prefix: string, index?: number): string | null {
  if (index == null || !path) return path;
  const pattern = new RegExp(`^${prefix}\\.\\d+\\.`);
  if (!pattern.test(path)) return path;
  return path.replace(pattern, `${prefix}.${index}.`);
}

export function indexedContextLabel(label: string, itemLabel: string, index?: number): string {
  return index == null ? label : `第 ${index + 1} 条${itemLabel}：${label}`;
}
