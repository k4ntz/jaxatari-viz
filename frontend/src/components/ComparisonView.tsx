import React, { useEffect, useState } from 'react';
import Plot from 'react-plotly.js';
import { fetchRunMetrics, fetchRuns, fetchBaselines, fetchComparisonSummary, fetchGameMetadata, type RunInfo, type BaselineInfo } from '../api';
import { LayoutGrid, Gamepad2, BarChart2, ChevronDown, Filter, RotateCcw } from 'lucide-react';
import { Toggle } from './Toggle';

interface ComparisonProps {
  selectedRuns: string[];
  setSelectedRuns?: React.Dispatch<React.SetStateAction<string[]>>;
  theme?: string;
}

const filterOutliersIQR = (data: number[]) => {
  if (data.length < 4) return data;
  const sorted = [...data].sort((a, b) => a - b);
  const q1 = sorted[Math.floor((sorted.length - 1) * 0.25)];
  const q3 = sorted[Math.floor((sorted.length - 1) * 0.75)];
  const iqr = q3 - q1;
  const lowerBound = q1 - 1.5 * iqr;
  const upperBound = q3 + 1.5 * iqr;
  return data.filter(x => x >= lowerBound && x <= upperBound);
};

const ComparisonView: React.FC<ComparisonProps> = ({ selectedRuns, setSelectedRuns, theme = 'dark' }) => {
  const [metricsData, setMetricsData] = useState<Record<string, any[]>>({});
  const [allRuns, setAllRuns] = useState<RunInfo[]>([]);
  const [runInfos, setRunInfos] = useState<Record<string, RunInfo>>({});
  const [loading, setLoading] = useState(false);
  const [baselinesMap, setBaselinesMap] = useState<Record<string, BaselineInfo>>({});
  const [groupBy, setGroupBy] = useState<string>('noise (all)');
  const [sortGamesBy, setSortGamesBy] = useState<'name' | '#Algorithms'>('name');
  const [aggFilterOutliers, setAggFilterOutliers] = useState<boolean>(() => {
    const saved = localStorage.getItem(`outlier_filter_aggregate`);
    return saved ? JSON.parse(saved) : false;
  });

  // Filter state for top bar
  const [selectedModels, setSelectedModels] = useState<Set<string>>(new Set());
  const [selectedMethods, setSelectedMethods] = useState<Set<string>>(new Set());
  const [selectedGames, setSelectedGames] = useState<Set<string>>(new Set());
  const [gameMeta, setGameMeta] = useState<Record<string, { category: string; status: string }>>({});
  const [summaryMap, setSummaryMap] = useState<Record<string, any>>({});

  useEffect(() => {
    fetchComparisonSummary().then((items: any[]) => {
      const sMap: Record<string, any> = {};
      items.forEach((item: any) => { sMap[item.id] = item; });
      setSummaryMap(sMap);
    }).catch(e => console.error("Summary fetch error:", e));
  }, []);

  useEffect(() => {
    fetchGameMetadata().then(meta => setGameMeta(meta)).catch(e => console.error("Failed to load game metadata:", e));
    fetchRuns().then(data => {
      setAllRuns(data);
      const infoMap: Record<string, RunInfo> = {};
      data.forEach(r => infoMap[r.id] = r);
      setRunInfos(infoMap);
      setSelectedModels(new Set(data.map(r => String(r.config.model || 'unknown'))));
      setSelectedMethods(new Set(data.map(r => String(r.config.method || 'unknown'))));
      setSelectedGames(new Set(data.map(r => String(r.config.game || 'unknown')).filter(g => g !== 'montezuma')));
    });
  }, []);

  const models = React.useMemo(() => Array.from(new Set(allRuns.map(r => String(r.config.model || 'unknown')))).sort((a, b) => a.localeCompare(b)), [allRuns]);
  const methods = React.useMemo(() => Array.from(new Set(allRuns.map(r => String(r.config.method || 'unknown')))).sort((a, b) => a.localeCompare(b)), [allRuns]);
  const games = React.useMemo(() => Array.from(new Set(allRuns.map(r => String(r.config.game || 'unknown')))).sort((a, b) => a.localeCompare(b)), [allRuns]);

  const getGameMetaInfo = React.useCallback((g: string) => {
    const norm = g.toLowerCase().replace(/_/g, '');
    return gameMeta[g] || gameMeta[norm] || { category: 'Other', status: '🥈' };
  }, [gameMeta]);

  const gameCategories = React.useMemo(() => {
    const cats = new Set(games.map(g => getGameMetaInfo(g).category));
    return Array.from(cats).sort((a, b) => a.localeCompare(b));
  }, [games, getGameMetaInfo]);

  const gameStatuses = React.useMemo(() => {
    const st = new Set(games.map(g => getGameMetaInfo(g).status));
    return Array.from(st).sort((a, b) => a.localeCompare(b));
  }, [games, getGameMetaInfo]);

  useEffect(() => {
    if (!setSelectedRuns || allRuns.length === 0) return;
    const matching = allRuns.filter(run => {
      const modelMatch = selectedModels.has(String(run.config.model || 'unknown'));
      const methodMatch = selectedMethods.size === 0 || selectedMethods.has(String(run.config.method || 'unknown'));
      const gameMatch = selectedGames.has(String(run.config.game || 'unknown'));
      return modelMatch && methodMatch && gameMatch;
    }).map(r => r.id);
    setSelectedRuns(matching);
  }, [selectedModels, selectedMethods, selectedGames, allRuns]);

  const handleFilterClick = (
    e: React.MouseEvent,
    setFilter: React.Dispatch<React.SetStateAction<Set<string>>>,
    value: string,
    allItems: string[]
  ) => {
    const isModifier = e.ctrlKey || e.metaKey;
    if (isModifier) {
      setFilter(prev => {
        if (prev.size === 1 && prev.has(value)) {
          return new Set(allItems);
        }
        return new Set([value]);
      });
    } else {
      setFilter(prev => {
        const next = new Set(prev);
        if (next.has(value)) next.delete(value);
        else next.add(value);
        return next;
      });
    }
  };

  useEffect(() => {
    localStorage.setItem(`outlier_filter_aggregate`, JSON.stringify(aggFilterOutliers));
  }, [aggFilterOutliers]);

  useEffect(() => {
    if (selectedRuns.length === 0) return;
    
    setLoading(true);
    const loadData = async () => {
      // Fetch run infos to determine the game
      try {
        const allRuns = await fetchRuns();
        const infoMap: Record<string, RunInfo> = {};
        allRuns.forEach(r => infoMap[r.id] = r);
        setRunInfos(infoMap);
      } catch (e) {
        console.error("Failed to load run infos");
      }

      // Fetch baselines & summary only (no 922 bulk metrics requests!)
      try {
        const baselines = await fetchBaselines();
        const bMap: Record<string, BaselineInfo> = {};
        baselines.forEach(b => { bMap[b.game] = b; });
        setBaselinesMap(bMap);
      } catch(e) {
        console.error("Failed to fetch baselines");
      }
      
      setLoading(false);
    };
    
    loadData();
  }, [selectedRuns]);

  // Group selected runs by game
  const runsByGame: Record<string, string[]> = React.useMemo(() => {
    const map: Record<string, string[]> = {};
    selectedRuns.forEach(runId => {
      const game = runInfos[runId]?.config?.game || 'Unknown Game';
      if (!map[game]) map[game] = [];
      map[game].push(runId);
    });
    return map;
  }, [selectedRuns, runInfos]);

  const sortedGameEntries = React.useMemo(() => {
    const entries = Object.entries(runsByGame);
    if (sortGamesBy === '#Algorithms') {
      entries.sort((a, b) => {
        const algosA = new Set(a[1].map(r => runInfos[r]?.config?.method || 'Unknown')).size;
        const algosB = new Set(b[1].map(r => runInfos[r]?.config?.method || 'Unknown')).size;
        if (algosB !== algosA) return algosB - algosA; // Most algorithms first
        return a[0].localeCompare(b[0]);
      });
    } else {
      entries.sort((a, b) => a[0].localeCompare(b[0]));
    }
    return entries;
  }, [runsByGame, sortGamesBy, runInfos]);

  if (selectedRuns.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-slate-500 flex-col gap-4 relative">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-indigo-500/10 rounded-full blur-[100px] pointer-events-none" />
        
        <div className="w-20 h-20 rounded-2xl bg-[#12141F] border border-[#2e334d] flex items-center justify-center mb-4 shadow-lg shadow-black/50 z-10">
          <LayoutGrid className="w-10 h-10 text-indigo-400 opacity-80" />
        </div>
        <p className="text-xl font-medium text-slate-300 z-10">Select runs to start comparing</p>
        <p className="text-sm text-slate-500 z-10">Use the filters in the sidebar to narrow down your choices.</p>
      </div>
    );
  }

  const availableGroupKeys = [
    'method',
    'model',
    'seed',
    'noise (all)',
    'sigma0',
    'obs_noise_std',
    'epsilon_random'
  ];

  const getNoiseHpTag = (cfg: any) => {
    const parts = [];
    if (cfg.sigma0 && Number(cfg.sigma0) !== 0) parts.push(`σ0: ${cfg.sigma0}`);
    if (cfg.obs_noise_std && Number(cfg.obs_noise_std) !== 0) parts.push(`obs: ${cfg.obs_noise_std}`);
    if (cfg.epsilon_random && Number(cfg.epsilon_random) !== 0) parts.push(`eps: ${cfg.epsilon_random}`);
    return parts.length > 0 ? parts.join(', ') : '';
  };

  const getGroupValue = (runId: string, groupKey: string) => {
    const config = runInfos[runId]?.config || {};
    if (groupKey === 'seed') return config.cma_seed ?? 'N/A';
    if (groupKey === 'noise (all)') {
      const tag = getNoiseHpTag(config);
      return tag || 'none';
    }
    if (groupKey === 'sigma0') return config.sigma0 ?? 'N/A';
    const val = config[groupKey];
    if (val === undefined && groupKey === 'method') return 'LeGPS';
    return val ?? 'N/A';
  };

  const colors = ['#818cf8', '#c084fc', '#34d399', '#f472b6', '#fbbf24', '#f87171', '#a78bfa', '#2dd4bf'];

  const generatePlotData = (gameRuns: string[], game: string, metricKey: string, mode: 'lines' | 'lines+markers' = 'lines+markers') => {
    let maxX = 0;
    const traces: any[] = gameRuns.map((runId, idx) => {
      const runData = metricsData[runId] || [];
      const x = [];
      const y = [];
      
      for (let i = 0; i < runData.length; i++) {
        const item = runData[i];
        const stepVal = item.gen ?? item.global_step ?? item.step ?? item._step ?? item.iteration;
        const metricVal = item[metricKey] ?? (metricKey === 'ret_mean' ? (item['charts/episodic_return'] ?? item['charts/episodic_game_return'] ?? item['eval/episodic_return_mod'] ?? item['episodic_return'] ?? item['reward']) : (metricKey === 'best_fitness' ? (item['ret_mean'] ?? item['charts/episodic_return'] ?? item['charts/episodic_game_return'] ?? item['losses/loss']) : undefined));
        
        if (stepVal !== undefined && metricVal !== undefined) {
          x.push(stepVal);
          y.push(metricVal);
          if (stepVal > maxX) maxX = stepVal;
        }
      }

      const color = colors[idx % colors.length];
      const cfg = runInfos[runId]?.config || {};
      const method = cfg.method || 'Unknown';
      const shortRunId = runId.split('::').pop() || runId;
      const traceName = `${method} (${shortRunId})`;

      return {
        x,
        y,
        type: 'scatter',
        mode,
        name: traceName,
        line: { width: mode === 'lines' ? 2 : 1.5, color },
        marker: { size: mode === 'lines+markers' ? 6 : 0, color, symbol: 'circle', line: { color: '#000', width: 1 } }
      };
    });

    if (metricKey === 'ret_mean') {
       let bGame = game;
       if (bGame === 'montezuma') bGame = 'montezuma_revenge';
       const b = baselinesMap[bGame];
       if (b) {
         const baselineX = [0, maxX || 100];
         traces.push({ x: baselineX, y: [b.ppo, b.ppo], type: 'scatter', mode: 'lines', name: 'PPO Baseline', line: { color: '#8b5cf6', width: 2, dash: 'dash' }, marker: {size: 0} });
         traces.push({ x: baselineX, y: [b.dqn, b.dqn], type: 'scatter', mode: 'lines', name: 'DQN Baseline', line: { color: '#ec4899', width: 2, dash: 'dash' }, marker: {size: 0} });
       }
    }

    return traces;
  };

  const getHNS = (game: string, rawScore: number) => {
    let bGame = game;
    if (bGame === 'montezuma') bGame = 'montezuma_revenge';
    const b = baselinesMap[bGame];
    if (!b) return rawScore; // Fallback to raw if baselines missing for game
    const h = b.human;
    const r = b.random;
    if (h === r) return 0; // Avoid divide by zero
    return (rawScore - r) / (h - r);
  };
  const formatLabelWithBreak = (str: string) => {
    if (!str) return str;
    return str.replace(/\s+\(/g, '<br>(');
  };

  const generateBoxPlotData = (gameRuns: string[], game: string, applyFilter: boolean) => {
    const traces: Record<string, { y: number[], type: 'box', name: string, marker: { color: string }, boxpoints?: boolean | string }> = {};
    
    gameRuns.forEach(runId => {
      const cfg = runInfos[runId]?.config || summaryMap[runId]?.config || {};
      const method = cfg.method || (cfg.algorithm ? String(cfg.algorithm).toUpperCase() : 'LeGPS');
      
      let rawGroupName = method;
      if (groupBy === 'noise (all)') {
        const hpTag = getNoiseHpTag(cfg);
        rawGroupName = hpTag ? `${method} (${hpTag})` : method;
      } else if (groupBy === 'sigma0') {
        rawGroupName = (cfg.sigma0 && Number(cfg.sigma0) !== 0) ? `${method} (σ0: ${cfg.sigma0})` : method;
      } else if (groupBy !== 'method') {
        const groupVal = getGroupValue(runId, groupBy);
        if (groupVal !== 'N/A' && groupVal !== 0 && groupVal !== '0' && groupVal !== 'none') {
          rawGroupName = `${method} (${groupBy}: ${groupVal})`;
        }
      }

      const groupName = formatLabelWithBreak(rawGroupName);
      
      const runData = metricsData[runId] || [];
      
      let maxScore = -Infinity;
      if (runData.length > 0) {
        for (let i = 0; i < runData.length; i++) {
          const item = runData[i];
          const scoreVal = item.ret_mean ?? item['charts/episodic_return'] ?? item['charts/episodic_game_return'] ?? item['eval/episodic_return_mod'] ?? item['episodic_return'] ?? item['reward'];
          if (scoreVal !== undefined) {
            maxScore = Math.max(maxScore, scoreVal);
          }
        }
      } else if (summaryMap[runId]?.max_ret_mean !== undefined && summaryMap[runId]?.max_ret_mean !== null) {
        maxScore = summaryMap[runId].max_ret_mean;
      }
      
      if (maxScore !== -Infinity) {
        if (!traces[groupName]) {
          traces[groupName] = {
            y: [],
            type: 'box',
            name: groupName,
            marker: { color: '' }
          };
        }
        traces[groupName].y.push(getHNS(game, maxScore));
      }
    });
    
    const result = Object.values(traces).map((trace, idx) => {
      if (applyFilter) {
        trace.y = filterOutliersIQR(trace.y);
        trace.boxpoints = false;
      } else {
        trace.boxpoints = 'outliers';
      }
      trace.marker.color = colors[idx % colors.length];
      return trace;
    });

    let bGame = game;
    if (bGame === 'montezuma') bGame = 'montezuma_revenge';
    const b = baselinesMap[bGame];
    if (b) {
      result.push({ y: [getHNS(game, b.ppo)], type: 'box', name: 'PPO Baseline', marker: { color: '#8b5cf6' }, boxpoints: false } as any);
      result.push({ y: [getHNS(game, b.dqn)], type: 'box', name: 'DQN Baseline', marker: { color: '#ec4899' }, boxpoints: false } as any);
    }

    return result;
  };

  const generateAggregateBoxPlotData = (applyFilter: boolean) => {
    const groupGameMax: Record<string, Record<string, number>> = {};
    const dqnPoints: number[] = [];
    const ppoPoints: number[] = [];
    
    const games = Object.keys(runsByGame);

    games.forEach(game => {
      runsByGame[game].forEach(runId => {
        const cfg = runInfos[runId]?.config || summaryMap[runId]?.config || {};
        const method = cfg.method || (cfg.algorithm ? String(cfg.algorithm).toUpperCase() : 'LeGPS');
        
        let rawGroupName = method;
        if (groupBy === 'noise (all)') {
          const hpTag = getNoiseHpTag(cfg);
          rawGroupName = hpTag ? `${method} (${hpTag})` : method;
        } else if (groupBy === 'sigma0') {
          rawGroupName = (cfg.sigma0 && Number(cfg.sigma0) !== 0) ? `${method} (σ0: ${cfg.sigma0})` : method;
        } else if (groupBy !== 'method') {
          const groupVal = getGroupValue(runId, groupBy);
          if (groupVal !== 'N/A' && groupVal !== 0 && groupVal !== '0' && groupVal !== 'none') {
            rawGroupName = `${method} (${groupBy}: ${groupVal})`;
          }
        }

        const groupName = formatLabelWithBreak(rawGroupName);
        
        const runData = metricsData[runId] || [];
        
        let maxScore = -Infinity;
        if (runData.length > 0) {
          for (let i = 0; i < runData.length; i++) {
            const item = runData[i];
            const scoreVal = item.ret_mean ?? item['charts/episodic_return'] ?? item['charts/episodic_game_return'] ?? item['eval/episodic_return_mod'] ?? item['episodic_return'] ?? item['reward'];
            if (scoreVal !== undefined) {
              maxScore = Math.max(maxScore, scoreVal);
            }
          }
        } else if (summaryMap[runId]?.max_ret_mean !== undefined && summaryMap[runId]?.max_ret_mean !== null) {
          maxScore = summaryMap[runId].max_ret_mean;
        }
        
        if (maxScore !== -Infinity) {
          let bGame = game;
          if (bGame === 'montezuma') bGame = 'montezuma_revenge';
          if (!baselinesMap[bGame]) return; // Skip if no baseline (avoids mixing raw scores with HNS)
          
          const hns = getHNS(game, maxScore);
          if (!groupGameMax[groupName]) groupGameMax[groupName] = {};
          if (groupGameMax[groupName][game] === undefined) {
             groupGameMax[groupName][game] = hns;
          } else {
             groupGameMax[groupName][game] = Math.max(groupGameMax[groupName][game], hns);
          }
        }
      });
      
      let bGame = game;
      if (bGame === 'montezuma') bGame = 'montezuma_revenge';
      const b = baselinesMap[bGame];
      if (b) {
        dqnPoints.push(getHNS(game, b.dqn));
        ppoPoints.push(getHNS(game, b.ppo));
      }
    });

    const traces: any[] = [];
    
    Object.keys(groupGameMax).forEach((groupName, idx) => {
      traces.push({
        y: Object.values(groupGameMax[groupName]),
        type: 'box',
        name: groupName,
        marker: { color: colors[idx % colors.length] }
      });
    });
    
    traces.push({ y: ppoPoints, type: 'box', name: 'PPO Baseline', marker: { color: '#8b5cf6' } });
    traces.push({ y: dqnPoints, type: 'box', name: 'DQN Baseline', marker: { color: '#ec4899' } });

    if (applyFilter) {
      traces.forEach(trace => {
        trace.y = filterOutliersIQR(trace.y);
        trace.boxpoints = false;
      });
    } else {
      traces.forEach(trace => {
        trace.boxpoints = 'outliers';
      });
    }

    return traces;
  };

  const isDark = theme === 'dark';
  const layoutBase = {
    autosize: true,
    paper_bgcolor: 'transparent',
    plot_bgcolor: 'transparent',
    font: { color: isDark ? '#94a3b8' : '#475569', family: 'Inter, sans-serif' },
    margin: { t: 20, r: 20, l: 80, b: 65 },
    xaxis: { 
      tickangle: 0,
      gridcolor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)', 
      zerolinecolor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)', 
      tickfont: { color: isDark ? '#64748b' : '#64748b' }
    },
    yaxis: { 
      gridcolor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)', 
      zerolinecolor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)',
      tickfont: { color: isDark ? '#64748b' : '#64748b' }
    },
    legend: {
      orientation: 'h',
      y: -0.28,
      font: { color: isDark ? '#cbd5e1' : '#334155' }
    },
    hovermode: 'closest',
    hoverlabel: {
      bgcolor: isDark ? '#12141F' : '#ffffff',
      bordercolor: isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.15)',
      font: { family: 'Inter', color: isDark ? '#fff' : '#0f172a' }
    }
  };

  return (
    <div className="p-8 relative">
      <div className="flex items-end justify-between mb-8 pb-6 border-b border-[#2e334d]">
        <div>
          <h1 className="text-3xl font-bold text-white mb-2 tracking-tight">Run Comparison</h1>
          <p className="text-slate-400">Viewing comparative metrics across <span className="text-indigo-400 font-medium">{selectedRuns.length}</span> selected runs.</p>
        </div>
        {loading && <div className="badge animate-pulse border-indigo-500 text-indigo-400 bg-indigo-500/10">Syncing data...</div>}
      </div>

      <div className="flex flex-col" style={{ gap: 'var(--game-outer-gap, 3.5rem)' }}>
        {/* Top Filters Bar */}
        <div className="bg-[#16192b] border border-[#2e334d] p-6 rounded-2xl flex flex-col gap-6 mb-4">
          <div className="flex items-center justify-between border-b border-[#2e334d] pb-4">
            <div className="flex items-center gap-2">
              <Filter className="w-5 h-5 text-indigo-400" />
              <h2 className="text-base font-bold text-white tracking-wide">Filter Runs</h2>
            </div>
            <button
              onClick={() => {
                setSelectedGames(new Set(games));
                setSelectedModels(new Set(models));
                setSelectedMethods(new Set(methods));
              }}
              className="text-xs font-semibold text-slate-400 hover:text-indigo-400 flex items-center gap-1.5 transition-colors px-3 py-1.5 rounded-lg border border-[#2e334d] bg-[rgba(0,0,0,0.2)] hover:bg-[rgba(99,102,241,0.1)]"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset Filters</span>
            </button>
          </div>

          <div className="flex flex-col gap-6">
            {games.length > 0 && (
              <div className="flex flex-col gap-4 w-full">
                {/* Quick Selectors for Category & Quality Status */}
                <div className="flex flex-col gap-3 p-4 bg-[#12141F] border border-[#2e334d] rounded-xl">
                  {/* Category Row */}
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Game Category</span>
                      <span className="text-[10px] text-slate-500">(Click to select, Ctrl/Cmd+Click to isolate)</span>
                    </div>
                    <div className="filter-chip-group">
                      {gameCategories.map(cat => {
                        const catGames = games.filter(g => getGameMetaInfo(g).category === cat);
                        const allCatSelected = catGames.length > 0 && catGames.every(g => selectedGames.has(g));
                        const someCatSelected = catGames.some(g => selectedGames.has(g));
                        return (
                          <button
                            key={cat}
                            onClick={e => {
                              const isModifier = e.ctrlKey || e.metaKey;
                              if (isModifier) {
                                setSelectedGames(new Set(catGames));
                              } else {
                                setSelectedGames(prev => {
                                  const next = new Set(prev);
                                  if (allCatSelected) {
                                    catGames.forEach(g => next.delete(g));
                                  } else {
                                    catGames.forEach(g => next.add(g));
                                  }
                                  return next;
                                });
                              }
                            }}
                            className={`filter-chip ${allCatSelected ? 'active active-purple' : someCatSelected ? 'border-purple-500/50 text-purple-300' : ''}`}
                          >
                            <span className="filter-chip-label">{cat} ({catGames.length})</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Quality Status Row */}
                  <div className="flex flex-col gap-2 pt-2 border-t border-[#2e334d]/60">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Quality Status</span>
                      <span className="text-[10px] text-slate-500">(Click to select, Ctrl/Cmd+Click to isolate)</span>
                    </div>
                    <div className="filter-chip-group">
                      {gameStatuses.map(st => {
                        const stGames = games.filter(g => getGameMetaInfo(g).status === st);
                        const allStSelected = stGames.length > 0 && stGames.every(g => selectedGames.has(g));
                        const someStSelected = stGames.some(g => selectedGames.has(g));
                        return (
                          <button
                            key={st}
                            onClick={e => {
                              const isModifier = e.ctrlKey || e.metaKey;
                              if (isModifier) {
                                setSelectedGames(new Set(stGames));
                              } else {
                                setSelectedGames(prev => {
                                  const next = new Set(prev);
                                  if (allStSelected) {
                                    stGames.forEach(g => next.delete(g));
                                  } else {
                                    stGames.forEach(g => next.add(g));
                                  }
                                  return next;
                                });
                              }
                            }}
                            className={`filter-chip ${allStSelected ? 'active active-indigo' : someStSelected ? 'border-indigo-500/50 text-indigo-300' : ''}`}
                          >
                            <span className="filter-chip-label">{st} ({stGames.length})</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Individual Games</span>
                  <span className="badge text-[11px] py-0.5 px-2 bg-indigo-500/20 border-indigo-500/30 text-indigo-300">
                    {selectedGames.size} / {games.length}
                  </span>
                </div>
                <div className="filter-chip-group">
                  {games.map(g => {
                    const active = selectedGames.has(g);
                    return (
                      <button
                        key={g}
                        onClick={e => handleFilterClick(e, setSelectedGames, g, games)}
                        title="Click to toggle, Ctrl+Click or Cmd+Click to isolate"
                        className={`filter-chip ${active ? 'active active-indigo' : ''}`}
                      >
                        <span className="filter-chip-label">{g}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {models.length > 0 && (
              <div className="flex flex-col gap-3 w-full">
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
                        onClick={e => handleFilterClick(e, setSelectedModels, m, models)}
                        title="Click to toggle, Ctrl+Click or Cmd+Click to isolate"
                        className={`filter-chip ${active ? 'active active-purple' : ''}`}
                      >
                        <span className="filter-chip-label">{m}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {methods.length > 0 && (
              <div className="flex flex-col gap-3 w-full">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Methods</span>
                  <span className="badge text-[11px] py-0.5 px-2 bg-emerald-500/20 border-emerald-500/30 text-emerald-300">
                    {selectedMethods.size} / {methods.length}
                  </span>
                </div>
                <div className="filter-chip-group">
                  {methods.map(method => {
                    const active = selectedMethods.has(method);
                    return (
                      <button
                        key={method}
                        onClick={e => handleFilterClick(e, setSelectedMethods, method, methods)}
                        title="Click to toggle, Ctrl+Click or Cmd+Click to isolate"
                        className={`filter-chip ${active ? 'active active-emerald' : ''}`}
                      >
                        <span className="filter-chip-label">{method}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Sort Games & Group Distributions Controls */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-4">
          <div className="bg-[#16192b] border border-[#2e334d] p-6 rounded-2xl flex flex-col gap-6">
            <div className="flex items-center justify-between border-b border-[#2e334d] pb-4">
              <div className="flex items-center gap-2">
                <Gamepad2 className="w-5 h-5 text-indigo-400" />
                <h2 className="text-base font-bold text-white tracking-wide">Sort Game Cards By</h2>
              </div>
              <span className="badge text-[11px] py-0.5 px-2 bg-indigo-500/20 border-indigo-500/30 text-indigo-300">
                Active: {sortGamesBy === 'name' ? 'Name' : '#Algorithms'}
              </span>
            </div>
            <div className="filter-chip-group">
              <button
                onClick={() => setSortGamesBy('name')}
                className={`filter-chip ${sortGamesBy === 'name' ? 'active active-indigo' : ''}`}
              >
                <span className="filter-chip-label">Name (Alphabetical)</span>
              </button>
              <button
                onClick={() => setSortGamesBy('#Algorithms')}
                className={`filter-chip ${sortGamesBy === '#Algorithms' ? 'active active-indigo' : ''}`}
              >
                <span className="filter-chip-label"># Algorithms Available</span>
              </button>
            </div>
          </div>

          <div className="bg-[#16192b] border border-[#2e334d] p-6 rounded-2xl flex flex-col gap-6">
            <div className="flex items-center justify-between border-b border-[#2e334d] pb-4">
              <div className="flex items-center gap-2">
                <BarChart2 className="w-5 h-5 text-indigo-400" />
                <h2 className="text-base font-bold text-white tracking-wide">Group Distributions By</h2>
              </div>
              <span className="badge text-[11px] py-0.5 px-2 bg-indigo-500/20 border-indigo-500/30 text-indigo-300">
                Active: {groupBy}
              </span>
            </div>
            <div className="filter-chip-group">
              {availableGroupKeys.map(key => {
                const active = groupBy === key;
                return (
                  <button
                    key={key}
                    onClick={() => setGroupBy(key)}
                    className={`filter-chip ${active ? 'active active-indigo' : ''}`}
                  >
                    <span className="filter-chip-label">{key}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {Object.keys(runsByGame).length > 0 && Object.keys(baselinesMap).length > 0 && (
          <div className="flex flex-col gap-6 relative">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 bg-indigo-500/20 rounded-lg border border-indigo-500/30">
                <BarChart2 className="w-6 h-6 text-indigo-400" />
              </div>
              <h2 className="text-2xl font-bold text-white">All Games Aggregate Performance</h2>
              <span className="badge ml-2">vs. Baselines</span>
            </div>
            <div className="panel flex flex-col group">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-base font-semibold text-white tracking-wide">Human Normalized Score Distribution (All Selected Games)</h3>
                <div className="flex items-center gap-4">
                  <label className="flex items-center gap-3 cursor-pointer group/toggle">
                    <span className={`text-sm font-medium transition-colors ${aggFilterOutliers ? 'text-indigo-300' : 'text-slate-400'}`}>Filter Outliers</span>
                    <Toggle 
                      checked={aggFilterOutliers}
                      onChange={setAggFilterOutliers}
                    />
                  </label>
                  <div className="w-2 h-2 rounded-full bg-blue-400 shadow-[0_0_8px_rgba(96,165,250,0.8)]" />
                </div>
              </div>
              <div className="w-full">
                <Plot
                  data={generateAggregateBoxPlotData(aggFilterOutliers) as any}
                  layout={{ ...layoutBase, yaxis: { ...layoutBase.yaxis, title: { text: 'Normalized Score', font: { color: '#64748b' } } } }}
                  useResizeHandler={true}
                  style={{ width: '100%', height: '400px' }}
                  config={{ responsive: true, displayModeBar: false }}
                />
              </div>
            </div>
          </div>
        )}

        {sortedGameEntries.map(([game, gameRuns]) => (
          <GameSection 
            key={game} 
            game={game} 
            gameRuns={gameRuns} 
            runInfos={runInfos}
            metricsData={metricsData}
            setMetricsData={setMetricsData}
            generatePlotData={generatePlotData} 
            generateBoxPlotData={generateBoxPlotData} 
            layoutBase={layoutBase} 
          />
        ))}
      </div>
    </div>
  );
};

const GameSection = React.memo(({ game, gameRuns, runInfos, metricsData, setMetricsData, generatePlotData, generateBoxPlotData, layoutBase }: any) => {
  const [expanded, setExpanded] = useState(false);
  const [loadingGameMetrics, setLoadingGameMetrics] = useState(false);
  const [filterOutliers, setFilterOutliers] = useState<boolean>(() => {
    const saved = localStorage.getItem(`outlier_filter_game_${game}`);
    return saved ? JSON.parse(saved) : false;
  });

  const numAlgos = React.useMemo(() => {
    return new Set(gameRuns.map((r: string) => runInfos[r]?.config?.method || 'Unknown')).size;
  }, [gameRuns, runInfos]);

  useEffect(() => {
    localStorage.setItem(`outlier_filter_game_${game}`, JSON.stringify(filterOutliers));
  }, [filterOutliers, game]);

  useEffect(() => {
    if (!expanded) return;
    const missing = gameRuns.filter((id: string) => !metricsData[id]);
    if (missing.length === 0) return;

    setLoadingGameMetrics(true);
    Promise.all(
      missing.map((runId: string) =>
        fetchRunMetrics(runId)
          .then(data => ({ runId, data }))
          .catch(() => ({ runId, data: [] }))
      )
    ).then(results => {
      setMetricsData((prev: any) => {
        const next = { ...prev };
        results.forEach(res => { next[res.runId] = res.data; });
        return next;
      });
      setLoadingGameMetrics(false);
    });
  }, [expanded, gameRuns, metricsData, setMetricsData]);

  return (
    <div className="flex flex-col relative" style={{ gap: 'var(--game-inner-gap, 0.25rem)' }}>
      <div 
        className="flex items-center gap-3 cursor-pointer hover:bg-slate-800/50 p-3 rounded-xl transition-colors group"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="p-2 bg-indigo-500/20 rounded-lg border border-indigo-500/30">
          <Gamepad2 className="w-6 h-6 text-indigo-400" />
        </div>
        <h2 className="text-2xl font-bold text-white capitalize flex-1">{game}</h2>
        <span className="badge border-indigo-500/30 text-indigo-300 bg-indigo-500/10 font-semibold">{numAlgos} Algorithm{numAlgos > 1 ? 's' : ''}</span>
        <span className="badge">{gameRuns.length} runs</span>
        <div className="flex items-center gap-2 ml-4">
          {loadingGameMetrics && <span className="text-xs text-indigo-400 font-medium animate-pulse">Loading charts...</span>}
          <span className="text-sm text-slate-400 group-hover:text-slate-300">Deeper Analysis</span>
          <ChevronDown className={`w-5 h-5 text-slate-400 transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </div>
      </div>

      <div className="panel flex flex-col group">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-base font-semibold text-white tracking-wide">Human Normalized Score Distribution</h3>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-3 cursor-pointer group/toggle">
              <span className={`text-sm font-medium transition-colors ${filterOutliers ? 'text-indigo-300' : 'text-slate-400'}`}>Filter Outliers</span>
              <Toggle 
                checked={filterOutliers}
                onChange={setFilterOutliers}
              />
            </label>
            <div className="w-2 h-2 rounded-full bg-orange-400 shadow-[0_0_8px_rgba(251,146,60,0.8)]" />
          </div>
        </div>
        <div className="w-full">
          <Plot
            data={generateBoxPlotData(gameRuns, game, filterOutliers) as any}
            layout={{ ...layoutBase, yaxis: { ...layoutBase.yaxis, title: { text: 'Normalized Score', font: { color: '#64748b' } } } }}
            useResizeHandler={true}
            style={{ width: '100%', height: '400px' }}
            config={{ responsive: true, displayModeBar: false }}
          />
        </div>
      </div>

      {expanded && (
        <div className="p-6 bg-slate-800/20 border border-slate-700/50 rounded-2xl flex flex-col gap-6 animate-in fade-in slide-in-from-top-4 duration-300">
          <h3 className="text-xl font-bold text-white mb-2">Detailed Game Metrics</h3>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            <div className="panel flex flex-col group bg-[#16192b]">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-base font-semibold text-white tracking-wide">Best Fitness Over Time</h3>
                <div className="w-2 h-2 rounded-full bg-indigo-500 shadow-[0_0_8px_rgba(99,102,241,0.8)]" />
              </div>
              <div className="w-full">
                <Plot
                  data={generatePlotData(gameRuns, game, 'best_fitness') as any}
                  layout={{ ...layoutBase, xaxis: { ...layoutBase.xaxis, title: { text: 'Generation', font: { color: '#64748b' } } }, yaxis: { ...layoutBase.yaxis, title: { text: 'Fitness', font: { color: '#64748b' } } } }}
                  useResizeHandler={true}
                  style={{ width: '100%', height: '350px' }}
                  config={{ responsive: true, displayModeBar: false }}
                />
              </div>
            </div>

            <div className="panel flex flex-col group bg-[#16192b]">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-base font-semibold text-white tracking-wide">Game Score Progression</h3>
                <div className="w-2 h-2 rounded-full bg-purple-500 shadow-[0_0_8px_rgba(192,132,252,0.8)]" />
              </div>
              <div className="w-full">
                <Plot
                  data={generatePlotData(gameRuns, game, 'ret_mean', 'lines') as any}
                  layout={{ ...layoutBase, xaxis: { ...layoutBase.xaxis, title: { text: 'Generation', font: { color: '#64748b' } } }, yaxis: { ...layoutBase.yaxis, title: { text: 'Score', font: { color: '#64748b' } } } }}
                  useResizeHandler={true}
                  style={{ width: '100%', height: '350px' }}
                  config={{ responsive: true, displayModeBar: false }}
                />
              </div>
            </div>
            
            <div className="panel flex flex-col xl:col-span-2 group bg-[#16192b]">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-base font-semibold text-white tracking-wide">Min Y (Height Progress - Lower is Better)</h3>
                <div className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]" />
              </div>
              <div className="w-full">
                <Plot
                  data={generatePlotData(gameRuns, game, 'min_y_best') as any}
                  layout={{ ...layoutBase, xaxis: { ...layoutBase.xaxis, title: { text: 'Generation', font: { color: '#64748b' } } }, yaxis: { ...layoutBase.yaxis, autorange: 'reversed' } }}
                  useResizeHandler={true}
                  style={{ width: '100%', height: '350px' }}
                  config={{ responsive: true, displayModeBar: false }}
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

export default ComparisonView;
