import { useState, useEffect, useCallback } from 'react';
import { Info, CheckCircle } from 'lucide-react';
import { getProfile, getAIConfig } from '@/src/utils/storage';
import { sessionGet, sessionSet } from '@/src/utils/sessionStorage';
import { calculateCompletion } from '@/src/utils/profileCompletion';
import type { DebugSession } from '@/src/autofill/debug';
import { DebugPanel } from './DebugPanel';
import { InfoTooltip } from '@/src/components/ui/InfoTooltip';

interface AutofillResult {
  noReview: number;
  needReview: number;
  lowConfidence: number;
  noData: number;
  totalScanned: number;
  aiAvailable?: boolean;
}

interface AutofillScanResult {
  preFilledCount: number;
}

interface CompletionState {
  percentage: number;
  isCoreComplete: boolean;
  optionalFieldsRemaining: number;
}

// 'confirming' is shown when the scan found pre-filled fields and we need
// the user to choose merge vs overwrite before proceeding.
type AutofillState = 'idle' | 'loading' | 'confirming' | 'success' | 'error';

function App() {
  const [completion, setCompletion] = useState<CompletionState>({
    percentage: 0,
    isCoreComplete: false,
    optionalFieldsRemaining: 0,
  });
  const [loading, setLoading] = useState(true);
  const [autofillState, setAutofillState] = useState<AutofillState>('idle');
  const [autofillResult, setAutofillResult] = useState<AutofillResult | null>(null);
  const [preFilledCount, setPreFilledCount] = useState(0);
  const [fillMode, setFillMode] = useState<'merge' | 'overwrite'>('merge');
  const [nudgeDismissed, setNudgeDismissed] = useState(false);
  const [hasAIKey, setHasAIKey] = useState<boolean | null>(null);
  const [debugSession, setDebugSession] = useState<DebugSession | null>(null);
  const [debugOpen, setDebugOpen] = useState(false);

  useEffect(() => {
    getProfile()
      .then((p) => {
        const r = calculateCompletion(p ?? {});
        setCompletion({
          percentage: r.percentage,
          isCoreComplete: r.isCoreComplete,
          optionalFieldsRemaining: r.optionalFieldsRemaining,
        });
      })
      .catch((err) => {
        console.error('[Job Buddy] Failed to load profile:', err);
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  const sendToActiveTab = useCallback(async (message: object) => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('No active tab found');
    return chrome.tabs.sendMessage(tab.id, message);
  }, []);

  const dispatchFill = useCallback(
    async (mode: 'merge' | 'overwrite') => {
      const result = (await sendToActiveTab({ action: 'AUTOFILL_FILL', mode })) as AutofillResult;
      if (result && typeof result.totalScanned === 'number') {
        setAutofillResult(result);
        setAutofillState('success');
      } else {
        setAutofillState('error');
      }
    },
    [sendToActiveTab],
  );

  // Lazily fetch the debug session from the content script when the user opens
  // the panel — keeps the popup's initial render cheap.
  const openDebugPanel = async () => {
    try {
      const sess = (await sendToActiveTab({ action: 'GET_DEBUG_SESSION' })) as DebugSession | null;
      if (sess) setDebugSession(sess);
    } catch {
      /* content script absent */
    }
    setDebugOpen(true);
  };

  // On mount: restore fill state, check AI nudge dismissal, check Gemini key.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = (await sendToActiveTab({ action: 'GET_STATUS' })) as AutofillResult | null;
        if (!cancelled && result && typeof result.totalScanned === 'number') {
          setAutofillResult(result);
          setAutofillState('success');
        }
      } catch {
        // Content script not loaded on this page — stay in idle state.
      }
    })();
    sessionGet('jb:ai:nudge:dismissed').then((r) => {
      if (!cancelled && r?.['jb:ai:nudge:dismissed']) setNudgeDismissed(true);
    });
    getAIConfig()
      .then((config) => {
        if (!cancelled) setHasAIKey(!!config);
      })
      .catch(() => {
        if (!cancelled) setHasAIKey(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sendToActiveTab]);

  const dismissNudge = () => {
    setNudgeDismissed(true);
    void sessionSet({ 'jb:ai:nudge:dismissed': true });
  };

  const openOptions = () => chrome.runtime.openOptionsPage();

  // Open Settings → AI Features and focus the Gemini API key input.
  // Same end-state as ResumeImportSection's "Go to Settings →" link, but
  // crosses the popup→options-page context boundary via chrome.storage.session.
  const goToSettingsKey = () => {
    dismissNudge();
    void sessionSet({ 'jb:focusOnLoad': 'gemini-api-key' });
    chrome.runtime.openOptionsPage();
  };

  const handleAutofill = async () => {
    setAutofillState('loading');
    setAutofillResult(null);
    try {
      const scan = (await sendToActiveTab({ action: 'AUTOFILL_SCAN' })) as AutofillScanResult;
      if (scan?.preFilledCount > 0) {
        // Form already has data — ask the user how to proceed
        setPreFilledCount(scan.preFilledCount);
        setFillMode('merge');
        setAutofillState('confirming');
      } else {
        await dispatchFill('overwrite');
      }
    } catch {
      setAutofillState('error');
    }
  };

  const handleConfirmFill = async () => {
    setAutofillState('loading');
    try {
      await dispatchFill(fillMode);
    } catch {
      setAutofillState('error');
    }
  };

  const handleCancelFill = () => {
    setAutofillState('idle');
    setAutofillResult(null);
  };

  const handleUndo = async () => {
    try {
      await sendToActiveTab({ action: 'CLEAR' });
    } catch {
      /* ignore — page may have already been refreshed */
    }
    setAutofillState('idle');
    setAutofillResult(null);
  };

  const { percentage, isCoreComplete, optionalFieldsRemaining } = completion;

  // True once loading is done and at least one profile field has been filled.
  const hasProfileData = !loading && percentage > 0;

  const color = percentage >= 80 ? 'green' : percentage >= 50 ? 'yellow' : 'red';
  const colorMap = {
    red: {
      bar: 'bg-red-500',
      text: 'text-red-600 dark:text-red-400',
      badge: 'bg-red-50 border-red-200 dark:bg-red-900/30 dark:border-red-800',
    },
    yellow: {
      bar: 'bg-yellow-500',
      text: 'text-yellow-600 dark:text-yellow-400',
      badge: 'bg-yellow-50 border-yellow-200 dark:bg-yellow-900/30 dark:border-yellow-800',
    },
    green: {
      bar: 'bg-green-500',
      text: 'text-green-600 dark:text-green-400',
      badge: 'bg-green-50 border-green-200 dark:bg-green-900/30 dark:border-green-800',
    },
  }[color];

  return (
    <div className="w-[380px] p-5 font-sans bg-white dark:bg-gray-900">
      {/* Header */}
      <div className="flex items-center gap-2.5 mb-5">
        <img
          src="/icon.svg"
          alt="Job Buddy"
          className="w-8 h-8 shrink-0"
          onClick={(e) => {
            if (e.shiftKey && autofillState === 'success') openDebugPanel();
          }}
        />
        <h1 className="text-base font-bold text-gray-900 dark:text-gray-100 flex-1">Job Buddy</h1>
      </div>

      {/* Completion indicator */}
      {loading ? (
        <div className="h-20 bg-gray-100 dark:bg-gray-800 rounded-xl animate-pulse mb-4" />
      ) : isCoreComplete ? (
        <div className="p-4 rounded-xl border mb-4 bg-green-50 border-green-200 dark:bg-green-900/30 dark:border-green-800 flex flex-col items-center text-center">
          <CheckCircle className="w-8 h-8 text-green-600 dark:text-green-400 mb-2" />
          <span className="text-base font-bold text-green-700 dark:text-green-400">
            资料已就绪，可以开始投递！
          </span>
          {optionalFieldsRemaining > 0 && (
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              还有 {optionalFieldsRemaining} 个选填字段可补充，以提高自动填写覆盖率
            </p>
          )}
        </div>
      ) : (
        <div className={`p-4 rounded-xl border mb-4 ${colorMap.badge}`}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
              资料完整度
            </span>
            <span className={`text-xl font-bold ${colorMap.text}`}>{percentage}%</span>
          </div>
          <div className="w-full bg-white dark:bg-gray-800 bg-opacity-60 rounded-full h-2 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${colorMap.bar}`}
              style={{ width: `${percentage}%` }}
            />
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
            {percentage < 50
              ? '完善资料后即可自动填写招聘表单'
              : '即将完成，请补充剩余资料'}
          </p>
        </div>
      )}

      {/* CTA button */}
      <button
        onClick={openOptions}
        className="w-full py-2.5 px-4 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 active:bg-blue-800 transition-colors mb-4"
      >
        {isCoreComplete ? '编辑资料' : '完善个人资料'}
      </button>

      {/* Autofill panel */}
      <div className="p-4 bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-1.5 mb-3">
          <p className="text-xs text-gray-500 dark:text-gray-400 font-semibold uppercase tracking-wide">
            自动填写
          </p>
          {hasAIKey === false && (
            <div className="relative group shrink-0">
              <button
                type="button"
                onClick={goToSettingsKey}
                className="flex items-center justify-center text-gray-400 dark:text-gray-500 hover:text-gray-500 dark:hover:text-gray-400 active:scale-95 transition-colors"
              >
                <Info className="w-4 h-4" />
              </button>
              <div className="pointer-events-none absolute bottom-full left-0 z-50 mb-1.5 w-52 rounded-md bg-gray-800 dark:bg-gray-700 px-2 py-1.5 text-[11px] leading-snug text-white shadow-md opacity-0 group-hover:opacity-100 transition-opacity">
                当前使用规则匹配。在设置中添加 AI Key 可提高识别准确率。
              </div>
            </div>
          )}
        </div>

        {/* Loading skeleton */}
        {loading ? (
          <div className="h-9 bg-gray-200 dark:bg-gray-700 rounded-lg animate-pulse" />
        ) : !hasProfileData ? (
          /* ── State 1: no profile data ── */
          <p className="text-sm text-gray-600 dark:text-gray-300 leading-snug">
            请先完善个人资料，再开始自动填写。
          </p>
        ) : autofillState === 'confirming' ? (
          /* ── State 2a: merge / overwrite confirmation dialog ── */
          <div>
            <p className="text-sm font-medium text-gray-800 dark:text-gray-200 mb-1">
              当前表单已经填写了部分内容。
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
              已有 {preFilledCount} 个字段包含内容，请选择填写方式。
            </p>

            <div className="space-y-2 mb-4">
              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="radio"
                  name="fillMode"
                  value="merge"
                  checked={fillMode === 'merge'}
                  onChange={() => setFillMode('merge')}
                  className="mt-0.5 shrink-0"
                />
                <div>
                  <span className="text-sm font-medium text-gray-800 dark:text-gray-200">
                    合并填写
                  </span>
                  <p className="text-xs text-gray-500 dark:text-gray-400 leading-snug">
                    只填写空白字段，保留已有内容
                  </p>
                </div>
              </label>

              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="radio"
                  name="fillMode"
                  value="overwrite"
                  checked={fillMode === 'overwrite'}
                  onChange={() => setFillMode('overwrite')}
                  className="mt-0.5 shrink-0"
                />
                <div>
                  <span className="text-sm font-medium text-gray-800 dark:text-gray-200">
                    覆盖填写
                  </span>
                  <p className="text-xs text-gray-500 dark:text-gray-400 leading-snug">
                    用个人资料替换所有匹配字段
                  </p>
                </div>
              </label>
            </div>

            <div className="flex gap-2">
              <button
                onClick={handleCancelFill}
                className="flex-1 py-2 px-3 border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 text-sm font-medium rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 active:scale-95 transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleConfirmFill}
                className="flex-1 py-2 px-3 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 active:scale-95 transition-colors"
              >
                继续
              </button>
            </div>
          </div>
        ) : (
          /* ── State 2b: normal autofill controls ── */
          <>
            {/* Auto Fill button */}
            <button
              onClick={handleAutofill}
              disabled={autofillState === 'loading'}
              className="w-full py-2.5 px-4 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50 active:scale-95 transition-colors mb-2"
            >
              {autofillState === 'loading' ? '正在填写…' : '一键填写 ✨'}
            </button>

            {/* Undo — only visible after a fill has run in this session */}
            {autofillState === 'success' && (
              <button
                onClick={handleUndo}
                className="w-full py-2 px-4 border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 text-sm font-medium rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 active:scale-95 transition-colors"
              >
                撤销填写
              </button>
            )}

            {autofillState === 'success' &&
              autofillResult?.aiAvailable === false &&
              !nudgeDismissed && (
                <div className="mt-2 flex items-start gap-2 px-3 py-2.5 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
                  <span className="flex-1 text-xs text-blue-700 dark:text-blue-300 leading-snug">
                    Add an AI key in{' '}
                    <button
                      type="button"
                      onClick={goToSettingsKey}
                      className="underline font-medium hover:text-blue-900 dark:hover:text-blue-200 active:scale-95"
                    >
                      设置
                    </button>{' '}
                    中添加 AI Key，提高自动填写准确率。
                  </span>
                  <button
                    type="button"
                    onClick={dismissNudge}
                    className="shrink-0 text-blue-400 hover:text-blue-600 dark:text-blue-500 dark:hover:text-blue-300 text-base leading-none active:scale-95"
                  >
                    ×
                  </button>
                </div>
              )}

            {/* Result summary — no fields found */}
            {autofillState === 'success' && autofillResult && autofillResult.totalScanned === 0 && (
              <div className="mt-3 p-3 bg-gray-50 dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 text-xs text-gray-700 dark:text-gray-300 leading-relaxed">
                <p className="font-medium mb-1">当前页面没有发现可填写字段。</p>
                <p className="text-gray-500 dark:text-gray-400 mb-2.5">
                  页面可能使用了暂不支持的 iframe 或非标准自定义表单。
                </p>
                <p className="text-gray-500 dark:text-gray-400 mb-1">发现问题？请反馈：</p>
                <a
                  href="https://github.com/myowinthein/job-buddy/issues/new"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 underline font-medium"
                >
                  在 GitHub 提交问题
                </a>
              </div>
            )}

            {/* Result summary — normal */}
            {autofillState === 'success' && autofillResult && autofillResult.totalScanned > 0 && (
              <div className="mt-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-xs">
                {/* ── Filled header ── */}
                <div className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-50 dark:bg-gray-800 rounded-t-lg">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                    已填写
                  </span>
                  <span className="text-[11px] font-bold text-gray-600 dark:text-gray-300">
                    ({autofillResult.noReview + autofillResult.needReview})
                  </span>
                </div>

                {/* No Review + Review — side by side */}
                <div className="flex items-center justify-between px-3 py-2 border-t border-gray-100 dark:border-gray-700">
                  <span className="flex items-center gap-1 text-gray-600 dark:text-gray-300">
                    <span className="text-green-600 dark:text-green-400 font-semibold">✓</span>
                    无需检查
                    <span className="font-medium text-gray-600 dark:text-gray-300">
                      {autofillResult.noReview}
                    </span>
                    <InfoTooltip text="该字段已填写，匹配结果可靠。" />
                  </span>
                  <span className="flex items-center gap-1 text-gray-600 dark:text-gray-300">
                    <span className="text-yellow-600 dark:text-yellow-400 font-semibold">⚠</span>
                    建议检查
                    <span className="font-medium text-gray-600 dark:text-gray-300">
                      {autofillResult.needReview}
                    </span>
                    <InfoTooltip
                      text="已自动填写，但匹配置信度较低，请检查或修改。"
                      align="right"
                    />
                  </span>
                </div>

                {/* ── Not Filled header ── */}
                <div className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-50 dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                    未填写
                  </span>
                  <span className="text-[11px] font-bold text-gray-600 dark:text-gray-300">
                    ({autofillResult.lowConfidence + autofillResult.noData})
                  </span>
                </div>

                {/* No Match + No Data — side by side */}
                <div className="flex items-center justify-between px-3 py-2 border-t border-gray-100 dark:border-gray-700">
                  <span className="flex items-center gap-1 text-gray-600 dark:text-gray-300">
                    <span className="text-red-500 dark:text-red-400 font-semibold">✗</span>
                    无法匹配
                    <span className="font-medium text-gray-600 dark:text-gray-300">
                      {autofillResult.lowConfidence}
                    </span>
                    <InfoTooltip text="无法可靠识别该字段，点击后可手动选择资料。" />
                  </span>
                  <span className="flex items-center gap-1 text-gray-600 dark:text-gray-300">
                    <span className="text-gray-400 dark:text-gray-500">○</span>
                    资料缺失
                    <span className="font-medium text-gray-600 dark:text-gray-300">
                      {autofillResult.noData}
                    </span>
                    <InfoTooltip
                      text="个人资料中暂无对应内容，点击后可选择其他资料。"
                      align="right"
                    />
                  </span>
                </div>
              </div>
            )}

            {/* Error state */}
            {autofillState === 'error' && (
              <p className="mt-3 text-xs text-red-500 dark:text-red-400 text-center leading-snug">
                无法连接到当前页面。
                <br />
                请刷新页面后再次点击“一键填写”。
              </p>
            )}
          </>
        )}
      </div>

      {debugOpen && debugSession && (
        <DebugPanel session={debugSession} onClose={() => setDebugOpen(false)} />
      )}
    </div>
  );
}

export default App;
