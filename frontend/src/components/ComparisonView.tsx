import React, { useEffect, useState } from 'react';
import Plot from 'react-plotly.js';
import { fetchRunMetrics, fetchRuns, fetchBaselines, fetchComparisonSummary, fetchGameMetadata, fetchAppConfig, type RunInfo, type BaselineInfo } from '../api';
import { LayoutGrid, Gamepad2, BarChart2, ChevronDown, Filter, RotateCcw } from 'lucide-react';
import { Toggle } from './Toggle';

interface ComparisonProps {
  selectedRuns: string[];
  setSelectedRuns?: React.Dispatch<React.SetStateAction<string[]>>;
  theme?: string;
  activeTab?: 'jaxatari' | 'vs_ale' | 'env_scaling' | 'alg_comparison';
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

const ComparisonView: React.FC<ComparisonProps> = ({ selectedRuns, setSelectedRuns, theme = 'dark', activeTab = 'jaxatari' }) => {
  const compareTab = activeTab;
  const [metricsData, setMetricsData] = useState<Record<string, any[]>>({});
  const [allRuns, setAllRuns] = useState<RunInfo[]>([]);
  const [runInfos, setRunInfos] = useState<Record<string, RunInfo>>({});
  const [loading, setLoading] = useState(false);
  const [baselinesMap, setBaselinesMap] = useState<Record<string, BaselineInfo>>({});
  const [groupBy, setGroupBy] = useState<string>('noise (all)');
  const [sortGamesBy, setSortGamesBy] = useState<'name' | '#Algorithms' | 'Algorithm'>('#Algorithms');
  const [selectedSortAlgo, setSelectedSortAlgo] = useState<string | null>(null);
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
  const [configColors, setConfigColors] = useState<Record<string, string>>({});

  useEffect(() => {
    fetchAppConfig().then(cfg => {
      if (cfg && cfg.algorithm_colors) {
        setConfigColors(cfg.algorithm_colors);
      }
    }).catch(e => console.error("Config fetch error:", e));

    let active = true;
    const refreshSummary = () => fetchComparisonSummary(true).then((items: any[]) => {
      if (!active) return;
      const sMap: Record<string, any> = {};
      items.forEach((item: any) => { sMap[item.id] = item; });
      setSummaryMap(sMap);
    }).catch(e => console.error("Summary fetch error:", e));
    refreshSummary();
    const timer = window.setInterval(refreshSummary, 5_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
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
      // Default preset based on active scientific question tab
      if (compareTab === 'env_scaling') {
        setGroupBy('num_envs');
      } else if (compareTab === 'alg_comparison') {
        setGroupBy('method');
      }
    });
  }, [compareTab]);

  // Determine eligible runs for the current tab
  const eligibleRuns = React.useMemo(() => {
    if (compareTab === 'jaxatari') {
      return allRuns.filter(r => (r.config?.backend || r.backend || 'jaxatari').toLowerCase() === 'jaxatari');
    }
    
    if (compareTab === 'alg_comparison') {
      return allRuns.filter(r => {
        const cfg = r.config || {};
        const backend = (cfg.backend || r.backend || 'jaxatari').toLowerCase();
        const numEnvs = Number(cfg.num_envs || 32);
        const rawMethod = String(cfg.raw_alg || cfg.method || '').toLowerCase();
        if (backend !== 'jaxatari') return false;
        if (rawMethod.includes('dqn') && numEnvs !== 1) return false;
        if (rawMethod.includes('rainbow') && numEnvs !== 1) return false;
        if (rawMethod.includes('ppo') && numEnvs !== 8) return false;
        if (rawMethod.includes('pqn') && numEnvs !== 128) return false;
        return true;
      });
    }

    if (compareTab === 'vs_ale') {
      // Find intersection of (raw_alg, num_envs, obs_type) available on BOTH ale and jaxatari
      const aleKeys = new Set<string>();
      const jaxKeys = new Set<string>();

      allRuns.forEach(r => {
        const cfg = r.config || {};
        const backend = (cfg.backend || r.backend || 'jaxatari').toLowerCase();
        const numEnvs = Number(cfg.num_envs || 32);
        const rawAlg = String(cfg.raw_alg || cfg.method || '').toUpperCase().trim();
        const obs = (r.obs_type || (String(cfg.method || '').toLowerCase().includes('oc') ? 'oc' : 'pixels')).toLowerCase();
        const key = `${rawAlg}__${numEnvs}__${obs}`;
        if (backend === 'ale') {
          aleKeys.add(key);
        } else {
          jaxKeys.add(key);
        }
      });

      const sharedKeys = new Set([...aleKeys].filter(k => jaxKeys.has(k)));

      return allRuns.filter(r => {
        const cfg = r.config || {};
        const numEnvs = Number(cfg.num_envs || 32);
        const rawAlg = String(cfg.raw_alg || cfg.method || '').toUpperCase().trim();
        const obs = (r.obs_type || (String(cfg.method || '').toLowerCase().includes('oc') ? 'oc' : 'pixels')).toLowerCase();
        const key = `${rawAlg}__${numEnvs}__${obs}`;
        return sharedKeys.has(key);
      });
    }

    return allRuns;
  }, [allRuns, compareTab]);

  const models = React.useMemo(() => Array.from(new Set(eligibleRuns.map(r => String(r.config.model || 'unknown')))).sort((a, b) => a.localeCompare(b)), [eligibleRuns]);
  const methods = React.useMemo(() => Array.from(new Set(eligibleRuns.map(r => String(r.config.method || 'unknown')))).sort((a, b) => a.localeCompare(b)), [eligibleRuns]);
  const games = React.useMemo(() => Array.from(new Set(eligibleRuns.map(r => String(r.config.game || 'unknown')))).sort((a, b) => a.localeCompare(b)), [eligibleRuns]);

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
    if (!setSelectedRuns || eligibleRuns.length === 0) return;
    const matching = eligibleRuns.filter(run => {
      const modelMatch = selectedModels.has(String(run.config.model || 'unknown'));
      const methodMatch = selectedMethods.size === 0 || selectedMethods.has(String(run.config.method || 'unknown'));
      const gameMatch = selectedGames.has(String(run.config.game || 'unknown'));
      return modelMatch && methodMatch && gameMatch;
    }).map(r => r.id);
    setSelectedRuns(matching);
  }, [selectedModels, selectedMethods, selectedGames, eligibleRuns]);

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
        baselines.forEach(b => { bMap[b.game.toLowerCase()] = b; });
        setBaselinesMap(bMap);
      } catch(e) {
        console.error("Failed to fetch baselines");
      }
      
      setLoading(false);
    };
    
    loadData();
  }, [selectedRuns]);

  // Group selected runs by game (filtering out environments if an algorithm filter is selected)
  const runsByGame: Record<string, string[]> = React.useMemo(() => {
    const map: Record<string, string[]> = {};
    selectedRuns.forEach(runId => {
      const game = runInfos[runId]?.config?.game || 'Unknown Game';
      if (!map[game]) map[game] = [];
      map[game].push(runId);
    });

    if (sortGamesBy === 'Algorithm' && selectedSortAlgo) {
      const target = selectedSortAlgo.toLowerCase();
      const filteredMap: Record<string, string[]> = {};
      for (const [game, runIds] of Object.entries(map)) {
        const hasAlgo = runIds.some(r => {
          const m = (runInfos[r]?.config?.method || runInfos[r]?.config?.algorithm || '').toLowerCase();
          return m.includes(target) || target.includes(m);
        });
        if (hasAlgo) {
          filteredMap[game] = runIds;
        }
      }
      return filteredMap;
    }

    return map;
  }, [selectedRuns, runInfos, sortGamesBy, selectedSortAlgo]);

  const availableAlgorithms = React.useMemo(() => {
    const algos = new Set<string>();
    eligibleRuns.forEach(r => {
      const m = r.config?.method || r.config?.algorithm;
      if (m) {
        const clean = String(m).replace(/\s*\((pixels|oc)\)\s*/gi, '').trim();
        if (clean) algos.add(clean);
      }
    });
    return Array.from(algos).sort((a, b) => a.localeCompare(b));
  }, [eligibleRuns]);

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
    'num_envs',
    'backend',
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

  const COLOR_PALETTE = [
    '#818cf8', // Indigo
    '#34d399', // Emerald
    '#c084fc', // Purple
    '#f472b6', // Pink
    '#fbbf24', // Amber
    '#38bdf8', // Sky
    '#f87171', // Red
    '#a78bfa', // Violet
    '#2dd4bf', // Teal
    '#fb923c'  // Orange
  ];

  const FIXED_ALGO_COLORS: Record<string, string> = {
    'legps': '#818cf8',               // Indigo for LeGPS
    'ppo': '#34d399',                 // Emerald for PPO
    'jaxatari: ppo (pixels)': '#34d399', // Emerald
    'ale: ppo (pixels)': '#60a5fa',      // Bright Sky Blue
    'jaxatari: ppo (oc)': '#a78bfa',     // Purple
    'ale: ppo (oc)': '#f472b6',          // Pink
    'jaxatari: pqn (pixels)': '#f59e0b', // Amber
    'ale: pqn (pixels)': '#38bdf8',      // Sky
    'jaxatari: pqn (oc)': '#fbbf24',     // Yellow Amber
    'ale: pqn (oc)': '#e879f9',          // Fuchsia
    'jaxatari: dqn (pixels)': '#2dd4bf', // Teal
    'ale: dqn (pixels)': '#818cf8',      // Indigo
    'jaxatari: rainbow (pixels)': '#fb7185', // Rose
    'ale: rainbow (pixels)': '#c084fc',      // Violet
    'ppo baseline': '#8b5cf6',
    'dqn': '#38bdf8',
    'dqn baseline': '#ec4899',
    'cma-es': '#fbbf24',
    'cmaes': '#fbbf24',
  };

  const getAlgorithmColor = (name: string): string => {
    if (!name) return COLOR_PALETTE[0];
    const cleanName = name.toLowerCase().replace(/<br>/g, ' ').replace(/\s+/g, ' ').trim();
    if (configColors[cleanName]) {
      return configColors[cleanName];
    }
    if (FIXED_ALGO_COLORS[cleanName]) {
      return FIXED_ALGO_COLORS[cleanName];
    }
    const merged = { ...configColors, ...FIXED_ALGO_COLORS };
    for (const [key, color] of Object.entries(merged)) {
      if (cleanName === key || cleanName.startsWith(key)) {
        return color;
      }
    }
    let hash = 0;
    for (let i = 0; i < cleanName.length; i++) {
      hash = (hash << 5) - hash + cleanName.charCodeAt(i);
      hash |= 0;
    }
    const index = Math.abs(hash) % COLOR_PALETTE.length;
    return COLOR_PALETTE[index];
  };

  const generatePlotData = (gameRuns: string[], _game: string, metricKey: string, mode: 'lines' | 'lines+markers' = 'lines+markers') => {
    let maxX = 0;
    const traces: any[] = gameRuns.map((runId) => {
      const runData = metricsData[runId] || [];
      const x = [];
      const y = [];
      
      for (let i = 0; i < runData.length; i++) {
        const item = runData[i];
        // Never compare a CMA generation directly with an RL environment step.
        // Current LeGPS2 records expose cumulative optimizer interactions;
        // historical records without an interaction axis are omitted here.
        const stepVal = item.cumulative_optimizer_primary_env_steps ?? item.global_step ?? item.step ?? item._step;
        const metricVal = item[metricKey];
        
        if (stepVal !== undefined && metricVal !== undefined) {
          x.push(stepVal);
          y.push(metricVal);
          if (stepVal > maxX) maxX = stepVal;
        }
      }

      const cfg = runInfos[runId]?.config || {};
      const method = cfg.method || 'Unknown';
      const shortRunId = runId.split('::').pop() || runId;
      const traceName = `${method} (${shortRunId})`;
      const color = getAlgorithmColor(method);

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

    return traces;
  };

  const getHNS = (game: string, rawScore: number): number | null => {
    let bGame = game.toLowerCase();
    if (bGame === 'montezuma') bGame = 'montezuma_revenge';
    const b = baselinesMap[bGame];
    if (!b) return null;
    const h = b.human;
    const r = b.random;
    if (h === r) return null;
    return (rawScore - r) / (h - r);
  };
  const hasBaseline = (game: string) => {
    const normalized = game.toLowerCase();
    const key = normalized === 'montezuma' ? 'montezuma_revenge' : normalized;
    const baseline = baselinesMap[key];
    return Boolean(baseline && baseline.human !== baseline.random);
  };

  const getRunComparisonScore = (runId: string): number | null => {
    const summaryScore = summaryMap[runId]?.comparison_score;
    if (typeof summaryScore === 'number' && Number.isFinite(summaryScore)) return summaryScore;
    // Compatibility for non-v2 servers: use the final exact ret_mean value, never the
    // maximum training observation and never a value from a differently named metric.
    const exact = (metricsData[runId] || []).filter(row => typeof row.ret_mean === 'number');
    return exact.length ? exact[exact.length - 1].ret_mean : null;
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
      if (compareTab === 'vs_ale') {
        const backendName = (cfg.backend || 'jaxatari').toLowerCase() === 'ale' ? 'ALE' : 'JAXAtari';
        rawGroupName = `${backendName}: ${method}`;
      } else if (groupBy === 'noise (all)') {
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
      
      const comparisonScore = getRunComparisonScore(runId);
      if (comparisonScore !== null) {
        if (!traces[groupName]) {
          traces[groupName] = {
            y: [],
            type: 'box',
            name: groupName,
            marker: { color: '' }
          };
        }
        const normalized = getHNS(game, comparisonScore);
        traces[groupName].y.push(normalized ?? comparisonScore);
      }
    });
    
    const result = Object.values(traces).map((trace) => {
      if (applyFilter) {
        trace.y = filterOutliersIQR(trace.y);
        trace.boxpoints = false;
      } else {
        trace.boxpoints = 'outliers';
      }
      trace.marker.color = getAlgorithmColor(trace.name);
      return trace;
    });

    return result;
  };

  const generateAggregateBoxPlotData = (applyFilter: boolean, obsTypeFilter?: 'pixels' | 'oc') => {
    const groupSamples: Record<string, number[]> = {};
    
    const games = Object.keys(runsByGame);

    games.forEach(game => {
      runsByGame[game].forEach(runId => {
        const info = runInfos[runId];
        const obs = info?.obs_type || info?.config?.obs_type || 'pixels';
        if (obsTypeFilter && obs !== obsTypeFilter) return;

        const cfg = runInfos[runId]?.config || summaryMap[runId]?.config || {};
        const method = cfg.method || (cfg.algorithm ? String(cfg.algorithm).toUpperCase() : 'LeGPS');
        
        let rawGroupName = method;
        if (compareTab === 'vs_ale') {
          const backendName = (cfg.backend || 'jaxatari').toLowerCase() === 'ale' ? 'ALE' : 'JAXAtari';
          rawGroupName = `${backendName}: ${method}`;
        } else if (groupBy === 'noise (all)') {
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
        
        const comparisonScore = getRunComparisonScore(runId);
        const hns = comparisonScore === null ? null : getHNS(game, comparisonScore);
        if (hns !== null) {
          if (!groupSamples[groupName]) groupSamples[groupName] = [];
          // Keep every independent run/seed. Taking the best run per game erased
          // seed variance and biased the aggregate upward.
          groupSamples[groupName].push(hns);
        }
      });
    });

    const traces: any[] = [];
    
    Object.keys(groupSamples).forEach((groupName) => {
      traces.push({
        y: groupSamples[groupName],
        type: 'box',
        name: groupName,
        marker: { color: getAlgorithmColor(groupName) }
      });
    });

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

  const aggregateMissingBaselines = Object.keys(runsByGame).filter(game => !hasBaseline(game));

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

  const pageTitles: Record<string, { title: string; subtitle: string; tag: string }> = {
    'jaxatari': {
      title: 'JAXAtari Exploration & Evaluation',
      subtitle: 'Comprehensive benchmarks and runs executed natively on JAXAtari.',
      tag: 'JAXAtari Benchmarks'
    },
    'env_scaling': {
      title: 'Impact of Parallel Environments',
      subtitle: 'What is the impact of the number of parallel environments (1 to 8192) on reinforcement learning performance?',
      tag: 'Scientific Question 1'
    },
    'alg_comparison': {
      title: 'Algorithm Comparison (Default Env Setup)',
      subtitle: 'Head-to-head comparison under standard canonical environment configurations (DQN: 1, Rainbow: 1, PPO: 8, PQN: 128).',
      tag: 'Scientific Question 2'
    },
    'vs_ale': {
      title: 'Framework Benchmark: JAXAtari vs ALE',
      subtitle: 'Direct side-by-side comparison between JAXAtari and Arcade Learning Environment (ALE) across equivalent parallel environment counts.',
      tag: 'Scientific Question 3'
    }
  };

  const currentTabInfo = pageTitles[compareTab] || pageTitles['jaxatari'];

  return (
    <div className="p-8 relative">
      <div className="flex items-center justify-between mb-8 pb-6 border-b border-[#2e334d]">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-3xl font-bold text-white tracking-tight">{currentTabInfo.title}</h1>
            <span className="badge py-0.5 px-2.5 bg-indigo-500/20 text-indigo-300 border-indigo-500/30 text-xs font-semibold">
              {currentTabInfo.tag}
            </span>
          </div>
          <p className="text-slate-400">
            {currentTabInfo.subtitle} <span className="text-indigo-400 font-medium">({selectedRuns.length} runs active)</span>
          </p>
        </div>
        
        <div className="flex items-center gap-4">
          {loading && <div className="badge animate-pulse border-indigo-500 text-indigo-400 bg-indigo-500/10">Syncing data...</div>}
        </div>
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
                Active: {sortGamesBy === 'name' ? 'Name' : sortGamesBy === '#Algorithms' ? '#Algorithms' : `Algorithm (${selectedSortAlgo})`}
              </span>
            </div>
            <div className="flex flex-col gap-4">
              <div className="filter-chip-group">
                <button
                  onClick={() => { setSortGamesBy('#Algorithms'); setSelectedSortAlgo(null); }}
                  className={`filter-chip ${sortGamesBy === '#Algorithms' ? 'active active-indigo' : ''}`}
                >
                  <span className="filter-chip-label"># Algorithms Available</span>
                </button>
                <button
                  onClick={() => { setSortGamesBy('name'); setSelectedSortAlgo(null); }}
                  className={`filter-chip ${sortGamesBy === 'name' ? 'active active-indigo' : ''}`}
                >
                  <span className="filter-chip-label">Name (Alphabetical)</span>
                </button>
              </div>

              {availableAlgorithms.length > 0 && (
                <div className="flex flex-col gap-2 pt-3 border-t border-[#2e334d]/60">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Filter By Algorithm Presence</span>
                    <span className="text-[10px] text-slate-500">(Only show environments where this algorithm was run)</span>
                  </div>
                  <div className="filter-chip-group">
                    {availableAlgorithms.map(algo => {
                      const isActive = sortGamesBy === 'Algorithm' && selectedSortAlgo === algo;
                      const color = getAlgorithmColor(algo);
                      return (
                        <button
                          key={algo}
                          onClick={() => {
                            if (isActive) {
                              setSortGamesBy('#Algorithms');
                              setSelectedSortAlgo(null);
                            } else {
                              setSortGamesBy('Algorithm');
                              setSelectedSortAlgo(algo);
                            }
                          }}
                          className={`filter-chip ${isActive ? 'active active-emerald' : ''}`}
                          style={isActive ? { borderColor: color, backgroundColor: `${color}25`, color: '#ffffff' } : {}}
                        >
                          <span className="w-2 h-2 rounded-full inline-block mr-1.5" style={{ backgroundColor: color }} />
                          <span className="filter-chip-label">{algo}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
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

        {Object.keys(runsByGame).length > 0 && (
          <div className="flex flex-col gap-6 relative">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 bg-indigo-500/20 rounded-lg border border-indigo-500/30">
                <BarChart2 className="w-6 h-6 text-indigo-400" />
              </div>
              <h2 className="text-2xl font-bold text-white">All Games Aggregate Performance</h2>
            </div>
            {aggregateMissingBaselines.length > 0 && (
              <div className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
                Excluded from normalized aggregate because no human/random baseline is available: {aggregateMissingBaselines.join(', ')}. Raw and normalized scores are never mixed.
              </div>
            )}

            {compareTab === 'vs_ale' ? (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Pixel-based Aggregate Panel */}
                <div className="panel flex flex-col group bg-[#16192b]">
                  <div className="flex items-center justify-between mb-6">
                    <div>
                      <h3 className="text-base font-semibold text-white tracking-wide">Pixel-based RL (All Selected Games)</h3>
                      <p className="text-xs text-slate-400">JAXAtari (Pixel) vs. ALE (In-house)</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <label className="flex items-center gap-2 cursor-pointer group/toggle">
                        <span className={`text-xs font-medium transition-colors ${aggFilterOutliers ? 'text-indigo-300' : 'text-slate-400'}`}>Filter Outliers</span>
                        <Toggle checked={aggFilterOutliers} onChange={setAggFilterOutliers} />
                      </label>
                      <div className="w-2 h-2 rounded-full bg-indigo-400 shadow-[0_0_8px_rgba(129,140,248,0.8)]" />
                    </div>
                  </div>
                  <div className="w-full">
                    <Plot
                      data={generateAggregateBoxPlotData(aggFilterOutliers, 'pixels') as any}
                      layout={{ ...layoutBase, yaxis: { ...layoutBase.yaxis, title: { text: 'Normalized Score', font: { color: '#64748b' } } } }}
                      useResizeHandler={true}
                      style={{ width: '100%', height: '400px' }}
                      config={{ responsive: true, displayModeBar: false }}
                    />
                  </div>
                </div>

                {/* Object-Centric (OC) Aggregate Panel */}
                <div className="panel flex flex-col group bg-[#16192b]">
                  <div className="flex items-center justify-between mb-6">
                    <div>
                      <h3 className="text-base font-semibold text-white tracking-wide">Object-Centric (OC) RL (All Selected Games)</h3>
                      <p className="text-xs text-slate-400">JAXAtari (OC) vs. OCAtari</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <label className="flex items-center gap-2 cursor-pointer group/toggle">
                        <span className={`text-xs font-medium transition-colors ${aggFilterOutliers ? 'text-indigo-300' : 'text-slate-400'}`}>Filter Outliers</span>
                        <Toggle checked={aggFilterOutliers} onChange={setAggFilterOutliers} />
                      </label>
                      <div className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]" />
                    </div>
                  </div>
                  <div className="w-full">
                    <Plot
                      data={generateAggregateBoxPlotData(aggFilterOutliers, 'oc') as any}
                      layout={{ ...layoutBase, yaxis: { ...layoutBase.yaxis, title: { text: 'Normalized Score', font: { color: '#64748b' } } } }}
                      useResizeHandler={true}
                      style={{ width: '100%', height: '400px' }}
                      config={{ responsive: true, displayModeBar: false }}
                    />
                  </div>
                </div>
              </div>
            ) : (
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
            )}
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
            compareTab={compareTab}
            scoreAxisLabel={hasBaseline(game) ? 'Human-normalized score' : 'Raw environment return (baseline unavailable)'}
          />
        ))}
      </div>
    </div>
  );
};

const GameSection = React.memo(({ game, gameRuns, runInfos, metricsData, setMetricsData, generatePlotData, generateBoxPlotData, layoutBase, compareTab, scoreAxisLabel }: any) => {
  const [expanded, setExpanded] = useState(false);
  const [loadingGameMetrics, setLoadingGameMetrics] = useState(false);
  const [filterOutliers, setFilterOutliers] = useState<boolean>(() => {
    const saved = localStorage.getItem(`outlier_filter_game_${game}`);
    return saved ? JSON.parse(saved) : false;
  });

  const numAlgos = React.useMemo(() => {
    return new Set(gameRuns.map((r: string) => runInfos[r]?.config?.method || 'Unknown')).size;
  }, [gameRuns, runInfos]);

  const pixelRuns = React.useMemo(() => {
    return gameRuns.filter((r: string) => {
      const info = runInfos[r];
      const obs = info?.obs_type || info?.config?.obs_type || 'pixels';
      return obs === 'pixels';
    });
  }, [gameRuns, runInfos]);

  const ocRuns = React.useMemo(() => {
    return gameRuns.filter((r: string) => {
      const info = runInfos[r];
      const obs = info?.obs_type || info?.config?.obs_type;
      return obs === 'oc';
    });
  }, [gameRuns, runInfos]);

  useEffect(() => {
    localStorage.setItem(`outlier_filter_game_${game}`, JSON.stringify(filterOutliers));
  }, [filterOutliers, game]);

  useEffect(() => {
    if (!expanded) return;
    let active = true;
    const loadMetrics = (forceRefresh: boolean) => {
      const targets = forceRefresh ? gameRuns : gameRuns.filter((id: string) => !metricsData[id]);
      if (targets.length === 0) return Promise.resolve();
      setLoadingGameMetrics(true);
      return Promise.all(
        targets.map((runId: string) =>
        fetchRunMetrics(runId, forceRefresh)
          .then(data => ({ runId, data }))
          .catch(() => ({ runId, data: [] }))
      )
    ).then(results => {
      if (!active) return;
      setMetricsData((prev: any) => {
        const next = { ...prev };
        results.forEach(res => { next[res.runId] = res.data; });
        return next;
      });
      setLoadingGameMetrics(false);
    });
    };
    loadMetrics(false);
    const timer = window.setInterval(() => { loadMetrics(true); }, 5_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
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

      {compareTab === 'vs_ale' ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Pixel-based Panel */}
          <div className="panel flex flex-col group bg-[#16192b]">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="text-base font-semibold text-white tracking-wide">Pixel-based RL</h3>
                <p className="text-xs text-slate-400">JAXAtari (Pixel) vs. ALE (In-house)</p>
              </div>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 cursor-pointer group/toggle">
                  <span className={`text-xs font-medium transition-colors ${filterOutliers ? 'text-indigo-300' : 'text-slate-400'}`}>Filter Outliers</span>
                  <Toggle checked={filterOutliers} onChange={setFilterOutliers} />
                </label>
                <div className="w-2 h-2 rounded-full bg-indigo-400 shadow-[0_0_8px_rgba(129,140,248,0.8)]" />
              </div>
            </div>
            <div className="w-full">
              {pixelRuns.length > 0 ? (
                <Plot
                  data={generateBoxPlotData(pixelRuns, game, filterOutliers) as any}
                  layout={{ ...layoutBase, yaxis: { ...layoutBase.yaxis, title: { text: scoreAxisLabel, font: { color: '#64748b' } } } }}
                  useResizeHandler={true}
                  style={{ width: '100%', height: '380px' }}
                  config={{ responsive: true, displayModeBar: false }}
                />
              ) : (
                <div className="h-[380px] flex items-center justify-center text-slate-500 text-sm">
                  No Pixel-based runs selected for {game}
                </div>
              )}
            </div>
          </div>

          {/* Object-Centric (OC) Panel */}
          <div className="panel flex flex-col group bg-[#16192b]">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="text-base font-semibold text-white tracking-wide">Object-Centric (OC) RL</h3>
                <p className="text-xs text-slate-400">JAXAtari (OC) vs. OCAtari</p>
              </div>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 cursor-pointer group/toggle">
                  <span className={`text-xs font-medium transition-colors ${filterOutliers ? 'text-indigo-300' : 'text-slate-400'}`}>Filter Outliers</span>
                  <Toggle checked={filterOutliers} onChange={setFilterOutliers} />
                </label>
                <div className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]" />
              </div>
            </div>
            <div className="w-full">
              {ocRuns.length > 0 ? (
                <Plot
                  data={generateBoxPlotData(ocRuns, game, filterOutliers) as any}
                  layout={{ ...layoutBase, yaxis: { ...layoutBase.yaxis, title: { text: scoreAxisLabel, font: { color: '#64748b' } } } }}
                  useResizeHandler={true}
                  style={{ width: '100%', height: '380px' }}
                  config={{ responsive: true, displayModeBar: false }}
                />
              ) : (
                <div className="h-[380px] flex items-center justify-center text-slate-500 text-sm">
                  No Object-Centric runs selected for {game}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="panel flex flex-col group">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-base font-semibold text-white tracking-wide">{scoreAxisLabel} distribution</h3>
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
              layout={{ ...layoutBase, yaxis: { ...layoutBase.yaxis, title: { text: scoreAxisLabel, font: { color: '#64748b' } } } }}
              useResizeHandler={true}
              style={{ width: '100%', height: '400px' }}
              config={{ responsive: true, displayModeBar: false }}
            />
          </div>
        </div>
      )}

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
                  layout={{ ...layoutBase, xaxis: { ...layoutBase.xaxis, title: { text: 'Primary Environment Steps', font: { color: '#64748b' } } }, yaxis: { ...layoutBase.yaxis, title: { text: 'Fitness', font: { color: '#64748b' } } } }}
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
                  layout={{ ...layoutBase, xaxis: { ...layoutBase.xaxis, title: { text: 'Primary Environment Steps', font: { color: '#64748b' } } }, yaxis: { ...layoutBase.yaxis, title: { text: 'Score', font: { color: '#64748b' } } } }}
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
                  layout={{ ...layoutBase, xaxis: { ...layoutBase.xaxis, title: { text: 'Primary Environment Steps', font: { color: '#64748b' } } }, yaxis: { ...layoutBase.yaxis, autorange: 'reversed' } }}
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
