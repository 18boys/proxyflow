import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import {
  Activity, Layers, GitBranch, Smartphone, LogOut, Moon, Sun, Zap
} from 'lucide-react';
import { useStore } from '../store/useStore';
import { useEffect, useRef } from 'react';
import type { RequestLog } from '../types';

const NAV_ITEMS = [
  { to: '/dashboard', icon: Activity, label: 'Monitor' },
  { to: '/rules', icon: GitBranch, label: 'Routes' },
  { to: '/mocks', icon: Layers, label: 'Mocks' },
  { to: '/devices', icon: Smartphone, label: 'Devices' },
];

export default function Layout() {
  const { user, token, logout, theme, toggleTheme, prependRequest, updateDeviceStatus } = useStore();
  const navigate = useNavigate();
  const wsRef = useRef<WebSocket | null>(null);

  // Connect WebSocket for real-time updates with auto-reconnect
  useEffect(() => {
    if (!token) return;

    let destroyed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    function connect() {
      if (destroyed) return;
      // Use dynamic hostname to support non-localhost deployments
      const wsHost = window.location.hostname;
      const wsUrl = `ws://${wsHost}:9000/ws/dashboard?token=${token}`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'new_request') {
            prependRequest(msg.log as RequestLog);
          } else if (msg.type === 'device_online') {
            updateDeviceStatus(msg.sessionId as string, true);
          } else if (msg.type === 'device_offline') {
            updateDeviceStatus(msg.sessionId as string, false);
          }
        } catch {
          // ignore parse errors
        }
      };

      ws.onclose = () => {
        if (!destroyed) {
          // Auto-reconnect after 3 seconds
          reconnectTimer = setTimeout(() => {
            connect();
          }, 3000);
        }
      };

      ws.onerror = () => {
        ws.close();
      };
    }

    connect();

    return () => {
      destroyed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [token, prependRequest, updateDeviceStatus]);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className={`flex h-screen overflow-hidden ${theme === 'light' ? 'bg-slate-100' : 'bg-slate-950'}`}>
      {/* Sidebar */}
      <aside className="w-16 lg:w-56 flex flex-col bg-slate-900 border-r border-slate-800 shrink-0">
        {/* Logo */}
        <div className="h-14 flex items-center px-3 lg:px-4 border-b border-slate-800">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center shrink-0">
              <Zap size={16} className="text-white" />
            </div>
            <span className="hidden lg:block font-bold text-white text-sm truncate">proxyflow</span>
          </div>
        </div>

        {/* Nav items */}
        <nav className="flex-1 py-4 flex flex-col gap-1 px-2">
          {NAV_ITEMS.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors text-sm font-medium
                ${isActive
                  ? 'bg-cyan-500/20 text-cyan-400'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                }`
              }
            >
              <Icon size={18} className="shrink-0" />
              <span className="hidden lg:block">{label}</span>
            </NavLink>
          ))}
        </nav>

        {/* Bottom actions */}
        <div className="p-2 border-t border-slate-800 space-y-1">
          <button
            onClick={toggleTheme}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors text-sm"
          >
            {theme === 'dark' ? <Sun size={18} className="shrink-0" /> : <Moon size={18} className="shrink-0" />}
            <span className="hidden lg:block">{theme === 'dark' ? 'Light Mode' : 'Dark Mode'}</span>
          </button>
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-colors text-sm"
          >
            <LogOut size={18} className="shrink-0" />
            <span className="hidden lg:block truncate">{user?.email || 'Logout'}</span>
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-hidden">
        <Outlet />
      </main>
    </div>
  );
}
