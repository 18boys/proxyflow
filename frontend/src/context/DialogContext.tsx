import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';

export interface ConfirmOptions {
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  type?: 'danger' | 'warning' | 'info' | 'primary';
}

export interface AlertOptions {
  title?: string;
  message: string;
  confirmText?: string;
  type?: 'error' | 'warning' | 'info' | 'success';
}

export interface ToastItem {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info' | 'warning';
}

interface DialogContextValue {
  confirm: (options: ConfirmOptions | string) => Promise<boolean>;
  alert: (options: AlertOptions | string) => Promise<void>;
  toast: {
    success: (message: string) => void;
    error: (message: string) => void;
    info: (message: string) => void;
    warning: (message: string) => void;
  };
}

const DialogContext = createContext<DialogContextValue | null>(null);

export function useDialog(): DialogContextValue {
  const ctx = useContext(DialogContext);
  if (!ctx) {
    throw new Error('useDialog must be used within a DialogProvider');
  }
  return ctx;
}

export function DialogProvider({ children }: { children: React.ReactNode }) {
  // Confirm state
  const [confirmState, setConfirmState] = useState<{
    isOpen: boolean;
    options: ConfirmOptions;
    resolve: (value: boolean) => void;
  } | null>(null);

  // Alert state
  const [alertState, setAlertState] = useState<{
    isOpen: boolean;
    options: AlertOptions;
    resolve: () => void;
  } | null>(null);

  // Toasts state
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const toastIdRef = useRef(0);

  const confirm = useCallback((options: ConfirmOptions | string): Promise<boolean> => {
    const opts: ConfirmOptions = typeof options === 'string' ? { message: options } : options;
    return new Promise<boolean>((resolve) => {
      setConfirmState({
        isOpen: true,
        options: opts,
        resolve,
      });
    });
  }, []);

  const alert = useCallback((options: AlertOptions | string): Promise<void> => {
    const opts: AlertOptions = typeof options === 'string' ? { message: options } : options;
    return new Promise<void>((resolve) => {
      setAlertState({
        isOpen: true,
        options: opts,
        resolve,
      });
    });
  }, []);

  const addToast = useCallback((message: string, type: 'success' | 'error' | 'info' | 'warning') => {
    const id = `toast-${++toastIdRef.current}-${Date.now()}`;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3500);
  }, []);

  const toast = {
    success: useCallback((msg: string) => addToast(msg, 'success'), [addToast]),
    error: useCallback((msg: string) => addToast(msg, 'error'), [addToast]),
    info: useCallback((msg: string) => addToast(msg, 'info'), [addToast]),
    warning: useCallback((msg: string) => addToast(msg, 'warning'), [addToast]),
  };

  const handleConfirmClose = (result: boolean) => {
    if (confirmState) {
      confirmState.resolve(result);
      setConfirmState(null);
    }
  };

  const handleAlertClose = () => {
    if (alertState) {
      alertState.resolve();
      setAlertState(null);
    }
  };

  // Keyboard accessibility
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (confirmState?.isOpen) {
          handleConfirmClose(false);
        } else if (alertState?.isOpen) {
          handleAlertClose();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [confirmState, alertState]);

  return (
    <DialogContext.Provider value={{ confirm, alert, toast }}>
      {children}

      {/* Confirm Modal */}
      {confirmState?.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm animate-fade-in">
          <div
            className="w-full max-w-md bg-slate-900 border border-slate-700/80 rounded-xl shadow-2xl p-5 space-y-4 animate-scale-up text-slate-100"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3.5">
              <div className={`p-2.5 rounded-xl shrink-0 ${
                confirmState.options.type === 'danger'
                  ? 'bg-red-500/15 text-red-400 border border-red-500/20'
                  : confirmState.options.type === 'warning'
                    ? 'bg-amber-500/15 text-amber-400 border border-amber-500/20'
                    : 'bg-cyan-500/15 text-cyan-400 border border-cyan-500/20'
              }`}>
                {confirmState.options.type === 'danger' ? (
                  <AlertCircle size={22} />
                ) : confirmState.options.type === 'warning' ? (
                  <AlertTriangle size={22} />
                ) : (
                  <Info size={22} />
                )}
              </div>
              <div className="flex-1 min-w-0 pt-0.5">
                <h3 className="text-sm font-semibold text-slate-100">
                  {confirmState.options.title || '请确认操作'}
                </h3>
                <p className="text-xs text-slate-400 mt-1.5 leading-relaxed break-words whitespace-pre-line">
                  {confirmState.options.message}
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => handleConfirmClose(false)}
                className="px-3.5 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 hover:border-slate-600 transition-colors cursor-pointer"
              >
                {confirmState.options.cancelText || '取消'}
              </button>
              <button
                type="button"
                autoFocus
                onClick={() => handleConfirmClose(true)}
                className={`px-4 py-1.5 rounded-lg text-xs font-semibold text-white transition-all shadow-sm cursor-pointer ${
                  confirmState.options.type === 'danger'
                    ? 'bg-red-600 hover:bg-red-500 shadow-red-600/20'
                    : confirmState.options.type === 'warning'
                      ? 'bg-amber-600 hover:bg-amber-500 shadow-amber-600/20'
                      : 'bg-cyan-600 hover:bg-cyan-500 shadow-cyan-600/20'
                }`}
              >
                {confirmState.options.confirmText || '确定'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Alert Modal */}
      {alertState?.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm animate-fade-in">
          <div
            className="w-full max-w-md bg-slate-900 border border-slate-700/80 rounded-xl shadow-2xl p-5 space-y-4 animate-scale-up text-slate-100"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3.5">
              <div className={`p-2.5 rounded-xl shrink-0 ${
                alertState.options.type === 'error'
                  ? 'bg-red-500/15 text-red-400 border border-red-500/20'
                  : alertState.options.type === 'success'
                    ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20'
                    : alertState.options.type === 'warning'
                      ? 'bg-amber-500/15 text-amber-400 border border-amber-500/20'
                      : 'bg-cyan-500/15 text-cyan-400 border border-cyan-500/20'
              }`}>
                {alertState.options.type === 'error' ? (
                  <AlertCircle size={22} />
                ) : alertState.options.type === 'success' ? (
                  <CheckCircle2 size={22} />
                ) : alertState.options.type === 'warning' ? (
                  <AlertTriangle size={22} />
                ) : (
                  <Info size={22} />
                )}
              </div>
              <div className="flex-1 min-w-0 pt-0.5">
                <h3 className="text-sm font-semibold text-slate-100">
                  {alertState.options.title || (alertState.options.type === 'error' ? '操作提示' : '提示')}
                </h3>
                <p className="text-xs text-slate-400 mt-1.5 leading-relaxed break-words whitespace-pre-line">
                  {alertState.options.message}
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end pt-2">
              <button
                type="button"
                autoFocus
                onClick={handleAlertClose}
                className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-cyan-600 hover:bg-cyan-500 text-white shadow-sm shadow-cyan-600/20 transition-all cursor-pointer"
              >
                {alertState.options.confirmText || '我知道了'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Floating Toast Container */}
      {toasts.length > 0 && (
        <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 max-w-sm pointer-events-none">
          {toasts.map((t) => (
            <div
              key={t.id}
              className={`pointer-events-auto flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl border shadow-xl text-xs backdrop-blur-md transition-all animate-fade-in ${
                t.type === 'success'
                  ? 'bg-emerald-950/90 border-emerald-500/30 text-emerald-200'
                  : t.type === 'error'
                    ? 'bg-red-950/90 border-red-500/30 text-red-200'
                    : t.type === 'warning'
                      ? 'bg-amber-950/90 border-amber-500/30 text-amber-200'
                      : 'bg-slate-900/90 border-slate-700 text-slate-200'
              }`}
            >
              <div className="shrink-0">
                {t.type === 'success' && <CheckCircle2 size={15} className="text-emerald-400" />}
                {t.type === 'error' && <AlertCircle size={15} className="text-red-400" />}
                {t.type === 'warning' && <AlertTriangle size={15} className="text-amber-400" />}
                {t.type === 'info' && <Info size={15} className="text-cyan-400" />}
              </div>
              <span className="flex-1 font-medium">{t.message}</span>
              <button
                onClick={() => setToasts((prev) => prev.filter((item) => item.id !== t.id))}
                className="shrink-0 p-0.5 opacity-60 hover:opacity-100 transition-opacity cursor-pointer"
              >
                <X size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
    </DialogContext.Provider>
  );
}
