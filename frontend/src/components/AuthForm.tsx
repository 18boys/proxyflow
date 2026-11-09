import { useState } from 'react';
import { Zap, Eye, EyeOff, AlertCircle, ArrowRight, ShieldCheck } from 'lucide-react';
import { authApi } from '../api/client';
import { useStore } from '../store/useStore';

interface AuthFormProps {
  onSuccess?: () => void;
  title?: string;
  subtitle?: string;
  isModal?: boolean;
}

export default function AuthForm({
  onSuccess,
  title = '欢迎使用 proxyflow',
  subtitle = '输入账号密码直接登录，新邮箱将自动创建账号',
  isModal = false,
}: AuthFormProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setAuth = useStore((s) => s.setAuth);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const result = await authApi.continueAuth(email, password);
      setAuth(result.user, result.token);
      onSuccess?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : '认证失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full">
      {/* Header */}
      <div className="text-center mb-6">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-gradient-to-br from-cyan-500 to-blue-600 mb-3 shadow-md shadow-cyan-500/20">
          <Zap size={24} className="text-white" />
        </div>
        <h2 className="text-xl font-bold text-slate-100">{title}</h2>
        <p className="text-slate-400 mt-1 text-xs">{subtitle}</p>
      </div>

      {/* Error Alert */}
      {error && (
        <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/30 text-red-400 rounded-xl px-3.5 py-2.5 mb-4 text-xs">
          <AlertCircle size={15} className="shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Unified Form */}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-xs font-medium text-slate-300 mb-1.5">
            工作邮箱 / 开发者账号
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="input-field w-full text-sm"
            placeholder="dev@example.com"
            required
            autoFocus
          />
        </div>

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="block text-xs font-medium text-slate-300">
              账户密码
            </label>
            <span className="text-[11px] text-slate-500">至少 6 位字符</span>
          </div>
          <div className="relative">
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input-field w-full pr-10 text-sm"
              placeholder="••••••••"
              required
              minLength={6}
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 transition-colors"
            >
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="btn-primary w-full justify-center flex items-center gap-2 mt-2 py-2.5 text-sm"
        >
          {loading ? (
            <span className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          ) : (
            <>
              <span>进入工作台</span>
              <ArrowRight size={15} />
            </>
          )}
        </button>
      </form>

      {/* Friendly Hint */}
      <div className="mt-5 pt-3.5 border-t border-slate-800/80 flex items-center justify-center gap-1.5 text-[11px] text-slate-400">
        <ShieldCheck size={13} className="text-cyan-400" />
        <span>支持自动识别：未注册邮箱将直接自动开通并登录</span>
      </div>

      {!isModal && (
        <p className="text-center text-[11px] text-slate-600 mt-5">
          proxyflow · API Mock & Proxy Platform
        </p>
      )}
    </div>
  );
}

