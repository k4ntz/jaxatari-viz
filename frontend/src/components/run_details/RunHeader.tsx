import React from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { ArrowLeft, Server, Settings, Eye } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { RunInfo } from '../../api';

interface RunHeaderProps {
  runInfo: RunInfo;
  showConfig: boolean;
  setShowConfig: (val: boolean) => void;
  tagColor?: string;
}

export const RunHeader: React.FC<RunHeaderProps> = ({
  runInfo,
  showConfig,
  setShowConfig,
  tagColor = 'indigo'
}) => {
  const navigate = useNavigate();

  return (
    <div className="flex items-center gap-6 mb-8 pb-6 border-b border-[#2e334d] shrink-0 relative" style={{ zIndex: 1000 }}>
      <button onClick={() => navigate(-1)} className="panel-btn w-10 h-10 flex items-center justify-center border rounded-xl transition-all">
        <ArrowLeft className="w-5 h-5" />
      </button>
      <div className="flex-1">
        <h1 className="text-3xl font-bold text-white tracking-tight flex items-center gap-3">
          {runInfo.id}
        </h1>
        <div className="flex items-center gap-6 mt-2">
          <span className="flex items-center gap-2 text-sm text-slate-400">
            <Server className={`w-4 h-4 text-${tagColor}-400`} /> Model: <strong className="text-white font-medium bg-[rgba(255,255,255,0.05)] px-2 py-0.5 rounded border border-[#2e334d]">{runInfo.config.model || 'Unknown'}</strong>
          </span>
          <span className="flex items-center gap-2 text-sm text-slate-400">
            <Settings className="w-4 h-4 text-purple-400" /> Method: <strong className="text-white font-medium bg-[rgba(255,255,255,0.05)] px-2 py-0.5 rounded border border-[#2e334d]">{runInfo.config.method || 'Unknown'}</strong>
          </span>
        </div>
      </div>
      
      {/* Hover Config Popup Button */}
      <div 
        className="relative"
        style={{ zIndex: 1000 }}
        onMouseEnter={() => setShowConfig(true)}
        onMouseLeave={() => setShowConfig(false)}
      >
        <button className="panel-btn flex items-center gap-2 border px-4 py-2 rounded-lg transition-all font-medium text-sm">
          <Eye className="w-4 h-4" /> View Config
        </button>

        {showConfig && (
          <div className="absolute top-full right-0 mt-2 w-80 sm:w-96 max-w-[calc(100vw-3rem)] pointer-events-auto shadow-2xl" style={{ zIndex: 1000 }}>
            <div className="flex flex-col p-6 rounded-2xl border border-indigo-500/30 bg-[#06080F] shadow-2xl" style={{ zIndex: 1000 }}>
              <h2 className="text-sm font-bold uppercase tracking-wider text-slate-300 mb-4 flex items-center gap-2 shrink-0">
                <Settings className="w-4 h-4 text-purple-400" /> Configuration
              </h2>
              <div className="bg-[#000000] rounded-lg border border-[#2e334d] max-h-96 overflow-y-auto custom-scrollbar">
                <SyntaxHighlighter
                  language="json"
                  style={vscDarkPlus}
                  customStyle={{ margin: 0, padding: '1rem', background: '#000000', fontSize: '1.12rem' }}
                >
                  {JSON.stringify(runInfo.config, null, 2)}
                </SyntaxHighlighter>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
