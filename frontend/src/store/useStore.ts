import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { User, RequestLog, MockRule, DeviceSession } from '../types';

interface AppState {
  // Auth
  user: User | null;
  token: string | null;
  setAuth: (user: User, token: string) => void;
  logout: () => void;

  // Theme
  theme: 'dark' | 'light';
  toggleTheme: () => void;

  // Selected request
  selectedRequestId: number | null;
  setSelectedRequestId: (id: number | null) => void;

  // Request list
  requests: RequestLog[];
  setRequests: (logs: RequestLog[]) => void;
  prependRequest: (log: RequestLog) => void;

  // Devices
  devices: DeviceSession[];
  setDevices: (devices: DeviceSession[]) => void;
  updateDeviceStatus: (sessionId: string, isOnline: boolean) => void;

  // Mock rules
  mockRules: MockRule[];
  setMockRules: (rules: MockRule[]) => void;

  // Selected requests for AI diagnosis
  selectedForDiagnosis: number[];
  toggleDiagnosisSelection: (id: number) => void;
  clearDiagnosisSelection: () => void;

  // Filter state
  filters: {
    url: string;
    method: string;
    status: string;
    sessionId: string;
    startTime: string;
    endTime: string;
  };
  setFilter: (key: string, value: string) => void;
  clearFilters: () => void;
}

export const useStore = create<AppState>()(
  persist(
    (set) => ({
      // Auth
      user: null,
      token: null,
      setAuth: (user, token) => {
        localStorage.setItem('proxyflow_token', token);
        set({ user, token });
      },
      logout: () => {
        localStorage.removeItem('proxyflow_token');
        set({ user: null, token: null });
      },

      // Theme
      theme: 'dark',
      toggleTheme: () => set((state) => ({ theme: state.theme === 'dark' ? 'light' : 'dark' })),

      // Selected request
      selectedRequestId: null,
      setSelectedRequestId: (id) => set({ selectedRequestId: id }),

      // Requests
      requests: [],
      setRequests: (logs) => set({ requests: logs }),
      prependRequest: (log) => set((state) => ({
        requests: [log, ...state.requests].slice(0, 1000), // Keep max 1000
      })),

      // Devices
      devices: [],
      setDevices: (devices) => set({ devices }),
      updateDeviceStatus: (sessionId, isOnline) => set((state) => ({
        devices: state.devices.map((d) =>
          d.session_id === sessionId ? { ...d, is_online: isOnline ? 1 : 0 } : d
        ),
      })),

      // Mock rules
      mockRules: [],
      setMockRules: (rules) => set({ mockRules: rules }),

      // Diagnosis
      selectedForDiagnosis: [],
      toggleDiagnosisSelection: (id) => set((state) => ({
        selectedForDiagnosis: state.selectedForDiagnosis.includes(id)
          ? state.selectedForDiagnosis.filter((i) => i !== id)
          : [...state.selectedForDiagnosis, id],
      })),
      clearDiagnosisSelection: () => set({ selectedForDiagnosis: [] }),

      // Filters
      filters: { url: '', method: '', status: '', sessionId: '', startTime: '', endTime: '' },
      setFilter: (key, value) => set((state) => ({
        filters: { ...state.filters, [key]: value },
      })),
      clearFilters: () => set({
        filters: { url: '', method: '', status: '', sessionId: '', startTime: '', endTime: '' },
      }),
    }),
    {
      name: 'proxyflow-storage',
      partialize: (state) => ({
        user: state.user,
        token: state.token,
        theme: state.theme,
      }),
    }
  )
);
