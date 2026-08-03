// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { isAllowedPlannerClick, scanPageForAI } from './pagePlanner';
import type { AIPageAction } from '../resume-ai/types';

beforeEach(() => {
  document.body.innerHTML = '';
});

function action(purpose: AIPageAction['purpose']): AIPageAction {
  return { type: 'click', controlId: 'control_001', purpose, confidence: 'high' };
}

describe('scanPageForAI', () => {
  it('creates semantic IDs and never includes entered field values', () => {
    document.body.innerHTML = `
      <section aria-label="项目经历">
        <label for="project-name">项目名称</label>
        <input id="project-name" name="projectName" value="绝密项目内容" required>
        <button type="button">添加项目</button>
      </section>`;

    const scan = scanPageForAI();
    expect(scan.snapshot.sections[0]).toEqual({ sectionId: 'section_001', label: '项目经历' });
    expect(scan.snapshot.fields[0]).toMatchObject({
      fieldId: 'field_001',
      label: '项目名称',
      sectionId: 'section_001',
      required: true,
      filled: true,
    });
    expect(scan.snapshot.controls[0]).toMatchObject({
      controlId: 'control_001',
      label: '添加项目',
      dangerHint: false,
    });
    expect(JSON.stringify(scan.snapshot)).not.toContain('绝密项目内容');
  });

  it('marks submit and delete controls as dangerous', () => {
    document.body.innerHTML = '<button>提交申请</button><button>删除经历</button>';
    expect(scanPageForAI().snapshot.controls.every((control) => control.dangerHint)).toBe(true);
  });
});

describe('isAllowedPlannerClick', () => {
  it('allows add-row controls in safe mode but blocks submit controls', () => {
    const add = document.createElement('button');
    add.textContent = '新增项目';
    document.body.appendChild(add);
    expect(isAllowedPlannerClick(action('add_row'), add, false)).toBe(true);

    const submit = document.createElement('button');
    submit.textContent = '提交申请';
    document.body.appendChild(submit);
    expect(isAllowedPlannerClick(action('next_step'), submit, true)).toBe(false);
  });

  it('only allows an exact next-step action when web actions are enabled', () => {
    const next = document.createElement('button');
    next.textContent = '下一步';
    document.body.appendChild(next);
    expect(isAllowedPlannerClick(action('next_step'), next, false)).toBe(false);
    expect(isAllowedPlannerClick(action('next_step'), next, true)).toBe(true);
  });

  it('blocks external links even in web-action mode', () => {
    const link = document.createElement('a');
    link.href = 'https://example.net/next';
    link.textContent = '下一步';
    document.body.appendChild(link);
    expect(isAllowedPlannerClick(action('next_step'), link, true)).toBe(false);
  });
});
