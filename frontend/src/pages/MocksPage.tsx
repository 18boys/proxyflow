import { useEffect, useState, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Plus, Search, ArrowUpFromLine, ArrowDownToLine, Trash2, Edit2, Bot, Sparkles,
  Folder, FolderPlus, ToggleLeft, ToggleRight, GitBranch, Loader2, Globe, Lock,
  Users, GitFork, Share2, Eye, EyeOff, Check, ChevronDown, ChevronRight, X,
} from 'lucide-react';
import type { MockFolder, MockRule, MockVersion, TeamMockOwner } from '../types';
import { parseJson } from '../types';
import { mocksApi, rulesApi, streamAiRequest } from '../api/client';
import { useStore } from '../store/useStore';
import { useDialog } from '../context/DialogContext';
import { copyToClipboard } from '../utils/clipboard';
import MockEditor from '../components/MockEditor';
import CustomSelect from '../components/CustomSelect';
import JsonViewer from '../components/JsonViewer';

type ViewTab = 'mine' | 'team';

export default function MocksPage() {
  const { confirm, toast } = useDialog();
  const user = useStore((s) => s.user);
  const [searchParams, setSearchParams] = useSearchParams();

  const initialTab: ViewTab = searchParams.get('tab') === 'team' ? 'team' : 'mine';
  const initialOwnerParam = searchParams.get('owner');
  const initialFolderParam = searchParams.get('folder');

  const [activeTab, setActiveTab] = useState<ViewTab>(initialTab);

  // ── My Mocks state ──
  const [rules, setRules] = useState<MockRule[]>([]);
  const [folders, setFolders] = useState<MockFolder[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showEditor, setShowEditor] = useState(false);
  const [editingRule, setEditingRule] = useState<MockRule | null>(null);
  const [showAiGenerate, setShowAiGenerate] = useState(false);
  const [selectedFolder, setSelectedFolder] = useState<'all' | 'unfiled' | number>('all');
  const [globalMode, setGlobalMode] = useState<'proxy' | 'mock' | null>(null);
  const [togglingRuleId, setTogglingRuleId] = useState<number | null>(null);
  const [togglingRuleVisibilityId, setTogglingRuleVisibilityId] = useState<number | null>(null);
  const [togglingFolderVisibilityId, setTogglingFolderVisibilityId] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [renamingFolderId, setRenamingFolderId] = useState<number | null>(null);
  const [renameFolderName, setRenameFolderName] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Team Shared state ──
  const [teamOwners, setTeamOwners] = useState<TeamMockOwner[]>([]);
  const [teamRules, setTeamRules] = useState<MockRule[]>([]);
  const [teamTotalCount, setTeamTotalCount] = useState<number>(0);
  const [teamLoading, setTeamLoading] = useState(false);
  const [teamSearch, setTeamSearch] = useState('');
  const [selectedTeamOwnerId, setSelectedTeamOwnerId] = useState<number | null>(() => {
    const n = Number(initialOwnerParam);
    return Number.isInteger(n) && n > 0 ? n : null;
  });
  const [selectedTeamFolder, setSelectedTeamFolder] = useState<'all' | 'unfiled' | number>(() => {
    if (initialFolderParam === 'unfiled') return 'unfiled';
    const n = Number(initialFolderParam);
    return Number.isInteger(n) && n > 0 ? n : 'all';
  });
  const [selectedTeamFolderMeta, setSelectedTeamFolderMeta] = useState<{
    id: number;
    name: string;
    owner_id: number;
    owner_email: string;
  } | null>(null);
  const [cloningFolder, setCloningFolder] = useState(false);
  const [forkingRuleKey, setForkingRuleKey] = useState<string | null>(null);

  // Sync tab/owner/folder if URL params change externally (e.g. clicking a shared link)
  useEffect(() => {
    const tabParam = searchParams.get('tab');
    if (tabParam === 'team') {
      setActiveTab('team');
      const ownerN = Number(searchParams.get('owner'));
      setSelectedTeamOwnerId(Number.isInteger(ownerN) && ownerN > 0 ? ownerN : null);
      const fParam = searchParams.get('folder');
      if (fParam === 'unfiled') {
        setSelectedTeamFolder('unfiled');
      } else {
        const fN = Number(fParam);
        setSelectedTeamFolder(Number.isInteger(fN) && fN > 0 ? fN : 'all');
      }
    }
  }, [searchParams]);

  const loadData = useCallback(async () => {
    try {
      const [ruleData, folderData] = await Promise.all([
        mocksApi.list(search || undefined),
        mocksApi.listFolders(),
      ]);
      setRules(ruleData);
      setFolders(folderData);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [search]);

  const loadTeamData = useCallback(async (silent = false) => {
    if (!silent) setTeamLoading(true);
    try {
      const res = await mocksApi.listTeam({
        search: teamSearch || undefined,
        ownerId: selectedTeamOwnerId,
        folderId: selectedTeamFolder,
      });
      setTeamOwners(res.owners);
      setTeamRules(res.rules);
      setTeamTotalCount(res.total_public_rules);
      setSelectedTeamFolderMeta(res.selected_folder);
    } catch (err) {
      if (!silent) {
        toast.error(err instanceof Error ? err.message : '加载团队共享 Mock 失败');
      }
    } finally {
      if (!silent) setTeamLoading(false);
    }
  }, [teamSearch, selectedTeamOwnerId, selectedTeamFolder, toast]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    void loadTeamData(activeTab !== 'team' && teamOwners.length > 0);
  }, [activeTab, loadTeamData]); // eslint-disable-line react-hooks/exhaustive-deps

  const switchTab = (next: ViewTab) => {
    setActiveTab(next);
    if (next === 'mine') {
      setSearchParams({}, { replace: true });
    } else {
      const nextParams: Record<string, string> = { tab: 'team' };
      if (selectedTeamOwnerId) nextParams['owner'] = String(selectedTeamOwnerId);
      if (selectedTeamFolder !== 'all') nextParams['folder'] = String(selectedTeamFolder);
      setSearchParams(nextParams, { replace: true });
    }
  };

  const selectTeamTarget = (ownerId: number | null, folder: 'all' | 'unfiled' | number) => {
    setSelectedTeamOwnerId(ownerId);
    setSelectedTeamFolder(folder);
    const nextParams: Record<string, string> = { tab: 'team' };
    if (ownerId) nextParams['owner'] = String(ownerId);
    if (folder !== 'all') nextParams['folder'] = String(folder);
    setSearchParams(nextParams, { replace: true });
  };

  const filteredRules = rules.filter((rule) => {
    if (selectedFolder === 'all') return true;
    if (selectedFolder === 'unfiled') return rule.folder_id === null;
    return rule.folder_id === selectedFolder;
  });

  const currentFolderObj = typeof selectedFolder === 'number'
    ? folders.find((f) => f.id === selectedFolder) ?? null
    : null;
  const defaultFolderId = typeof selectedFolder === 'number' ? selectedFolder : null;
  const mockCount = rules.filter((rule) => rule.is_active).length;

  const handleGlobalMode = async (mode: 'mock' | 'proxy') => {
    setGlobalMode(mode);
    try {
      await rulesApi.setGlobal(mode);
      await loadData();
    } finally {
      setGlobalMode(null);
    }
  };

  const handleToggle = async (rule: MockRule) => {
    setTogglingRuleId(rule.id);
    try {
      await rulesApi.toggle(rule.id);
      await loadData();
    } finally {
      setTogglingRuleId(null);
    }
  };

  const handleToggleRuleVisibility = async (rule: MockRule) => {
    const nextPublic = rule.is_public === 0;
    setTogglingRuleVisibilityId(rule.id);
    try {
      await mocksApi.setVisibility(rule.id, nextPublic);
      toast.success(nextPublic ? '已设为团队公开' : '已设为仅自己可见');
      await Promise.all([loadData(), loadTeamData(true)]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '更新可见性失败');
    } finally {
      setTogglingRuleVisibilityId(null);
    }
  };

  const handleToggleFolderVisibility = async (folder: MockFolder) => {
    const nextPublic = folder.is_public === 0;
    setTogglingFolderVisibilityId(folder.id);
    try {
      await mocksApi.setFolderVisibility(folder.id, nextPublic);
      toast.success(nextPublic ? `目录「${folder.name}」已设为团队公开` : `目录「${folder.name}」已设为私有，他人不可见`);
      await Promise.all([loadData(), loadTeamData(true)]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '更新目录可见性失败');
    } finally {
      setTogglingFolderVisibilityId(null);
    }
  };

  const handleCopyFolderShareLink = async (ownerId: number, folderId: number | 'unfiled', label: string) => {
    const url = `${window.location.origin}/mocks?tab=team&owner=${ownerId}&folder=${folderId}`;
    const ok = await copyToClipboard(url);
    if (ok) {
      toast.success(`已复制目录「${label}」分享链接`);
    } else {
      toast.error('复制失败，请手动复制地址栏链接');
    }
  };

  const handleVersionChange = async (rule: MockRule, versionId: number) => {
    await rulesApi.setVersion(rule.id, versionId);
    await loadData();
  };

  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) return;
    try {
      const folder = await mocksApi.createFolder(newFolderName.trim());
      setSelectedFolder(folder.id);
      setNewFolderName('');
      setShowNewFolder(false);
      toast.success('文件夹创建成功');
      await loadData();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '创建文件夹失败');
    }
  };

  const handleRenameFolder = async (folder: MockFolder) => {
    if (!renameFolderName.trim()) return;
    if (renameFolderName.trim() === folder.name) {
      setRenamingFolderId(null);
      return;
    }
    try {
      await mocksApi.updateFolder(folder.id, renameFolderName.trim());
      setRenamingFolderId(null);
      setRenameFolderName('');
      toast.success('文件夹已重命名');
      await loadData();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '重命名文件夹失败');
    }
  };

  const handleDeleteFolder = async (folder: MockFolder) => {
    const ok = await confirm({
      title: '删除文件夹',
      message: `确定要删除文件夹 “${folder.name}” 吗？其中的 Mock 规则将自动移至“未分类”。`,
      confirmText: '删除文件夹',
      type: 'danger',
    });
    if (!ok) return;
    try {
      await mocksApi.deleteFolder(folder.id);
      if (selectedFolder === folder.id) setSelectedFolder('unfiled');
      toast.success('文件夹已删除');
      await Promise.all([loadData(), loadTeamData(true)]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '删除文件夹失败');
    }
  };

  const handleDelete = async (id: number) => {
    const ok = await confirm({
      title: '删除 Mock 规则',
      message: '确定要删除此 Mock 规则及其所有响应版本吗？此操作无法撤销。',
      confirmText: '删除规则',
      type: 'danger',
    });
    if (!ok) return;
    try {
      await mocksApi.delete(id);
      setRules(rules.filter((r) => r.id !== id));
      toast.success('Mock 规则已删除');
      void loadTeamData(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '删除 Mock 规则失败');
    }
  };

  const handleExport = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const data = await mocksApi.export(selectedFolder);
      const count = Array.isArray(data.mocks) ? data.mocks.length : 0;
      if (count === 0) {
        toast.info('当前选中范围内没有可导出的 Mock 规则');
        return;
      }
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = data.filename || 'proxyflow-mocks.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      const scopeLabel = selectedFolder === 'all'
        ? '全部'
        : selectedFolder === 'unfiled'
          ? '未分类'
          : `目录「${currentFolderObj?.name || data.folder_name || ''}」`;
      toast.success(`已导出${scopeLabel}的 ${count} 条 Mock 规则`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '导出 Mock 失败');
    } finally {
      setExporting(false);
    }
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const mocks = data.mocks || data;
      const res = await mocksApi.import(Array.isArray(mocks) ? mocks : [], defaultFolderId);
      toast.success(`成功导入 ${res.imported} 条 Mock 规则`);
      await Promise.all([loadData(), loadTeamData(true)]);
    } catch (error) {
      toast.error(error instanceof SyntaxError ? 'JSON 文件格式无效，请检查文件内容' : (error instanceof Error ? error.message : '导入失败'));
    } finally {
      setImporting(false);
      e.target.value = '';
    }
  };

  // ── Team fork handlers ──
  const handleForkTeamRule = async (rule: MockRule, options: { versionId?: number; activate: boolean }) => {
    const key = `${rule.id}:${options.versionId ?? 'rule'}:${options.activate ? 'on' : 'off'}`;
    setForkingRuleKey(key);
    try {
      await mocksApi.fork({
        sourceRuleId: rule.id,
        versionId: options.versionId,
        preserveFolderName: true,
        activate: options.activate,
      });
      toast.success(
        options.activate
          ? `已复制「${rule.name}」到我的 Mock 并启用`
          : `已复制「${rule.name}」到我的 Mock`,
      );
      await Promise.all([loadData(), loadTeamData(true)]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '复制 Mock 失败');
    } finally {
      setForkingRuleKey(null);
    }
  };

  const handleCloneTeamFolder = async () => {
    if (selectedTeamFolder === 'all') return;
    const ownerObj = teamOwners.find((o) => o.user_id === selectedTeamOwnerId);
    const folderLabel = selectedTeamFolder === 'unfiled'
      ? `${ownerObj?.email.split('@')[0] || '团队'} - 未分类`
      : (selectedTeamFolderMeta?.name
        || teamOwners.flatMap((o) => o.folders).find((f) => f.id === selectedTeamFolder)?.name
        || '共享目录');

    const ok = await confirm({
      title: '克隆共享目录到我的 Mocks',
      message: `将目录「${folderLabel}」下的 ${teamRules.length} 条公开 Mock 规则及其所有版本复制到你的账号下（默认保持关闭状态，避免直接影响当前调试流量）。`,
      confirmText: '立即克隆',
      type: 'info',
    });
    if (!ok) return;

    setCloningFolder(true);
    try {
      const res = await mocksApi.forkFolder({
        sourceFolderId: selectedTeamFolder,
        sourceOwnerId: selectedTeamOwnerId ?? undefined,
        targetFolderName: folderLabel,
        activate: false,
      });
      toast.success(`已克隆 ${res.cloned_rules} 条规则到你的目录「${res.folder.name}」`);
      await Promise.all([loadData(), loadTeamData(true)]);
      setSelectedFolder(res.folder.id);
      switchTab('mine');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '克隆目录失败');
    } finally {
      setCloningFolder(false);
    }
  };

  const exportButtonLabel = exporting
    ? 'Exporting...'
    : selectedFolder === 'all'
      ? 'Export'
      : selectedFolder === 'unfiled'
        ? 'Export Unfiled'
        : 'Export Folder';

  const exportButtonTitle = selectedFolder === 'all'
    ? '导出全部 Mock 规则'
    : selectedFolder === 'unfiled'
      ? '导出“未分类”中的 Mock 规则'
      : `导出目录「${currentFolderObj?.name || ''}」中的 Mock 规则`;

  // Resolve current team folder header info
  const activeTeamOwner = selectedTeamOwnerId
    ? teamOwners.find((o) => o.user_id === selectedTeamOwnerId) ?? null
    : null;
  const activeTeamFolderName = selectedTeamFolder === 'unfiled'
    ? '未分类 (Unfiled)'
    : typeof selectedTeamFolder === 'number'
      ? (selectedTeamFolderMeta?.name
        || teamOwners.flatMap((o) => o.folders).find((f) => f.id === selectedTeamFolder)?.name
        || `目录 #${selectedTeamFolder}`)
      : null;

  return (
    <div className="h-full flex flex-col bg-slate-950">
      {/* Top Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 border-b border-slate-800 bg-slate-900">
        <div className="flex items-center gap-4 flex-wrap">
          <div>
            <h1 className="text-lg font-semibold text-slate-100">Mock Studio</h1>
            <p className="text-xs text-slate-500 mt-0.5">
              {activeTab === 'mine'
                ? `${mockCount} active · ${rules.length} configured`
                : `${teamTotalCount} team public mocks · ${teamOwners.length} contributors`}
            </p>
          </div>

          {/* Segmented View Switcher: My Mocks vs Team Shared */}
          <div className="flex items-center p-1 rounded-lg bg-slate-950/70 border border-slate-800">
            <button
              type="button"
              onClick={() => switchTab('mine')}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5 ${
                activeTab === 'mine'
                  ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30'
                  : 'text-slate-400 hover:text-slate-200 border border-transparent'
              }`}
            >
              <Folder size={13} />
              我的 Mocks
              <span className="font-mono text-[11px] opacity-75">{rules.length}</span>
            </button>
            <button
              type="button"
              onClick={() => switchTab('team')}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5 ${
                activeTab === 'team'
                  ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30'
                  : 'text-slate-400 hover:text-slate-200 border border-transparent'
              }`}
            >
              <Users size={13} />
              团队共享
              <span className="font-mono text-[11px] opacity-75">{teamTotalCount}</span>
            </button>
          </div>
        </div>

        {activeTab === 'mine' ? (
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              onClick={() => handleGlobalMode('proxy')}
              disabled={globalMode !== null}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium flex items-center gap-1.5 border transition-colors disabled:opacity-60 ${
                globalMode === 'proxy'
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-blue-500/15 text-blue-400 border-blue-500/20 hover:bg-blue-500/25'
              }`}
            >
              <GitBranch size={13} /> All Proxy
            </button>
            <button
              onClick={() => handleGlobalMode('mock')}
              disabled={globalMode !== null}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium flex items-center gap-1.5 border transition-colors disabled:opacity-60 ${
                globalMode === 'mock'
                  ? 'bg-emerald-600 text-white border-emerald-600'
                  : 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/25'
              }`}
            >
              <ToggleRight size={13} /> All Mock
            </button>
            <button
              onClick={() => setShowAiGenerate(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-purple-500/15 hover:bg-purple-500/25 border border-purple-500/20 text-purple-400 text-sm font-medium transition-colors"
            >
              <Sparkles size={14} />
              AI Generate
            </button>
            <button
              onClick={handleExport}
              disabled={exporting}
              title={exportButtonTitle}
              className="btn-secondary text-sm py-1.5 flex items-center gap-1.5 disabled:opacity-60"
            >
              {exporting ? <Loader2 size={14} className="animate-spin" /> : <ArrowUpFromLine size={14} />}
              {exportButtonLabel}
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={importing}
              title={currentFolderObj ? `导入 Mock（无目录字段的规则将放入「${currentFolderObj.name}」）` : '从 JSON 文件导入 Mock'}
              className="btn-secondary text-sm py-1.5 flex items-center gap-1.5 disabled:opacity-60"
            >
              {importing ? <Loader2 size={14} className="animate-spin" /> : <ArrowDownToLine size={14} />}
              {importing ? 'Importing...' : 'Import'}
            </button>
            <button
              onClick={() => { setEditingRule(null); setShowEditor(true); }}
              className="btn-primary text-sm py-1.5 flex items-center gap-1.5"
            >
              <Plus size={14} /> New Rule
            </button>
            <input ref={fileInputRef} type="file" accept=".json" className="hidden" onChange={handleImport} />
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-end gap-2">
            {selectedTeamFolder !== 'all' && (
              <>
                {(selectedTeamOwnerId || selectedTeamFolderMeta?.owner_id) && (
                  <button
                    type="button"
                    onClick={() => handleCopyFolderShareLink(
                      selectedTeamOwnerId || selectedTeamFolderMeta!.owner_id,
                      selectedTeamFolder,
                      activeTeamFolderName || '共享目录',
                    )}
                    className="btn-secondary text-sm py-1.5 flex items-center gap-1.5"
                  >
                    <Share2 size={14} /> 复制目录链接
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleCloneTeamFolder}
                  disabled={cloningFolder || teamRules.length === 0}
                  className="btn-primary text-sm py-1.5 flex items-center gap-1.5 disabled:opacity-50"
                >
                  {cloningFolder ? <Loader2 size={14} className="animate-spin" /> : <GitFork size={14} />}
                  {cloningFolder ? '克隆中...' : `克隆整个目录 (${teamRules.length})`}
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {/* Main Split Content */}
      {activeTab === 'mine' ? (
        <div className="flex-1 min-h-0 flex">
          <aside className="w-60 shrink-0 border-r border-slate-800 bg-slate-900 p-3 overflow-y-auto">
            <div className="flex items-center justify-between px-2 mb-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Folders</span>
              <button
                onClick={() => setShowNewFolder((visible) => !visible)}
                title="New folder"
                aria-label="New folder"
                className="p-1 rounded-md text-slate-500 hover:text-cyan-400 hover:bg-slate-800 transition-colors"
              >
                <FolderPlus size={14} />
              </button>
            </div>
            <div className="space-y-1">
              {showNewFolder && (
                <div className="p-2.5 mb-2 rounded-xl border border-slate-700 bg-slate-800/60 space-y-2">
                  <input
                    value={newFolderName}
                    onChange={(event) => setNewFolderName(event.target.value)}
                    onKeyDown={(event) => event.key === 'Enter' && handleCreateFolder()}
                    placeholder="Folder name"
                    aria-label="Folder name"
                    autoFocus
                    className="input-field w-full text-xs py-1.5"
                  />
                  <div className="flex justify-end gap-1.5">
                    <button
                      onClick={() => { setShowNewFolder(false); setNewFolderName(''); }}
                      className="px-2 py-1 text-[11px] text-slate-400 hover:text-slate-200"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleCreateFolder}
                      disabled={!newFolderName.trim()}
                      className="px-2.5 py-1 rounded-md bg-cyan-600 text-[11px] font-medium text-white disabled:opacity-40"
                    >
                      Create
                    </button>
                  </div>
                </div>
              )}
              <button
                onClick={() => setSelectedFolder('all')}
                className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-sm font-medium border transition-colors ${
                  selectedFolder === 'all'
                    ? 'bg-cyan-500/15 text-cyan-400 border-cyan-500/20'
                    : 'text-slate-400 border-transparent hover:bg-slate-800 hover:text-slate-200'
                }`}
              >
                <Folder size={14} /> <span className="flex-1 text-left">All Mocks</span><span className="text-xs opacity-70 font-mono">{rules.length}</span>
              </button>
              <button
                onClick={() => setSelectedFolder('unfiled')}
                className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-sm font-medium border transition-colors ${
                  selectedFolder === 'unfiled'
                    ? 'bg-cyan-500/15 text-cyan-400 border-cyan-500/20'
                    : 'text-slate-400 border-transparent hover:bg-slate-800 hover:text-slate-200'
                }`}
              >
                <Folder size={14} /> <span className="flex-1 text-left">Unfiled</span><span className="text-xs opacity-70 font-mono">{rules.filter((rule) => rule.folder_id === null).length}</span>
              </button>
              {folders.map((folder) => {
                const isFolderPublic = folder.is_public !== 0;
                return (
                  <div key={folder.id} className="group flex items-center gap-0.5">
                    {renamingFolderId === folder.id ? (
                      <div className="w-full p-2.5 rounded-xl border border-slate-700 bg-slate-800/60 space-y-2">
                        <input
                          value={renameFolderName}
                          onChange={(event) => setRenameFolderName(event.target.value)}
                          onKeyDown={(event) => event.key === 'Enter' && handleRenameFolder(folder)}
                          aria-label={`Rename ${folder.name}`}
                          autoFocus
                          className="input-field w-full text-xs py-1.5"
                        />
                        <div className="flex justify-end gap-1.5">
                          <button onClick={() => setRenamingFolderId(null)} className="px-2 py-1 text-[11px] text-slate-400">Cancel</button>
                          <button onClick={() => handleRenameFolder(folder)} className="px-2.5 py-1 rounded-md bg-cyan-600 text-[11px] font-medium text-white">Save</button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <button
                          onClick={() => setSelectedFolder(folder.id)}
                          className={`min-w-0 flex-1 flex items-center gap-2 px-2.5 py-2 rounded-lg text-sm font-medium border transition-colors ${
                            selectedFolder === folder.id
                              ? 'bg-cyan-500/15 text-cyan-400 border-cyan-500/20'
                              : 'text-slate-400 border-transparent hover:bg-slate-800 hover:text-slate-200'
                          }`}
                        >
                          <Folder size={14} className="shrink-0" />
                          <span className="flex-1 text-left truncate">{folder.name}</span>
                          <span className="text-xs opacity-70 font-mono">{folder.mock_count}</span>
                        </button>
                        <button
                          onClick={() => handleToggleFolderVisibility(folder)}
                          disabled={togglingFolderVisibilityId === folder.id}
                          title={isFolderPublic ? '目录公开（点击设为私有）' : '目录私有（点击设为公开）'}
                          aria-label={isFolderPublic ? `Set ${folder.name} private` : `Set ${folder.name} public`}
                          className={`p-1 rounded transition-colors ${
                            isFolderPublic
                              ? 'text-slate-500 hover:text-cyan-400 opacity-0 group-hover:opacity-100 focus:opacity-100'
                              : 'text-amber-400 hover:text-amber-300 opacity-100'
                          }`}
                        >
                          {isFolderPublic ? <Globe size={11} /> : <Lock size={11} />}
                        </button>
                        {isFolderPublic && user?.id && (
                          <button
                            onClick={() => handleCopyFolderShareLink(user.id, folder.id, folder.name)}
                            title={`复制目录「${folder.name}」分享链接`}
                            aria-label={`Share ${folder.name}`}
                            className="p-1 rounded text-slate-500 hover:text-cyan-400 opacity-0 group-hover:opacity-100 focus:opacity-100"
                          >
                            <Share2 size={11} />
                          </button>
                        )}
                        <button
                          onClick={() => { setRenamingFolderId(folder.id); setRenameFolderName(folder.name); }}
                          title={`Rename ${folder.name}`}
                          aria-label={`Rename ${folder.name}`}
                          className="p-1 rounded text-slate-500 hover:text-slate-200 opacity-0 group-hover:opacity-100 focus:opacity-100"
                        >
                          <Edit2 size={11} />
                        </button>
                        <button
                          onClick={() => handleDeleteFolder(folder)}
                          title={`Delete ${folder.name}`}
                          aria-label={`Delete ${folder.name}`}
                          className="p-1 rounded text-slate-500 hover:text-red-400 opacity-0 group-hover:opacity-100 focus:opacity-100"
                        >
                          <Trash2 size={11} />
                        </button>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </aside>

          <section className="flex-1 min-w-0 flex flex-col">
            <div className="px-6 py-3 border-b border-slate-800 bg-slate-900 flex items-center justify-between gap-3 flex-wrap">
              <div className="relative max-w-md flex-1 min-w-56">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  type="text"
                  placeholder="Search by name or URL..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="input-field w-full pl-9 pr-8 text-sm py-1.5"
                />
                {search && (
                  <button
                    type="button"
                    onClick={() => setSearch('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                  >
                    <X size={13} />
                  </button>
                )}
              </div>
              {currentFolderObj && (
                <div className="flex items-center gap-2 text-xs text-slate-400">
                  <span className="font-medium text-slate-200">{currentFolderObj.name}</span>
                  <button
                    type="button"
                    onClick={() => handleToggleFolderVisibility(currentFolderObj)}
                    disabled={togglingFolderVisibilityId === currentFolderObj.id}
                    className={`flex items-center gap-1 px-2 py-1 rounded-md border text-[11px] transition-colors ${
                      currentFolderObj.is_public !== 0
                        ? 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20 hover:bg-cyan-500/20'
                        : 'bg-amber-500/15 text-amber-400 border-amber-500/30 hover:bg-amber-500/25'
                    }`}
                  >
                    {currentFolderObj.is_public !== 0 ? <Globe size={11} /> : <Lock size={11} />}
                    {currentFolderObj.is_public !== 0 ? '团队公开' : '目录私有'}
                  </button>
                  {currentFolderObj.is_public !== 0 && user?.id && (
                    <button
                      type="button"
                      onClick={() => handleCopyFolderShareLink(user.id, currentFolderObj.id, currentFolderObj.name)}
                      className="flex items-center gap-1 px-2 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-[11px] transition-colors"
                    >
                      <Share2 size={11} /> 分享目录
                    </button>
                  )}
                </div>
              )}
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-4">
              {loading ? (
                <div className="flex items-center justify-center h-40">
                  <div className="w-6 h-6 border-2 border-cyan-500/30 border-t-cyan-500 rounded-full animate-spin" />
                </div>
              ) : filteredRules.length === 0 ? (
                <div className="text-center text-slate-500 py-16">
                  <div className="text-4xl mb-3">📦</div>
                  <p>{rules.length === 0 ? 'No mock rules yet' : 'No mocks in this folder'}</p>
                  <p className="text-sm mt-1">Create a rule or move one here from the editor</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {filteredRules.map((rule) => (
                    <MockRuleCard
                      key={rule.id}
                      rule={rule}
                      toggling={togglingRuleId === rule.id}
                      togglingVisibility={togglingRuleVisibilityId === rule.id}
                      onToggle={() => handleToggle(rule)}
                      onToggleVisibility={() => handleToggleRuleVisibility(rule)}
                      onVersionChange={(versionId) => handleVersionChange(rule, versionId)}
                      onEdit={() => { setEditingRule(rule); setShowEditor(true); }}
                      onDelete={() => handleDelete(rule.id)}
                    />
                  ))}
                </div>
              )}
            </div>
          </section>
        </div>
      ) : (
        /* ── Team Shared View ── */
        <div className="flex-1 min-h-0 flex">
          <aside className="w-64 shrink-0 border-r border-slate-800 bg-slate-900 p-3 overflow-y-auto space-y-2">
            <div className="px-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Team Directory</span>
            </div>

            <button
              type="button"
              onClick={() => selectTeamTarget(null, 'all')}
              className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-sm font-medium border transition-colors ${
                selectedTeamOwnerId === null && selectedTeamFolder === 'all'
                  ? 'bg-cyan-500/15 text-cyan-400 border-cyan-500/20'
                  : 'text-slate-400 border-transparent hover:bg-slate-800 hover:text-slate-200'
              }`}
            >
              <Users size={14} />
              <span className="flex-1 text-left">全部团队共享</span>
              <span className="text-xs opacity-70 font-mono">{teamTotalCount}</span>
            </button>

            <div className="space-y-3 pt-1">
              {teamOwners.map((owner) => {
                const isOwnerAllSelected = selectedTeamOwnerId === owner.user_id && selectedTeamFolder === 'all';
                return (
                  <div key={owner.user_id} className="space-y-1">
                    <button
                      type="button"
                      onClick={() => selectTeamTarget(owner.user_id, 'all')}
                      className={`w-full flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                        isOwnerAllSelected
                          ? 'bg-cyan-500/15 text-cyan-400 border-cyan-500/20'
                          : 'text-slate-300 border-transparent hover:bg-slate-800'
                      }`}
                    >
                      <span className="flex-1 text-left truncate" title={owner.email}>{owner.email}</span>
                      {owner.is_me && (
                        <span className="px-1 py-0.2 rounded text-[9px] bg-slate-700 text-slate-300 shrink-0">我</span>
                      )}
                      <span className="text-[11px] opacity-70 font-mono shrink-0">{owner.public_rule_count}</span>
                    </button>

                    <div className="pl-3 space-y-0.5 border-l border-slate-800 ml-2.5">
                      {owner.folders.map((folder) => {
                        const isFolderSelected = selectedTeamFolder === folder.id;
                        return (
                          <button
                            key={folder.id}
                            type="button"
                            onClick={() => selectTeamTarget(owner.user_id, folder.id)}
                            className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs font-medium border transition-colors ${
                              isFolderSelected
                                ? 'bg-cyan-500/15 text-cyan-400 border-cyan-500/20'
                                : 'text-slate-400 border-transparent hover:bg-slate-800 hover:text-slate-200'
                            }`}
                          >
                            <Folder size={12} className="shrink-0" />
                            <span className="flex-1 text-left truncate">{folder.name}</span>
                            <span className="text-[11px] opacity-70 font-mono">{folder.mock_count}</span>
                          </button>
                        );
                      })}
                      {owner.unfiled_count > 0 && (
                        <button
                          type="button"
                          onClick={() => selectTeamTarget(owner.user_id, 'unfiled')}
                          className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs font-medium border transition-colors ${
                            selectedTeamOwnerId === owner.user_id && selectedTeamFolder === 'unfiled'
                              ? 'bg-cyan-500/15 text-cyan-400 border-cyan-500/20'
                              : 'text-slate-400 border-transparent hover:bg-slate-800 hover:text-slate-200'
                          }`}
                        >
                          <Folder size={12} className="shrink-0 opacity-70" />
                          <span className="flex-1 text-left truncate">未分类</span>
                          <span className="text-[11px] opacity-70 font-mono">{owner.unfiled_count}</span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </aside>

          <section className="flex-1 min-w-0 flex flex-col">
            <div className="px-6 py-3 border-b border-slate-800 bg-slate-900 flex flex-wrap items-center justify-between gap-3">
              <div className="relative max-w-md flex-1 min-w-60">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  type="text"
                  placeholder="搜索规则名、URL、版本、作者或目录..."
                  value={teamSearch}
                  onChange={(e) => setTeamSearch(e.target.value)}
                  className="input-field w-full pl-9 pr-8 text-sm py-1.5"
                />
                {teamSearch && (
                  <button
                    type="button"
                    onClick={() => setTeamSearch('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                  >
                    <X size={13} />
                  </button>
                )}
              </div>

              {(activeTeamOwner || activeTeamFolderName) && (
                <div className="flex items-center gap-2 text-xs text-slate-400">
                  {activeTeamFolderName && (
                    <span className="flex items-center gap-1 px-2 py-1 rounded-md bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 font-medium">
                      <Folder size={12} /> {activeTeamFolderName}
                    </span>
                  )}
                  {(activeTeamOwner?.email || selectedTeamFolderMeta?.owner_email) && (
                    <span className="font-mono text-slate-400">
                      {activeTeamOwner?.email || selectedTeamFolderMeta?.owner_email}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => selectTeamTarget(null, 'all')}
                    className="text-slate-500 hover:text-slate-200 px-1.5 py-0.5 rounded hover:bg-slate-800"
                  >
                    查看全部
                  </button>
                </div>
              )}
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-4">
              {teamLoading ? (
                <div className="flex items-center justify-center h-40">
                  <div className="w-6 h-6 border-2 border-cyan-500/30 border-t-cyan-500 rounded-full animate-spin" />
                </div>
              ) : teamRules.length === 0 ? (
                <div className="text-center text-slate-500 py-16">
                  <div className="text-4xl mb-3">🌐</div>
                  <p>没有找到公开的团队 Mock 规则</p>
                  <p className="text-sm mt-1">所有人的 Mock 默认团队公开（除非作者手动设为私有）</p>
                </div>
              ) : (
                <div className="space-y-2.5">
                  {teamRules.map((rule) => (
                    <TeamMockRuleCard
                      key={rule.id}
                      rule={rule}
                      forkingKey={forkingRuleKey}
                      onFork={(opts) => handleForkTeamRule(rule, opts)}
                    />
                  ))}
                </div>
              )}
            </div>
          </section>
        </div>
      )}

      {/* Editor modal */}
      {showEditor && (
        <MockEditor
          rule={editingRule}
          defaultFolderId={defaultFolderId}
          onClose={() => { setShowEditor(false); void loadData(); void loadTeamData(true); }}
          onSaved={() => { void loadData(); void loadTeamData(true); }}
        />
      )}

      {/* AI Generate Modal */}
      {showAiGenerate && (
        <AiGenerateModal
          onClose={() => setShowAiGenerate(false)}
          onGenerated={() => { setShowAiGenerate(false); void loadData(); void loadTeamData(true); }}
          folders={folders}
          defaultFolderId={defaultFolderId}
        />
      )}
    </div>
  );
}

function MockRuleCard({
  rule,
  toggling,
  togglingVisibility,
  onToggle,
  onToggleVisibility,
  onVersionChange,
  onEdit,
  onDelete,
}: {
  rule: MockRule;
  toggling: boolean;
  togglingVisibility: boolean;
  onToggle: () => void;
  onToggleVisibility: () => void;
  onVersionChange: (versionId: number) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const isFolderPrivate = rule.folder_id !== null && rule.folder_is_public === 0;
  const isRulePublic = rule.is_public !== 0;

  return (
    <div className="card p-4 hover:border-slate-600 transition-colors">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="text-sm font-medium text-slate-200">{rule.name}</span>
            {rule.folder_name && (
              <span className="px-1.5 py-0.5 text-[10px] rounded bg-cyan-500/10 text-cyan-400">
                {rule.folder_name}
              </span>
            )}
            {rule.forked_from_email && (
              <span
                title={`复制自 ${rule.forked_from_email}`}
                className="px-1.5 py-0.5 text-[10px] rounded bg-purple-500/15 text-purple-400 flex items-center gap-1"
              >
                <GitFork size={10} /> Forked · {rule.forked_from_email.split('@')[0]}
              </span>
            )}
            <span className={`px-1.5 py-0.5 text-[10px] rounded font-mono ${
              rule.match_type === 'exact' ? 'bg-slate-700 text-slate-400' :
              rule.match_type === 'wildcard' ? 'bg-blue-500/20 text-blue-400' :
              'bg-purple-500/20 text-purple-400'
            }`}>
              {rule.match_type}
            </span>
            {rule.method && (
              <span className="px-1.5 py-0.5 text-[10px] rounded bg-slate-700 text-slate-400 font-mono">
                {rule.method}
              </span>
            )}
            {rule.delay_ms > 0 && (
              <span className="text-xs text-amber-400">⏱ {rule.delay_ms}ms</span>
            )}
          </div>
          <p className="text-xs font-mono text-slate-400 truncate">{rule.url_pattern}</p>
          <div className="flex items-center gap-3 mt-2 text-xs text-slate-500">
            <span>{rule.version_count} version{rule.version_count !== 1 ? 's' : ''}</span>
            {rule.active_version && (
              <span className="text-emerald-400">
                Active: {rule.active_version.name}
              </span>
            )}
            {rule.condition_field_type && (
              <span className="text-amber-400">
                Cond: {rule.condition_field_type}.{rule.condition_field_key}={rule.condition_field_value}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {isFolderPrivate ? (
            <span
              title="所在文件夹已设为私有，他人不可见"
              className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium bg-amber-500/15 text-amber-400 border border-amber-500/20"
            >
              <Lock size={12} /> 目录私有
            </span>
          ) : (
            <button
              type="button"
              onClick={onToggleVisibility}
              disabled={togglingVisibility}
              title={isRulePublic ? '团队公开（点击设为仅自己可见）' : '仅自己可见（点击设为团队公开）'}
              className={`flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium border transition-colors disabled:opacity-40 ${
                isRulePublic
                  ? 'bg-slate-800/80 text-slate-400 border-slate-700 hover:text-cyan-400 hover:border-cyan-500/30'
                  : 'bg-amber-500/15 text-amber-400 border-amber-500/30 hover:bg-amber-500/25'
              }`}
            >
              {togglingVisibility ? (
                <Loader2 size={12} className="animate-spin" />
              ) : isRulePublic ? (
                <Globe size={12} />
              ) : (
                <Lock size={12} />
              )}
              {isRulePublic ? '公开' : '私有'}
            </button>
          )}
          <div className="min-w-44 max-w-64">
            <CustomSelect
              size="xs"
              value={rule.active_version_id ?? ''}
              onChange={(val) => onVersionChange(Number(val))}
              disabled={!rule.versions?.length}
              ariaLabel={`Active version for ${rule.name}`}
              placeholder="No versions"
              options={
                rule.versions?.map((version) => ({
                  value: version.id,
                  label: version.name,
                  badge: String(version.response_status),
                  badgeColor:
                    version.response_status >= 200 && version.response_status < 300
                      ? 'bg-emerald-500/15 text-emerald-400'
                      : version.response_status >= 400
                        ? 'bg-red-500/15 text-red-400'
                        : 'bg-slate-700 text-slate-300',
                })) || []
              }
            />
          </div>
          <button
            onClick={onToggle}
            disabled={toggling || !rule.versions?.length}
            title={rule.is_active ? 'Switch to Proxy' : 'Switch to Mock'}
            className={`flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium disabled:opacity-40 ${
              rule.is_active ? 'bg-emerald-500/15 text-emerald-400' : 'bg-blue-500/10 text-blue-400'
            }`}
          >
            {toggling ? (
              <span className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" />
            ) : rule.is_active ? <ToggleRight size={16} /> : <ToggleLeft size={16} />}
            {rule.is_active ? 'MOCK' : 'PROXY'}
          </button>
          <button
            onClick={onEdit}
            aria-label={`Edit ${rule.name}`}
            className="p-2 rounded-lg hover:bg-slate-700 text-slate-400 hover:text-slate-200 transition-colors"
          >
            <Edit2 size={14} />
          </button>
          <button
            onClick={onDelete}
            aria-label={`Delete ${rule.name}`}
            className="p-2 rounded-lg hover:bg-red-500/10 text-slate-400 hover:text-red-400 transition-colors"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

function TeamMockRuleCard({
  rule,
  forkingKey,
  onFork,
}: {
  rule: MockRule;
  forkingKey: string | null;
  onFork: (options: { versionId?: number; activate: boolean }) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [previewVersionId, setPreviewVersionId] = useState<number | null>(null);
  const versions = (rule.versions || []) as MockVersion[];
  const isForkingCopy = forkingKey === `${rule.id}:rule:off`;
  const isForkingActivate = forkingKey === `${rule.id}:rule:on`;

  return (
    <div className="card overflow-hidden hover:border-slate-600 transition-colors">
      <div className="p-4 flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="text-sm font-medium text-slate-200">{rule.name}</span>
            {rule.owner_email && (
              <span className="px-1.5 py-0.5 text-[10px] rounded bg-blue-500/15 text-blue-400 font-mono">
                {rule.owner_email}{rule.is_mine ? ' (我)' : ''}
              </span>
            )}
            {rule.folder_name && (
              <span className="px-1.5 py-0.5 text-[10px] rounded bg-cyan-500/10 text-cyan-400">
                {rule.folder_name}
              </span>
            )}
            {rule.already_forked && (
              <span className="px-1.5 py-0.5 text-[10px] rounded bg-emerald-500/15 text-emerald-400 flex items-center gap-0.5">
                <Check size={10} /> 已复制过
              </span>
            )}
            <span className={`px-1.5 py-0.5 text-[10px] rounded font-mono ${
              rule.match_type === 'exact' ? 'bg-slate-700 text-slate-400' :
              rule.match_type === 'wildcard' ? 'bg-blue-500/20 text-blue-400' :
              'bg-purple-500/20 text-purple-400'
            }`}>
              {rule.match_type}
            </span>
            {rule.method && (
              <span className="px-1.5 py-0.5 text-[10px] rounded bg-slate-700 text-slate-400 font-mono">
                {rule.method}
              </span>
            )}
            {rule.delay_ms > 0 && (
              <span className="text-xs text-amber-400">⏱ {rule.delay_ms}ms</span>
            )}
          </div>
          <p className="text-xs font-mono text-slate-400 truncate">{rule.url_pattern}</p>
          <div className="flex items-center gap-3 mt-2 text-xs text-slate-500 flex-wrap">
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="flex items-center gap-1 text-cyan-400 hover:text-cyan-300 transition-colors"
            >
              {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              {versions.length} 个版本{expanded ? '（收起）' : '（展开预览）'}
            </button>
            {rule.condition_field_type && (
              <span className="text-amber-400">
                Cond: {rule.condition_field_type}.{rule.condition_field_key}={rule.condition_field_value}
              </span>
            )}
            <span className="text-slate-600">
              更新于 {new Date(rule.updated_at).toLocaleString('zh-CN', { hour12: false })}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => onFork({ activate: false })}
            disabled={forkingKey !== null}
            className="btn-secondary text-xs py-1.5 px-2.5 flex items-center gap-1.5 disabled:opacity-50"
            title="复制到我的 Mock（默认关闭，不立即生效）"
          >
            {isForkingCopy ? <Loader2 size={12} className="animate-spin" /> : <GitFork size={12} />}
            {isForkingCopy ? '复制中...' : '复制到我的 Mocks'}
          </button>
          <button
            type="button"
            onClick={() => onFork({ activate: true })}
            disabled={forkingKey !== null || versions.length === 0}
            className="btn-primary text-xs py-1.5 px-2.5 flex items-center gap-1.5 disabled:opacity-50"
            title="复制到我的 Mock 并立即启用"
          >
            {isForkingActivate ? <Loader2 size={12} className="animate-spin" /> : <ToggleRight size={13} />}
            {isForkingActivate ? '复制中...' : '复制并启用'}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="px-4 pb-3 pt-2 border-t border-slate-800/80 bg-slate-950/30 space-y-1.5">
          {versions.length === 0 ? (
            <p className="text-xs text-slate-600 italic">暂无响应版本</p>
          ) : versions.map((v) => {
            const isPreviewOpen = previewVersionId === v.id;
            const isForkingVer = forkingKey === `${rule.id}:${v.id}:on`;
            return (
              <div key={v.id} className="rounded-lg border border-slate-800 bg-slate-900/60 overflow-hidden">
                <div className="flex items-center gap-2 px-3 py-2 text-xs">
                  <span className="text-slate-200 font-medium flex-1 truncate">{v.name}</span>
                  <span className={`font-mono px-1.5 py-0.5 rounded text-[11px] ${
                    v.response_status >= 200 && v.response_status < 300
                      ? 'bg-emerald-500/15 text-emerald-400'
                      : v.response_status >= 400
                        ? 'bg-red-500/15 text-red-400'
                        : 'bg-slate-700 text-slate-300'
                  }`}>
                    {v.response_status}
                  </span>
                  <button
                    type="button"
                    onClick={() => setPreviewVersionId(isPreviewOpen ? null : v.id)}
                    className="flex items-center gap-1 px-2 py-1 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200 text-[11px] transition-colors"
                  >
                    {isPreviewOpen ? <EyeOff size={12} /> : <Eye size={12} />}
                    {isPreviewOpen ? '收起数据' : '预览数据'}
                  </button>
                  <button
                    type="button"
                    onClick={() => onFork({ versionId: v.id, activate: true })}
                    disabled={forkingKey !== null}
                    className="flex items-center gap-1 px-2 py-1 rounded bg-cyan-500/15 hover:bg-cyan-600 text-cyan-400 hover:text-white border border-cyan-500/30 text-[11px] font-medium transition-colors disabled:opacity-50"
                  >
                    {isForkingVer ? <Loader2 size={11} className="animate-spin" /> : <GitFork size={11} />}
                    {isForkingVer ? '复制中...' : '采用此版本'}
                  </button>
                </div>
                {isPreviewOpen && (
                  <div className="px-3 pb-3 pt-1 border-t border-slate-800">
                    <JsonViewer data={parseJson(v.response_body) ?? v.response_body} maxHeight="260px" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

interface AiGenerateModalProps {
  onClose: () => void;
  onGenerated: () => void;
  folders: MockFolder[];
  defaultFolderId: number | null;
}

function AiGenerateModal({ onClose, onGenerated, folders, defaultFolderId }: AiGenerateModalProps) {
  const [description, setDescription] = useState('');
  const [url, setUrl] = useState('');
  const [method, setMethod] = useState('GET');
  const [folderId, setFolderId] = useState<number | null>(defaultFolderId);
  const [loading, setLoading] = useState(false);
  const [scenarios, setScenarios] = useState<Array<{
    name: string;
    response_status: number;
    response_headers: Record<string, string>;
    response_body: string;
  }>>([]);
  const [rawOutput, setRawOutput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const cancelRef = useRef<(() => void) | null>(null);

  const handleGenerate = () => {
    if (!description.trim()) return;
    setLoading(true);
    setRawOutput('');
    setScenarios([]);
    setError(null);

    let fullText = '';
    cancelRef.current = streamAiRequest(
      '/ai/generate-mock',
      { description, url, method },
      (text) => {
        fullText += text;
        setRawOutput(fullText);
      },
      (final) => {
        const text = (final || fullText).trim();
        try {
          // Try to extract JSON array from the text
          const jsonMatch = text.match(/\[[\s\S]*\]/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            setScenarios(parsed);
          }
        } catch {
          setError('Could not parse AI response as JSON');
        }
        setLoading(false);
      },
      (err) => {
        setError(err);
        setLoading(false);
      }
    );
  };

  const handleSaveScenario = async (s: typeof scenarios[0]) => {
    if (!url) return;
    try {
      const rule = await mocksApi.create({ name: s.name, url_pattern: url, match_type: 'exact', method, folder_id: folderId });
      await mocksApi.createVersion(rule.id, {
        name: s.name,
        response_status: s.response_status,
        response_headers: JSON.stringify(s.response_headers),
        response_body: typeof s.response_body === 'string' ? s.response_body : JSON.stringify(s.response_body),
      });
    } catch {
      // ignore
    }
  };

  const handleSaveAll = async () => {
    for (const s of scenarios) {
      await handleSaveScenario(s);
    }
    onGenerated();
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center gap-2 px-6 py-4 border-b border-slate-800">
          <Sparkles size={16} className="text-purple-400" />
          <h2 className="text-base font-semibold text-slate-100">AI Mock Generator</h2>
          <button onClick={onClose} className="ml-auto p-1 rounded hover:bg-slate-700 text-slate-400">
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <label className="block text-xs text-slate-400 mb-1">API Endpoint URL</label>
              <input value={url} onChange={(e) => setUrl(e.target.value)}
                className="input-field w-full text-sm font-mono" placeholder="/api/users/:id" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Method</label>
              <CustomSelect
                value={method}
                onChange={(val) => setMethod(val)}
                mono
                options={['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => ({ value: m, label: m }))}
              />
            </div>
            <div className="col-span-3">
              <label className="block text-xs text-slate-400 mb-1">Save to Folder</label>
              <CustomSelect
                value={folderId ?? ''}
                onChange={(val) => setFolderId(val ? Number(val) : null)}
                options={[
                  { value: '', label: 'Unfiled' },
                  ...folders.map((folder) => ({ value: folder.id, label: folder.name })),
                ]}
              />
            </div>
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1">Describe the API (what it does)</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="input-field w-full text-sm resize-none"
              placeholder="e.g. Returns user profile data including name, email, avatar, and account settings..."
            />
          </div>

          <button
            onClick={handleGenerate}
            disabled={loading || !description.trim()}
            className="btn-primary w-full flex items-center justify-center gap-2"
          >
            {loading ? (
              <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : <Bot size={15} />}
            Generate Mock Scenarios
          </button>

          {error && (
            <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          {loading && rawOutput && (
            <div className="text-xs font-mono text-slate-400 bg-slate-800/50 rounded-lg p-3 max-h-32 overflow-y-auto">
              {rawOutput}
            </div>
          )}

          {scenarios.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium text-slate-200">
                Generated {scenarios.length} scenarios:
              </p>
              {scenarios.map((s, i) => (
                <div key={i} className="card p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`text-xs font-mono font-bold ${
                      s.response_status >= 200 && s.response_status < 300 ? 'text-emerald-400' : 'text-red-400'
                    }`}>{s.response_status}</span>
                    <span className="text-sm text-slate-200">{s.name}</span>
                  </div>
                  <pre className="text-xs font-mono text-slate-400 bg-slate-900 rounded p-2 max-h-24 overflow-y-auto whitespace-pre-wrap">
                    {typeof s.response_body === 'string'
                      ? s.response_body.slice(0, 200)
                      : JSON.stringify(s.response_body, null, 2).slice(0, 200)}
                    {(typeof s.response_body === 'string' ? s.response_body : JSON.stringify(s.response_body)).length > 200 && '...'}
                  </pre>
                </div>
              ))}

              <button onClick={handleSaveAll} className="btn-primary w-full mt-2">
                Save All {scenarios.length} Scenarios
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
