import { useState, useRef, useEffect, useCallback } from 'react';
import type { Profile } from '@/src/types/profile';
import type {
  LearnedMappings,
  ApplicationEntry,
  DriveBackupFile,
  DriveError,
  AIUsageStats,
} from '@/src/types/storage';
import {
  getProfile,
  saveProfile,
  getLearnedMappings,
  getApplicationHistory,
  saveLearnedMappings,
  saveApplicationHistory,
  clearAllStorage,
  getGeminiApiKey,
  saveGeminiApiKey,
  getGeminiModel,
  saveGeminiModel,
  clearGeminiSettings,
  getAIProvider,
  saveAIProvider,
  getDeepSeekApiKey,
  saveDeepSeekApiKey,
  getDeepSeekModel,
  saveDeepSeekModel,
  clearDeepSeekSettings,
  saveThemePreference,
  getAIUsage,
} from '@/src/utils/storage';
import { applyTheme, getCurrentTheme } from '@/src/utils/theme';
import type { ThemePreference } from '@/src/utils/theme';
import { calculateCompletion } from '@/src/utils/profileCompletion';
import { validateImportedProfile } from '@/src/utils/profileValidator';
import type { InvalidField } from '@/src/utils/profileValidator';
import { useToast } from '@/src/components/ui/useToast';
import { validateProviderApiKey } from '@/src/resume-ai/provider';
import {
  getFullDriveState,
  connectDrive,
  disconnectDrive,
  syncProfileToDrive,
  overwriteDriveWithLocal,
  isDriveConfigured,
} from '@/src/utils/driveSync';
import { generateDiff, applyChanges } from '@/src/resume-ai/parser';
import { DEFAULT_DEEPSEEK_MODEL, DEFAULT_GEMINI_MODEL } from '@/src/resume-ai/types';
import type { AIProvider, FieldChange } from '@/src/resume-ai/types';
import ImportSummaryDialog from '@/src/components/shared/ImportSummaryDialog';
import ImportReviewScreen from '@/src/components/shared/ImportReviewScreen';

interface Props {
  onImportComplete: () => void;
  onResetComplete: () => void;
}

interface ExportData {
  _comment?: string;
  version: string;
  profileId?: string;
  exportedAt: string;
  profile: Profile;
  learnedMappings: LearnedMappings;
  applicationHistory: ApplicationEntry[];
}

interface ParsedImport {
  sanitized: Partial<Profile>;
  invalidFields: InvalidField[];
  exportData: ExportData;
}

// ── Drive timestamp formatter ────────────────────────────────────────────────
// Timestamps are stored as UTC ISO strings. Display converts to local timezone:
//   "Today at HH:mm" / "Yesterday at HH:mm" / full locale date for older entries.
function fmtDriveTimestamp(iso: string | null): string {
  if (!iso) return 'Not synced yet';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return 'Not synced yet';

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const startOfD = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const diffDays = Math.round((startOfToday - startOfD) / 86_400_000);
    const timeStr = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

    if (diffDays === 0) return `Today at ${timeStr}`;
    if (diffDays === 1) return `Yesterday at ${timeStr}`;

    return d.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return 'Not synced yet';
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export function SettingsSection({ onImportComplete, onResetComplete }: Props) {
  const { showToast } = useToast();
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [showResetDialog, setShowResetDialog] = useState(false);
  const [resetConfirmText, setResetConfirmText] = useState('');
  const [resetting, setResetting] = useState(false);

  const [parsedImport, setParsedImport] = useState<ParsedImport | null>(null);
  const [importScreen, setImportScreen] = useState<'idle' | 'summary' | 'review'>('idle');
  const [importChanges, setImportChanges] = useState<FieldChange[]>([]);
  const [importBaseProfile, setImportBaseProfile] = useState<Partial<Profile>>({});

  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Appearance state ─────────────────────────────────────────────────────────
  // getCurrentTheme() is synchronous — initTheme() is awaited before React
  // renders, so the correct preference is already cached in theme.ts.
  const [themePreference, setThemePreference] = useState<ThemePreference>(getCurrentTheme);

  const handleThemeChange = (value: ThemePreference) => {
    setThemePreference(value);
    applyTheme(value);
    void saveThemePreference(value);
  };

  // ── AI Features state ────────────────────────────────────────────────────────
  const [aiProvider, setAIProvider] = useState<AIProvider>('deepseek');
  const [aiKey, setAIKey] = useState('');
  const [aiKeyStatus, setAIKeyStatus] = useState<
    'idle' | 'validating' | 'valid' | 'invalid' | 'no_model'
  >('idle');
  const [_aiModel, setAIModel] = useState<string | null>(null);
  const aiDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const probeIdRef = useRef(0);
  const [aiUsage, setAIUsage] = useState<AIUsageStats | null>(null);

  // ── Cloud Backup state ───────────────────────────────────────────────────────
  const [driveState, setDriveState] = useState<{
    connected: boolean;
    lastSynced: string | null;
    pendingSync: boolean;
    error: DriveError;
  }>({ connected: false, lastSynced: null, pendingSync: false, error: null });
  const [driveConnecting, setDriveConnecting] = useState(false);
  const [driveSyncing, setDriveSyncing] = useState(false);
  const [driveDisconnectDialog, setDriveDisconnectDialog] = useState(false);
  const [disconnectDeleteBackup, setDisconnectDeleteBackup] = useState(false);
  const [driveRestoreCase, setDriveRestoreCase] = useState<'empty' | 'conflict' | null>(null);
  const [driveRestoreData, setDriveRestoreData] = useState<DriveBackupFile | null>(null);
  const [driveLocalProfile, setDriveLocalProfile] = useState<Partial<Profile> | null>(null);
  const [driveRestoreBusy, setDriveRestoreBusy] = useState(false);
  const [driveConflictChanges, setDriveConflictChanges] = useState<FieldChange[]>([]);
  const [driveConflictScreen, setDriveConflictScreen] = useState<'summary' | 'review'>('summary');
  const [resetScope, setResetScope] = useState<'device' | 'everywhere'>('device');

  const loadAISettings = useCallback(async (provider: AIProvider) => {
    const [key, model] =
      provider === 'deepseek'
        ? await Promise.all([getDeepSeekApiKey(), getDeepSeekModel()])
        : await Promise.all([getGeminiApiKey(), getGeminiModel()]);
    setAIKey(key ?? '');
    setAIModel(model);
    setAIKeyStatus(key ? 'valid' : 'idle');
  }, []);

  useEffect(() => {
    getAIProvider().then((provider) => {
      setAIProvider(provider);
      void saveAIProvider(provider);
      void loadAISettings(provider);
    });
  }, [loadAISettings]);

  useEffect(() => {
    void getAIUsage().then(setAIUsage).catch(() => setAIUsage(null));
  }, []);

  // ── Cloud Backup — load state and listen for cross-component updates ────────
  useEffect(() => {
    const handler = () => {
      void getFullDriveState()
        .then(setDriveState)
        .catch(() => {
          /* silent */
        });
    };
    handler();
    window.addEventListener('jb:drive:state-changed', handler);
    return () => window.removeEventListener('jb:drive:state-changed', handler);
  }, []);

  const handleAIProviderChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const provider = e.target.value as AIProvider;
    if (aiDebounceRef.current) clearTimeout(aiDebounceRef.current);
    probeIdRef.current++;
    setAIProvider(provider);
    setAIKey('');
    setAIKeyStatus('idle');
    void saveAIProvider(provider);
    void loadAISettings(provider);
  };

  const handleAIKeyChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const key = e.target.value;
    setAIKey(key);
    if (aiDebounceRef.current) clearTimeout(aiDebounceRef.current);

    if (!key.trim()) {
      setAIKeyStatus('idle');
      setAIModel(null);
      void (aiProvider === 'deepseek' ? clearDeepSeekSettings() : clearGeminiSettings());
      return;
    }

    aiDebounceRef.current = setTimeout(async () => {
      const trimmed = key.trim();
      const probeId = ++probeIdRef.current;
      const provider = aiProvider;
      setAIKeyStatus('validating');
      const result = await validateProviderApiKey(provider, trimmed);
      if (probeId !== probeIdRef.current) return;

      if (result.valid) {
        const model =
          result.model ?? (provider === 'deepseek' ? DEFAULT_DEEPSEEK_MODEL : DEFAULT_GEMINI_MODEL);
        if (provider === 'deepseek') {
          await Promise.all([saveDeepSeekApiKey(trimmed), saveDeepSeekModel(model)]);
        } else {
          await Promise.all([saveGeminiApiKey(trimmed), saveGeminiModel(model)]);
        }
        await saveAIProvider(provider);
        setAIModel(model);
        setAIKeyStatus('valid');
        showToast('success', `${provider === 'deepseek' ? 'DeepSeek' : 'Gemini'} API key saved.`);
      } else if (result.keyValidNoModel) {
        setAIKeyStatus('no_model');
      } else if (result.keyInvalid) {
        setAIModel(null);
        setAIKeyStatus('invalid');
      } else {
        setAIKeyStatus('idle');
      }
    }, 800);
  };

  // ── Export ──────────────────────────────────────────────────────────────────

  const handleExport = async () => {
    try {
      const [profile, learnedMappings, applicationHistory] = await Promise.all([
        getProfile(),
        getLearnedMappings(),
        getApplicationHistory(),
      ]);

      if (!profile) {
        showToast('warning', 'No profile data to export.');
        return;
      }

      const exportData = {
        _comment:
          'This is your Job Buddy profile backup. Import it back into the Job Buddy extension to restore your data.',
        version: '1.0',
        profileId: profile.id,
        exportedAt: new Date().toISOString(),
        profile,
        learnedMappings,
        applicationHistory,
      };

      const json = JSON.stringify(exportData, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `job-buddy-profile-${profile.id.slice(0, 8)}-${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);

      showToast('success', 'Profile exported successfully');
    } catch (err) {
      console.error('[Job Buddy] Export failed:', err);
      showToast('error', 'Failed to export profile');
    }
  };

  // ── Import — file selection ──────────────────────────────────────────────────

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset so the same file can be selected again
    e.target.value = '';
    if (!file) return;

    setImportError(null);

    let parsed: unknown;
    try {
      const text = await file.text();
      parsed = JSON.parse(text);
    } catch {
      showToast('error', 'Invalid file. Please select a valid Job Buddy export file.');
      return;
    }

    if (typeof parsed !== 'object' || parsed === null || !('profile' in (parsed as object))) {
      showToast('error', 'Invalid file. Please select a valid Job Buddy export file.');
      return;
    }

    const exportData = parsed as ExportData;
    const validation = validateImportedProfile(exportData.profile);

    // If the current profile is empty, skip the merge/overwrite dialog and
    // import immediately — there is nothing to conflict with.
    const currentProfile = await getProfile();
    const { percentage } = calculateCompletion(currentProfile ?? {});

    if (percentage === 0) {
      setImporting(true);
      try {
        await saveProfile(validation.sanitized as Profile);
        if (exportData.learnedMappings) await saveLearnedMappings(exportData.learnedMappings);
        if (exportData.applicationHistory)
          await saveApplicationHistory(exportData.applicationHistory);
        const skipped0 = validation.invalidFields.length;
        const suffix0 =
          skipped0 > 0 ? ` (${skipped0} field${skipped0 !== 1 ? 's' : ''} skipped)` : '';
        showToast('success', `Profile imported successfully${suffix0}`);
        onImportComplete();
      } catch (err) {
        console.error('[Job Buddy] Import failed:', err);
        showToast('error', 'Import failed. Please try again.');
      } finally {
        setImporting(false);
      }
      return;
    }

    // Non-empty profile: compute diff and show summary → review flow.
    const diff = generateDiff(currentProfile ?? {}, validation.sanitized);
    setImportBaseProfile(currentProfile ?? {});
    setImportChanges(diff);
    setParsedImport({
      sanitized: validation.sanitized,
      invalidFields: validation.invalidFields,
      exportData,
    });
    setImportScreen('summary');
  };

  // ── Import — shared save helper ───────────────────────────────────────────────

  const performImportSave = async (finalChanges: FieldChange[]) => {
    if (!parsedImport) return;
    setImporting(true);
    try {
      const applied = applyChanges(importBaseProfile, finalChanges);
      await saveProfile(applied as Profile);
      if (parsedImport.exportData.learnedMappings) {
        await saveLearnedMappings(parsedImport.exportData.learnedMappings);
      }
      if (parsedImport.exportData.applicationHistory) {
        await saveApplicationHistory(parsedImport.exportData.applicationHistory);
      }
      const skipped = parsedImport.invalidFields.length;
      const suffix = skipped > 0 ? ` (${skipped} field${skipped !== 1 ? 's' : ''} skipped)` : '';
      showToast('success', `Profile imported successfully${suffix}`);
      setImportScreen('idle');
      setImportChanges([]);
      setImportBaseProfile({});
      setParsedImport(null);
      onImportComplete();
    } catch (err) {
      console.error('[Job Buddy] Import failed:', err);
      showToast('error', 'Import failed. Please try again.');
    } finally {
      setImporting(false);
    }
  };

  const handleImportAcceptAll = () => {
    void performImportSave(importChanges);
  };

  const handleImportRejectAll = () => {
    setImportScreen('idle');
    setImportChanges([]);
    setImportBaseProfile({});
    setParsedImport(null);
  };

  // ── Cloud Backup — handlers ──────────────────────────────────────────────────

  const handleDriveConnect = async () => {
    setDriveConnecting(true);
    try {
      const { backup } = await connectDrive();
      const localProfile = await getProfile();
      setDriveLocalProfile(localProfile);
      if (backup) {
        const localCompletion = calculateCompletion(localProfile ?? {});
        if (localCompletion.percentage === 0) {
          setDriveRestoreCase('empty');
          setDriveRestoreData(backup);
        } else {
          const diff = generateDiff(localProfile ?? {}, backup.profile);
          setDriveConflictChanges(diff);
          setDriveConflictScreen('summary');
          setDriveRestoreCase('conflict');
          setDriveRestoreData(backup);
        }
      } else if (localProfile) {
        // No Drive backup yet — push the local profile up as the initial snapshot.
        void syncProfileToDrive(localProfile);
      }
    } catch (err) {
      console.error('[Job Buddy] Drive connect failed:', err);
      showToast('error', 'Could not connect to Google Drive. Please try again.');
    } finally {
      setDriveConnecting(false);
    }
  };

  const handleDriveSyncNow = async () => {
    const profile = await getProfile();
    if (!profile) {
      showToast('warning', 'No profile data to sync.');
      return;
    }
    setDriveSyncing(true);
    try {
      const res = await syncProfileToDrive(profile);
      if (res.success) {
        showToast('success', 'Synced to Google Drive');
      } else if (res.errorCode === 'storage_full') {
        showToast('error', 'Google Drive storage full — sync paused.');
      } else if (res.errorCode === 'token_expired') {
        showToast('warning', 'Drive disconnected — reconnect to resume syncing.');
      } else if (res.errorCode) {
        showToast('warning', 'Sync failed — will retry automatically.');
      }
    } finally {
      setDriveSyncing(false);
    }
  };

  const handleDriveReconnect = () => {
    void handleDriveConnect();
  };

  const handleDriveDisconnect = async (deleteFile: boolean) => {
    setDriveDisconnectDialog(false);
    setDisconnectDeleteBackup(false);
    try {
      await disconnectDrive(deleteFile);
      showToast(
        'success',
        deleteFile ? '已断开连接并删除 Drive 备份' : '已断开 Google Drive 连接',
      );
    } catch (err) {
      console.error('[Job Buddy] Drive disconnect failed:', err);
      showToast('error', '断开连接失败，请重试');
    }
  };

  const closeRestoreDialog = () => {
    setDriveRestoreCase(null);
    setDriveRestoreData(null);
    setDriveLocalProfile(null);
    setDriveConflictChanges([]);
    setDriveConflictScreen('summary');
  };

  const handleRestoreFromDrive = async () => {
    if (!driveRestoreData) return;
    setDriveRestoreBusy(true);
    try {
      const validation = validateImportedProfile(driveRestoreData.profile);
      if (Object.keys(validation.sanitized).length === 0) {
        showToast('error', 'Drive 备份中的个人资料无效');
        closeRestoreDialog();
        return;
      }
      await saveProfile(validation.sanitized as Profile);
      if (driveRestoreData.learnedMappings) {
        await saveLearnedMappings(driveRestoreData.learnedMappings);
      }
      const fresh = await getFullDriveState();
      setDriveState(fresh);
      showToast('success', '已从 Google Drive 恢复个人资料');
      onImportComplete();
      closeRestoreDialog();
    } catch (err) {
      console.error('[Job Buddy] Restore from Drive failed:', err);
      showToast('error', '恢复失败，请重试');
    } finally {
      setDriveRestoreBusy(false);
    }
  };

  const handleKeepLocal = async () => {
    if (!driveLocalProfile) {
      closeRestoreDialog();
      return;
    }
    setDriveRestoreBusy(true);
    try {
      const res = await overwriteDriveWithLocal(driveLocalProfile as Profile);
      if (res.success) {
        showToast('success', '本地个人资料已上传至 Google Drive');
      } else if (res.errorCode) {
        showToast('warning', '同步失败，将自动重试');
      }
      closeRestoreDialog();
    } finally {
      setDriveRestoreBusy(false);
    }
  };

  const handleDriveReviewSave = async (finalChanges: FieldChange[]) => {
    if (!driveLocalProfile) return;
    setDriveRestoreBusy(true);
    try {
      const applied = applyChanges(driveLocalProfile, finalChanges);
      await saveProfile(applied as Profile);
      if (driveRestoreData?.learnedMappings) {
        await saveLearnedMappings(driveRestoreData.learnedMappings);
      }
      void syncProfileToDrive(applied as Profile);
      showToast('success', '已使用 Drive 备份更新个人资料');
      onImportComplete();
      closeRestoreDialog();
    } catch {
      showToast('error', '保存失败，请重试');
    } finally {
      setDriveRestoreBusy(false);
    }
  };

  // ── Reset All Data ───────────────────────────────────────────────────────────

  const handleReset = async () => {
    if (resetConfirmText !== '删除') return;
    setResetting(true);
    try {
      if (driveState.connected) {
        // 'device' → keep Drive backup file; 'everywhere' → delete it
        await disconnectDrive(resetScope === 'everywhere');
      }
      await clearAllStorage();
      setShowResetDialog(false);
      setResetConfirmText('');
      setResetScope('device');
      showToast('success', '全部数据已重置');
      onResetComplete();
    } catch (err) {
      console.error('[Job Buddy] Reset failed:', err);
      showToast('error', '重置失败，请重试');
    } finally {
      setResetting(false);
    }
  };

  const handleResetDialogClose = () => {
    setShowResetDialog(false);
    setResetConfirmText('');
    setResetScope('device');
  };

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">设置</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">管理资料、AI 和备份设置</p>
      </div>

      {/* ── Appearance ────────────────────────────────────────────────────────── */}
      <section className="mb-8 pb-8 border-b border-gray-200 dark:border-gray-700">
        <h3 className="text-base font-semibold text-gray-800 dark:text-gray-200 mb-1">
          外观
        </h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
          选择 Job Buddy 的显示模式。
        </p>
        <div className="inline-flex rounded-lg border border-gray-300 dark:border-gray-600 overflow-hidden">
          {(['system', 'light', 'dark'] as const).map((opt, i, arr) => (
            <button
              key={opt}
              type="button"
              onClick={() => handleThemeChange(opt)}
              className={[
                'px-4 py-1.5 text-sm font-medium capitalize transition-colors',
                i < arr.length - 1 ? 'border-r border-gray-300 dark:border-gray-600' : '',
                themePreference === opt
                  ? 'bg-blue-600 text-white border-blue-600 dark:border-blue-600'
                  : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700',
              ].join(' ')}
            >
              {opt === 'system' ? '跟随系统' : opt === 'light' ? '浅色' : '深色'}
            </button>
          ))}
        </div>
      </section>

      {/* ── AI Features ───────────────────────────────────────────────────────── */}
      <section className="mb-8 pb-8 border-b border-gray-200 dark:border-gray-700">
        <h3 className="text-base font-semibold text-gray-800 dark:text-gray-200 mb-1">
          AI 功能
        </h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
          使用你自己的 API Key 启用 AI 简历解析和智能字段识别。
        </p>

        <div className="max-w-md mb-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-800 dark:bg-emerald-950/30">
          <p className="text-sm font-medium text-emerald-800 dark:text-emerald-300">AI 省钱模式已默认启用</p>
          <p className="mt-1 text-xs text-emerald-700 dark:text-emerald-400">
            本地规则优先；简历和照片文件不会发送给字段识别 AI，身份证和紧急联系人仅在页面出现对应字段时按需发送。
          </p>
          {aiUsage && aiUsage.requests > 0 && (
            <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-gray-600 dark:text-gray-400">
              <span>累计请求：{aiUsage.requests.toLocaleString()}</span>
              <span>输出：{aiUsage.completionTokens.toLocaleString()} Token</span>
              <span>输入：{aiUsage.promptTokens.toLocaleString()} Token</span>
              <span>缓存命中：{aiUsage.cacheHitTokens.toLocaleString()} Token</span>
            </div>
          )}
        </div>

        <label
          htmlFor="ai-provider"
          className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
        >
          AI 服务商
        </label>
        <select
          id="ai-provider"
          value={aiProvider}
          onChange={handleAIProviderChange}
          className="w-full max-w-md mb-4 px-3 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="deepseek">DeepSeek（默认）</option>
          <option value="gemini">Gemini</option>
        </select>

        <label
          htmlFor="ai-api-key"
          className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
        >
          {aiProvider === 'deepseek' ? 'DeepSeek' : 'Gemini'} API Key
        </label>
        <input
          id="ai-api-key"
          type="password"
          value={aiKey}
          onChange={handleAIKeyChange}
          placeholder={aiProvider === 'deepseek' ? 'sk-...' : 'AQ...'}
          autoComplete="off"
          className="w-full max-w-md px-3 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          {aiProvider === 'deepseek'
            ? '仅保存在当前浏览器中，调用时直接发送给 DeepSeek。'
            : '请从 Google AI Studio 获取 API Key。'}
        </p>

        {aiKeyStatus === 'validating' && (
          <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">正在验证…</p>
        )}
        {aiKeyStatus === 'no_model' && (
          <p className="mt-1.5 text-xs text-yellow-600 dark:text-yellow-400">
            API Key 有效，但当前账户没有可用的受支持模型，请稍后重试。
          </p>
        )}
        {aiKeyStatus === 'invalid' && (
          <p className="mt-1.5 text-xs text-red-500 dark:text-red-400">
            API Key 无效，请检查后重试。
          </p>
        )}

        <details className="mt-3 max-w-md">
          <summary className="text-xs text-blue-600 dark:text-blue-400 cursor-pointer select-none hover:underline">
            如何获取 API Key
          </summary>
          <ol className="mt-2 ml-4 text-xs text-gray-600 dark:text-gray-400 space-y-1 list-decimal">
            <li>
              Visit{' '}
              <a
                href={
                  aiProvider === 'deepseek'
                    ? 'https://platform.deepseek.com/api_keys'
                    : 'https://aistudio.google.com/api-keys'
                }
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 dark:text-blue-400 underline"
              >
                {aiProvider === 'deepseek' ? 'DeepSeek Platform' : 'Google AI Studio'}
              </a>{' '}
              并登录
            </li>
            <li>创建新的 API Key</li>
            <li>复制 API Key 并粘贴到上方输入框</li>
          </ol>
        </details>
      </section>

      {/* ── Export ────────────────────────────────────────────────────────────── */}
      <section className="mb-8 pb-8 border-b border-gray-200 dark:border-gray-700">
        <h3 className="text-base font-semibold text-gray-800 dark:text-gray-200 mb-1">
          导出资料
        </h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
          将普通资料保存为 JSON 文件，用于备份或迁移。本机国内秋招资料不会包含在导出文件中。
        </p>
        <button
          type="button"
          onClick={handleExport}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 active:scale-95 transition-colors"
        >
          下载文件
        </button>
      </section>

      {/* ── Import ────────────────────────────────────────────────────────────── */}
      <section className="mb-8 pb-8 border-b border-gray-200 dark:border-gray-700">
        <h3 className="text-base font-semibold text-gray-800 dark:text-gray-200 mb-1">
          导入资料
        </h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
          从之前导出的 JSON 文件恢复 Job Buddy 普通资料。
        </p>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          className="hidden"
          onChange={handleFileChange}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 text-sm font-medium rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 active:scale-95 transition-colors"
        >
          选择文件
        </button>
        {importError && (
          <p className="mt-2 text-sm text-red-500 dark:text-red-400">{importError}</p>
        )}
      </section>

      {/* ── Cloud Backup ──────────────────────────────────────────────────────── */}
      <section className="mb-8 pb-8 border-b border-gray-200 dark:border-gray-700">
        <h3 className="text-base font-semibold text-gray-800 dark:text-gray-200 mb-1">
          云端备份
        </h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
          将普通资料同步到你自己的 Google Drive；本机国内秋招资料不会上传。
        </p>

        {/* State 1a: Not configured in this build */}
        {!driveState.connected && !driveConnecting && !isDriveConfigured() && (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            当前版本未配置 Google Drive 同步。
          </p>
        )}

        {/* State 1b: Not connected */}
        {!driveState.connected && !driveConnecting && isDriveConfigured() && (
          <button
            type="button"
            onClick={handleDriveConnect}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 active:scale-95 transition-colors"
          >
            连接 Google Drive
          </button>
        )}

        {/* State 2: Connecting */}
        {driveConnecting && (
          <p className="text-sm text-gray-600 dark:text-gray-300">
            <span className="inline-block w-3 h-3 mr-2 rounded-full border-2 border-gray-400 dark:border-gray-500 border-t-transparent animate-spin align-[-2px]" />
            正在连接…
          </p>
        )}

        {/* State 6: Token expired (takes priority over the healthy view) */}
        {driveState.connected && driveState.error === 'token_expired' && (
          <div>
            <p className="text-sm text-yellow-700 dark:text-yellow-400 mb-3">
              Google Drive 连接已失效，请重新连接后继续同步。
            </p>
            <button
              type="button"
              onClick={handleDriveReconnect}
              disabled={driveConnecting}
              className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 active:scale-95 transition-colors"
            >
              重新连接
            </button>
          </div>
        )}

        {/* State 7: Storage full */}
        {driveState.connected && driveState.error === 'storage_full' && (
          <div>
            <p className="text-sm text-red-600 dark:text-red-400 mb-3">
              Google Drive 存储空间不足，同步已暂停。
            </p>
            <a
              href="https://one.google.com/storage"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-blue-600 dark:text-blue-400 underline font-medium"
            >
              管理存储空间 →
            </a>
          </div>
        )}

        {/* State 5: Temp failure */}
        {driveState.connected && driveState.error === 'sync_error' && (
          <div>
            <p className="text-sm text-yellow-700 dark:text-yellow-400 mb-3">
              同步失败，稍后会自动重试。
            </p>
            <button
              type="button"
              onClick={handleDriveSyncNow}
              disabled={driveSyncing}
              className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 active:scale-95 transition-colors"
            >
              {driveSyncing ? '正在重试…' : '重试'}
            </button>
          </div>
        )}

        {/* State 4: Pending sync (no other error) */}
        {driveState.connected && !driveState.error && driveState.pendingSync && (
          <div>
            <p className="text-sm text-gray-700 dark:text-gray-300 mb-3">
              已保存到本机，等待同步。
            </p>
            <button
              type="button"
              onClick={handleDriveSyncNow}
              disabled={driveSyncing}
              className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 active:scale-95 transition-colors"
            >
              {driveSyncing ? '正在重试…' : '重试'}
            </button>
          </div>
        )}

        {/* State 3: Connected (healthy) */}
        {driveState.connected && !driveState.error && !driveState.pendingSync && (
          <div>
            <p className="text-sm font-medium text-green-700 dark:text-green-400 mb-1">
              ✓ 已连接 Google Drive
            </p>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
              上次同步：{fmtDriveTimestamp(driveState.lastSynced)}
            </p>
            <div className="flex flex-wrap gap-2 mb-3">
              <button
                type="button"
                onClick={handleDriveSyncNow}
                disabled={driveSyncing}
                className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 active:scale-95 transition-colors"
              >
                {driveSyncing ? '正在同步…' : '立即同步'}
              </button>
              <button
                type="button"
                onClick={() => setDriveDisconnectDialog(true)}
                className="px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 text-sm font-medium rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 active:scale-95 transition-colors"
              >
                断开连接
              </button>
            </div>
          </div>
        )}
      </section>

      {/* ── Privacy notice ────────────────────────────────────────────────────── */}
      <p className="mb-8 text-xs text-gray-500 dark:text-gray-400">
        {driveState.connected
          ? '普通资料保存在本机并备份到 Google Drive；国内秋招资料仅保存在本机。'
          : '所有资料均保存在当前设备中。'}{' '}
        <a
          href="https://myowinthein.github.io/job-buddy/legal/privacy/"
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 underline font-medium"
        >
          隐私政策
        </a>
        {' · '}
        <a
          href="https://myowinthein.github.io/job-buddy/legal/terms/"
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 underline font-medium"
        >
          服务条款
        </a>
        {' · '}
        <a
          href="https://ko-fi.com/myowinthein"
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 underline font-medium"
        >
          支持项目 ☕
        </a>
      </p>

      {/* ── Reset All Data ───────────────────────────────────────────────────── */}
      <section className="pt-2">
        <h3 className="text-base font-semibold text-red-700 dark:text-red-400 mb-1">
          重置全部数据
        </h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
          永久删除当前浏览器中的普通资料、国内秋招资料和已学习的字段映射。此操作无法撤销。
        </p>
        <button
          type="button"
          onClick={() => setShowResetDialog(true)}
          className="px-4 py-2 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 active:scale-95 transition-colors"
        >
          立即重置
        </button>
      </section>

      {/* ── Import Profile — summary / review dialogs ──────────────────────────── */}
      {importScreen === 'summary' && (
        <ImportSummaryDialog
          changes={importChanges}
          title="导入资料"
          onAcceptAll={handleImportAcceptAll}
          onRejectAll={handleImportRejectAll}
          onReview={() => setImportScreen('review')}
          isProcessing={importing}
        />
      )}
      {importScreen === 'review' && (
        <ImportReviewScreen
          changes={importChanges}
          onSave={performImportSave}
          onBack={() => setImportScreen('summary')}
          isSaving={importing}
          title="检查导入内容"
          saveLabel="导入所选内容"
        />
      )}

      {/* ── Reset confirmation dialog ─────────────────────────────────────────── */}
      {showResetDialog && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={handleResetDialogClose}
        >
          <div
            className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl dark:shadow-black/60 w-full max-w-md mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
              <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
                重置全部数据
              </h3>
              <button
                type="button"
                onClick={handleResetDialogClose}
                className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 text-xl leading-none active:scale-95 transition-colors"
              >
                ×
              </button>
            </div>

            <div className="px-6 py-5">
              <p className="text-sm text-gray-700 dark:text-gray-300 mb-2">
                这将永久删除本浏览器中的个人资料、已学习的自动填写映射及其他插件数据。
              </p>
              <p className="text-sm text-gray-700 dark:text-gray-300 mb-3">
                建议先{' '}
                <button
                  type="button"
                  className="underline hover:text-gray-900 dark:hover:text-gray-100 transition-colors"
                  onClick={handleExport}
                >
                  导出个人资料
                </button>
                .
              </p>
              <p className="text-sm font-medium text-red-600 dark:text-red-400 mb-5">
                此操作无法撤销。
              </p>

              {driveState.connected && (
                <div className="mb-5">
                  <p className="text-sm font-medium text-gray-800 dark:text-gray-200 mb-2">
                    是否同时重置 Google Drive？
                  </p>
                  <div className="space-y-2">
                    <label className="flex items-start gap-2.5 cursor-pointer">
                      <input
                        type="radio"
                        name="resetScope"
                        value="device"
                        checked={resetScope === 'device'}
                        onChange={() => setResetScope('device')}
                        className="mt-0.5 text-red-600"
                      />
                      <div>
                        <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                          仅此设备
                        </span>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                          断开云端连接，但保留 Drive 中的备份文件。
                        </p>
                      </div>
                    </label>
                    <label className="flex items-start gap-2.5 cursor-pointer">
                      <input
                        type="radio"
                        name="resetScope"
                        value="everywhere"
                        checked={resetScope === 'everywhere'}
                        onChange={() => setResetScope('everywhere')}
                        className="mt-0.5 text-red-600"
                      />
                      <div>
                        <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                          此设备和 Google Drive
                        </span>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                          断开云端连接并删除 Drive 中的备份文件。
                        </p>
                      </div>
                    </label>
                  </div>
                </div>
              )}

              <label className="block text-sm text-gray-700 dark:text-gray-300 mb-2">
                输入{' '}
                <code className="font-mono font-bold text-red-600 dark:text-red-400">删除</code>{' '}
                进行确认：
              </label>
              <input
                type="text"
                value={resetConfirmText}
                onChange={(e) => setResetConfirmText(e.target.value)}
                placeholder="删除"
                autoComplete="off"
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
              />
            </div>

            <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-200 dark:border-gray-700">
              <button
                type="button"
                onClick={handleResetDialogClose}
                className="px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 text-sm font-medium rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 active:scale-95 transition-colors"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleReset}
                disabled={resetConfirmText !== '删除' || resetting}
                className="px-4 py-2 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 disabled:opacity-50 active:scale-95 transition-colors"
              >
                {resetting ? '正在重置…' : '重置全部数据'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Drive disconnect dialog ───────────────────────────────────────────── */}
      {driveDisconnectDialog && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => {
            setDriveDisconnectDialog(false);
            setDisconnectDeleteBackup(false);
          }}
        >
          <div
            className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl dark:shadow-black/60 w-full max-w-md mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
              <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
                如何处理 Drive 备份？
              </h3>
              <button
                type="button"
                onClick={() => {
                  setDriveDisconnectDialog(false);
                  setDisconnectDeleteBackup(false);
                }}
                className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 text-xl leading-none active:scale-95 transition-colors"
              >
                ×
              </button>
            </div>
            <div className="px-6 py-5 space-y-3">
              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="radio"
                  name="disconnectScope"
                  checked={!disconnectDeleteBackup}
                  onChange={() => setDisconnectDeleteBackup(false)}
                  className="mt-0.5 text-blue-600"
                />
                <div>
                  <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                    保留备份文件
                  </span>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    以后重新连接时仍可使用这份 Drive 备份。
                  </p>
                </div>
              </label>
              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="radio"
                  name="disconnectScope"
                  checked={disconnectDeleteBackup}
                  onChange={() => setDisconnectDeleteBackup(true)}
                  className="mt-0.5 text-blue-600"
                />
                <div>
                  <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                    删除备份文件
                  </span>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    从 Google Drive 永久删除这份备份。
                  </p>
                </div>
              </label>
            </div>
            <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-200 dark:border-gray-700">
              <button
                type="button"
                onClick={() => {
                  setDriveDisconnectDialog(false);
                  setDisconnectDeleteBackup(false);
                }}
                className="px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 text-sm font-medium rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 active:scale-95 transition-colors"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => void handleDriveDisconnect(disconnectDeleteBackup)}
                className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 active:scale-95 transition-colors"
              >
                断开连接
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Drive restore dialog — empty local profile ───────────────────────── */}
      {driveRestoreCase === 'empty' && driveRestoreData && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={closeRestoreDialog}
        >
          <div
            className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl dark:shadow-black/60 w-full max-w-md mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
              <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
                从 Google Drive 恢复
              </h3>
              <button
                type="button"
                onClick={closeRestoreDialog}
                className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 text-xl leading-none active:scale-95 transition-colors"
              >
                ×
              </button>
            </div>
            <div className="px-6 py-5">
              <p className="text-sm text-gray-700 dark:text-gray-300 mb-2">
                在 Google Drive 中找到了个人资料，是否恢复？
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                备份时间：{fmtDriveTimestamp(driveRestoreData.lastModified)}
              </p>
            </div>
            <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-200 dark:border-gray-700">
              <button
                type="button"
                onClick={closeRestoreDialog}
                disabled={driveRestoreBusy}
                className="px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 text-sm font-medium rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 active:scale-95 transition-colors"
              >
                跳过
              </button>
              <button
                type="button"
                onClick={handleRestoreFromDrive}
                disabled={driveRestoreBusy}
                className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 active:scale-95 transition-colors"
              >
                {driveRestoreBusy ? '正在恢复…' : '恢复'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Drive restore — conflict: summary → review ────────────────────────── */}
      {driveRestoreCase === 'conflict' && driveConflictScreen === 'summary' && (
        <ImportSummaryDialog
          changes={driveConflictChanges}
          title="个人资料冲突"
          onAcceptAll={() => void handleRestoreFromDrive()}
          onRejectAll={() => void handleKeepLocal()}
          onReview={() => setDriveConflictScreen('review')}
          isProcessing={driveRestoreBusy}
        />
      )}
      {driveRestoreCase === 'conflict' && driveConflictScreen === 'review' && (
        <ImportReviewScreen
          changes={driveConflictChanges}
          onSave={handleDriveReviewSave}
          onBack={() => setDriveConflictScreen('summary')}
          isSaving={driveRestoreBusy}
          title="检查 Drive 备份"
          saveLabel="应用所选内容"
        />
      )}
    </div>
  );
}
