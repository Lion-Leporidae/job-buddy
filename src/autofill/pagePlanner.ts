import type { Profile } from '../types/profile';
import type { DomesticProfile } from '../types/domesticProfile';
import type {
  AIPageAction,
  AIPageFieldPayload,
  AIPagePlan,
  AIPageSnapshot,
} from '../resume-ai/types';
import type { FieldMatch } from './mapper';
import { extractSignals } from './signals';
import { resolveProfileValue } from './resolver';
import { planPageWithProvider } from '../resume-ai/provider';
import { parsePagePlan } from '../resume-ai/pagePlannerPrompt';
import {
  getAIConfig,
  getAIPagePlanCache,
  getAIPagePlannerSettings,
  saveAIPagePlanCache,
} from '../utils/storage';

const FIELD_SELECTOR = [
  'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="image"]):not([type="reset"])',
  'textarea',
  'select',
  '[contenteditable="true"]',
  '[role="textbox"]',
  '[role="combobox"]',
  '[role="listbox"]',
].join(',');

const CONTROL_SELECTOR = [
  'button',
  '[role="button"]',
  'input[type="button"]',
  'input[type="submit"]',
  'a[href]',
  '.add-entry',
  '[class*="add-entry"]',
  '[data-action]',
].join(',');

const SECTION_SELECTOR = [
  'section',
  'fieldset',
  '[data-section]',
  '[data-section-id]',
  '.resume-module',
  '.form-module',
  '.experience-section',
  '[class*="form-section"]',
].join(',');

const ROW_SELECTOR = [
  '.repeat-wrap',
  '.repeat-item',
  '.experience-item',
  '[class*="repeat-item"]',
  '[class*="experience-item"]',
  '[data-repeat-item]',
  '[data-entry-index]',
].join(',');

const SEMANTIC_HEADING_SELECTOR = [
  'legend',
  'h1',
  'h2',
  'h3',
  'h4',
  '[class*="section-title"]',
  '[class*="module-title"]',
  '[class*="card-title"]',
  '[class*="panel-title"]',
].join(',');

const ADD_RE = /(add|new|create|新增|添加|增加|新建|继续添加)/i;
const NEXT_RE = /^(next|continue|下一步|继续)$/i;
const DANGER_RE = /(submit|apply|send|save\s*(and|&)\s*submit|delete|remove|withdraw|payment|purchase|buy|投递|提交|报名|发送|删除|移除|撤回|付款|支付|购买|保存并提交)/i;
const OPEN_SECTION_RE = /(expand|open|edit|details|展开|打开|编辑|详情)/i;
const OPEN_PICKER_RE = /(choose|select|date|calendar|选择|日期|日历)/i;
const MAX_STRUCTURAL_ACTIONS = 8;
const MAX_EXTRA_ACTIONS = 3;

export interface PagePlannerStats {
  enabled: boolean;
  aiCalls: number;
  cacheHits: number;
  createdRows: number;
  webActions: number;
  blockedActions: number;
}

export interface PagePlannerResult {
  mappings: Map<HTMLElement, FieldMatch>;
  stats: PagePlannerStats;
}

export interface ScannedAIPage {
  snapshot: AIPageSnapshot;
  fieldElements: Map<string, HTMLElement>;
  controlElements: Map<string, HTMLElement>;
}

function visible(element: HTMLElement): boolean {
  if (element.closest('[hidden], [aria-hidden="true"]')) return false;
  const style = window.getComputedStyle(element);
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
  return true;
}

function clippedText(value: string | null | undefined, max = 180): string {
  const normalized = (value ?? '').replace(/\s+/g, ' ').trim();
  return normalized.length > max ? `${normalized.slice(0, max)}…` : normalized;
}

function controlText(element: HTMLElement): string {
  const input = element as HTMLInputElement;
  return clippedText(
    element.getAttribute('aria-label') ||
      element.getAttribute('title') ||
      input.value ||
      element.textContent,
    140,
  );
}

function sectionLabel(section: HTMLElement): string {
  const heading = section.querySelector<HTMLElement>(
    SEMANTIC_HEADING_SELECTOR,
  );
  return clippedText(
    heading?.textContent ||
      section.getAttribute('aria-label') ||
      section.getAttribute('data-section') ||
      section.getAttribute('data-section-id') ||
      section.id,
    160,
  );
}

function findSemanticSection(element: HTMLElement): HTMLElement | null {
  const explicit = element.closest<HTMLElement>(SECTION_SELECTOR);
  if (explicit && explicit !== document.body && explicit !== document.documentElement) return explicit;
  let current = element.parentElement;
  for (let depth = 0; current && depth < 8; depth += 1, current = current.parentElement) {
    if (current === document.body || current === document.documentElement) break;
    const heading = current.querySelector<HTMLElement>(SEMANTIC_HEADING_SELECTOR);
    if (!heading) continue;
    const fieldCount = current.querySelectorAll(FIELD_SELECTOR).length;
    if (fieldCount > 0 && fieldCount <= 80) return current;
  }
  return null;
}

function safeFieldLabel(signals: ReturnType<typeof extractSignals>, fallback: string): string {
  return clippedText(
    signals.label || signals.ariaLabel || signals.placeholder || signals.name || signals.id || fallback,
    140,
  );
}

function fieldType(element: HTMLElement): AIPageFieldPayload['type'] {
  if (element instanceof HTMLSelectElement || element.getAttribute('role') === 'combobox' || element.getAttribute('role') === 'listbox') return 'select';
  if (element instanceof HTMLInputElement && element.type === 'radio') return 'radio';
  if (element instanceof HTMLInputElement && element.type === 'checkbox') return 'checkbox';
  return 'text';
}

function selectOptions(element: HTMLSelectElement): { label: string; value: string }[] {
  return Array.from(element.options)
    .filter((option) => !option.disabled && (option.value.trim() || option.text.trim()))
    .map((option) => ({ label: option.text.trim(), value: option.value }))
    .slice(0, 40);
}

function fieldFilled(element: HTMLElement): boolean {
  if (element instanceof HTMLInputElement) {
    if (element.type === 'checkbox' || element.type === 'radio') return element.checked;
    if (element.type === 'file') return (element.files?.length ?? 0) > 0;
    return element.value.trim() !== '';
  }
  if (element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
    return element.value.trim() !== '';
  }
  return clippedText(element.textContent).length > 0;
}

function hash(input: string): string {
  let value = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    value ^= input.charCodeAt(index);
    value = Math.imul(value, 16777619);
  }
  return (value >>> 0).toString(36);
}

export function scanPageForAI(): ScannedAIPage {
  const fieldNodes = Array.from(document.querySelectorAll<HTMLElement>(FIELD_SELECTOR)).filter(visible);
  const controlNodes = Array.from(document.querySelectorAll<HTMLElement>(CONTROL_SELECTOR))
    .filter(visible)
    .filter((element, index, all) => all.indexOf(element) === index)
    .filter((element) => controlText(element).length > 0);

  const sectionNodes: HTMLElement[] = [];
  const sectionIdByElement = new Map<HTMLElement, string>();
  const registerSection = (element: HTMLElement): string | undefined => {
    const section = findSemanticSection(element);
    if (!section || section === document.body || section === document.documentElement) return undefined;
    let id = sectionIdByElement.get(section);
    if (!id) {
      sectionNodes.push(section);
      id = `section_${String(sectionNodes.length).padStart(3, '0')}`;
      sectionIdByElement.set(section, id);
    }
    return id;
  };

  [...fieldNodes, ...controlNodes]
    .sort((left, right) =>
      left === right ? 0 : left.compareDocumentPosition(right) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
    )
    .forEach(registerSection);

  const fieldElements = new Map<string, HTMLElement>();
  const fields = fieldNodes.slice(0, 240).map((element, index): AIPageFieldPayload => {
    const fieldId = `field_${String(index + 1).padStart(3, '0')}`;
    fieldElements.set(fieldId, element);
    const signals = extractSignals(element);
    const sectionId = registerSection(element);
    const section = findSemanticSection(element);
    const row = element.closest<HTMLElement>(ROW_SELECTOR);
    let rowIndex: number | undefined;
    if (section && row) {
      const rows = Array.from(section.querySelectorAll<HTMLElement>(ROW_SELECTOR))
        .filter((candidate, rowPosition, all) =>
          all.findIndex((other) => other === candidate || other.contains(candidate)) === rowPosition,
        );
      const found = rows.indexOf(row);
      if (found >= 0) rowIndex = found;
    }
    const type = fieldType(element);
    const options = element instanceof HTMLSelectElement ? selectOptions(element) : undefined;
    return {
      fieldId,
      type,
      label: safeFieldLabel(signals, fieldId),
      ...(signals.placeholder && { placeholder: clippedText(signals.placeholder, 80) }),
      ...(signals.name && { name: clippedText(signals.name, 80) }),
      ...(signals.nearbyText && !fieldFilled(element) && { nearbyText: clippedText(signals.nearbyText, 180) }),
      ...(options?.length && { options }),
      ...(sectionId && { sectionId }),
      ...(rowIndex !== undefined && { rowIndex }),
      required: element.hasAttribute('required') || element.getAttribute('aria-required') === 'true',
      filled: fieldFilled(element),
      disabled: (element as HTMLInputElement).disabled === true || element.getAttribute('aria-disabled') === 'true',
      readOnly: (element as HTMLInputElement).readOnly === true || element.getAttribute('aria-readonly') === 'true',
    };
  });

  const controlElements = new Map<string, HTMLElement>();
  const controls = controlNodes.slice(0, 120).map((element, index) => {
    const controlId = `control_${String(index + 1).padStart(3, '0')}`;
    controlElements.set(controlId, element);
    const label = controlText(element);
    const sectionId = registerSection(element);
    return {
      controlId,
      label,
      role: element.getAttribute('role') || element.tagName.toLowerCase(),
      ...(sectionId && { sectionId }),
      disabled: (element as HTMLButtonElement).disabled === true || element.getAttribute('aria-disabled') === 'true',
      dangerHint: DANGER_RE.test(label),
    };
  });

  const sections = sectionNodes.slice(0, 50).map((element) => ({
    sectionId: sectionIdByElement.get(element)!,
    label: sectionLabel(element),
  }));
  const page = { host: window.location.hostname, path: window.location.pathname };
  const fingerprintSource = JSON.stringify({
    page,
    sections,
    fields: fields.map(({ fieldId: _fieldId, filled: _filled, ...field }) => field),
    controls: controls.map(({ controlId: _controlId, ...control }) => control),
  });
  return {
    snapshot: { page, fingerprint: hash(fingerprintSource), sections, fields, controls },
    fieldElements,
    controlElements,
  };
}

function collectionCount(
  profile: Profile & { domestic?: DomesticProfile },
  collection: 'projects' | 'workHistory' | 'education' | 'awards' | null,
): number {
  return collection ? profile[collection]?.length ?? 0 : 0;
}

function profileShape(profile: Profile): string {
  return [profile.projects?.length ?? 0, profile.workHistory?.length ?? 0, profile.education?.length ?? 0, profile.awards?.length ?? 0].join('-');
}

function cacheKey(scan: ScannedAIPage, profile: Profile): string {
  return `${scan.snapshot.fingerprint}:${profileShape(profile)}`;
}

async function waitForMutation(timeoutMs = 1600): Promise<boolean> {
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
    observer = new MutationObserver(() => finish(true));
    observer.observe(document.body, { childList: true, subtree: true, attributes: true });
    timer = setTimeout(() => finish(false), timeoutMs);
  });
}

export function isAllowedPlannerClick(
  action: AIPageAction,
  element: HTMLElement,
  allowWebActions: boolean,
): boolean {
  if (action.confidence !== 'high' || !element.isConnected || !visible(element)) return false;
  const label = controlText(element);
  if (!label || DANGER_RE.test(label)) return false;
  if ((element as HTMLButtonElement).disabled || element.getAttribute('aria-disabled') === 'true') return false;
  if (element instanceof HTMLAnchorElement) {
    try {
      const target = new URL(element.href, window.location.href);
      if (target.origin !== window.location.origin) return false;
    } catch {
      return false;
    }
  }
  if (action.purpose === 'add_row') return ADD_RE.test(label);
  if (!allowWebActions) return false;
  if (action.purpose === 'next_step') return NEXT_RE.test(label);
  if (action.purpose === 'open_section') {
    return element.hasAttribute('aria-expanded') || OPEN_SECTION_RE.test(label);
  }
  if (action.purpose === 'switch_tab') {
    return element.getAttribute('role') === 'tab' || element.closest('[role="tablist"]') !== null;
  }
  if (action.purpose === 'open_picker') {
    return element.hasAttribute('aria-haspopup') || OPEN_PICKER_RE.test(label);
  }
  return false;
}

async function executePlanActions(
  plan: AIPagePlan,
  initialScan: ScannedAIPage,
  profile: Profile & { domestic?: DomesticProfile },
  allowWebActions: boolean,
  stats: PagePlannerStats,
): Promise<boolean> {
  let changed = false;
  let structuralActions = 0;
  for (const section of plan.sections) {
    if (section.confidence !== 'high' || !section.addControlId) continue;
    const desired = Math.min(Math.max(section.desiredRows, 0), collectionCount(profile, section.profileCollection));
    const additions = Math.min(Math.max(desired - Math.max(section.existingRows, 0), 0), MAX_STRUCTURAL_ACTIONS - structuralActions);
    let control = initialScan.controlElements.get(section.addControlId);
    for (let index = 0; index < additions && control; index += 1) {
      const action: AIPageAction = { type: 'click', controlId: section.addControlId, purpose: 'add_row', confidence: 'high' };
      if (!isAllowedPlannerClick(action, control, allowWebActions)) {
        stats.blockedActions += 1;
        break;
      }
      const before = scanPageForAI();
      const beforeSectionFields = before.snapshot.fields.filter((field) => field.sectionId === section.sectionId).length;
      const mutation = waitForMutation();
      control.click();
      const mutated = await mutation;
      const after = scanPageForAI();
      const afterSectionFields = after.snapshot.fields.filter((field) => field.sectionId === section.sectionId).length;
      if (!mutated || after.snapshot.fingerprint === before.snapshot.fingerprint || afterSectionFields <= beforeSectionFields) break;
      changed = true;
      stats.createdRows += 1;
      structuralActions += 1;
      const oldLabel = controlText(control);
      control = after.controlElements.get(section.addControlId) ??
        [...after.controlElements.entries()].find(([controlId, candidate]) => {
          const payload = after.snapshot.controls.find((item) => item.controlId === controlId);
          return payload?.sectionId === section.sectionId && controlText(candidate) === oldLabel;
        })?.[1];
    }
  }

  if (allowWebActions) {
    let extraActions = 0;
    for (const action of plan.actions) {
      if (action.purpose === 'add_row' || extraActions >= MAX_EXTRA_ACTIONS) continue;
      const liveScan = scanPageForAI();
      const element = liveScan.controlElements.get(action.controlId);
      if (!element || !isAllowedPlannerClick(action, element, true)) {
        stats.blockedActions += 1;
        continue;
      }
      const mutation = waitForMutation(1200);
      element.click();
      await mutation;
      changed = true;
      stats.webActions += 1;
      extraActions += 1;
    }
  }
  return changed;
}

function mappingsFromPlan(
  plan: AIPagePlan,
  scan: ScannedAIPage,
  profile: Profile & { domestic?: DomesticProfile },
): Map<HTMLElement, FieldMatch> {
  const result = new Map<HTMLElement, FieldMatch>();
  const claimed = new Set<string>();
  const fieldsById = new Map(scan.snapshot.fields.map((field) => [field.fieldId, field]));
  for (const mapping of plan.fieldMappings) {
    if (mapping.confidence !== 'high' && mapping.confidence !== 'low') continue;
    const element = scan.fieldElements.get(mapping.fieldId);
    const field = fieldsById.get(mapping.fieldId);
    if (!element || !field || !element.isConnected || field.disabled || field.readOnly) continue;
    if (mapping.profilePath && claimed.has(mapping.profilePath)) continue;
    const value = mapping.profilePath ? resolveProfileValue(profile, mapping.profilePath) : '';
    const selected = mapping.selectedOption?.trim() ?? '';
    if (selected && field.options && !field.options.some((option) => option.label === selected || option.value === selected)) continue;
    if (!value && !selected) continue;
    if (mapping.profilePath) claimed.add(mapping.profilePath);
    result.set(element, {
      fieldPath: mapping.profilePath,
      confidence: mapping.confidence === 'high' ? 0.97 : 0.72,
      value: selected || value,
      matchLayer: 'ai_page',
    });
  }
  return result;
}

async function readOrRequestPlan(
  scan: ScannedAIPage,
  profile: Profile & { domestic?: DomesticProfile },
  stats: PagePlannerStats,
): Promise<AIPagePlan> {
  const key = cacheKey(scan, profile);
  const cache = await getAIPagePlanCache();
  const hit = cache.find((entry) => entry.host === scan.snapshot.page.host && entry.fingerprint === key);
  if (hit) {
    stats.cacheHits += 1;
    return parsePagePlan(hit.plan);
  }
  const config = await getAIConfig();
  if (!config) return { sections: [], fieldMappings: [], actions: [] };
  const plan = await planPageWithProvider(config, scan.snapshot, profile);
  stats.aiCalls += 1;
  await saveAIPagePlanCache([
    { fingerprint: key, host: scan.snapshot.page.host, plan, updatedAt: new Date().toISOString() },
    ...cache.filter((entry) => !(entry.host === scan.snapshot.page.host && entry.fingerprint === key)),
  ]).catch(() => undefined);
  return plan;
}

export async function preparePageWithAI(
  profile: Profile & { domestic?: DomesticProfile },
): Promise<PagePlannerResult> {
  const stats: PagePlannerStats = {
    enabled: false,
    aiCalls: 0,
    cacheHits: 0,
    createdRows: 0,
    webActions: 0,
    blockedActions: 0,
  };
  const settings = await getAIPagePlannerSettings();
  const config = await getAIConfig();
  if (!settings.enabled || !config) return { mappings: new Map(), stats };
  try {
    const initialScan = scanPageForAI();
    let plan = await readOrRequestPlan(initialScan, profile, stats);
    stats.enabled = true;
    const changed = await executePlanActions(plan, initialScan, profile, settings.allowWebActions, stats);
    const finalScan = changed ? scanPageForAI() : initialScan;
    if (changed) plan = await readOrRequestPlan(finalScan, profile, stats);
    return { mappings: mappingsFromPlan(plan, finalScan, profile), stats };
  } catch {
    return { mappings: new Map(), stats };
  }
}
