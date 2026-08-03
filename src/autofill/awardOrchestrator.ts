import { extractSignals } from './signals';

const AWARD_RE = /(award|honor|prize|获奖|奖项|荣誉|奖励)/i;
const ADD_RE = /(add|new|create|新增|添加|增加)/i;
const DANGEROUS_RE = /(delete|remove|submit|save|cancel|删除|移除|提交|保存|取消)/i;
const MAX_AWARD_ROWS = 20;
const WAIT_MS = 1800;

function elementText(element: Element): string {
  const input = element as HTMLInputElement;
  return [element.textContent, element.getAttribute('aria-label'), element.getAttribute('title'), input.value]
    .filter(Boolean).join(' ').trim();
}

function isVisible(element: HTMLElement): boolean {
  if ((element as HTMLButtonElement).disabled) return false;
  if (element.closest('[hidden], [aria-hidden="true"]')) return false;
  const style = window.getComputedStyle(element);
  return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
}

function hasAwardContext(element: HTMLElement): boolean {
  const signals = extractSignals(element);
  return AWARD_RE.test([signals.label, signals.ariaLabel, signals.placeholder, signals.name, signals.id, signals.nearbyText].filter(Boolean).join(' '));
}

export function findAwardAddButton(): HTMLElement | null {
  const candidates = Array.from(document.querySelectorAll<HTMLElement>('button, [role="button"], input[type="button"]'));
  return candidates.find((element) => {
    const text = elementText(element);
    return isVisible(element) && Boolean(text) && !DANGEROUS_RE.test(text) && AWARD_RE.test(text) && ADD_RE.test(text);
  }) ?? null;
}

function nearestAwardRow(field: HTMLElement, fields: HTMLElement[]): HTMLElement | null {
  let current = field.parentElement;
  for (let depth = 0; current && depth < 7; depth += 1, current = current.parentElement) {
    const contained = fields.filter((candidate) => current!.contains(candidate));
    if (contained.length < 2 || contained.length > 12) continue;
    if (contained.some(hasAwardContext) || AWARD_RE.test(elementText(current).slice(0, 1200))) return current;
  }
  return null;
}

export function buildAwardIndexMap(fields: HTMLElement[]): Map<HTMLElement, number> {
  const rows = new Set<HTMLElement>();
  fields.forEach((field) => {
    const row = nearestAwardRow(field, fields);
    if (row) rows.add(row);
  });
  const ordered = [...rows]
    .filter((row, _, all) => !all.some((other) => other !== row && row.contains(other)))
    .sort((a, b) => a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
  const result = new Map<HTMLElement, number>();
  ordered.forEach((row, index) => fields.forEach((field) => { if (row.contains(field)) result.set(field, index); }));
  return result;
}

function awardFieldCount(): number {
  return Array.from(document.querySelectorAll<HTMLElement>('input, textarea, select, [role="textbox"], [role="combobox"]')).filter(hasAwardContext).length;
}

function waitForAwardDomChange(previousCount: number): Promise<boolean> {
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
    observer = new MutationObserver(() => { if (awardFieldCount() > previousCount) finish(true); });
    observer.observe(document.body, { childList: true, subtree: true });
    timer = setTimeout(() => finish(awardFieldCount() > previousCount), WAIT_MS);
  });
}

export async function ensureAwardRows(awardCount: number): Promise<number> {
  const target = Math.min(Math.max(awardCount, 0), MAX_AWARD_ROWS);
  if (target <= 1) return 0;
  let clicks = 0;
  while (clicks < target) {
    const fields = Array.from(document.querySelectorAll<HTMLElement>('input, textarea, select'));
    const indexes = buildAwardIndexMap(fields);
    const currentRows = indexes.size ? Math.max(...indexes.values()) + 1 : 0;
    if (currentRows >= target) break;
    const button = findAwardAddButton();
    if (!button) break;
    const previousCount = awardFieldCount();
    button.click();
    clicks += 1;
    if (!(await waitForAwardDomChange(previousCount))) break;
  }
  return clicks;
}

export function bindAwardPath(path: string | null, awardIndex?: number): string | null {
  if (awardIndex == null || !path || !/^awards\.\d+\./.test(path)) return path;
  return path.replace(/^awards\.\d+\./, `awards.${awardIndex}.`);
}

export function awardContextLabel(label: string, awardIndex?: number): string {
  return awardIndex == null ? label : `第 ${awardIndex + 1} 个获奖：${label}`;
}
