import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import AuthForm from './AuthForm';
import { onUnauthorized } from '../api/client';
import { useStore } from '../store/useStore';

export default function AuthModal() {
  const [open, setOpen] = useState(false);
  const token = useStore((s) => s.token);

  useEffect(() => {
    // 监听 401 事件呼出弹窗
    const unsubscribe = onUnauthorized(() => {
      setOpen(true);
    });

    const handleCustomEvent = () => setOpen(true);
    window.addEventListener('proxyflow:unauthorized', handleCustomEvent);

    return () => {
      unsubscribe();
      window.removeEventListener('proxyflow:unauthorized', handleCustomEvent);
    };
  }, []);

  // 如果原本就没有 Token（纯未登录首次打开，交给路由的 AuthPage 渲染，不重复浮层）
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fade-in">
      <div className="relative w-full max-w-md bg-slate-900 border border-slate-700/90 rounded-2xl p-6 sm:p-7 shadow-2xl animate-scale-up">
        {/* 如果用户本地还有 token 可以关闭，纯过期要求重登 */}
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="absolute top-4 right-4 p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
          title="关闭"
        >
          <X size={16} />
        </button>

        <AuthForm
          isModal
          title="登录已失效 / 请先登录"
          subtitle="登录态已过期或未授权，验证密码后可无缝继续当前联调"
          onSuccess={() => {
            setOpen(false);
          }}
        />
      </div>
    </div>
  );
}

