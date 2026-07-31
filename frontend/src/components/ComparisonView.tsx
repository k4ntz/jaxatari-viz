import React, { useEffect, useState } from 'react';
import Plot from 'react-plotly.js';
import { fetchRunMetrics, fetchRuns, fetchBaselines, type RunInfo, type BaselineInfo } from '../api';
import { LayoutGrid, Gamepad2, BarChart2, ChevronDown } from 'lucide-react';
import { Toggle } from './Toggle';

interface ComparisonProps {
  selectedRuns: string[];
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

const ComparisonView: React.FC<ComparisonProps> = ({ selectedRuns, theme = 'dark' }) => {
  const [metricsData, setMetricsData] = useState<Record<string, any[]>>({});
  const [runInfos, setRunInfos] = useState<Record<string, RunInfo>>({});
  const [loading, setLoading] = useState(false);
  const [baselinesMap, setBaselinesMap] = useState<Record<string, BaselineInfo>>({});
  const [groupBy, setGroupBy] = useState<string>('noise (all)');
  const [aggFilterOutliers, setAggFilterOutliers] = useState<boolean>(() => {
    const saved = localStorage.getItem(`outlier_filter_aggregate`);
    return saved ? JSON.parse(saved) : false;
  });

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

      // Fetch metrics data
      const dataMap: Record<string, any[]> = {};
      for (const runId of selectedRuns) {
        if (!metricsData[runId]) {
          try {
            const data = await fetchRunMetrics(runId);
            dataMap[runId] = data;
          } catch (e) {
            console.error(`Failed to load metrics for ${runId}`);
          }
        } else {
          dataMap[runId] = metricsData[runId];
        }
      }
      setMetricsData(prev => ({ ...prev, ...dataMap }));

      // Fetch baselines
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

  // Group selected runs by game
  const runsByGame: Record<string, string[]> = {};
  selectedRuns.forEach(runId => {
    const game = runInfos[runId]?.config?.game || 'Unknown Game';
    if (!runsByGame[game]) runsByGame[game] = [];
    runsByGame[game].push(runId);
  });

  const availableGroupKeys = [
    'method',
    'model',
    'seed',
    'noise (all)',
    'sigma0',
    'obs_noise_std',
    'epsilon_random'
  ];

  const getGroupValue = (runId: string, groupKey: string) => {
    const config = runInfos[runId]?.config || {};
    if (groupKey === 'seed') return config.cma_seed ?? 'N/A';
    if (groupKey === 'noise (all)') {
      return `sigma0: ${config.sigma0 ?? 0}, obs: ${config.obs_noise_std ?? 0}, eps: ${config.epsilon_random ?? 0}`;
    }
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
        if (item.gen !== undefined && item[metricKey] !== undefined) {
          x.push(item.gen);
          y.push(item[metricKey]);
          if (item.gen > maxX) maxX = item.gen;
        }
      }

      const color = colors[idx % colors.length];

      return {
        x,
        y,
        type: 'scatter',
        mode,
        name: runId,
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

  const generateBoxPlotData = (gameRuns: string[], game: string, applyFilter: boolean) => {
    const traces: Record<string, { y: number[], type: 'box', name: string, marker: { color: string }, boxpoints?: boolean | string }> = {};
    
    gameRuns.forEach(runId => {
      const groupVal = getGroupValue(runId, groupBy);
      const groupName = String(groupVal);
      
      const runData = metricsData[runId] || [];
      
      let maxScore = -Infinity;
      for (let i = 0; i < runData.length; i++) {
        const item = runData[i];
        if (item.ret_mean !== undefined) {
          maxScore = Math.max(maxScore, item.ret_mean);
        }
      }
      
      if (maxScore !== -Infinity) {
        if (!traces[groupName]) {
          traces[groupName] = {
            y: [],
            type: 'box',
            name: `${groupBy}: ${groupName}`,
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
        const groupVal = getGroupValue(runId, groupBy);
        const groupName = String(groupVal);
        
        const runData = metricsData[runId] || [];
        
        let maxScore = -Infinity;
        for (let i = 0; i < runData.length; i++) {
          const item = runData[i];
          if (item.ret_mean !== undefined) {
            maxScore = Math.max(maxScore, item.ret_mean);
          }
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
        name: `${groupBy}: ${groupName}`,
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
    margin: { t: 20, r: 20, l: 80, b: 40 },
    xaxis: { 
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
      y: -0.2,
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

      <div className="flex flex-col gap-16">
        <div className="flex items-center gap-4 bg-[rgba(0,0,0,0.2)] p-4 rounded-xl border border-[#2e334d] w-fit">
          <span className="text-sm font-medium text-slate-400">Group distributions by:</span>
          <select 
            value={groupBy} 
            onChange={(e) => setGroupBy(e.target.value)}
            className="bg-[#0f111a] border border-[#2e334d] text-slate-300 text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:border-indigo-500 transition-colors"
          >
            {availableGroupKeys.map(key => (
              <option key={key} value={key}>{key}</option>
            ))}
          </select>
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

        {Object.entries(runsByGame).map(([game, gameRuns]) => (
          <GameSection 
            key={game} 
            game={game} 
            gameRuns={gameRuns} 
            generatePlotData={generatePlotData} 
            generateBoxPlotData={generateBoxPlotData} 
            layoutBase={layoutBase} 
          />
        ))}
      </div>
    </div>
  );
};

const GameSection = ({ game, gameRuns, generatePlotData, generateBoxPlotData, layoutBase }: any) => {
  const [expanded, setExpanded] = useState(false);
  const [filterOutliers, setFilterOutliers] = useState<boolean>(() => {
    const saved = localStorage.getItem(`outlier_filter_game_${game}`);
    return saved ? JSON.parse(saved) : false;
  });

  useEffect(() => {
    localStorage.setItem(`outlier_filter_game_${game}`, JSON.stringify(filterOutliers));
  }, [filterOutliers, game]);

  return (
    <div className="flex flex-col gap-6 relative">
      <div 
        className="flex items-center gap-3 mb-2 cursor-pointer hover:bg-slate-800/50 p-3 rounded-xl transition-colors group"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="p-2 bg-indigo-500/20 rounded-lg border border-indigo-500/30">
          <Gamepad2 className="w-6 h-6 text-indigo-400" />
        </div>
        <h2 className="text-2xl font-bold text-white capitalize flex-1">{game}</h2>
        <span className="badge">{gameRuns.length} runs</span>
        <div className="flex items-center gap-2 ml-4">
          <span className="text-sm text-slate-400 group-hover:text-slate-300">Deeper Analysis</span>
          <ChevronDown className={`w-5 h-5 text-slate-400 transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </div>
      </div>

      <div className="panel flex flex-col group mt-2">
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
};

export default ComparisonView;
