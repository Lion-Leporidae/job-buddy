// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { bindAwardPath, buildAwardIndexMap, ensureAwardRows, findAwardAddButton } from './awardOrchestrator';

function appendAward(index: number): void {
  const row = document.createElement('section');
  row.innerHTML = `<h3>获奖 ${index}</h3><label>获奖项<input name="award-name-${index}" /></label><label>获奖描述<textarea name="award-desc-${index}"></textarea></label>`;
  document.body.appendChild(row);
}

beforeEach(() => { document.body.innerHTML = ''; });

describe('award orchestration', () => {
  it('binds award rows in DOM order', () => {
    appendAward(1);
    appendAward(2);
    const fields = Array.from(document.querySelectorAll<HTMLElement>('input, textarea'));
    const indexes = buildAwardIndexMap(fields);
    expect(indexes.get(fields[0])).toBe(0);
    expect(indexes.get(fields[2])).toBe(1);
    expect(bindAwardPath('awards.0.description', 1)).toBe('awards.1.description');
  });

  it('clicks a safe add-award button until enough rows exist', async () => {
    appendAward(1);
    const button = document.createElement('button');
    button.textContent = '添加获奖';
    let count = 1;
    button.addEventListener('click', () => appendAward(++count));
    document.body.appendChild(button);
    expect(findAwardAddButton()).toBe(button);
    await expect(ensureAwardRows(3)).resolves.toBe(2);
    expect(document.querySelectorAll('section')).toHaveLength(3);
  });
});
