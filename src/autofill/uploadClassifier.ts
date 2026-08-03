import type { FieldSignals } from './signals';

export type UploadFieldKind = 'resume' | 'photo' | 'unknown';

const RESUME_RE = /(resume|curriculum\s*vitae|\bcv\b|简历附件|上传简历|简历上传|个人简历|履历)/i;
const PHOTO_RE = /(upload\s*photo|profile\s*photo|avatar|headshot|portrait|上传头像|头像上传|上传照片|证件照|个人照片|求职照片)/i;
const MAX_CONTEXT_LENGTH = 500;
const MAX_ANCESTOR_DEPTH = 7;

function normalizeText(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function standardSignalText(signals: FieldSignals): string {
  return [
    signals.label,
    signals.ariaLabel,
    signals.placeholder,
    signals.name,
    signals.id,
    signals.nearbyText,
  ].filter(Boolean).join(' ');
}

/**
 * Classifies a file input from its closest self-contained upload module.
 * File names, MIME types and accept=image are deliberately not semantic proof.
 */
export function classifyUploadField(element: HTMLInputElement, signals: FieldSignals): UploadFieldKind {
  const direct = standardSignalText(signals);
  if (RESUME_RE.test(direct)) return 'resume';
  if (PHOTO_RE.test(direct)) return 'photo';

  let current: HTMLElement | null = element.parentElement;
  for (let depth = 0; current && depth < MAX_ANCESTOR_DEPTH; depth += 1, current = current.parentElement) {
    const visibleText = normalizeText(current.textContent);
    // Once context grows into a whole form/page it is no longer safe: that
    // container can mention both resume and avatar fields.
    if (visibleText.length > MAX_CONTEXT_LENGTH) break;
    const context = [
      typeof current.className === 'string' ? current.className : '',
      current.getAttribute('aria-label'),
      current.getAttribute('title'),
      visibleText,
    ].filter(Boolean).join(' ');
    if (RESUME_RE.test(context)) return 'resume';
    if (PHOTO_RE.test(context)) return 'photo';
  }
  return 'unknown';
}
