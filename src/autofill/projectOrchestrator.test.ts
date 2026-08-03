// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  bindProjectPath,
  buildProjectIndexMap,
  ensureProjectRows,
  findProjectAddButton,
  isSafeProjectAddButton,
  projectContextLabel,
} from './projectOrchestrator';

function appendProject(index: number): HTMLElement {
  const row = document.createElement('section');
  row.innerHTML = `
    <h3>项目 ${index}</h3>
    <label for="project-name-${index}">项目名称</label>
    <input id="project-name-${index}" />
    <label for="project-desc-${index}">项目描述</label>
    <textarea id="project-desc-${index}"></textarea>
  `;
  document.body.appendChild(row);
  return row;
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('project orchestration', () => {
  it('accepts only semantically clear and safe add-project buttons', () => {
    const add = document.createElement('button');
    add.textContent = '添加项目经历';
    document.body.appendChild(add);
    expect(isSafeProjectAddButton(add)).toBe(true);
    expect(findProjectAddButton()).toBe(add);

    add.textContent = '删除项目';
    expect(isSafeProjectAddButton(add)).toBe(false);
  });

  it('binds rows in DOM order and rewrites project paths', () => {
    appendProject(1);
    appendProject(2);
    const fields = Array.from(document.querySelectorAll<HTMLElement>('input, textarea'));
    const indexes = buildProjectIndexMap(fields);
    expect(indexes.get(fields[0])).toBe(0);
    expect(indexes.get(fields[2])).toBe(1);
    expect(bindProjectPath('projects.0.description', 1)).toBe('projects.1.description');
    expect(projectContextLabel('项目名称', 1)).toBe('第 2 个项目：项目名称');
  });

  it('clicks add once at a time until enough rows exist', async () => {
    appendProject(1);
    const button = document.createElement('button');
    button.textContent = '添加项目';
    let count = 1;
    button.addEventListener('click', () => appendProject(++count));
    document.body.appendChild(button);

    await expect(ensureProjectRows(3)).resolves.toBe(2);
    expect(document.querySelectorAll('section')).toHaveLength(3);
  });
});
