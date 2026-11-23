import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Zap, CheckCircle2, XCircle, ShieldCheck, Clock, Terminal,
  LogOut, Loader2, AlertTriangle, Smartphone,
} from 'lucide-react';
import { mcpAuthApi, type McpAuthRequestInfo } from '../api/client';
import { useStore } from '../store/useStore';

export default function McpAuthPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user, logout } = useStore();
  const requestId = (searchParams.get('request_id') || '').trim();

  const [info, setInfo] = useState<McpAuthRequestInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tokenName, setTokenName] = useState('');
  const [ensureSession, setEnsureSession] = useState(true);
  const [submitting, setSubmitting] = useState<'approve' | 'deny' | null>(null);
  const [result, setResult] = useState<{
    status: 'approved' | 'denied';
    tokenName?: string;
    tokenPrefix?: string;
    createdSessionId?: string | null;
  } | null>(null);

  useEffect(() => {
    if (!requestId) {
      setError('缺少授权请求参数（request_id），请从 AI 编辑器重新发起授权。');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    mcpAuthApi.getRequest(requestId)
      .then((data) => {
        setInfo(data);
        const suggested = data.hostname
          ? `${data.client_name} (${data.hostname})`
          : `${data.client_name} (Auto)`;
        setTokenName(suggested);
        setEnsureSession(!data.has_device_session);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : '加载授权请求失败');
      })
      .finally(() => setLoading(false));
  }, [requestId]);

  const handleApprove = async () => {
    if (!requestId || submitting) return;
    setSubmitting('approve');
    setError(null);
    try {
      const res = await mcpAuthApi.approve({
        request_id: requestId,
        token_name: tokenName.trim() || undefined,
        ensure_session: ensureSession,
      });
      setResult({
        status: 'approved',
        tokenName: res.token_name,
        tokenPrefix: res.token_prefix,
        createdSessionId: res.created_session_id,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : '授权失败，请重试');
    } finally {
      setSubmitting(null);
    }
  };

  const handleDeny = async () => {
    if (!requestId || submitting) return;
    setSubmitting('deny');
    setError(null);
    try {
      await mcpAuthApi.deny(requestId);
      setResult({ status: 'denied' });
    } catch (err) {
      setError(err instanceof Error ? err.message : '拒绝授权失败');
    } finally {
      setSubmitting(null);
    }
  };

  const handleSwitchAccount = () => {
    logout();
    navigate('/login', {
      state: { from: `/mcp-auth?request_id=${encodeURIComponent(requestId)}` },
      replace: true,
    });
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-[linear-gradient(rgba(6,182,212,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(6,182,212,0.03)_1px,transparent_1px)] bg-[size:64px_64px] pointer-events-none" />

      <div className="relative w-full max-w-md bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl overflow-hidden">
        {/* Brand header */}
        <div className="px-6 py-5 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center shadow-sm shadow-cyan-500/20">
              <Zap size={16} className="text-white" />
            </div>
            <div>
              <h1 className="text-sm font-bold text-slate-100">ProxyFlow MCP 授权</h1>
              <p className="text-[11px] text-slate-500">自动生成并下发 API Token</p>
            </div>
          </div>
          <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-cyan-500/15 text-cyan-400 border border-cyan-500/25 flex items-center gap-1">
            <Terminal size={10} /> MCP
          </span>
        </div>

        <div className="p-6 space-y-5">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-10 gap-3 text-slate-400 text-xs">
              <Loader2 size={24} className="animate-spin text-cyan-400" />
              <span>正在加载授权请求...</span>
            </div>
          ) : result?.status === 'approved' ? (
            <div className="text-center space-y-4 py-3">
              <div className="w-12 h-12 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 flex items-center justify-center mx-auto">
                <CheckCircle2 size={26} />
              </div>
              <div className="space-y-1.5">
                <h2 className="text-base font-semibold text-slate-100">授权成功！</h2>
                <p className="text-xs text-slate-400 leading-relaxed">
                  已为 <span className="font-mono text-slate-200">{user?.email}</span> 自动生成访问 Token，MCP 客户端会自动领取并保存到本地凭证。
                  现在可以关闭此页面，直接返回 AI 编辑器继续操作。
                </p>
              </div>
              <div className="text-left bg-slate-950/60 border border-slate-800 rounded-xl p-3.5 text-xs space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Token 名称</span>
                  <span className="text-slate-200 font-medium">{result.tokenName}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Token 前缀</span>
                  <code className="text-cyan-400 font-mono">{result.tokenPrefix}••••••••</code>
                </div>
                {result.createdSessionId && (
                  <div className="flex items-center justify-between gap-2 pt-1 border-t border-slate-800">
                    <span className="text-slate-500 shrink-0">自动创建 Session</span>
                    <code className="text-emerald-400 font-mono truncate">{result.createdSessionId}</code>
                  </div>
                )}
              </div>
              <div className="flex items-center justify-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => navigate('/settings')}
                  className="btn-secondary text-xs py-1.5 px-3"
                >
                  查看 API Tokens
                </button>
                <button
                  type="button"
                  onClick={() => navigate('/dashboard')}
                  className="btn-primary text-xs py-1.5 px-3.5"
                >
                  进入控制台
                </button>
              </div>
            </div>
          ) : result?.status === 'denied' ? (
            <div className="text-center space-y-4 py-4">
              <div className="w-12 h-12 rounded-full bg-red-500/15 border border-red-500/30 text-red-400 flex items-center justify-center mx-auto">
                <XCircle size={26} />
              </div>
              <div className="space-y-1">
                <h2 className="text-base font-semibold text-slate-100">已拒绝本次授权</h2>
                <p className="text-xs text-slate-400">未生成任何 Token，你可以关闭此页面。</p>
              </div>
              <button
                type="button"
                onClick={() => navigate('/dashboard')}
                className="btn-secondary text-xs py-1.5 px-4"
              >
                返回控制台
              </button>
            </div>
          ) : error && !info ? (
            <div className="text-center space-y-4 py-4">
              <div className="w-12 h-12 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-400 flex items-center justify-center mx-auto">
                <AlertTriangle size={24} />
              </div>
              <p className="text-sm text-slate-300">{error}</p>
              <button
                type="button"
                onClick={() => navigate('/dashboard')}
                className="btn-secondary text-xs py-1.5 px-4"
              >
                返回控制台
              </button>
            </div>
          ) : info && info.status !== 'pending' ? (
            <div className="text-center space-y-4 py-4">
              <div className="w-12 h-12 rounded-full bg-slate-800 border border-slate-700 text-slate-400 flex items-center justify-center mx-auto">
                {info.status === 'expired' ? <Clock size={24} className="text-amber-400" /> : <CheckCircle2 size={24} className="text-emerald-400" />}
              </div>
              <div className="space-y-1">
                <h2 className="text-base font-semibold text-slate-100">
                  {info.status === 'expired'
                    ? '授权链接已过期'
                    : info.status === 'denied'
                      ? '该授权请求已被拒绝'
                      : '该授权请求已完成'}
                </h2>
                <p className="text-xs text-slate-400">
                  {info.status === 'expired'
                    ? '授权链接有效期为 10 分钟，请回到 AI 编辑器中重新触发授权。'
                    : '你可以直接关闭此页面或返回控制台查看。'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => navigate('/dashboard')}
                className="btn-secondary text-xs py-1.5 px-4"
              >
                返回控制台
              </button>
            </div>
          ) : info ? (
            <>
              {/* Account badge */}
              <div className="flex items-center justify-between gap-2 px-3.5 py-2.5 rounded-xl bg-slate-800/60 border border-slate-700/80 text-xs">
                <div className="min-w-0">
                  <p className="text-[11px] text-slate-500">当前授权账号</p>
                  <p className="font-mono text-slate-200 truncate">{user?.email || info.user_email}</p>
                </div>
                <button
                  type="button"
                  onClick={handleSwitchAccount}
                  className="flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-slate-700 text-slate-400 hover:text-slate-200 transition-colors shrink-0"
                >
                  <LogOut size={12} /> 切换账号
                </button>
              </div>

              {/* Verification code */}
              <div className="rounded-xl border border-cyan-500/30 bg-cyan-500/5 p-4 text-center space-y-1.5">
                <p className="text-[11px] text-slate-400">请确认此验证码与 AI 编辑器中显示的一致</p>
                <div className="text-2xl font-bold font-mono tracking-widest text-cyan-400">
                  {info.user_code}
                </div>
                <p className="text-[11px] text-slate-500">
                  请求方：{info.client_name}{info.hostname ? ` · ${info.hostname}` : ''}
                </p>
              </div>

              {/* Token name */}
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5">
                  自动生成的 Token 名称（后续可在 Settings 中随时吊销）
                </label>
                <input
                  type="text"
                  value={tokenName}
                  onChange={(e) => setTokenName(e.target.value)}
                  className="input-field w-full text-sm py-1.5"
                  placeholder="例如：ProxyFlow MCP (MacBook)"
                />
              </div>

              {/* Optional auto device session */}
              {!info.has_device_session && (
                <label className="flex items-start gap-2.5 px-3 py-2.5 rounded-xl border border-slate-800 bg-slate-800/40 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={ensureSession}
                    onChange={(e) => setEnsureSession(e.target.checked)}
                    className="mt-0.5 w-4 h-4 accent-cyan-500 rounded shrink-0"
                  />
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-slate-200 flex items-center gap-1.5">
                      <Smartphone size={12} className="text-cyan-400" />
                      同时自动生成默认设备 Session ID
                    </div>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      当前账号暂无配对设备，勾选后 Agent 可直接获取 session_id 写入项目配置。
                    </p>
                  </div>
                </label>
              )}

              {/* Permissions note */}
              <div className="flex items-start gap-2 text-[11px] text-slate-500 leading-relaxed">
                <ShieldCheck size={14} className="text-emerald-400 shrink-0 mt-0.5" />
                <span>
                  授权后该 MCP 客户端将能够管理你的 Mock 规则、查看抓包日志、归档分享链接及自动获取/创建设备 Session ID。
                </span>
              </div>

              {error && (
                <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">
                  {error}
                </div>
              )}

              {/* Actions */}
              <div className="flex items-center gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={handleDeny}
                  disabled={submitting !== null}
                  className="btn-secondary flex-1 text-sm py-2 disabled:opacity-50"
                >
                  {submitting === 'deny' ? '处理中...' : '拒绝'}
                </button>
                <button
                  type="button"
                  onClick={handleApprove}
                  disabled={submitting !== null}
                  className="btn-primary flex-1 text-sm py-2 flex items-center justify-center gap-1.5 disabled:opacity-50"
                >
                  {submitting === 'approve' ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <CheckCircle2 size={14} />
                  )}
                  {submitting === 'approve' ? '授权中...' : '确认授权'}
                </button>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
