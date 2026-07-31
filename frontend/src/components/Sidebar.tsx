import React, { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { fetchRuns, type RunInfo } from '../api';
import { Activity, BarChart2, FileText, Search, ChevronRight, Moon, Sun, Gamepad2 } from 'lucide-react';

interface SidebarProps {
  selectedRuns: string[];
  setSelectedRuns: (runs: string[]) => void;
  theme?: string;
  toggleTheme?: () => void;
}

const Sidebar: React.FC<SidebarProps> = ({ selectedRuns, setSelectedRuns, theme = 'light', toggleTheme }) => {
  const [runs, setRuns] = useState<RunInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  
  // Filter states
  const [selectedModels, setSelectedModels] = useState<Set<string>>(new Set());
  const [selectedGames, setSelectedGames] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetchRuns().then(data => {
      setRuns(data);
      setSelectedModels(new Set(data.map(r => String(r.config.model || 'unknown'))));
      setSelectedGames(new Set(data.map(r => String(r.config.game || 'unknown')).filter(g => g !== 'montezuma')));
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    if (selectedModels.size === 0 && selectedGames.size === 0) return;
    
    const matchingRuns = runs.filter(run => {
      const modelMatch = selectedModels.has(String(run.config.model || 'unknown'));
      const gameMatch = selectedGames.has(String(run.config.game || 'unknown'));
      
      return modelMatch && gameMatch;
    }).map(r => r.id);
    
    setSelectedRuns(matchingRuns);
  }, [selectedModels, selectedGames, runs, setSelectedRuns]);

  const handleRunToggle = (runId: string) => {
    setSelectedRuns(
      selectedRuns.includes(runId) ? selectedRuns.filter(id => id !== runId) : [...selectedRuns, runId]
    );
  };

  const filteredRuns = runs.filter(r => r.id.toLowerCase().includes(searchTerm.toLowerCase()));

  return (
    <div className="w-72 bg-[#16192b] border-r border-[#2e334d] h-full flex flex-col shadow-lg z-10 relative">
      <div className="p-6 border-b border-[#2e334d] flex items-center gap-3">
        <div className="p-2 bg-indigo-500/20 rounded-lg border border-indigo-500/30 shadow-glow">
          <Activity className="text-indigo-400 w-6 h-6" />
        </div>
        <div className="flex-1 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gradient-accent">
              JAXAtari-Viz
            </h1>
            <div className="text-xs text-slate-400 font-medium tracking-wider">Experiment Dashboard</div>
          </div>
          {toggleTheme && (
            <button 
              onClick={toggleTheme}
              className="p-2 rounded-lg bg-[rgba(0,0,0,0.2)] hover:bg-[rgba(255,255,255,0.05)] border border-[#2e334d] transition-colors flex items-center justify-center shrink-0 ml-2"
              title={`Switch to ${theme === 'dark' ? 'Light' : 'Dark'} Mode`}
            >
              {theme === 'dark' ? <Sun className="w-4 h-4 text-orange-400" /> : <Moon className="w-4 h-4 text-indigo-400" />}
            </button>
          )}
        </div>
      </div>

      <nav className="p-4 flex flex-col gap-2 border-b border-[#2e334d]">
        <NavLink to="/environments" className={({isActive}) => `sidebar-link ${isActive ? 'active' : ''}`}>
          <Gamepad2 className="w-5 h-5" />
          <span>Environments</span>
        </NavLink>
        <NavLink to="/compare" className={({isActive}) => `sidebar-link ${isActive ? 'active' : ''}`}>
          <BarChart2 className="w-5 h-5" />
          <span>Compare Runs</span>
        </NavLink>
        <NavLink to="/logs" className={({isActive}) => `sidebar-link ${isActive ? 'active' : ''}`}>
          <FileText className="w-5 h-5" />
          <span>Logs Explorer</span>
        </NavLink>
      </nav>

      <div className="p-4 flex-1 overflow-y-auto custom-scrollbar">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold uppercase tracking-wider text-slate-400">Runs</h2>
          <span className="badge">{filteredRuns.length}</span>
        </div>

        <div className="relative mb-4">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input 
            type="text" 
            placeholder="Search runs..." 
            className="w-full text-sm pl-9"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
          />
        </div>
        
        {loading ? (
          <div className="text-center text-sm text-indigo-400 py-4 animate-pulse">Loading runs...</div>
        ) : (
          <div className="flex flex-col gap-1">
            {filteredRuns.map(run => (
              <div key={run.id} className="run-item flex items-center gap-2">
                <input 
                  type="checkbox" 
                  checked={selectedRuns.includes(run.id)}
                  onChange={() => handleRunToggle(run.id)}
                />
                <NavLink 
                  to={`/run/${encodeURIComponent(run.id)}`}
                  className="text-xs text-slate-300 hover:text-white truncate flex-1 flex items-center justify-between group gap-1"
                  title={run.id}
                >
                  <span className="truncate flex-1">{run.id}</span>
                  <div className="flex items-center gap-1 shrink-0">
                    {run.has_logs && <span title="Contains logs" className="flex items-center"><FileText className="w-3 h-3 text-emerald-500/80" /></span>}
                    <ChevronRight className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity text-indigo-400" />
                  </div>
                </NavLink>
              </div>
            ))}
            {filteredRuns.length === 0 && (
              <div className="text-center text-sm text-slate-500 py-4 italic">No runs found</div>
            )}
          </div>
        )}
      </div>

    </div>
  );
};

export default Sidebar;
