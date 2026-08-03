// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { executePlanActions, isAllowedPlannerClick, scanPageForAI } from './pagePlanner';
import type { AIPageAction, AIPagePlan } from '../resume-ai/types';
import type { Profile } from '../types/profile';

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

  it('allows saving one repeated entry only inside a recognised experience editor', () => {
    document.body.innerHTML = `
      <div role="dialog" aria-label="项目经历">
        <button>保存</button>
      </div>`;
    const entrySave = document.querySelector('button')!;
    expect(isAllowedPlannerClick(action('save_entry'), entrySave, false)).toBe(false);
    expect(isAllowedPlannerClick(action('save_entry'), entrySave, true)).toBe(true);

    document.body.innerHTML = '<button>保存</button>';
    expect(isAllowedPlannerClick(action('save_entry'), document.querySelector('button')!, true)).toBe(false);
  });
});

describe('executePlanActions', () => {
  it('reclassifies an add button returned in the generic action list and adds the missing row', async () => {
    document.body.innerHTML = `
      <section aria-label="项目经历">
        <div class="repeat-item"><label>项目名称<input></label></div>
        <div class="add-entry">添加项目</div>
      </section>`;
    const button = document.querySelector<HTMLElement>('.add-entry')!;
    button.addEventListener('click', () => {
      const row = document.createElement('div');
      row.className = 'repeat-item';
      row.innerHTML = '<label>项目名称<input></label>';
      button.before(row);
    });
    const scan = scanPageForAI();
    const plan: AIPagePlan = {
      sections: [],
      fieldMappings: [],
      actions: [{
        type: 'click',
        controlId: 'control_001',
        purpose: 'open_section',
        confidence: 'high',
      }],
    };
    const stats = {
      enabled: true,
      aiCalls: 1,
      cacheHits: 0,
      plannedActions: 1,
      mappedFields: 0,
      createdRows: 0,
      webActions: 0,
      blockedActions: 0,
    };
    const profile = { projects: [{ name: 'A' }, { name: 'B' }] } as unknown as Profile;

    expect(await executePlanActions(plan, scan, profile, false, stats)).toBe(true);
    expect(document.querySelectorAll('.repeat-item')).toHaveLength(2);
    expect(stats.createdRows).toBe(1);
    expect(stats.blockedActions).toBe(0);
  });

  it('saves a filled repeated-entry editor during the after-fill phase', async () => {
    document.body.innerHTML = `
      <div role="dialog" aria-label="项目经历">
        <label>项目名称<input value="项目 A"></label>
        <button>保存</button>
      </div>`;
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    dialog.querySelector('button')!.addEventListener('click', () => dialog.remove());
    const scan = scanPageForAI();
    const stats = {
      enabled: true,
      aiCalls: 0,
      cacheHits: 1,
      plannedActions: 0,
      mappedFields: 1,
      createdRows: 0,
      webActions: 0,
      blockedActions: 0,
    };

    expect(
      await executePlanActions(
        { sections: [], fieldMappings: [], actions: [] },
        scan,
        { projects: [{ name: '项目 A' }] } as unknown as Profile,
        true,
        stats,
        'after_fill',
      ),
    ).toBe(true);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(stats.webActions).toBe(1);
  });
});
