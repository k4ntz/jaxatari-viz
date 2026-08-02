import React, { useEffect, useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { fetchRunLogs, fetchRuns, type RunInfo } from '../api';
import { Terminal, Search, Filter, RotateCcw, Copy, Check, ChevronDown, ChevronUp, CheckSquare, X, ArrowUpDown, ArrowUp, ArrowDown, Gamepad2, Cpu, Calendar } from 'lucide-react';

interface LogsExplorerProps {
  selectedRuns: string[];
  setSelectedRuns?: (runs: string[]) => void;
}

export const getRunDate = (run: RunInfo): string => {
  if (run.config.date) return String(run.config.date);
  if (run.config.date_str) return String(run.config.date_str);
  if (run.config._timestamp) {
    try {
      const d = new Date(Number(run.config._timestamp) * 1000);
      if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
    } catch {}
  }
  const runFolder = run.id.includes('::') ? run.id.split('::')[1] : run.id;
  const match = runFolder.match(/^(\d{4})(\d{2})(\d{2})/);
  if (match) {
    return `${match[1]}-${match[2]}-${match[3]}`;
  }
  return 'Unknown Date';
};

export const getRunSeed = (run: RunInfo): string => {
  if (run.config.cma_seed !== undefined && run.config.cma_seed !== null) {
    return `Seed ${run.config.cma_seed}`;
  }
  if (run.config.log_rollout_seed !== undefined && run.config.log_rollout_seed !== null) {
    return `Seed ${run.config.log_rollout_seed}`;
  }
  const match = run.id.match(/_s(\d+)(?:_|$)/i);
  if (match) {
    return `Seed ${match[1]}`;
  }
  return 'Seed 0';
};

export interface FormattedRunTitle {
  primaryBadge: string;
  secondaryBadge?: string;
  dateStr: string;
  seedStr: string;
  modelStr: string;
  noiseStr: string;
  popStr: string;
  llmStr: string;
}

export const parseRunTitleComponents = (run: RunInfo, orderBy: 'game' | 'method' | 'date'): FormattedRunTitle => {
  const game = run.config.game || run.config.env || 'unknown';
  const method = run.config.method || run.config.model || 'unknown';
  const dateStr = getRunDate(run);
  const seedStr = getRunSeed(run);
  const modelStr = run.config.model ? String(run.config.model) : '';
  const noise = run.config.obs_noise_std ?? run.config.noise ?? 0;
  const noiseStr = `noise: ${noise}`;
  const pop = run.config.popsize;
  const popStr = pop ? `pop: ${pop}` : '';
  const llmEnabled = run.config.llm_enabled;
  const llmReward = run.config.llm_reward;
  const llmStr = llmReward ? 'LLM Reward' : llmEnabled ? 'LLM' : '';

  if (orderBy === 'game') {
    return {
      primaryBadge: method,
      dateStr,
      seedStr,
      modelStr,
      noiseStr,
      popStr,
      llmStr,
    };
  } else if (orderBy === 'method') {
    return {
      primaryBadge: game,
      dateStr,
      seedStr,
      modelStr,
      noiseStr,
      popStr,
      llmStr,
    };
  } else {
    return {
      primaryBadge: game,
      secondaryBadge: method,
      dateStr,
      seedStr,
      modelStr,
      noiseStr,
      popStr,
      llmStr,
    };
  }
};

const renderRunTitle = (run: RunInfo, orderBy: 'game' | 'method' | 'date') => {
  const parsed = parseRunTitleComponents(run, orderBy);
  return (
    <div className="flex items-center gap-2 flex-wrap text-xs">
      <span className="bg-[#2e334d] text-white px-2 py-0.5 rounded font-bold border border-[#3e4468]">
        {parsed.primaryBadge}
      </span>
      {parsed.secondaryBadge && (
        <span className="bg-[#12141F] text-indigo-300 px-2 py-0.5 rounded font-medium border border-indigo-500/30">
          {parsed.secondaryBadge}
        </span>
      )}
      <span className="text-slate-300 font-mono text-[11px]">{parsed.dateStr}</span>
      <span className="text-emerald-400 font-semibold">{parsed.seedStr}</span>
      {parsed.modelStr && (
        <span className="bg-purple-500/10 text-purple-300 px-2 py-0.5 rounded border border-purple-500/20 text-[11px]">
          {parsed.modelStr}
        </span>
      )}
      {parsed.noiseStr && (
        <span className="text-slate-400 text-[11px]">{parsed.noiseStr}</span>
      )}
      {parsed.popStr && (
        <span className="text-slate-400 text-[11px]">{parsed.popStr}</span>
      )}
      {parsed.llmStr && (
        <span className="bg-emerald-500/10 text-emerald-300 px-1.5 py-0.5 rounded text-[10px] font-bold border border-emerald-500/20">
          {parsed.llmStr}
        </span>
      )}
    </div>
  );
};

const LogsExplorer: React.FC<LogsExplorerProps> = ({ selectedRuns, setSelectedRuns }) => {
  const [allRuns, setAllRuns] = useState<RunInfo[]>([]);
  const [logsMap, setLogsMap] = useState<Record<string, string>>({});
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [logSearchTerm, setLogSearchTerm] = useState('');
  const [runSearchTerm, setRunSearchTerm] = useState('');
  const [copiedRun, setCopiedRun] = useState<string | null>(null);

  // Group / Order state
  const [orderBy, setOrderBy] = useState<'game' | 'method' | 'date'>(() => {
    return (localStorage.getItem('logs_order_by') as any) || 'game';
  });
  const [orderDirection, setOrderDirection] = useState<'asc' | 'desc'>(() => {
    return (localStorage.getItem('logs_order_dir') as any) || 'asc';
  });

  // Top bar filter state
  const [selectedModels, setSelectedModels] = useState<Set<string>>(new Set());
  const [selectedMethods, setSelectedMethods] = useState<Set<string>>(new Set());
  const [selectedGames, setSelectedGames] = useState<Set<string>>(new Set());
  const [showRunList, setShowRunList] = useState(true);

  useEffect(() => {
    localStorage.setItem('logs_order_by', orderBy);
    localStorage.setItem('logs_order_dir', orderDirection);
  }, [orderBy, orderDirection]);

  const handleOrderByClick = (mode: 'game' | 'method' | 'date') => {
    if (orderBy === mode) {
      setOrderDirection(prev => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setOrderBy(mode);
      setOrderDirection(mode === 'date' ? 'desc' : 'asc');
    }
  };

  // Fetch all runs on mount
  useEffect(() => {
    fetchRuns().then(data => {
      setAllRuns(data);
      setSelectedModels(new Set(data.map(r => String(r.config.model || 'unknown'))));
      setSelectedMethods(new Set(data.map(r => String(r.config.method || 'unknown'))));
      setSelectedGames(new Set(data.map(r => String(r.config.game || 'unknown')).filter(g => g !== 'montezuma')));
    }).catch(err => console.error('Failed to fetch runs:', err));
  }, []);

  const models = useMemo(() => Array.from(new Set(allRuns.map(r => String(r.config.model || 'unknown')))), [allRuns]);
  const methods = useMemo(() => Array.from(new Set(allRuns.map(r => String(r.config.method || 'unknown')))), [allRuns]);
  const games = useMemo(() => Array.from(new Set(allRuns.map(r => String(r.config.game || 'unknown')))), [allRuns]);

  const runInfoMap = useMemo(() => {
    const map = new Map<string, RunInfo>();
    allRuns.forEach(r => map.set(r.id, r));
    return map;
  }, [allRuns]);

  // Compute runs matching top-bar filters
  const filteredRunsByGroup = useMemo(() => {
    return allRuns.filter(run => {
      const modelMatch = selectedModels.has(String(run.config.model || 'unknown'));
      const methodMatch = selectedMethods.size === 0 || selectedMethods.has(String(run.config.method || 'unknown'));
      const gameMatch = selectedGames.has(String(run.config.game || 'unknown'));
      return modelMatch && methodMatch && gameMatch;
    });
  }, [allRuns, selectedModels, selectedMethods, selectedGames]);

  // Search filter applied on top of group filters
  const visibleRuns = useMemo(() => {
    if (!runSearchTerm.trim()) return filteredRunsByGroup;
    return filteredRunsByGroup.filter(r => r.id.toLowerCase().includes(runSearchTerm.toLowerCase()));
  }, [filteredRunsByGroup, runSearchTerm]);

  // Group visible runs according to orderBy and orderDirection
  const groupedSelectorRuns = useMemo(() => {
    const groupMap = new Map<string, RunInfo[]>();
    visibleRuns.forEach(run => {
      let key = '';
      if (orderBy === 'game') key = run.config.game || run.config.env || 'unknown';
      else if (orderBy === 'method') key = run.config.method || run.config.model || 'unknown';
      else key = getRunDate(run);

      if (!groupMap.has(key)) groupMap.set(key, []);
      groupMap.get(key)!.push(run);
    });

    const mult = orderDirection === 'asc' ? 1 : -1;
    const result: { key: string; runs: RunInfo[] }[] = [];
    groupMap.forEach((runs, key) => {
      runs.sort((a, b) => mult * a.id.localeCompare(b.id));
      result.push({ key, runs });
    });
    result.sort((a, b) => mult * a.key.localeCompare(b.key));
    return result;
  }, [visibleRuns, orderBy, orderDirection]);

  // Group selected runs for terminal logs display
  const groupedSelectedRuns = useMemo(() => {
    const selectedRunObjects = selectedRuns
      .map(id => runInfoMap.get(id))
      .filter((r): r is RunInfo => r !== undefined);

    const groupMap = new Map<string, RunInfo[]>();
    selectedRunObjects.forEach(run => {
      let key = '';
      if (orderBy === 'game') key = `Game: ${run.config.game || run.config.env || 'unknown'}`;
      else if (orderBy === 'method') key = `Method: ${run.config.method || run.config.model || 'unknown'}`;
      else key = `Date: ${getRunDate(run)}`;

      if (!groupMap.has(key)) groupMap.set(key, []);
      groupMap.get(key)!.push(run);
    });

    const mult = orderDirection === 'asc' ? 1 : -1;
    const result: { title: string; runs: RunInfo[] }[] = [];
    groupMap.forEach((runs, title) => {
      runs.sort((a, b) => mult * a.id.localeCompare(b.id));
      result.push({ title, runs });
    });
    result.sort((a, b) => mult * a.title.localeCompare(b.title));
    return result;
  }, [selectedRuns, runInfoMap, orderBy, orderDirection]);

  // Auto-select initial runs if none selected yet
  useEffect(() => {
    if (selectedRuns.length === 0 && filteredRunsByGroup.length > 0 && setSelectedRuns) {
      setSelectedRuns(filteredRunsByGroup.map(r => r.id));
    }
  }, [allRuns]);

  const toggleFilter = (setFilter: React.Dispatch<React.SetStateAction<Set<string>>>, value: string) => {
    setFilter(prev => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  };

  const handleSelectAllMatching = () => {
    if (!setSelectedRuns) return;
    const matchingIds = visibleRuns.map(r => r.id);
    const combined = Array.from(new Set([...selectedRuns, ...matchingIds]));
    setSelectedRuns(combined);
  };

  const handleClearSelection = () => {
    if (!setSelectedRuns) return;
    setSelectedRuns([]);
  };

  const handleToggleRun = (runId: string) => {
    if (!setSelectedRuns) return;
    if (selectedRuns.includes(runId)) {
      setSelectedRuns(selectedRuns.filter(id => id !== runId));
    } else {
      setSelectedRuns([...selectedRuns, runId]);
    }
  };

  // Load logs for selected runs
  useEffect(() => {
    if (selectedRuns.length === 0) return;

    let isMounted = true;
    setLoadingLogs(true);
    const loadLogs = async () => {
      const newLogsMap: Record<string, string> = {};
      for (const runId of selectedRuns) {
        if (!logsMap[runId]) {
          try {
            newLogsMap[runId] = await fetchRunLogs(runId);
          } catch (e) {
            newLogsMap[runId] = 'Failed to load logs.';
          }
        }
      }
      if (isMounted) {
        setLogsMap(prev => ({ ...prev, ...newLogsMap }));
        setLoadingLogs(false);
      }
    };

    loadLogs();
    return () => { isMounted = false; };
  }, [selectedRuns]);

  const copyToClipboard = (runId: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedRun(runId);
    setTimeout(() => setCopiedRun(null), 2000);
  };

  return (
    <div className="p-8 flex flex-col h-full relative">
      <div className="absolute top-0 left-0 w-full h-[300px] bg-gradient-to-b from-emerald-500/5 to-transparent pointer-events-none" />

      {/* Header */}
      <div className="flex items-end justify-between mb-6 pb-4 border-b border-[#2e334d] z-10 shrink-0">
        <div>
          <h1 className="text-3xl font-bold text-white mb-2 tracking-tight">Logs Explorer</h1>
          <p className="text-slate-400">
            Inspecting logs for <span className="text-emerald-400 font-medium">{selectedRuns.length}</span> runs simultaneously.
          </p>
        </div>

        <div className="relative group">
          <Search className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-emerald-400 transition-colors" />
          <input
            type="text"
            placeholder="Grep logs content..."
            value={logSearchTerm}
            onChange={e => setLogSearchTerm(e.target.value)}
            className="log-search-input"
          />
        </div>
      </div>

      {/* Top Filter & Order Runs Card */}
      <div className="bg-[#16192b] border border-[#2e334d] p-6 rounded-2xl flex flex-col gap-6 mb-6 z-10 shrink-0 shadow-lg">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#2e334d] pb-4">
          <div className="flex items-center gap-2">
            <Filter className="w-5 h-5 text-emerald-400" />
            <h2 className="text-base font-bold text-white tracking-wide">Filter & Order Runs</h2>
            <span className="badge text-[11px] py-0.5 px-2 bg-emerald-500/20 border-emerald-500/30 text-emerald-300 ml-2">
              {selectedRuns.length} selected
            </span>
          </div>

          {/* Group / Order By Selector */}
          <div className="flex items-center gap-2 bg-[#12141F] p-1 rounded-xl border border-[#2e334d]">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider px-2 flex items-center gap-1">
              <ArrowUpDown className="w-3.5 h-3.5 text-emerald-400" /> Order By:
            </span>
            <button
              onClick={() => handleOrderByClick('game')}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium transition-all ${
                orderBy === 'game'
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Gamepad2 className="w-3.5 h-3.5" /> Game
              {orderBy === 'game' && (
                orderDirection === 'asc' ? <ArrowUp className="w-3 h-3 text-emerald-400" /> : <ArrowDown className="w-3 h-3 text-emerald-400" />
              )}
            </button>
            <button
              onClick={() => handleOrderByClick('method')}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium transition-all ${
                orderBy === 'method'
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Cpu className="w-3.5 h-3.5" /> Method
              {orderBy === 'method' && (
                orderDirection === 'asc' ? <ArrowUp className="w-3 h-3 text-emerald-400" /> : <ArrowDown className="w-3 h-3 text-emerald-400" />
              )}
            </button>
            <button
              onClick={() => handleOrderByClick('date')}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium transition-all ${
                orderBy === 'date'
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Calendar className="w-3.5 h-3.5" /> Date
              {orderBy === 'date' && (
                orderDirection === 'asc' ? <ArrowUp className="w-3 h-3 text-emerald-400" /> : <ArrowDown className="w-3 h-3 text-emerald-400" />
              )}
            </button>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                setSelectedGames(new Set(games));
                setSelectedModels(new Set(models));
                setSelectedMethods(new Set(methods));
                if (setSelectedRuns) setSelectedRuns(allRuns.map(r => r.id));
              }}
              className="text-xs font-semibold text-slate-400 hover:text-emerald-400 flex items-center gap-1.5 transition-colors px-3 py-1.5 rounded-lg border border-[#2e334d] bg-[rgba(0,0,0,0.2)] hover:bg-[rgba(16,185,129,0.1)]"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset Filters</span>
            </button>
            <button
              onClick={() => setShowRunList(prev => !prev)}
              className="text-xs font-semibold text-slate-400 hover:text-white flex items-center gap-1.5 transition-colors px-3 py-1.5 rounded-lg border border-[#2e334d] bg-[rgba(0,0,0,0.2)]"
            >
              {showRunList ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              <span>{showRunList ? 'Hide Run Selector' : 'Show Run Selector'}</span>
            </button>
          </div>
        </div>

        {/* Filter Chip Groups */}
        <div className="flex flex-col gap-5">
          {games.length > 0 && (
            <div className="flex flex-col gap-2.5 w-full">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Games</span>
                <span className="badge text-[11px] py-0.5 px-2 bg-emerald-500/20 border-emerald-500/30 text-emerald-300">
                  {selectedGames.size} / {games.length}
                </span>
              </div>
              <div className="filter-chip-group">
                {games.map(g => {
                  const active = selectedGames.has(g);
                  return (
                    <button
                      key={g}
                      onClick={() => toggleFilter(setSelectedGames, g)}
                      className={`filter-chip ${active ? 'active active-emerald' : ''}`}
                    >
                      <span className={`filter-chip-indicator ${active ? 'bg-emerald-400 shadow-[0_0_6px_rgba(16,185,129,0.8)]' : 'bg-slate-600'}`} />
                      <span className="filter-chip-label">{g}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {models.length > 0 && (
            <div className="flex flex-col gap-2.5 w-full">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Models</span>
                <span className="badge text-[11px] py-0.5 px-2 bg-purple-500/20 border-purple-500/30 text-purple-300">
                  {selectedModels.size} / {models.length}
                </span>
              </div>
              <div className="filter-chip-group">
                {models.map(m => {
                  const active = selectedModels.has(m);
                  return (
                    <button
                      key={m}
                      onClick={() => toggleFilter(setSelectedModels, m)}
                      className={`filter-chip ${active ? 'active active-purple' : ''}`}
                    >
                      <span className={`filter-chip-indicator ${active ? 'bg-purple-400 shadow-[0_0_6px_rgba(168,85,247,0.8)]' : 'bg-slate-600'}`} />
                      <span className="filter-chip-label">{m}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {methods.length > 0 && (
            <div className="flex flex-col gap-2.5 w-full">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Methods</span>
                <span className="badge text-[11px] py-0.5 px-2 bg-indigo-500/20 border-indigo-500/30 text-indigo-300">
                  {selectedMethods.size} / {methods.length}
                </span>
              </div>
              <div className="filter-chip-group">
                {methods.map(method => {
                  const active = selectedMethods.has(method);
                  return (
                    <button
                      key={method}
                      onClick={() => toggleFilter(setSelectedMethods, method)}
                      className={`filter-chip ${active ? 'active active-indigo' : ''}`}
                    >
                      <span className={`filter-chip-indicator ${active ? 'bg-indigo-400 shadow-[0_0_6px_rgba(99,102,241,0.8)]' : 'bg-slate-600'}`} />
                      <span className="filter-chip-label">{method}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Collapsible Run Selector Checklist */}
        {showRunList && (
          <div className="pt-4 border-t border-[#2e334d] flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                  Select Runs ({visibleRuns.length} matching)
                </span>
                <button
                  onClick={handleSelectAllMatching}
                  className="text-xs text-emerald-400 hover:underline flex items-center gap-1"
                >
                  <CheckSquare className="w-3.5 h-3.5" /> Select All Matching
                </button>
                <button
                  onClick={handleClearSelection}
                  className="text-xs text-slate-400 hover:text-red-400 transition-colors flex items-center gap-1"
                >
                  <X className="w-3.5 h-3.5" /> Clear Selection
                </button>
              </div>

              <div className="relative w-64">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  type="text"
                  placeholder="Filter runs by name..."
                  value={runSearchTerm}
                  onChange={e => setRunSearchTerm(e.target.value)}
                  className="w-full text-xs pl-8 pr-3 py-1 bg-[#12141F] border border-[#2e334d] rounded-lg text-slate-200 placeholder-slate-500 focus:outline-none focus:border-emerald-500/50"
                />
              </div>
            </div>

            <div className="max-h-64 overflow-y-auto custom-scrollbar p-3 bg-[#12141F] rounded-xl border border-[#2e334d] flex flex-col gap-4">
              {groupedSelectorRuns.map(group => (
                <div key={group.key} className="flex flex-col gap-2">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 border-b border-[#2e334d]/60 pb-1 flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                    <span>{orderBy === 'game' ? `Game: ${group.key}` : orderBy === 'method' ? `Method: ${group.key}` : `Date: ${group.key}`}</span>
                    <span className="text-slate-500 font-normal">({group.runs.length})</span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-1.5">
                    {group.runs.map(run => {
                      const isSelected = selectedRuns.includes(run.id);
                      return (
                        <div
                          key={run.id}
                          className={`flex items-center gap-2 text-xs p-2 rounded-lg transition-all border ${
                            isSelected
                              ? 'bg-emerald-500/10 border-emerald-500/30 text-white'
                              : 'bg-transparent border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => handleToggleRun(run.id)}
                            className="rounded border-[#2e334d] text-emerald-500 focus:ring-0 focus:ring-offset-0 bg-[#16192b] cursor-pointer"
                          />
                          <Link
                            to={`/run/${encodeURIComponent(run.id)}`}
                            className="truncate flex-1 hover:text-emerald-400 hover:underline transition-colors"
                            title={`View details for ${run.id}`}
                          >
                            {renderRunTitle(run, orderBy)}
                          </Link>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}

              {visibleRuns.length === 0 && (
                <div className="text-center text-xs text-slate-500 py-4 italic">
                  No runs match the current filters.
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {loadingLogs && (
        <div className="badge animate-pulse border-emerald-500 text-emerald-400 bg-emerald-500/10 self-start mb-4 z-10">
          Loading logs...
        </div>
      )}

      {/* Main Terminal Logs Display */}
      {selectedRuns.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-slate-500 flex-col gap-4 relative">
          <div className="w-20 h-20 rounded-2xl bg-[#12141F] border border-[#2e334d] flex items-center justify-center mb-2 shadow-lg shadow-black/50 z-10">
            <Terminal className="w-10 h-10 text-emerald-400 opacity-80" />
          </div>
          <p className="text-xl font-medium text-slate-300 z-10">No runs selected</p>
          <p className="text-xs text-slate-500 z-10">Use the filter bar above to select experiment runs to view logs.</p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto flex flex-col gap-8 custom-scrollbar pb-8 z-10 pr-2">
          {groupedSelectedRuns.map(group => (
            <div key={group.title} className="flex flex-col gap-4">
              <div className="flex items-center gap-3 border-b border-emerald-500/30 pb-2">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.8)]" />
                <h2 className="text-base font-bold text-white tracking-wide">{group.title}</h2>
                <span className="text-xs text-slate-400">({group.runs.length} runs)</span>
              </div>

              {group.runs.map(run => {
                const runId = run.id;
                const runLog = logsMap[runId] || '';

                const filteredLog = logSearchTerm
                  ? runLog.split('\n').filter(line => line.toLowerCase().includes(logSearchTerm.toLowerCase())).join('\n')
                  : runLog;

                return (
                  <div key={runId} className="panel flex flex-col max-h-[600px] border-emerald-500/20 shadow-lg">
                    <div className="flex items-center justify-between mb-4 sticky top-0 bg-[#12141F] z-10 py-1.5 border-b border-[#2e334d]">
                      <h3 className="text-sm font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2 flex-wrap">
                        <Terminal className="w-4 h-4 text-emerald-400 shrink-0" />
                        <span className="text-slate-400">Run:</span>
                        <Link
                          to={`/run/${encodeURIComponent(runId)}`}
                          className="hover:text-emerald-400 hover:underline bg-[rgba(255,255,255,0.05)] hover:bg-[rgba(16,185,129,0.1)] px-2.5 py-1 rounded border border-[#2e334d] hover:border-emerald-500/30 transition-all inline-flex items-center"
                          title={`View details for ${runId}`}
                        >
                          {renderRunTitle(run, orderBy)}
                        </Link>
                      </h3>

                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => copyToClipboard(runId, runLog)}
                          className="text-xs text-slate-400 hover:text-emerald-400 transition-colors flex items-center gap-1 px-2.5 py-1 rounded bg-[#16192b] border border-[#2e334d]"
                          title="Copy full log to clipboard"
                        >
                          {copiedRun === runId ? (
                            <>
                              <Check className="w-3.5 h-3.5 text-emerald-400" />
                              <span className="text-emerald-400">Copied</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3.5 h-3.5" />
                              <span>Copy Log</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>

                    <div className="log-terminal-container">
                      {logSearchTerm && !filteredLog ? (
                        <div className="text-slate-500 italic p-4">No matching lines found for "{logSearchTerm}".</div>
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
          ))}
        </div>
      )}
    </div>
  );
};

export default LogsExplorer;
