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

function appendProject(index: number, root: HTMLElement = document.body): HTMLElement {
  const row = document.createElement('div');
  row.innerHTML = `
    <h3>项目 ${index}</h3>
    <label for="project-name-${index}">项目名称</label>
    <input id="project-name-${index}" />
    <label for="project-desc-${index}">项目描述</label>
    <textarea id="project-desc-${index}"></textarea>
  `;
  root.appendChild(row);
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
    const block = document.createElement('section');
    block.innerHTML = '<h2>项目经历 / Projects</h2><button>添加 / Add</button>';
    document.body.appendChild(block);
    appendProject(1, block);
    appendProject(2, block);
    const fields = Array.from(document.querySelectorAll<HTMLElement>('input, textarea'));
    const indexes = buildProjectIndexMap(fields);
    expect(indexes.get(fields[0])).toBe(0);
    expect(indexes.get(fields[2])).toBe(1);
    expect(bindProjectPath('projects.0.description', 1)).toBe('projects.1.description');
    expect(bindProjectPath('derived.currentTitle', 1)).toBe('projects.1.role');
    expect(projectContextLabel('项目名称', 1)).toBe('第 2 条项目：项目名称');
  });

  it('uses the ancestor section for Moka-style generic add buttons', () => {
    const block = document.createElement('section');
    block.innerHTML = '<h2>项目经历 / Projects</h2><div><button>添加 / Add</button></div><input><textarea></textarea>';
    document.body.appendChild(block);
    const add = block.querySelector('button')!;
    expect(isSafeProjectAddButton(add)).toBe(true);

    const school = document.createElement('section');
    school.innerHTML = '<h2>教育经历</h2><input><input><button>添加学校全称</button>';
    document.body.appendChild(school);
    expect(isSafeProjectAddButton(school.querySelector('button')!)).toBe(false);
  });

  it('clicks add once at a time until enough rows exist', async () => {
    const block = document.createElement('section');
    block.innerHTML = '<h2>项目经历 / Projects</h2>';
    document.body.appendChild(block);
    appendProject(1, block);
    const button = document.createElement('button');
    button.textContent = '添加 / Add';
    let count = 1;
    button.addEventListener('click', () => appendProject(++count, block));
    block.appendChild(button);

    await expect(ensureProjectRows(3)).resolves.toBe(2);
    expect(block.querySelectorAll('div')).toHaveLength(3);
  });

  it('creates the first row when a semantic section initially has none', async () => {
    const block = document.createElement('section');
    block.innerHTML = '<h2>项目经历</h2><div class="add-entry">+ 添加</div>';
    document.body.appendChild(block);
    const add = block.querySelector<HTMLElement>('.add-entry')!;
    add.addEventListener('click', () => appendProject(1, block));
    await expect(ensureProjectRows(1)).resolves.toBe(1);
    expect(block.querySelectorAll('input, textarea')).toHaveLength(2);
  });

  it('supports component-style modules, div add controls and explicit repeat rows', async () => {
    const module = document.createElement('div');
    module.className = 'resume-module';
    module.innerHTML = `
      <div class="resume-module-header"><div class="resume-module-title">项目经历</div></div>
      <form>
        <div class="repeat-wrap"><input aria-label="项目名称"><textarea aria-label="项目简介"></textarea></div>
        <div class="add-entry"><font><font>+ 添加</font></font></div>
      </form>`;
    document.body.appendChild(module);
    const add = module.querySelector<HTMLElement>('.add-entry')!;
    let count = 1;
    add.addEventListener('click', () => {
      const row = document.createElement('div');
      row.className = 'repeat-wrap';
      row.innerHTML = `<input aria-label="项目名称 ${++count}"><textarea aria-label="项目简介 ${count}"></textarea>`;
      add.before(row);
    });

    expect(findProjectAddButton()).toBe(add);
    await expect(ensureProjectRows(3)).resolves.toBe(2);
    const fields = Array.from(module.querySelectorAll<HTMLElement>('input, textarea'));
    const indexes = buildProjectIndexMap(fields);
    expect(new Set(indexes.values())).toEqual(new Set([0, 1, 2]));
  });
});
