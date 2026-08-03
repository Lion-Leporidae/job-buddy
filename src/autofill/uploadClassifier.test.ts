// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { extractSignals } from './signals';
import { classifyUploadField } from './uploadClassifier';

beforeEach(() => { document.body.innerHTML = ''; });

function inputFrom(html: string): HTMLInputElement {
  document.body.innerHTML = html;
  return document.querySelector<HTMLInputElement>('input[type="file"]')!;
}

describe('upload field classifier', () => {
  it('recognises the 4399 hidden resume input from its nearest resume module', () => {
    const input = inputFrom(`
      <div class="resume-module">
        <h3>简历附件</h3>
        <div class="resume-file-module">
          微信图片_20260224.jpg 重新上传 删除
          <input type="file" class="hidden">
        </div>
      </div>
    `);
    expect(classifyUploadField(input, extractSignals(input))).toBe('resume');
  });

  it('does not classify accept=image or an image-looking filename as a photo by itself', () => {
    const input = inputFrom('<div class="file-module">微信图片.jpg<input type="file" accept="image/*"></div>');
    expect(classifyUploadField(input, extractSignals(input))).toBe('unknown');
  });

  it('recognises explicit avatar/photo upload modules', () => {
    const input = inputFrom('<div class="avatar-upload">头像 + 上传头像<input type="file" accept="image/*"></div>');
    expect(classifyUploadField(input, extractSignals(input))).toBe('photo');
  });

  it('leaves unrelated portfolio attachments unknown', () => {
    const input = inputFrom('<div class="attachment-module">作品附件<input type="file"></div>');
    expect(classifyUploadField(input, extractSignals(input))).toBe('unknown');
  });

  it('does not climb into a whole form containing unrelated resume/photo labels', () => {
    const input = inputFrom(`<div>${'其他字段'.repeat(150)} 简历附件 上传头像 <section>成绩单<input type="file"></section></div>`);
    expect(classifyUploadField(input, extractSignals(input))).toBe('unknown');
  });
});
