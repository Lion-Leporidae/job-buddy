import { extractSignals } from './signals';

const PROJECT_RE = /(project|项目)/i;
const ADD_RE = /(add|new|create|新增|添加|增加)/i;
const DANGEROUS_RE = /(delete|remove|submit|save|cancel|删除|移除|提交|保存|取消)/i;
const MAX_PROJECT_ROWS = 10;
const WAIT_MS = 1800;

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

export function isSafeProjectAddButton(element: HTMLElement): boolean {
  if (!isVisible(element)) return false;
  const text = elementText(element);
  if (!text || DANGEROUS_RE.test(text)) return false;
  return PROJECT_RE.test(text) && ADD_RE.test(text);
}

export function findProjectAddButton(): HTMLElement | null {
  const candidates = Array.from(
    document.querySelectorAll<HTMLElement>('button, [role="button"], input[type="button"]'),
  );
  return candidates.find(isSafeProjectAddButton) ?? null;
}

function hasProjectContext(element: HTMLElement): boolean {
  const signals = extractSignals(element);
  return PROJECT_RE.test(
    [signals.label, signals.ariaLabel, signals.placeholder, signals.name, signals.id, signals.nearbyText]
      .filter(Boolean)
      .join(' '),
  );
}

function nearestProjectRow(field: HTMLElement, fields: HTMLElement[]): HTMLElement | null {
  let current = field.parentElement;
  for (let depth = 0; current && depth < 7; depth += 1, current = current.parentElement) {
    const contained = fields.filter((candidate) => current!.contains(candidate));
    if (contained.length < 2 || contained.length > 15) continue;
    const ownProjectSignal = contained.some(hasProjectContext);
    const heading = elementText(current).slice(0, 1500);
    if (ownProjectSignal || PROJECT_RE.test(heading)) return current;
  }
  return null;
}

export function findProjectRows(fields: HTMLElement[]): HTMLElement[] {
  const rows = new Set<HTMLElement>();
  for (const field of fields) {
    const row = nearestProjectRow(field, fields);
    if (row) rows.add(row);
  }
  return [...rows]
    .filter((row, _, all) => !all.some((other) => other !== row && row.contains(other)))
    .sort((a, b) =>
      a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
    );
}

export function buildProjectIndexMap(fields: HTMLElement[]): Map<HTMLElement, number> {
  const result = new Map<HTMLElement, number>();
  findProjectRows(fields).forEach((row, index) => {
    fields.forEach((field) => {
      if (row.contains(field)) result.set(field, index);
    });
  });
  return result;
}

function projectFieldCount(): number {
  return Array.from(document.querySelectorAll<HTMLElement>('input, textarea, select, [role="textbox"], [role="combobox"]'))
    .filter(hasProjectContext).length;
}

function waitForProjectDomChange(previousCount: number): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    let observer: MutationObserver;
    let timer: ReturnType<typeof setTimeout>;
    const finish = (changed: boolean) => {
      if (settled) return;
      settled = true;
      observer.disconnect();
      clearTimeout(timer);
      resolve(changed);
    };
    observer = new MutationObserver(() => {
      if (projectFieldCount() > previousCount) finish(true);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    timer = setTimeout(() => finish(projectFieldCount() > previousCount), WAIT_MS);
  });
}

export async function ensureProjectRows(projectCount: number): Promise<number> {
  const target = Math.min(Math.max(projectCount, 0), MAX_PROJECT_ROWS);
  if (target <= 1) return 0;
  let clicks = 0;

  while (clicks < target) {
    const fields = Array.from(document.querySelectorAll<HTMLElement>('input, textarea, select'));
    const currentRows = findProjectRows(fields).length;
    if (currentRows >= target) break;
    const button = findProjectAddButton();
    if (!button) break;
    const previousCount = projectFieldCount();
    button.click();
    clicks += 1;
    if (!(await waitForProjectDomChange(previousCount))) break;
  }
  return clicks;
}

export function bindProjectPath(path: string | null, projectIndex?: number): string | null {
  if (projectIndex == null || !path) return path;
  if (!/^projects\.\d+\./.test(path)) return path;
  return path.replace(/^projects\.\d+\./, `projects.${projectIndex}.`);
}

export function projectContextLabel(label: string, projectIndex?: number): string {
  return projectIndex == null ? label : `第 ${projectIndex + 1} 个项目：${label}`;
}
