import { useEffect, useState, useRef } from 'react';
import { Bot, X, Brain } from 'lucide-react';
import { useStore } from '../store/useStore';
import { requestsApi, streamAiRequest } from '../api/client';
import RequestList from '../components/RequestList';
import RequestDetail from '../components/RequestDetail';

export default function DashboardPage() {
  const {
    requests, setRequests, selectedRequestId, setSelectedRequestId,
    selectedForDiagnosis, clearDiagnosisSelection,
  } = useStore();

  const [loadingRequests, setLoadingRequests] = useState(false);
  const [showAiPanel, setShowAiPanel] = useState(false);
  const [aiOutput, setAiOutput] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const aiCancelRef = useRef<(() => void) | null>(null);

  // Load initial requests
  useEffect(() => {
    setLoadingRequests(true);
    requestsApi.list({ limit: 100 })
      .then((data) => setRequests(data.logs))
      .catch(console.error)
      .finally(() => setLoadingRequests(false));
  }, [setRequests]);

  const handleSelectRequest = (id: number) => {
    setSelectedRequestId(id);
  };

  const handleAiDiagnose = () => {
    if (selectedForDiagnosis.length === 0) return;
    setShowAiPanel(true);
    setAiOutput('');
    setAiLoading(true);

    aiCancelRef.current = streamAiRequest(
      '/ai/diagnose',
      { requestIds: selectedForDiagnosis },
      (text) => setAiOutput((prev) => prev + text),
      () => setAiLoading(false),
      (err) => {
        setAiOutput(`Error: ${err}`);
        setAiLoading(false);
      }
    );
  };

  const handleCloseAi = () => {
    aiCancelRef.current?.();
    setShowAiPanel(false);
    setAiOutput('');
    clearDiagnosisSelection();
  };

  return (
    <div className="flex h-full relative overflow-hidden bg-slate-900">
      {/* Request List (full width by default) */}
      <div className="flex-1 flex flex-col h-full border-r border-slate-800 min-w-0">
        {/* Column header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
          <h2 className="text-sm font-semibold text-slate-200">Requests</h2>
          {selectedForDiagnosis.length > 0 && (
            <button
              onClick={handleAiDiagnose}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-purple-500/20 hover:bg-purple-500/30 text-purple-400 text-xs transition-colors"
            >
              <Brain size={12} />
              AI Diagnose ({selectedForDiagnosis.length})
            </button>
          )}
        </div>
        {loadingRequests ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="w-5 h-5 border-2 border-cyan-500/30 border-t-cyan-500 rounded-full animate-spin" />
          </div>
        ) : (
          <div className="flex-1 overflow-hidden">
            <RequestList onSelectRequest={handleSelectRequest} />
          </div>
        )}
      </div>

      {/* Detail Panel (right drawer) */}
      <div
        className={`absolute top-0 bottom-0 right-0 w-[500px] lg:w-[600px] bg-slate-900 border-l border-slate-700 shadow-2xl flex flex-col z-10 transition-all duration-300 ${
          selectedRequestId ? 'translate-x-0' : 'translate-x-full'
        } ${showAiPanel ? 'mr-96' : ''}`}
      >
        <RequestDetail requestId={selectedRequestId} onClose={() => setSelectedRequestId(null)} />
      </div>

      {/* AI Panel (right drawer) */}
      <div 
        className={`absolute right-0 top-0 bottom-0 w-96 bg-slate-900 border-l border-slate-700 flex flex-col z-20 transition-transform duration-300 ${
          showAiPanel ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
          <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-800">
            <Bot size={16} className="text-purple-400" />
            <span className="text-sm font-semibold text-slate-200">AI Diagnosis</span>
            {aiLoading && (
              <span className="ml-auto text-xs text-slate-400 flex items-center gap-1">
                <span className="w-3 h-3 border border-purple-400 border-t-transparent rounded-full animate-spin inline-block" />
                Analyzing...
              </span>
            )}
            <button
              onClick={handleCloseAi}
              className="ml-auto p-1 rounded hover:bg-slate-700 text-slate-400 hover:text-slate-200 transition-colors"
            >
              <X size={14} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            {aiOutput ? (
              <div className="text-sm text-slate-300 leading-relaxed whitespace-pre-wrap">
                <MarkdownText text={aiOutput} />
              </div>
            ) : aiLoading ? (
              <div className="text-slate-500 text-sm">Processing request analysis...</div>
            ) : null}
          </div>
        </div>
    </div>
  );
}

// Simple markdown renderer for bold/headers
function MarkdownText({ text }: { text: string }) {
  const lines = text.split('\n');
  return (
    <>
      {lines.map((line, i) => {
        if (line.startsWith('## ')) {
          return <h3 key={i} className="text-base font-bold text-slate-100 mt-4 mb-1">{line.slice(3)}</h3>;
        }
        if (line.startsWith('# ')) {
          return <h2 key={i} className="text-lg font-bold text-slate-100 mt-4 mb-2">{line.slice(2)}</h2>;
        }
        if (line.startsWith('**') && line.endsWith('**')) {
          return <p key={i} className="font-bold text-slate-200">{line.slice(2, -2)}</p>;
        }
        if (line.startsWith('- ') || line.startsWith('* ')) {
          return <li key={i} className="ml-4 list-disc text-slate-300">{line.slice(2)}</li>;
        }
        if (line.trim() === '') {
          return <br key={i} />;
        }
        // Handle inline bold
        const boldParts = line.split(/\*\*(.*?)\*\*/g);
        if (boldParts.length > 1) {
          return (
            <p key={i}>
              {boldParts.map((part, j) =>
                j % 2 === 1 ? <strong key={j} className="text-slate-100">{part}</strong> : part
              )}
            </p>
          );
        }
        return <p key={i}>{line}</p>;
      })}
    </>
  );
}
