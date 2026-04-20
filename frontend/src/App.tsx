import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useStore } from './store/useStore';
import Layout from './components/Layout';
import AuthPage from './pages/AuthPage';
import DashboardPage from './pages/DashboardPage';
import MocksPage from './pages/MocksPage';
import RulesPage from './pages/RulesPage';
import DevicesPage from './pages/DevicesPage';
import SharedRequestPage from './pages/SharedRequestPage';
import { authApi } from './api/client';

function RequireAuth({ children }: { children: React.ReactNode }) {
  const token = useStore((s) => s.token);
  if (!token) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  const theme = useStore((s) => s.theme);
  const { token, setAuth } = useStore();

  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.remove('light');
    } else {
      document.documentElement.classList.add('light');
    }
  }, [theme]);

  // Auto-refresh token on page load to extend expiry
  useEffect(() => {
    if (!token) return;
    authApi.refresh()
      .then(({ token: newToken, user }) => setAuth(user, newToken))
      .catch(() => {/* token invalid, user will be redirected on next auth-required call */});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<AuthPage mode="login" />} />
        <Route path="/register" element={<AuthPage mode="register" />} />
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
          <Route path="rules" element={<RulesPage />} />
          <Route path="devices" element={<DevicesPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
