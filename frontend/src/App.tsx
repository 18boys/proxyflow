import { useEffect, useLayoutEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useStore } from './store/useStore';
import { DialogProvider } from './context/DialogContext';
import Layout from './components/Layout';
import AuthModal from './components/AuthModal';
import AuthPage from './pages/AuthPage';
import DashboardPage from './pages/DashboardPage';
import MocksPage from './pages/MocksPage';
import DevicesPage from './pages/DevicesPage';
import SharedRequestPage from './pages/SharedRequestPage';
import SettingsPage from './pages/SettingsPage';
import AnalyticsPage from './pages/AnalyticsPage';
import { authApi } from './api/client';

function RequireAuth({ children }: { children: React.ReactNode }) {
  const token = useStore((s) => s.token);
  if (!token) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  const theme = useStore((s) => s.theme);
  const { token, setAuth } = useStore();

  // Apply the theme class synchronously (before paint) and suppress CSS transitions while the
  // theme flips. Otherwise every element with `transition-colors` animates its border/background
  // from the old theme's colour, which makes list dividers and card borders flash visibly.
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.classList.add('theme-switching');
    if (theme === 'dark') {
      root.classList.remove('light');
    } else {
      root.classList.add('light');
    }
    const timer = window.setTimeout(() => root.classList.remove('theme-switching'), 120);
    return () => window.clearTimeout(timer);
  }, [theme]);

  // Auto-refresh token on page load, and poll every 12 hours while browser is open
  useEffect(() => {
    if (!token) return;

    // 1. 启动时刷新一次
    authApi.refresh()
      .then(({ token: newToken, user }) => setAuth(user, newToken))
      .catch(() => {/* 失败时若返回 401，拦截器已触发 AuthModal */});

    // 2. 每 12 小时静默自动续期一次，只要持续在用就永远不会掉线
    const interval = setInterval(() => {
      authApi.refresh()
        .then(({ token: newToken, user }) => setAuth(user, newToken))
        .catch(() => {});
    }, 12 * 60 * 60 * 1000);

    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  return (
    <DialogProvider>
      <AuthModal />
      <BrowserRouter>
        <Routes>
        <Route path="/login" element={<AuthPage />} />
        <Route path="/register" element={<AuthPage />} />
        <Route path="/share/:token" element={<SharedRequestPage />} />
        <Route
          path="/"
          element={
            <RequireAuth>
              <Layout />
            </RequireAuth>
          }
        >
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<DashboardPage />} />
          <Route path="mocks" element={<MocksPage />} />
          <Route path="rules" element={<Navigate to="/mocks" replace />} />
          <Route path="devices" element={<DevicesPage />} />
          <Route path="analytics" element={<AnalyticsPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </BrowserRouter>
  </DialogProvider>
  );
}
