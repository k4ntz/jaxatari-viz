import React, { useEffect, useState, useMemo } from 'react';
import { NavLink } from 'react-router-dom';
import { fetchRuns, type RunInfo } from '../api';
import { Activity, BarChart2, FileText, Filter, Search, ChevronRight, Moon, Sun } from 'lucide-react';

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
  const [selectedMethods, setSelectedMethods] = useState<Set<string>>(new Set());
  const [selectedGames, setSelectedGames] = useState<Set<string>>(new Set());
  const [selectedPops, setSelectedPops] = useState<Set<string>>(new Set());
  const [selectedGens, setSelectedGens] = useState<Set<string>>(new Set());
  const [selectedSigmas, setSelectedSigmas] = useState<Set<string>>(new Set());
  const [selectedSticky, setSelectedSticky] = useState<Set<string>>(new Set());
  const [selectedScratch, setSelectedScratch] = useState<Set<string>>(new Set());
  const [selectedLlm, setSelectedLlm] = useState<Set<string>>(new Set());
  const [selectedLlmReward, setSelectedLlmReward] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetchRuns().then(data => {
      setRuns(data);
      setSelectedModels(new Set(data.map(r => String(r.config.model || 'unknown'))));
      setSelectedGames(new Set(data.map(r => String(r.config.game || 'unknown')).filter(g => g !== 'montezuma')));
      setLoading(false);
    });
  }, []);

  const models = useMemo(() => Array.from(new Set(runs.map(r => String(r.config.model || 'unknown')))), [runs]);
  const methods = useMemo(() => Array.from(new Set(runs.map(r => String(r.config.method || 'unknown')))), [runs]);
  const games = useMemo(() => Array.from(new Set(runs.map(r => String(r.config.game || 'unknown')))), [runs]);
  const pops = useMemo(() => Array.from(new Set(runs.map(r => String(r.config.popsize ?? 'unknown')))), [runs]);
  const gens = useMemo(() => Array.from(new Set(runs.map(r => String(r.config.generations ?? 'unknown')))), [runs]);
  const sigmas = useMemo(() => Array.from(new Set(runs.map(r => String(r.config.sigma0 ?? 'unknown')))), [runs]);
  const stickies = useMemo(() => Array.from(new Set(runs.map(r => String(r.config.sticky_actions ?? 'unknown')))), [runs]);
  const scratches = useMemo(() => Array.from(new Set(runs.map(r => String(r.config.from_scratch ?? 'unknown')))), [runs]);
  const llms = useMemo(() => Array.from(new Set(runs.map(r => String(r.config.llm_enabled ?? 'unknown')))), [runs]);
  const llmRewards = useMemo(() => Array.from(new Set(runs.map(r => String(r.config.llm_reward ?? 'unknown')))), [runs]);

  useEffect(() => {
    if (selectedModels.size === 0 && selectedMethods.size === 0 && selectedGames.size === 0 && selectedPops.size === 0 && selectedGens.size === 0 && selectedSigmas.size === 0 && selectedSticky.size === 0 && selectedScratch.size === 0 && selectedLlm.size === 0 && selectedLlmReward.size === 0) return;
    
    const matchingRuns = runs.filter(run => {
      const modelMatch = selectedModels.has(String(run.config.model || 'unknown'));
      const methodMatch = selectedMethods.size === 0 || selectedMethods.has(String(run.config.method || 'unknown'));
      const gameMatch = selectedGames.has(String(run.config.game || 'unknown'));
      const popMatch = selectedPops.size === 0 || selectedPops.has(String(run.config.popsize ?? 'unknown'));
      const genMatch = selectedGens.size === 0 || selectedGens.has(String(run.config.generations ?? 'unknown'));
      const sigmaMatch = selectedSigmas.size === 0 || selectedSigmas.has(String(run.config.sigma0 ?? 'unknown'));
      const stickyMatch = selectedSticky.size === 0 || selectedSticky.has(String(run.config.sticky_actions ?? 'unknown'));
      const scratchMatch = selectedScratch.size === 0 || selectedScratch.has(String(run.config.from_scratch ?? 'unknown'));
      const llmMatch = selectedLlm.size === 0 || selectedLlm.has(String(run.config.llm_enabled ?? 'unknown'));
      const llmRewardMatch = selectedLlmReward.size === 0 || selectedLlmReward.has(String(run.config.llm_reward ?? 'unknown'));
      
      return modelMatch && methodMatch && gameMatch && popMatch && genMatch && sigmaMatch && stickyMatch && scratchMatch && llmMatch && llmRewardMatch;
    }).map(r => r.id);
    
    setSelectedRuns(matchingRuns);
  }, [selectedModels, selectedMethods, selectedGames, selectedPops, selectedGens, selectedSigmas, selectedSticky, selectedScratch, selectedLlm, selectedLlmReward, runs, setSelectedRuns]);

  const handleRunToggle = (runId: string) => {
    setSelectedRuns(
      selectedRuns.includes(runId) ? selectedRuns.filter(id => id !== runId) : [...selectedRuns, runId]
    );
  };

  const toggleFilter = (setFilter: React.Dispatch<React.SetStateAction<Set<string>>>, value: string) => {
    setFilter(prev => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
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
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2 text-slate-400">
            <Filter className="w-4 h-4" />
            <h2 className="text-sm font-bold uppercase tracking-wider">Filters</h2>
          </div>
        </div>
        
        {/* Filters */}
        <FilterSection title="Game (Environment)" options={games} state={selectedGames} setState={setSelectedGames} toggleFilter={toggleFilter} />
        <FilterSection title="Models" options={models} state={selectedModels} setState={setSelectedModels} toggleFilter={toggleFilter} />
        <FilterSection title="Methods" options={methods} state={selectedMethods} setState={setSelectedMethods} toggleFilter={toggleFilter} />
        <FilterSection title="Noise: Sigma0" options={sigmas} state={selectedSigmas} setState={setSelectedSigmas} toggleFilter={toggleFilter} />
        <FilterSection title="Noise: Sticky Actions" options={stickies} state={selectedSticky} setState={setSelectedSticky} toggleFilter={toggleFilter} />
        <FilterSection title="Evol: Pop Size" options={pops} state={selectedPops} setState={setSelectedPops} toggleFilter={toggleFilter} />
        <FilterSection title="Evol: Generations" options={gens} state={selectedGens} setState={setSelectedGens} toggleFilter={toggleFilter} />
        <FilterSection title="Strat: From Scratch" options={scratches} state={selectedScratch} setState={setSelectedScratch} toggleFilter={toggleFilter} />
        <FilterSection title="Strat: LLM Enabled" options={llms} state={selectedLlm} setState={setSelectedLlm} toggleFilter={toggleFilter} />
        <FilterSection title="Strat: LLM Reward" options={llmRewards} state={selectedLlmReward} setState={setSelectedLlmReward} toggleFilter={toggleFilter} />

        <div className="flex items-center justify-between mb-3 mt-8">
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
                  to={`/run/${run.id}`}
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

const FilterSection = ({ title, options, state, setState, toggleFilter }: { title: string, options: string[], state: Set<string>, setState: React.Dispatch<React.SetStateAction<Set<string>>>, toggleFilter: any }) => {
  if (options.length === 0) return null;
  return (
    <div className="mb-6 bg-[rgba(0,0,0,0.2)] p-3 rounded-lg border border-[#2e334d]">
      <h3 className="text-xs font-semibold text-slate-300 mb-3 uppercase tracking-wider">{title}</h3>
      <div className="flex flex-col gap-2">
        {options.map(o => (
          <label key={o} className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer hover:text-white transition-colors">
            <input type="checkbox" checked={state.has(o)} onChange={() => toggleFilter(setState, o)} />
            {o}
          </label>
        ))}
      </div>
    </div>
  );
};

export default Sidebar;
