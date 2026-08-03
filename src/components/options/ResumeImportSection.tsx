import { useState, useEffect, useRef, useCallback } from 'react';
import type { Profile, DocumentFile } from '@/src/types/profile';
import { getAIConfig } from '@/src/utils/storage';
import { extractResumeWithAI } from '@/src/resume-ai/resumeProvider';
import { extractLinks } from '@/src/resume-ai/extractLinks';
import { generateDiff, applyChanges } from '@/src/resume-ai/parser';
import type {
  AIConfig,
  FieldChange,
  ImportProgressStep,
  ImportErrorCode,
} from '@/src/resume-ai/types';
import { useToast } from '@/src/components/ui/useToast';
import ImportSummaryDialog from '@/src/components/shared/ImportSummaryDialog';
import ImportReviewScreen from '@/src/components/shared/ImportReviewScreen';

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB
const LONG_WAIT_MS = 8_000;
const FILE_CHANGE_ID = '__cv_file__';

const PROGRESS_STEPS: { id: ImportProgressStep; label: string }[] = [
  { id: 'reading', label: '正在读取文件…' },
  { id: 'sending', label: '正在发送给 AI…' },
  { id: 'processing', label: '正在处理结果…' },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeFileChange(file: File): FieldChange {
  return {
    id: FILE_CHANGE_ID,
    label: '简历文件',
    section: 'Documents',
    currentValue: null,
    suggestedValue: file.name,
    displayCurrent: '',
    displaySuggested: file.name,
    status: 'new',
    accepted: true,
  };
}

function getMimeType(file: File): string {
  if (file.type === 'application/pdf' || file.name.endsWith('.pdf')) return 'application/pdf';
  if (
    file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    file.name.endsWith('.docx')
  )
    return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  throw new Error('Unsupported file type');
}

function fileToDataUri(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  profile: Partial<Profile>;
  onSave: (updates: Partial<Profile>) => Promise<void>;
  onGoToApiKey: () => void;
  onClose: () => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

type Screen = 'dialog' | 'progress' | 'summary' | 'review' | 'done';

export function ResumeImportSection({ profile, onSave, onGoToApiKey, onClose }: Props) {
  const { showToast } = useToast();
  const [screen, setScreen] = useState<Screen>('dialog');
  const [aiConfig, setAIConfig] = useState<AIConfig | null | undefined>(undefined);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileDataUri, setFileDataUri] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [progressStep, setProgressStep] = useState<ImportProgressStep | null>(null);
  const [showLongWait, setShowLongWait] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<ImportErrorCode | null>(null);
  const [changes, setChanges] = useState<FieldChange[]>([]);
  const [saving, setSaving] = useState(false);
  const [summary, setSummary] = useState<{
    updated: number;
    conflicts: number;
    skipped: number;
  } | null>(null);
  const [extractedLinks, setExtractedLinks] = useState<string[]>([]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const longWaitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load the selected provider's API configuration on mount.
  useEffect(() => {
    getAIConfig().then(setAIConfig);
    return () => {
      abortControllerRef.current?.abort();
      if (longWaitTimerRef.current) clearTimeout(longWaitTimerRef.current);
    };
  }, []);

  // Escape key cancels in-progress analysis
  const handleCancel = useCallback(() => {
    abortControllerRef.current?.abort();
    if (longWaitTimerRef.current) clearTimeout(longWaitTimerRef.current);
    setShowLongWait(false);
    setProgressStep(null);
    setErrorMsg(null);
    setErrorCode(null);
    setScreen('dialog');
  }, []);

  useEffect(() => {
    if (screen !== 'progress') return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleCancel();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [screen, handleCancel]);

  // ── Helpers ──────────────────────────────────────────────────────────────────

  const closeSection = useCallback(() => {
    abortControllerRef.current?.abort();
    if (longWaitTimerRef.current) clearTimeout(longWaitTimerRef.current);
    onClose();
  }, [onClose]);

  const goToSettings = useCallback(() => {
    abortControllerRef.current?.abort();
    if (longWaitTimerRef.current) clearTimeout(longWaitTimerRef.current);
    onGoToApiKey();
  }, [onGoToApiKey]);

  const handleFileSelect = (file: File) => {
    try {
      getMimeType(file);
    } catch {
      setErrorMsg('仅支持 PDF 和 DOCX 文件。');
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setErrorMsg('简历文件过大，最大支持 10 MB。');
      return;
    }
    setErrorMsg(null);
    setSelectedFile(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFileSelect(file);
  };

  // ── Extract core (shared between handleExtract and handleRetry) ──────────────

  const runExtractCore = async (file: File, controller: AbortController, links: string[]) => {
    try {
      setProgressStep('sending');
      const extracted = await extractResumeWithAI(
        aiConfig!,
        file,
        profile,
        controller.signal,
        links,
      );

      setProgressStep('processing');
      const aiChanges = generateDiff(profile, extracted);

      setChanges([makeFileChange(file), ...aiChanges]);
      setScreen('summary');
    } catch (err) {
      if ((err as { name?: string })?.name === 'AbortError') return;
      const e = err as { name?: string; message?: string; code?: ImportErrorCode };
      setErrorCode(e.code ?? null);
      setErrorMsg(e.message ?? '处理失败，请重试。');
    } finally {
      if (longWaitTimerRef.current) clearTimeout(longWaitTimerRef.current);
      setShowLongWait(false);
      setProgressStep(null);
    }
  };

  // ── Extract ───────────────────────────────────────────────────────────────────

  const handleExtract = async () => {
    if (!selectedFile || !aiConfig) return;

    const controller = new AbortController();
    abortControllerRef.current = controller;

    setScreen('progress');
    setErrorMsg(null);
    setErrorCode(null);
    setShowLongWait(false);
    longWaitTimerRef.current = setTimeout(() => setShowLongWait(true), LONG_WAIT_MS);

    try {
      setProgressStep('reading');
      const dataUri = await fileToDataUri(selectedFile);
      setFileDataUri(dataUri);
      const links = await extractLinks(selectedFile);
      setExtractedLinks(links);
      await runExtractCore(selectedFile, controller, links);
    } catch (err) {
      if ((err as { name?: string })?.name === 'AbortError') return;
      const e = err as { name?: string; message?: string; code?: ImportErrorCode };
      setErrorCode(e.code ?? null);
      setErrorMsg(e.message ?? '处理失败，请重试。');
      if (longWaitTimerRef.current) clearTimeout(longWaitTimerRef.current);
      setShowLongWait(false);
      setProgressStep(null);
    }
  };

  // ── Retry (network failure — file already read, skip reading step) ────────────

  const handleRetry = async () => {
    if (!selectedFile || !aiConfig) return;

    const controller = new AbortController();
    abortControllerRef.current = controller;

    setErrorMsg(null);
    setErrorCode(null);
    setShowLongWait(false);
    longWaitTimerRef.current = setTimeout(() => setShowLongWait(true), LONG_WAIT_MS);

    const dataUri = fileDataUri ?? (await fileToDataUri(selectedFile));
    if (!fileDataUri) setFileDataUri(dataUri);

    await runExtractCore(selectedFile, controller, extractedLinks);
  };

  // ── Save ──────────────────────────────────────────────────────────────────────

  const performSave = async (finalChanges: FieldChange[]): Promise<void> => {
    const fileChange = finalChanges.find((c) => c.id === FILE_CHANGE_ID);
    const aiChanges = finalChanges.filter((c) => c.id !== FILE_CHANGE_ID);

    const newAccepted = finalChanges.filter((c) => c.status === 'new' && c.accepted).length;
    const conflictAccepted = finalChanges.filter(
      (c) => c.status === 'conflict' && c.accepted,
    ).length;
    const skipped = finalChanges.filter((c) => c.status !== 'unchanged' && !c.accepted).length;

    let updated = applyChanges(profile, aiChanges);

    if (fileChange?.accepted && selectedFile && fileDataUri) {
      const documentFile: DocumentFile = {
        name: selectedFile.name,
        size: selectedFile.size,
        base64: fileDataUri,
      };
      updated = {
        ...updated,
        documents: {
          ...(updated.documents ?? {}),
          cv: {
            ...(updated.documents?.cv ?? {}),
            file: documentFile,
          },
        },
      };
    }

    setSaving(true);
    try {
      await onSave(updated);
      setSummary({ updated: newAccepted, conflicts: conflictAccepted, skipped });
      setScreen('done');
    } catch {
      showToast('error', '保存失败，请重试。');
    } finally {
      setSaving(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div>
      {/* ════════════════════════════════════════════════════════════════════════
          Upload dialog
          ════════════════════════════════════════════════════════════════════ */}
      {screen === 'dialog' && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={closeSection}
        >
          <div
            className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl dark:shadow-black/60 w-full max-w-lg mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
              <div>
                <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
                  导入简历
                </h3>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                  上传简历后，AI 会提取并建议资料内容；保存前你可以逐项检查。
                </p>
              </div>
              <button
                type="button"
                onClick={closeSection}
                className="ml-4 shrink-0 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 text-xl leading-none active:scale-95 transition-colors"
              >
                ×
              </button>
            </div>

            {/* Body */}
            <div className="px-6 py-5">
              {/* No API key state */}
              {aiConfig === null && (
                <div className="py-6 text-center">
                  <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
                    使用此功能前，请先配置所选 AI 服务的 API Key。
                  </p>
                  <button
                    type="button"
                    onClick={goToSettings}
                    className="text-sm text-blue-600 dark:text-blue-400 hover:underline active:scale-95 font-medium"
                  >
                    前往设置 →
                  </button>
                </div>
              )}

              {/* API key present — show upload area */}
              {aiConfig && (
                <>
                  <div
                    onDragOver={(e) => {
                      e.preventDefault();
                      setIsDragging(true);
                    }}
                    onDragLeave={() => setIsDragging(false)}
                    onDrop={handleDrop}
                    className={`flex flex-col items-center justify-center gap-3 border-2 border-dashed rounded-xl py-10 px-4 transition-colors cursor-pointer ${
                      isDragging
                        ? 'border-blue-400 dark:border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                        : 'border-gray-300 dark:border-gray-600 hover:border-gray-400 dark:hover:border-gray-500'
                    }`}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <span className="text-3xl">📄</span>
                    {selectedFile ? (
                      <>
                        <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                          {selectedFile.name}
                        </p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          {(selectedFile.size / 1024).toFixed(0)} KB · 点击更换
                        </p>
                      </>
                    ) : (
                      <>
                        <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                          将简历拖到此处，或{' '}
                          <span className="text-blue-600 dark:text-blue-400">选择文件</span>
                        </p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          PDF or DOCX · max 10 MB
                        </p>
                      </>
                    )}
                  </div>

                  {errorMsg && (
                    <p className="mt-2 text-sm text-red-500 dark:text-red-400">{errorMsg}</p>
                  )}

                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      e.target.value = '';
                      if (f) handleFileSelect(f);
                    }}
                  />
                </>
              )}

              {/* Still loading key — brief placeholder */}
              {aiConfig === undefined && <div className="py-8" />}
            </div>

            {/* Footer */}
            <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-200 dark:border-gray-700">
              {aiConfig ? (
                <>
                  <button
                    type="button"
                    onClick={closeSection}
                    className="px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 text-sm font-medium rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 active:scale-95 transition-colors"
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    disabled={!selectedFile}
                    onClick={handleExtract}
                    className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 active:scale-95 transition-colors"
                  >
                    分析简历
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={closeSection}
                  className="px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 text-sm font-medium rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 active:scale-95 transition-colors"
                >
                  关闭
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════════
          Progress
          ════════════════════════════════════════════════════════════════════ */}
      {screen === 'progress' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl dark:shadow-black/60 w-full max-w-sm mx-4 px-6 py-8">
            <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-6 text-center">
              正在分析简历…
            </h3>

            <div className="space-y-4">
              {PROGRESS_STEPS.map((step, i) => {
                const currentIdx = PROGRESS_STEPS.findIndex((s) => s.id === progressStep);
                const isDone = !errorMsg && currentIdx > i;
                const isActive = !errorMsg && step.id === progressStep;
                return (
                  <div key={step.id} className="flex items-center gap-3">
                    <div className="w-5 h-5 shrink-0 flex items-center justify-center">
                      {isDone ? (
                        <span className="text-green-500 dark:text-green-400 text-sm">✓</span>
                      ) : isActive ? (
                        <span className="inline-block w-3 h-3 rounded-full bg-blue-500 animate-pulse" />
                      ) : (
                        <span className="inline-block w-2 h-2 rounded-full bg-gray-300 dark:bg-gray-600" />
                      )}
                    </div>
                    <span
                      className={`text-sm ${
                        isActive
                          ? 'font-medium text-gray-900 dark:text-gray-100'
                          : isDone
                            ? 'text-gray-500 dark:text-gray-400'
                            : 'text-gray-400 dark:text-gray-600'
                      }`}
                    >
                      {step.label}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Long wait message */}
            {showLongWait && !errorMsg && (
              <div className="mt-5 text-xs text-amber-500 dark:text-amber-400 text-center">
                <p>本次处理时间比平时更长。</p>
                <p>AI 服务可能繁忙，请稍候。</p>
              </div>
            )}

            {/* Error state */}
            {errorMsg && (
              <div className="mt-6">
                {errorCode === 'rate_limit' ? (
                  <p className="text-sm text-red-500 dark:text-red-400 mb-4">
                    AI 模型当前繁忙，请稍后重试或检查用量：{' '}
                    <a
                      href="https://aistudio.google.com/rate-limit"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline hover:text-red-700 dark:hover:text-red-300"
                    >
                      Google AI Studio
                    </a>
                    .
                  </p>
                ) : (
                  <p className="text-sm text-red-500 dark:text-red-400 mb-4">{errorMsg}</p>
                )}
                <div className="flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={closeSection}
                    className="px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 text-sm font-medium rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 active:scale-95 transition-colors"
                  >
                    关闭
                  </button>
                  <button
                    type="button"
                    onClick={handleRetry}
                    className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 active:scale-95 transition-colors"
                  >
                    重试
                  </button>
                </div>
              </div>
            )}

            {/* Cancel button (only while in-progress, no error) */}
            {!errorMsg && (
              <div className="mt-6 flex justify-center">
                <button
                  type="button"
                  onClick={handleCancel}
                  className="px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 text-sm font-medium rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 active:scale-95 transition-colors"
                >
                  取消
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════════
          Summary — counts of new / conflict / unchanged fields
          ════════════════════════════════════════════════════════════════════ */}
      {screen === 'summary' && (
        <ImportSummaryDialog
          changes={changes}
          title="检查导入建议"
          onAcceptAll={() => void performSave(changes)}
          onRejectAll={() => setScreen('dialog')}
          onReview={() => setScreen('review')}
          isProcessing={saving}
        />
      )}

      {/* ════════════════════════════════════════════════════════════════════════
          Review — per-field accept / reject
          ════════════════════════════════════════════════════════════════════ */}
      {screen === 'review' && (
        <ImportReviewScreen
          changes={changes}
          onSave={performSave}
          onBack={() => setScreen('summary')}
          isSaving={saving}
          title="检查导入建议"
          saveLabel="保存所选内容"
        />
      )}

      {/* ════════════════════════════════════════════════════════════════════════
          Done — summary
          ════════════════════════════════════════════════════════════════════ */}
      {screen === 'done' && summary && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl dark:shadow-black/60 w-full max-w-sm mx-4 px-6 py-8">
            <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-3">
              导入完成
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">
              已更新 {summary.updated} 个字段
              {summary.conflicts > 0
                ? `, ${summary.conflicts} conflict${summary.conflicts !== 1 ? 's' : ''} resolved`
                : ''}
              {summary.skipped > 0 ? `, ${summary.skipped} skipped` : ''}.
            </p>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={closeSection}
                className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 active:scale-95 transition-colors"
              >
                完成
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
