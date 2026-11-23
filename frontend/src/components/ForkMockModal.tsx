import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, GitFork, FolderPlus, Loader2, ToggleRight, Folder } from 'lucide-react';
import type { MockFolder, MockRule, MockVersion } from '../types';
import { mocksApi } from '../api/client';
import { useDialog } from '../context/DialogContext';
import CustomSelect, { SelectOption } from './CustomSelect';

const PRESERVE_FOLDER_VALUE = '__preserve__';

interface ForkMockModalProps {
  rule: MockRule;
  initialVersionId?: number;
  initialActivate: boolean;
  disableConflicting?: boolean;
  targetUrl?: string;
  targetMethod?: string;
  folders: MockFolder[];
  onFolderCreated?: (folder: MockFolder) => void;
  onClose: () => void;
  onForked: (forkedRule: MockRule, activate: boolean) => void | Promise<void>;
}

export function ForkMockModal({
  rule,
  initialVersionId,
  initialActivate,
  disableConflicting = false,
  targetUrl,
  targetMethod,
  folders: initialFolders,
  onFolderCreated,
  onClose,
  onForked,
}: ForkMockModalProps) {
  const { toast } = useDialog();
  const [folders, setFolders] = useState<MockFolder[]>(initialFolders);
  const [name, setName] = useState(rule.name);
  const versions = (rule.versions || []) as MockVersion[];
  const [versionId, setVersionId] = useState<number | undefined>(() => (
    initialVersionId ?? rule.active_version_id ?? versions[0]?.id
  ));
  const [activate, setActivate] = useState<boolean>(initialActivate && versions.length > 0);

  // Pick smart default target folder:
  // 1) If user already has a folder with the same name as source rule's folder -> select it
  // 2) Else if source rule has a folder name -> default to auto-creating by that name
  // 3) Else -> Unfiled ('')
  const [folderSelection, setFolderSelection] = useState<string>(() => {
    if (rule.folder_name) {
      const sameName = initialFolders.find(
        (f) => f.name.trim().toLowerCase() === rule.folder_name!.trim().toLowerCase(),
      );
      if (sameName) return String(sameName.id);
      return PRESERVE_FOLDER_VALUE;
    }
    return '';
  });

  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Refresh user's folder list in case parent passed an empty/stale list
  useEffect(() => {
    if (initialFolders.length > 0) {
      setFolders(initialFolders);
      return;
    }
    mocksApi.listFolders()
      .then((loaded) => {
        setFolders(loaded);
        if (rule.folder_name) {
          const sameName = loaded.find(
            (f) => f.name.trim().toLowerCase() === rule.folder_name!.trim().toLowerCase(),
          );
          if (sameName) setFolderSelection(String(sameName.id));
        }
      })
      .catch(() => {});
  }, [initialFolders, rule.folder_name]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitting) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, submitting]);

  const hasSameNameFolder = Boolean(
    rule.folder_name && folders.some(
      (f) => f.name.trim().toLowerCase() === rule.folder_name!.trim().toLowerCase(),
    ),
  );

  const folderOptions: SelectOption[] = [
    ...(rule.folder_name && !hasSameNameFolder
      ? [{
          value: PRESERVE_FOLDER_VALUE,
          label: `按原目录名新建「${rule.folder_name}」`,
          badge: '自动新建',
          badgeColor: 'bg-cyan-500/15 text-cyan-400',
        }]
      : []),
    { value: '', label: '未分类 (Unfiled)' },
    ...folders.map((f) => ({
      value: String(f.id),
      label: f.name,
      badge: `${f.mock_count}`,
      badgeColor: 'bg-slate-700 text-slate-300',
    })),
  ];

  const handleCreateFolder = async () => {
    const trimmed = newFolderName.trim();
    if (!trimmed) return;
    setCreatingFolder(true);
    try {
      const created = await mocksApi.createFolder(trimmed);
      setFolders((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
      setFolderSelection(String(created.id));
      setNewFolderName('');
      setShowNewFolder(false);
      onFolderCreated?.(created);
      toast.success(`已创建目录「${created.name}」`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '创建目录失败');
    } finally {
      setCreatingFolder(false);
    }
  };

  const handleConfirm = async () => {
    if (!name.trim() || submitting) return;
    setSubmitting(true);
    try {
      const payload: Parameters<typeof mocksApi.fork>[0] = {
        sourceRuleId: rule.id,
        versionId,
        name: name.trim(),
        activate: activate && versions.length > 0,
        disableConflicting,
        targetUrl,
        targetMethod,
      };
      if (folderSelection === PRESERVE_FOLDER_VALUE) {
        payload.preserveFolderName = true;
      } else if (folderSelection === '') {
        payload.folderId = null;
      } else {
        payload.folderId = Number(folderSelection);
      }

      const forked = await mocksApi.fork(payload);
      await onForked(forked, Boolean(payload.activate));
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '复制 Mock 失败');
    } finally {
      setSubmitting(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={() => !submitting && onClose()}
    >
      <div
        className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-cyan-500/15 border border-cyan-500/25 flex items-center justify-center text-cyan-400 shrink-0">
              <GitFork size={15} />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-slate-100">
                {activate ? '复制并启用 Mock' : '复制到我的 Mocks'}
              </h3>
              <p className="text-[11px] text-slate-500 truncate font-mono">
                {rule.method ? `${rule.method} ` : ''}{rule.url_pattern}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            aria-label="关闭"
            className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-4">
          {rule.owner_email && (
            <div className="text-xs text-slate-400 bg-slate-800/60 border border-slate-700/70 rounded-lg px-3 py-2 flex items-center justify-between gap-2">
              <span className="truncate">
                来源：<span className="font-mono text-blue-400">{rule.owner_email}</span>
                {rule.folder_name && <span className="text-slate-500"> · {rule.folder_name}</span>}
              </span>
              <span className="text-[11px] text-slate-500 shrink-0">{versions.length} 个版本</span>
            </div>
          )}

          {/* Rule name */}
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">规则名称</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !showNewFolder && handleConfirm()}
              placeholder="输入规则名称"
              className="input-field w-full text-sm py-1.5"
              autoFocus
            />
          </div>

          {/* Target folder */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-slate-400">复制到目录</label>
              <button
                type="button"
                onClick={() => setShowNewFolder((v) => !v)}
                className="flex items-center gap-1 text-[11px] text-cyan-400 hover:text-cyan-300 transition-colors"
              >
                <FolderPlus size={12} />
                {showNewFolder ? '取消新建' : '新建目录'}
              </button>
            </div>

            <CustomSelect
              value={folderSelection}
              onChange={(val) => setFolderSelection(val)}
              ariaLabel="选择目标目录"
              options={folderOptions}
            />

            {showNewFolder && (
              <div className="flex items-center gap-2 pt-1">
                <input
                  type="text"
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleCreateFolder()}
                  placeholder="输入新目录名称..."
                  className="input-field flex-1 text-xs py-1.5"
                  autoFocus
                />
                <button
                  type="button"
                  onClick={handleCreateFolder}
                  disabled={creatingFolder || !newFolderName.trim()}
                  className="px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-medium disabled:opacity-50 flex items-center gap-1 shrink-0"
                >
                  {creatingFolder && <Loader2 size={11} className="animate-spin" />}
                  创建
                </button>
              </div>
            )}
          </div>

          {/* Active version picker when rule has multiple versions */}
          {versions.length > 1 && (
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">默认选中版本（将一并复制全部 {versions.length} 个版本）</label>
              <CustomSelect
                value={versionId ?? ''}
                onChange={(val) => setVersionId(Number(val))}
                ariaLabel="选择默认版本"
                options={versions.map((v) => ({
                  value: v.id,
                  label: v.name,
                  badge: String(v.response_status),
                  badgeColor:
                    v.response_status >= 200 && v.response_status < 300
                      ? 'bg-emerald-500/15 text-emerald-400'
                      : v.response_status >= 400
                        ? 'bg-red-500/15 text-red-400'
                        : 'bg-slate-700 text-slate-300',
                }))}
              />
            </div>
          )}

          {/* Activate toggle */}
          {versions.length > 0 && (
            <label className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg border border-slate-800 bg-slate-800/40 cursor-pointer select-none">
              <div className="min-w-0">
                <div className="text-xs font-medium text-slate-200 flex items-center gap-1.5">
                  <ToggleRight size={14} className={activate ? 'text-emerald-400' : 'text-slate-500'} />
                  复制后立即启用此 Mock
                </div>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  {activate
                    ? '复制完成后立即在你的设备上生效（仅影响你自己的流量）'
                    : '仅保存到你的 Mock 列表，保持关闭状态'}
                </p>
              </div>
              <input
                type="checkbox"
                checked={activate}
                onChange={(e) => setActivate(e.target.checked)}
                className="w-4 h-4 accent-cyan-500 rounded shrink-0"
              />
            </label>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3.5 border-t border-slate-800 bg-slate-900/80">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="btn-secondary text-xs py-1.5 px-3"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={submitting || !name.trim()}
            className="btn-primary text-xs py-1.5 px-3.5 flex items-center gap-1.5 disabled:opacity-50"
          >
            {submitting ? <Loader2 size={13} className="animate-spin" /> : <GitFork size={13} />}
            {submitting ? '复制中...' : (activate ? '确认复制并启用' : '确认复制')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

interface CloneFolderModalProps {
  sourceFolderId: number | 'unfiled';
  sourceOwnerId?: number;
  sourceOwnerEmail?: string;
  sourceFolderLabel: string;
  ruleCount: number;
  folders: MockFolder[];
  onFolderCreated?: (folder: MockFolder) => void;
  onClose: () => void;
  onCloned: (result: { folder: MockFolder | null; cloned_rules: number }) => void | Promise<void>;
}

export function CloneFolderModal({
  sourceFolderId,
  sourceOwnerId,
  sourceOwnerEmail,
  sourceFolderLabel,
  ruleCount,
  folders: initialFolders,
  onFolderCreated,
  onClose,
  onCloned,
}: CloneFolderModalProps) {
  const { toast } = useDialog();
  const [folders, setFolders] = useState<MockFolder[]>(initialFolders);
  const sameNameFolder = initialFolders.find(
    (f) => f.name.trim().toLowerCase() === sourceFolderLabel.trim().toLowerCase(),
  );

  // 'new' = create/use by targetFolderName; '' = Unfiled; numeric string = existing folder ID
  const [mode, setMode] = useState<string>(() => (sameNameFolder ? String(sameNameFolder.id) : '__new__'));
  const [targetName, setTargetName] = useState(sourceFolderLabel);
  const [activate, setActivate] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitting) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, submitting]);

  const options: SelectOption[] = [
    {
      value: '__new__',
      label: '新建目录保存',
      badge: '自定义名称',
      badgeColor: 'bg-cyan-500/15 text-cyan-400',
    },
    { value: '', label: '未分类 (Unfiled)' },
    ...folders.map((f) => ({
      value: String(f.id),
      label: `合并到已有目录「${f.name}」`,
      badge: `${f.mock_count}`,
      badgeColor: 'bg-slate-700 text-slate-300',
    })),
  ];

  const handleConfirm = async () => {
    if (mode === '__new__' && !targetName.trim()) return;
    setSubmitting(true);
    try {
      const payload: Parameters<typeof mocksApi.forkFolder>[0] = {
        sourceFolderId,
        sourceOwnerId,
        activate,
      };
      if (mode === '__new__') {
        payload.targetFolderName = targetName.trim();
      } else if (mode === '') {
        payload.targetFolderId = null;
      } else {
        payload.targetFolderId = Number(mode);
      }

      const res = await mocksApi.forkFolder(payload);
      if (res.folder && !folders.some((f) => f.id === res.folder!.id)) {
        setFolders((prev) => [...prev, res.folder!]);
        onFolderCreated?.(res.folder);
      }
      await onCloned(res);
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '克隆目录失败');
    } finally {
      setSubmitting(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={() => !submitting && onClose()}
    >
      <div
        className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-cyan-500/15 border border-cyan-500/25 flex items-center justify-center text-cyan-400 shrink-0">
              <Folder size={15} />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-slate-100">克隆共享目录到我的 Mocks</h3>
              <p className="text-[11px] text-slate-500 truncate">
                「{sourceFolderLabel}」· {ruleCount} 条规则{sourceOwnerEmail ? ` · ${sourceOwnerEmail}` : ''}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            aria-label="关闭"
            className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">目标目录</label>
            <CustomSelect
              value={mode}
              onChange={(val) => setMode(val)}
              ariaLabel="选择克隆目标目录"
              options={options}
            />
          </div>

          {mode === '__new__' && (
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">新目录名称</label>
              <input
                type="text"
                value={targetName}
                onChange={(e) => setTargetName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleConfirm()}
                placeholder="输入目录名称"
                className="input-field w-full text-sm py-1.5"
                autoFocus
              />
            </div>
          )}

          <label className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg border border-slate-800 bg-slate-800/40 cursor-pointer select-none">
            <div className="min-w-0">
              <div className="text-xs font-medium text-slate-200">克隆后立即启用全部规则</div>
              <p className="text-[11px] text-slate-500 mt-0.5">
                默认保持关闭，避免直接覆盖你当前线上调试流量
              </p>
            </div>
            <input
              type="checkbox"
              checked={activate}
              onChange={(e) => setActivate(e.target.checked)}
              className="w-4 h-4 accent-cyan-500 rounded shrink-0"
            />
          </label>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3.5 border-t border-slate-800 bg-slate-900/80">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="btn-secondary text-xs py-1.5 px-3"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={submitting || (mode === '__new__' && !targetName.trim())}
            className="btn-primary text-xs py-1.5 px-3.5 flex items-center gap-1.5 disabled:opacity-50"
          >
            {submitting ? <Loader2 size={13} className="animate-spin" /> : <GitFork size={13} />}
            {submitting ? '克隆中...' : `确认克隆 (${ruleCount})`}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
