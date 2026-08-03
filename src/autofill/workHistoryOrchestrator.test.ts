// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  bindWorkHistoryPath,
  buildWorkHistoryIndexMap,
  ensureWorkHistoryRows,
  isSafeWorkHistoryAddButton,
} from './workHistoryOrchestrator';

function appendWorkRow(root: HTMLElement, index: number): HTMLElement {
  const row = document.createElement('div');
  row.className = 'multi-row';
  row.innerHTML = `
    <input aria-label="开始年份 ${index}"><input aria-label="开始月份 ${index}">
    <input aria-label="结束年份 ${index}"><input aria-label="结束月份 ${index}">
    <input aria-label="公司名称 ${index}"><input aria-label="职位名称 ${index}">
    <input aria-label="工作地点 ${index}"><textarea aria-label="工作职责 ${index}"></textarea>
  `;
  root.appendChild(row);
  return row;
}

beforeEach(() => { document.body.innerHTML = ''; });

describe('work history orchestration', () => {
  it('recognises generic Add only inside an internship/work section', () => {
    const block = document.createElement('section');
    block.innerHTML = '<h2>实习经历 / Internship experience</h2><input><input><input><button>添加 / Add</button>';
    document.body.appendChild(block);
    expect(isSafeWorkHistoryAddButton(block.querySelector('button')!)).toBe(true);

    const awards = document.createElement('section');
    awards.innerHTML = '<h2>获奖情况</h2><input><input><input><button>添加 / Add</button>';
    document.body.appendChild(awards);
    expect(isSafeWorkHistoryAddButton(awards.querySelector('button')!)).toBe(false);
  });

  it('binds each Moka-style row to an independent DOM-order index', () => {
    const block = document.createElement('section');
    block.innerHTML = '<h2>实习经历 / Internship experience</h2><button>添加 / Add</button>';
    document.body.appendChild(block);
    const first = appendWorkRow(block, 1);
    const second = appendWorkRow(block, 2);
    const fields = Array.from(block.querySelectorAll<HTMLElement>('input, textarea'));
    const map = buildWorkHistoryIndexMap(fields);
    expect(map.get(first.querySelector('input')!)).toBe(0);
    expect(map.get(second.querySelector('input')!)).toBe(1);
    expect(bindWorkHistoryPath('workHistory.0.company', 1)).toBe('workHistory.1.company');
    expect(bindWorkHistoryPath('derived.currentCompany', 1)).toBe('workHistory.1.company');
    expect(bindWorkHistoryPath('derived.currentTitle', 1)).toBe('workHistory.1.title');
  });

  it('adds one work row at a time until profile count is reached', async () => {
    const block = document.createElement('section');
    block.innerHTML = '<h2>工作经历 / Work experience</h2><button>添加 / Add</button>';
    document.body.appendChild(block);
    appendWorkRow(block, 1);
    let count = 1;
    block.querySelector('button')!.addEventListener('click', () => appendWorkRow(block, ++count));
    await expect(ensureWorkHistoryRows(3)).resolves.toBe(2);
    expect(block.querySelectorAll('.multi-row')).toHaveLength(3);
  });
});
