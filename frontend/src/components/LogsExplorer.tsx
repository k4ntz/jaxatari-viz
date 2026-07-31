import React, { useEffect, useState } from 'react';
import { fetchRunLogs } from '../api';
import { Terminal, Search } from 'lucide-react';

interface LogsExplorerProps {
  selectedRuns: string[];
}

const LogsExplorer: React.FC<LogsExplorerProps> = ({ selectedRuns }) => {
  const [logsMap, setLogsMap] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    if (selectedRuns.length === 0) return;
    
    setLoading(true);
    const loadLogs = async () => {
      const newLogsMap: Record<string, string> = {};
      for (const runId of selectedRuns) {
        if (!logsMap[runId]) {
          try {
            newLogsMap[runId] = await fetchRunLogs(runId);
          } catch (e) {
            newLogsMap[runId] = "Failed to load logs.";
          }
        } else {
          newLogsMap[runId] = logsMap[runId];
        }
      }
      setLogsMap(prev => ({ ...prev, ...newLogsMap }));
      setLoading(false);
    };
    
    loadLogs();
  }, [selectedRuns]);

  if (selectedRuns.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-slate-500 flex-col gap-4 relative">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-emerald-500/10 rounded-full blur-[100px] pointer-events-none" />
        <div className="w-20 h-20 rounded-2xl bg-[#12141F] border border-[#2e334d] flex items-center justify-center mb-4 shadow-lg shadow-black/50 z-10">
          <Terminal className="w-10 h-10 text-emerald-400 opacity-80" />
        </div>
        <p className="text-xl font-medium text-slate-300 z-10">Select runs to view logs</p>
      </div>
    );
  }

  return (
    <div className="p-8 flex flex-col h-full relative">
      <div className="absolute top-0 left-0 w-full h-[300px] bg-gradient-to-b from-emerald-500/5 to-transparent pointer-events-none" />
      
      <div className="flex items-end justify-between mb-8 pb-6 border-b border-[#2e334d] z-10 shrink-0">
        <div>
          <h1 className="text-3xl font-bold text-white mb-2 tracking-tight">Logs Explorer</h1>
          <p className="text-slate-400">Inspecting logs for <span className="text-emerald-400 font-medium">{selectedRuns.length}</span> runs simultaneously.</p>
        </div>
        
        <div className="relative group">
          <Search className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-emerald-400 transition-colors" />
          <input 
            type="text" 
            placeholder="Grep logs..." 
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="log-search-input"
          />
        </div>
      </div>

      {loading && <div className="badge animate-pulse border-emerald-500 text-emerald-400 bg-emerald-500/10 self-start mb-4">Loading logs...</div>}

      <div className="flex-1 overflow-y-auto flex flex-col gap-8 custom-scrollbar pb-8 z-10 pr-2">
        {selectedRuns.map(runId => {
          const runLog = logsMap[runId] || '';
          
          const filteredLog = searchTerm 
            ? runLog.split('\n').filter(line => line.toLowerCase().includes(searchTerm.toLowerCase())).join('\n')
            : runLog;

          return (
            <div key={runId} className="panel flex flex-col max-h-[600px] border-emerald-500/10">
              <div className="flex items-center justify-between mb-4 sticky top-0 bg-[#12141F] z-10 py-1">
                <h2 className="text-sm font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
                  <Terminal className="w-4 h-4 text-emerald-400" />
                  Run: <span className="text-white bg-[rgba(255,255,255,0.05)] px-2 py-0.5 rounded border border-[#2e334d] normal-case tracking-normal">{runId}</span>
                </h2>
              </div>
              <div className="log-terminal-container">
                {searchTerm && !filteredLog ? (
                  <div className="text-slate-500 italic p-4">No matching lines found for "{searchTerm}".</div>
                ) : (
                  <pre className="log-pre-block">
                    {filteredLog || 'No logs available.'}
                  </pre>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default LogsExplorer;
