import { useMemo } from 'react';
import type { DebugSession } from '@/src/autofill/debug';

const LAYER_LABEL: Record<string, string> = {
  learned:          '已学习',
  autocomplete:     '浏览器语义',
  dictionary_exact: '词典',
  fuzzy:            '模糊匹配',
  context:          '上下文',
  none:             '未匹配',
};

const STATE_DOT: Record<string, string> = {
  green:     'bg-green-500',
  yellow:    'bg-yellow-500',
  red:       'bg-red-500',
  gray:      'bg-gray-400',
  unchanged: 'bg-gray-300 dark:bg-gray-600',
};

const STATE_LABEL: Record<string, string> = {
  green:     '成功',
  yellow:    '需检查',
  red:       '失败',
  gray:      '无数据',
  unchanged: '未更改',
};

function StateDot({ state }: { state: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className={`inline-block w-2 h-2 rounded-full ${STATE_DOT[state] ?? 'bg-gray-300'}`} />
      <span className="text-[10px] text-gray-500 dark:text-gray-400">{STATE_LABEL[state] ?? state}</span>
    </span>
  );
}

export function DebugPanel({
  session,
  onClose,
}: {
  session: DebugSession;
  onClose: () => void;
}) {
  const aiByFieldId = useMemo(
    () => new Map(session.ai.map((a) => [a.fieldId, a])),
    [session.ai],
  );
  const scannerByFieldId = useMemo(
    () => new Map(session.scanner.map((s) => [s.fieldId, s])),
    [session.scanner],
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl dark:shadow-black/60 w-full max-w-md flex flex-col max-h-[90vh] text-gray-900 dark:text-gray-100"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700 shrink-0">
          <h3 className="text-sm font-semibold">自动填写调试</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 text-xl leading-none"
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-5 text-xs">

          {/* ── Manual Mapping ──────────────────────────────────────────── */}
          <section>
            <h4 className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">
              规则映射（{session.mapping.length}）
            </h4>
            {session.mapping.length === 0 ? (
              <p className="text-gray-400 dark:text-gray-500 italic">没有映射数据。</p>
            ) : (
              <ul className="space-y-1.5">
                {session.mapping.map((m) => {
                  const scanned = scannerByFieldId.get(m.fieldId);
                  return (
                    <li key={m.fieldId} className="px-2 py-1.5 bg-gray-50 dark:bg-gray-800 rounded">
                      <div className="flex items-baseline gap-1.5">
                        <span className="font-mono text-[10px] text-gray-400">{m.fieldId}</span>
                        <span className="font-medium truncate">{scanned?.label || '（无标签）'}</span>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-gray-600 dark:text-gray-400">
                        <span>{LAYER_LABEL[m.matchLayer]}</span>
                        <span>·</span>
                        <span>置信度={m.confidence.toFixed(2)}</span>
                        <span>·</span>
                        <StateDot state={m.finalState} />
                      </div>
                      {m.profilePath && (
                        <div className="font-mono text-[10px] text-blue-600 dark:text-blue-400 truncate">{m.profilePath}</div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {/* ── AI Mapping ──────────────────────────────────────────────── */}
          <section>
            <h4 className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">
              AI 映射（{session.ai.length}）
            </h4>
            {session.aiSkipped ? (
              <p className="text-gray-400 dark:text-gray-500 italic">未配置 API 密钥，已跳过 AI 层。</p>
            ) : session.ai.length === 0 ? (
              <p className="text-gray-400 dark:text-gray-500 italic">没有发送给 AI 的字段。</p>
            ) : (
              <ul className="space-y-1.5">
                {Array.from(aiByFieldId.values()).map((a) => (
                  <li key={a.fieldId} className="px-2 py-1.5 bg-gray-50 dark:bg-gray-800 rounded">
                    <div className="flex items-baseline gap-1.5">
                      <span className="font-mono text-[10px] text-gray-400">{a.fieldId}</span>
                      <span className="font-medium truncate">{a.label || '（无标签）'}</span>
                      <span className="text-[10px] text-gray-400">[{a.type}]</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-gray-600 dark:text-gray-400">
                      <span>AI 置信度={a.aiConfidence ?? '无'}</span>
                      <span>·</span>
                      <StateDot state={a.finalState} />
                    </div>
                    {a.aiResult && (
                      <div className="font-mono text-[10px] text-purple-600 dark:text-purple-400 truncate">{a.aiResult}</div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

        </div>

      </div>
    </div>
  );
}
