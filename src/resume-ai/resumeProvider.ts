import type { Profile } from '@/src/types/profile';
import type { AIConfig } from './types';
import { toGeminiModel } from './types';
import { extractDocumentText } from './documentText';
import { extractFromResume } from './gemini';
import { extractFromResumeWithDeepSeek } from './deepseek';

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function getMimeType(file: File): string {
  return file.name.toLowerCase().endsWith('.pdf')
    ? 'application/pdf'
    : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
}

export async function extractResumeWithAI(
  config: AIConfig,
  file: File,
  currentProfile: Partial<Profile>,
  signal?: AbortSignal,
  links: string[] = [],
): Promise<Partial<Profile>> {
  if (config.provider === 'deepseek') {
    const documentText = await extractDocumentText(file);
    return extractFromResumeWithDeepSeek(
      config.apiKey,
      config.model,
      documentText,
      currentProfile,
      signal,
      links,
    );
  }

  const base64 = await fileToBase64(file);
  return extractFromResume(
    config.apiKey,
    toGeminiModel(config.model),
    base64,
    getMimeType(file),
    currentProfile,
    signal,
    links,
  );
}
