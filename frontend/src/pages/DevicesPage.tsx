import { useEffect, useState } from 'react';
import { Smartphone, Plus, Wifi, WifiOff, Trash2, Edit2, QrCode, X, Check, Shield, PlayCircle } from 'lucide-react';
import QRCode from 'react-qr-code';
import type { DeviceSession } from '../types';
import { devicesApi, settingsApi } from '../api/client';
import { useStore } from '../store/useStore';
import { copyToClipboard } from '../utils/clipboard';

export default function DevicesPage() {
  const { devices, setDevices } = useStore();
  const [loading, setLoading] = useState(true);
  const [showPairModal, setShowPairModal] = useState(false);
  const [viewQrSessionId, setViewQrSessionId] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameInput, setRenameInput] = useState('');

  // Exclusion domain state
  const [exclusions, setExclusions] = useState<string[]>([]);
  const [newDomain, setNewDomain] = useState('');
  const [savingExclusions, setSavingExclusions] = useState(false);

  const loadDevices = async () => {
    try {
      const [devData, settingsData] = await Promise.all([
        devicesApi.list(),
        settingsApi.get(),
      ]);
      setDevices(devData);
      setExclusions(settingsData.exclusion_domains);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDevices();
  }, []);

  const handleDisconnect = async (sessionId: string) => {
    if (!confirm('Disconnect this device?')) return;
    await devicesApi.disconnect(sessionId);
    setDevices(devices.filter((d) => d.session_id !== sessionId));
  };

  const handleRename = async (sessionId: string) => {
    if (!renameInput.trim()) return;
    await devicesApi.rename(sessionId, renameInput);
    setDevices(devices.map((d) => d.session_id === sessionId ? { ...d, name: renameInput } : d));
    setRenaming(null);
  };



  const handleAddExclusion = () => {
    const domain = newDomain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (!domain || exclusions.includes(domain)) return;
    setExclusions([...exclusions, domain]);
    setNewDomain('');
  };

  const handleRemoveExclusion = (domain: string) => {
    setExclusions(exclusions.filter((d) => d !== domain));
  };

  const handleSaveExclusions = async () => {
    setSavingExclusions(true);
    try {
      let finalExclusions = [...exclusions];
      const domain = newDomain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
      if (domain && !finalExclusions.includes(domain)) {
        finalExclusions.push(domain);
        setNewDomain('');
      }

      const result = await settingsApi.updateExclusions(finalExclusions);
      setExclusions(result.exclusion_domains);
    } finally {
      setSavingExclusions(false);
    }
  };



  return (
    <div className="h-full flex flex-col overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-900/30">
        <div>
          <h1 className="text-lg font-semibold text-slate-100">Connected Devices</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            {devices.filter(d => d.last_seen && (Date.now() - new Date(d.last_seen.replace(' ', 'T') + '+08:00').getTime() < 30 * 60 * 1000)).length} online
          </p>
        </div>
        <button
          onClick={() => setShowPairModal(true)}
          className="btn-primary text-sm flex items-center gap-1.5"
        >
          <Plus size={14} /> Pair New Device
        </button>
      </div>

      <div className="flex-1 px-6 py-4 space-y-8">
        {/* Device list */}
        {loading ? (
          <div className="flex items-center justify-center h-40">
            <div className="w-6 h-6 border-2 border-cyan-500/30 border-t-cyan-500 rounded-full animate-spin" />
          </div>
        ) : devices.length === 0 ? (
          <div className="text-center text-slate-500 py-16">
            <Smartphone size={48} className="mx-auto mb-3 text-slate-700" />
            <p>No devices paired yet</p>
            <p className="text-sm mt-1">Click "Pair New Device" to generate a QR code</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {devices.map((device) => (
              <DeviceCard
                key={device.session_id}
                device={device}
                onDisconnect={() => handleDisconnect(device.session_id)}
                isRenaming={renaming === device.session_id}
                renameInput={renameInput}
                onStartRename={() => {
                  setRenaming(device.session_id);
                  setRenameInput(device.name);
                }}
                onRenameChange={setRenameInput}
                onRenameConfirm={() => handleRename(device.session_id)}
                onRenameCancel={() => setRenaming(null)}
                onViewQr={() => setViewQrSessionId(device.session_id)}
              />
            ))}
          </div>
        )}

        {/* Exclusion Domains */}
        <div className="card p-5">
          <div className="flex items-center gap-2 mb-4">
            <Shield size={16} className="text-cyan-400" />
            <h2 className="text-sm font-semibold text-slate-200">Proxy Exclusion Domains</h2>
          </div>
          <p className="text-xs text-slate-500 mb-4">
            Requests to these domains will be forwarded silently — they will not appear in the console or be subject to Mock rules.
            Useful for analytics, crash reporting, and CDN traffic.
          </p>

          {/* Existing exclusions */}
          {exclusions.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-3">
              {exclusions.map((domain) => (
                <span
                  key={domain}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-slate-800 border border-slate-700 rounded-full text-xs text-slate-300 font-mono"
                >
                  {domain}
                  <button
                    onClick={() => handleRemoveExclusion(domain)}
                    className="text-slate-500 hover:text-red-400 transition-colors"
                  >
                    <X size={11} />
                  </button>
                </span>
              ))}
            </div>
          )}

          {/* Add new domain */}
          <div className="flex gap-2">
            <input
              value={newDomain}
              onChange={(e) => setNewDomain(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddExclusion()}
              placeholder="e.g. analytics.google.com or sentry.io"
              className="input-field flex-1 text-xs font-mono"
            />
            <button
              onClick={handleAddExclusion}
              className="btn-secondary text-xs px-3"
            >
              Add
            </button>
            <button
              onClick={handleSaveExclusions}
              disabled={savingExclusions}
              className="btn-primary text-xs px-3 flex items-center gap-1.5"
            >
              {savingExclusions ? (
                <span className="w-3 h-3 border border-white/30 border-t-white rounded-full animate-spin" />
              ) : <Check size={12} />}
              Save
            </button>
          </div>
        </div>
      </div>

      {showPairModal && (
        <PairModal
          onClose={() => {
            setShowPairModal(false);
            loadDevices();
          }}
        />
      )}

      {viewQrSessionId && (
        <PairModal
          existingSessionId={viewQrSessionId}
          onClose={() => setViewQrSessionId(null)}
        />
      )}
    </div>
  );
}

function CopyField({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    const success = await copyToClipboard(value);
    if (success) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };
  return (
    <div className="bg-slate-800 rounded-lg p-3 font-mono">
      <p className="text-slate-500 mb-1">{label}</p>
      <div className="flex items-center gap-2">
        <p className={`break-all flex-1 ${highlight ? 'text-cyan-400' : 'text-slate-300'}`}>{value}</p>
        <button
          onClick={handleCopy}
          className="shrink-0 text-slate-500 hover:text-slate-200 transition-colors"
          title="Copy"
        >
          {copied ? <Check size={12} className="text-emerald-400" /> : <span className="text-[10px]">copy</span>}
        </button>
      </div>
    </div>
  );
}

interface DeviceCardProps {
  device: DeviceSession;
  onDisconnect: () => void;
  isRenaming: boolean;
  renameInput: string;
  onStartRename: () => void;
  onRenameChange: (v: string) => void;
  onRenameConfirm: () => void;
  onRenameCancel: () => void;
  onViewQr: () => void;
}

function DeviceCard({
  device, onDisconnect, isRenaming, renameInput,
  onStartRename, onRenameChange, onRenameConfirm, onRenameCancel, onViewQr
}: DeviceCardProps) {
  const isOnline = device.last_seen ? (Date.now() - new Date(device.last_seen.replace(' ', 'T') + '+08:00').getTime() < 30 * 60 * 1000) : false;
  return (
    <div className="card p-4">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
            isOnline ? 'bg-emerald-500/20' : 'bg-slate-700'
          }`}>
            <Smartphone size={16} className={isOnline ? 'text-emerald-400' : 'text-slate-500'} />
          </div>
          <div>
            {isRenaming ? (
              <div className="flex items-center gap-1">
                <input
                  value={renameInput}
                  onChange={(e) => onRenameChange(e.target.value)}
                  className="bg-slate-700 text-sm text-slate-200 rounded px-2 py-0.5 w-28 focus:outline-none"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') onRenameConfirm();
                    if (e.key === 'Escape') onRenameCancel();
                  }}
                />
                <button onClick={onRenameConfirm} className="p-0.5 text-emerald-400 hover:text-emerald-300">
                  <Check size={12} />
                </button>
                <button onClick={onRenameCancel} className="p-0.5 text-slate-400 hover:text-slate-200">
                  <X size={12} />
                </button>
              </div>
            ) : (
              <p className="text-sm font-medium text-slate-200">{device.name}</p>
            )}
            <div className="flex items-center gap-1.5 mt-0.5">
              {isOnline ? (
                <Wifi size={11} className="text-emerald-400" />
              ) : (
                <WifiOff size={11} className="text-slate-500" />
              )}
              <span className={`text-xs ${isOnline ? 'text-emerald-400' : 'text-slate-500'}`}>
                {isOnline ? 'Online' : 'Offline'}
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1">

            <button
              onClick={onViewQr}
              className="p-1.5 rounded hover:bg-slate-700 text-slate-500 hover:text-slate-200 transition-colors"
              title="View QR Code"
            >
              <QrCode size={12} />
            </button>
          {!isRenaming && (
            <button
              onClick={onStartRename}
              className="p-1.5 rounded hover:bg-slate-700 text-slate-500 hover:text-slate-200 transition-colors"
            >
              <Edit2 size={12} />
            </button>
          )}
          <button
            onClick={onDisconnect}
            className="p-1.5 rounded hover:bg-red-500/10 text-slate-500 hover:text-red-400 transition-colors"
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>
      <div className="text-xs text-slate-600 font-mono space-y-0.5 mt-2">
        <CopyField label="Session ID" value={device.session_id} />
        {device.last_seen && (
          <p className="mt-1">Last Request: {new Date(device.last_seen.replace(' ', 'T') + '+08:00').toLocaleString()}</p>
        )}
        <p>Created: {new Date(device.created_at.replace(' ', 'T') + '+08:00').toLocaleDateString()}</p>
      </div>
    </div>
  );
}

interface PairModalProps {
  onClose: () => void;
  existingSessionId?: string;
}

function PairModal({ onClose, existingSessionId }: PairModalProps) {
  const [deviceName, setDeviceName] = useState('My iPhone');
  const [loading, setLoading] = useState(!!existingSessionId);
  const [pairData, setPairData] = useState<{
    sessionId: string;
    wsUrl: string;
    httpUrl: string;
    qrCode: string;
    pairingToken: string;
  } | null>(null);

  useEffect(() => {
    if (existingSessionId) {
      setLoading(true);
      devicesApi.getPairInfo(existingSessionId)
        .then(setPairData)
        .finally(() => setLoading(false));
    }
  }, [existingSessionId]);

  const handleGenerateQR = async () => {
    setLoading(true);
    try {
      const data = await devicesApi.pair(deviceName);
      setPairData(data);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <QrCode size={16} className="text-cyan-400" />
            <h2 className="text-base font-semibold text-slate-100">{existingSessionId ? 'Device QR Code' : 'Pair New Device'}</h2>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-slate-700 text-slate-400">
            <X size={16} />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          {loading ? (
            <div className="flex justify-center my-8">
              <div className="w-8 h-8 border-2 border-cyan-500/30 border-t-cyan-500 rounded-full animate-spin" />
            </div>
          ) : !pairData ? (
            <>
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5">Device Name</label>
                <input
                  value={deviceName}
                  onChange={(e) => setDeviceName(e.target.value)}
                  className="input-field w-full"
                  placeholder="e.g. My iPhone"
                />
              </div>
              <button
                onClick={handleGenerateQR}
                className="btn-primary w-full flex items-center justify-center gap-2"
              >
                <QrCode size={16} />
                Generate QR Code
              </button>
              <p className="text-xs text-slate-500 text-center">
                Scan the QR code with your mobile device running the proxyflow SDK
              </p>
            </>
          ) : (
            <div className="flex flex-col items-center gap-4">
              {/* QR Code */}
              <div className="bg-white p-4 rounded-xl">
                <QRCode
                  value={JSON.stringify({ 
                    wsUrl: `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws/device?token=${pairData.pairingToken}`, 
                    httpUrl: window.location.origin, 
                    sessionId: pairData.sessionId, 
                    pairingToken: pairData.pairingToken 
                  })}
                  size={200}
                />
              </div>

              <div className="w-full space-y-2 text-xs">
                <CopyField label="Session ID (填入 SDK init)" value={pairData.sessionId} highlight />
                <CopyField label="WSS Endpoint" value={`${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws/device?token=${pairData.pairingToken}`} />
                <CopyField label="HTTP Endpoint" value={window.location.origin} />
              </div>

              <div className="flex items-center gap-2 text-sm text-emerald-400">
                <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                Waiting for device to connect...
              </div>

              <button onClick={onClose} className="btn-secondary w-full text-sm">
                Done
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
