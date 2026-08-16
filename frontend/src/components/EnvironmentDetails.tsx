import React, { useEffect, useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Plot from 'react-plotly.js';
import {
  fetchEnvironmentById,
  fetchBaselines,
  fetchComparisonSummary,
  fetchRunMetrics,
  type EnvironmentInfo,
  type BaselineInfo
} from '../api';
import {
  ArrowLeft,
  Gamepad2,
  ExternalLink,
  Film,
  Sliders,
  Activity,
  CheckSquare,
  Square,
  BarChart2,
  Layers,
  Award,
  ShieldCheck
} from 'lucide-react';

interface EnvironmentDetailsProps {
  selectedRuns: string[];
  setSelectedRuns: React.Dispatch<React.SetStateAction<string[]>>;
  theme?: string;
}

const LOCAL_STORAGE_FILTER_KEY = 'jaxatari_env_details_filters';

const FIXED_ALGO_COLORS: Record<string, string> = {
  'legps': '#818cf8',        // Indigo
  'ppo': '#34d399',          // Emerald
  'ppo baseline': '#8b5cf6', // Violet
  'dqn': '#38bdf8',          // Sky Blue
  'dqn baseline': '#ec4899', // Pink
  'cma-es': '#fbbf24',       // Amber
  'cmaes': '#fbbf24',
  'blendrl': '#f97316'       // Orange
};

const COLOR_PALETTE = [
  '#818cf8', '#34d399', '#c084fc', '#f472b6', '#fbbf24',
  '#38bdf8', '#f87171', '#a855f7', '#2dd4bf', '#fb923c'
];

const getAlgorithmColor = (name: string): string => {
  if (!name) return COLOR_PALETTE[0];
  const cleanName = name.toLowerCase().replace(/<br>/g, ' ').replace(/\s+/g, ' ').trim();
  if (FIXED_ALGO_COLORS[cleanName]) return FIXED_ALGO_COLORS[cleanName];
  for (const [key, color] of Object.entries(FIXED_ALGO_COLORS)) {
    if (cleanName.startsWith(key)) return color;
  }
  let hash = 0;
  for (let i = 0; i < cleanName.length; i++) {
    hash = (hash << 5) - hash + cleanName.charCodeAt(i);
    hash |= 0;
  }
  return COLOR_PALETTE[Math.abs(hash) % COLOR_PALETTE.length];
};

export const EnvironmentDetails: React.FC<EnvironmentDetailsProps> = ({
  selectedRuns,
  setSelectedRuns,
  theme = 'dark'
}) => {
  const { envId } = useParams<{ envId: string }>();
  const navigate = useNavigate();

  const [envInfo, setEnvInfo] = useState<EnvironmentInfo | null>(null);
  const [baselines, setBaselines] = useState<Record<string, BaselineInfo>>({});
  const [allRuns, setAllRuns] = useState<any[]>([]);
  const [metricsMap, setMetricsMap] = useState<Record<string, any[]>>({});
  const [loading, setLoading] = useState(true);

  // Filters & Sorting state (persisted to localStorage)
  const [savedFilters, setSavedFilters] = useState(() => {
    try {
      const stored = localStorage.getItem(LOCAL_STORAGE_FILTER_KEY);
      return stored
        ? JSON.parse(stored)
        : {
            selectedMethod: 'all',
            selectedObsType: 'all',
            selectedBackend: 'all',
            sortMetric: 'comparison_score',
            sortOrder: 'desc'
          };
    } catch {
      return {
        selectedMethod: 'all',
        selectedObsType: 'all',
        selectedBackend: 'all',
        sortMetric: 'comparison_score',
        sortOrder: 'desc'
      };
    }
  });

  const { selectedMethod, selectedObsType, selectedBackend, sortOrder } = savedFilters;
  const sortMetric = savedFilters.sortMetric === 'max_ret_mean' ? 'comparison_score' : savedFilters.sortMetric;

  const updateFilters = (newFilters: Partial<typeof savedFilters>) => {
    setSavedFilters((prev: any) => {
      const updated = { ...prev, ...newFilters };
      try {
        localStorage.setItem(LOCAL_STORAGE_FILTER_KEY, JSON.stringify(updated));
      } catch (e) {
        console.error('Failed to save filters to localStorage', e);
      }
      return updated;
    });
  };

  useEffect(() => {
    if (!envId) return;

    let isMounted = true;
    setLoading(true);

    Promise.all([
      fetchEnvironmentById(envId).catch(() => null),
      fetchBaselines().catch(() => []),
      fetchComparisonSummary().catch(() => [])
    ]).then(async ([envData, bData, summaryData]) => {
      if (!isMounted) return;

      setEnvInfo(envData);

      const bMap: Record<string, BaselineInfo> = {};
      bData.forEach(b => {
        bMap[b.game.toLowerCase()] = b;
        if (b.game.toLowerCase() === 'montezuma_revenge') {
          bMap['montezuma'] = b;
        }
      });
      setBaselines(bMap);

      // Filter runs belonging to this game
      const normalizedEnv = envId.replace(/-/g, '_').toLowerCase();
      const envRuns = summaryData.filter(
        (r: any) =>
          r.game?.toLowerCase() === normalizedEnv ||
          r.game?.toLowerCase().replace(/_/g, '') === normalizedEnv.replace(/_/g, '')
      );
      setAllRuns(envRuns);

      // Fetch metrics for all runs of this game
      const mPromises = envRuns.map((r: any) =>
        fetchRunMetrics(r.id)
          .then(m => ({ id: r.id, metrics: m }))
          .catch(() => ({ id: r.id, metrics: [] }))
      );
      const mResults = await Promise.all(mPromises);

      if (!isMounted) return;

      const mMap: Record<string, any[]> = {};
      mResults.forEach(res => {
        mMap[res.id] = res.metrics;
      });
      setMetricsMap(mMap);

      setLoading(false);
    });

    return () => {
      isMounted = false;
    };
  }, [envId]);

  // Method options available for this game
  const methods = useMemo(() => {
    return Array.from(new Set(allRuns.map((r: any) => r.method || r.config?.method || 'unknown'))).filter(Boolean);
  }, [allRuns]);

  // Filtered runs based on selectors
  const filteredRuns = useMemo(() => {
    return allRuns.filter((r: any) => {
      const matchesMethod = selectedMethod === 'all' || r.method === selectedMethod;
      const matchesObs = selectedObsType === 'all' || r.config?.obs_type === selectedObsType;
      const matchesBackend = selectedBackend === 'all' || r.config?.backend === selectedBackend;
      return matchesMethod && matchesObs && matchesBackend;
    });
  }, [allRuns, selectedMethod, selectedObsType, selectedBackend]);

  // Sorted runs
  const sortedRuns = useMemo(() => {
    return [...filteredRuns].sort((a: any, b: any) => {
      let valA = a[sortMetric] ?? -Infinity;
      let valB = b[sortMetric] ?? -Infinity;
      if (typeof valA === 'string') valA = valA.toLowerCase();
      if (typeof valB === 'string') valB = valB.toLowerCase();
      if (valA < valB) return sortOrder === 'asc' ? -1 : 1;
      if (valA > valB) return sortOrder === 'asc' ? 1 : -1;
      return 0;
    });
  }, [filteredRuns, sortMetric, sortOrder]);

  // Box plot data for On JAXAtari
  const jaxatariBoxData = useMemo(() => {
    const jaxRuns = sortedRuns.filter((r: any) => (r.config?.backend || 'jaxatari') === 'jaxatari');
    const methodValues: Record<string, number[]> = {};

    jaxRuns.forEach((run: any) => {
      const method = run.method || run.config?.method || 'Unknown';
      const ret = run.comparison_score;
      if (ret !== undefined && ret !== null) {
        if (!methodValues[method]) methodValues[method] = [];
        methodValues[method].push(ret);
      }
    });

    return Object.keys(methodValues).map(method => ({
      y: methodValues[method],
      type: 'box',
      name: method,
      marker: { color: getAlgorithmColor(method) },
      boxpoints: 'outliers'
    }));
  }, [sortedRuns]);

  // Box plot data for JAXAtari vs ALE
  const vsAleBoxData = useMemo(() => {
    const methodValues: Record<string, number[]> = {};

    sortedRuns.forEach((run: any) => {
      const method = run.method || run.config?.method || 'Unknown';
      const ret = run.comparison_score;
      if (ret !== undefined && ret !== null) {
        if (!methodValues[method]) methodValues[method] = [];
        methodValues[method].push(ret);
      }
    });

    const traces: any[] = Object.keys(methodValues).map(method => ({
      y: methodValues[method],
      type: 'box',
      name: `JAXAtari: ${method}`,
      marker: { color: getAlgorithmColor(method) },
      boxpoints: 'outliers'
    }));

    return traces;
  }, [sortedRuns, envInfo]);

  // Score Evolution Line Plot (Aggregated across seeds) for On JAXAtari
  const jaxatariAggLineData = useMemo(() => {
    const jaxRuns = sortedRuns.filter((r: any) => (r.config?.backend || 'jaxatari') === 'jaxatari');
    const methodSteps: Record<string, Record<number, number[]>> = {};

    jaxRuns.forEach((run: any) => {
      const method = run.method || run.config?.method || 'Unknown';
      const mList = metricsMap[run.id] || [];

      if (!methodSteps[method]) methodSteps[method] = {};

      mList.forEach((m: any) => {
        const step = m.global_gen ?? m.global_step ?? m.step ?? m._step ?? m.iteration ?? m.gen;
        const ret = m.ret_mean;
        if (step !== undefined && ret !== undefined && ret !== null) {
          if (!methodSteps[method][step]) methodSteps[method][step] = [];
          methodSteps[method][step].push(ret);
        }
      });
    });

    const traces: any[] = [];
    Object.keys(methodSteps).forEach(method => {
      const steps = Object.keys(methodSteps[method])
        .map(Number)
        .sort((a, b) => a - b);

      const x: number[] = [];
      const yMean: number[] = [];

      steps.forEach(s => {
        const vals = methodSteps[method][s];
        if (vals.length > 0) {
          x.push(s);
          const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
          yMean.push(mean);
        }
      });

      const color = getAlgorithmColor(method);
      traces.push({
        x,
        y: yMean,
        type: 'scatter',
        mode: 'lines+markers',
        name: `${method} (Seed Mean)`,
        line: { color, width: 2.5 },
        marker: { color, size: 5 }
      });
    });

    return traces;
  }, [sortedRuns, metricsMap]);

  // Score Evolution Line Plot (Aggregated across seeds) for JAXAtari vs ALE
  const vsAleAggLineData = useMemo(() => {
    const methodSteps: Record<string, Record<number, number[]>> = {};

    sortedRuns.forEach((run: any) => {
      const method = run.method || run.config?.method || 'Unknown';
      const mList = metricsMap[run.id] || [];

      if (!methodSteps[method]) methodSteps[method] = {};

      mList.forEach((m: any) => {
        const step = m.global_gen ?? m.global_step ?? m.step ?? m._step ?? m.iteration ?? m.gen;
        const ret = m.ret_mean;
        if (step !== undefined && ret !== undefined && ret !== null) {
          if (!methodSteps[method][step]) methodSteps[method][step] = [];
          methodSteps[method][step].push(ret);
        }
      });
    });

    const traces: any[] = [];
    Object.keys(methodSteps).forEach(method => {
      const steps = Object.keys(methodSteps[method])
        .map(Number)
        .sort((a, b) => a - b);

      const x: number[] = [];
      const yMean: number[] = [];

      steps.forEach(s => {
        const vals = methodSteps[method][s];
        if (vals.length > 0) {
          x.push(s);
          const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
          yMean.push(mean);
        }
      });

      const color = getAlgorithmColor(method);
      traces.push({
        x,
        y: yMean,
        type: 'scatter',
        mode: 'lines+markers',
        name: `JAXAtari: ${method}`,
        line: { color, width: 2.5 },
        marker: { color, size: 5 }
      });
    });

    return traces;
  }, [sortedRuns, metricsMap, envInfo]);

  if (loading) {
    return (
      <div className="p-6 flex flex-col items-center justify-center h-full gap-3 text-slate-400">
        <Gamepad2 className="w-8 h-8 animate-pulse text-indigo-400" />
        <span className="font-medium text-base">Loading environment profile...</span>
      </div>
    );
  }

  if (!envInfo) {
    return (
      <div className="p-6 flex flex-col items-center justify-center h-full text-slate-400">
        <h2 className="text-xl font-bold text-white mb-2">Environment Not Found</h2>
        <p className="mb-4 text-xs">The requested environment profile could not be located.</p>
        <button
          onClick={() => navigate('/environments')}
          className="panel-btn flex items-center gap-2 text-indigo-400 border border-indigo-500/30 px-3 py-1.5 rounded-lg text-xs"
        >
          <ArrowLeft className="w-4 h-4" /> Return to Environments
        </button>
      </div>
    );
  }

  const baseline = baselines[envInfo.id.toLowerCase()] || baselines[envInfo.name.toLowerCase()];

  const isDark = theme === 'dark';
  const gridColor = isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.08)';
  const zeroLineColor = isDark ? 'rgba(255, 255, 255, 0.15)' : 'rgba(0, 0, 0, 0.15)';
  const fontColor = isDark ? '#94a3b8' : '#475569';
  const tickColor = isDark ? '#64748b' : '#475569';

  // Shared layout configuration for theme-aware grid lines across all charts
  const layoutBase = {
    paper_bgcolor: 'transparent',
    plot_bgcolor: 'transparent',
    font: { color: fontColor, family: 'Inter, sans-serif', size: 11 },
    xaxis: {
      showgrid: true,
      gridcolor: gridColor,
      gridwidth: 1,
      zeroline: true,
      zerolinecolor: zeroLineColor,
      tickfont: { color: tickColor }
    },
    yaxis: {
      showgrid: true,
      gridcolor: gridColor,
      gridwidth: 1,
      zeroline: true,
      zerolinecolor: zeroLineColor,
      tickfont: { color: tickColor }
    },
    legend: { orientation: 'h' as const, y: -0.15, font: { color: isDark ? '#cbd5e1' : '#334155', size: 10 } },
    hovermode: 'closest' as const,
    hoverlabel: {
      bgcolor: isDark ? '#12141F' : '#ffffff',
      bordercolor: isDark ? 'rgba(255, 255, 255, 0.2)' : 'rgba(0, 0, 0, 0.15)',
      font: { family: 'Inter', color: isDark ? '#fff' : '#0f172a' }
    }
  };

  return (
    <div className="p-4 relative max-w-[1800px] mx-auto flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center gap-4 pb-3 border-b border-[#2e334d]">
        <button
          onClick={() => navigate('/environments')}
          className="panel-btn w-9 h-9 flex items-center justify-center border rounded-lg transition-all hover:bg-indigo-500/10 hover:border-indigo-500/40 text-slate-300"
        >
          <ArrowLeft className="w-4 h-4 text-indigo-400" />
        </button>
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-extrabold text-white tracking-tight">{envInfo.name}</h1>
            <span className="badge text-[10px] px-2 py-0.5 bg-slate-800 border border-slate-700 text-slate-300 font-mono">
              {envInfo.id}
            </span>
            <span className="badge text-xs px-2.5 py-0.5 bg-indigo-500/10 border border-indigo-500/30 text-indigo-300 font-bold">
              {envInfo.status}
            </span>
          </div>
          <p className="text-[11px] text-slate-400 mt-0.5">
            Category: <span className="text-purple-300 font-medium">{envInfo.category}</span> &bull; {envInfo.mods_count} Game Modifications Available
          </p>
        </div>
      </div>

      {/* Top Grid: Left Side (GIF + Stacked Rows, ~25% width) vs Right Side (Description + ONLY On JAXAtari Performance, ~75% width) */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-8 items-stretch">
        {/* Left Column (3/12 cols = 25% width): GIF Preview + Stacked Stats Rows */}
        <div className="md:col-span-3 flex flex-col gap-3 pr-4 md:border-r md:border-[#2e334d]/60">
          {/* GIF Preview */}
          <div className="bg-[#16192b] border border-[#2e334d] p-2.5 rounded-xl shadow-lg flex flex-col items-center">
            <div className="w-full h-44 bg-[#0f111a] border border-[#2e334d] rounded-lg overflow-hidden flex items-center justify-center relative shadow-inner">
              {envInfo.has_gif ? (
                <img
                  src={envInfo.gif_url || undefined}
                  alt={envInfo.name}
                  className="h-full w-full object-contain"
                />
              ) : (
                <div className="flex flex-col items-center gap-1.5 text-slate-600">
                  <Film className="w-6 h-6 opacity-40" />
                  <span className="text-[10px] italic">No preview GIF</span>
                </div>
              )}
            </div>
          </div>

          {/* Stacked Rows for MODS & BASELINES */}
          <div className="bg-[#16192b] border border-[#2e334d] p-3 rounded-xl shadow-lg flex flex-col gap-2 text-xs">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Environment Metrics</span>

            {/* MODS Row */}
            <div className="p-2 bg-[#0f111a] border border-[#2e334d] rounded-lg flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-slate-300 font-bold uppercase tracking-wider text-[10px]">
                <Layers className="w-3.5 h-3.5 text-purple-400" /> MODS
              </div>
              <span className="text-xs font-extrabold text-purple-300">{envInfo.mods_count} Mods</span>
            </div>

            {/* HUMAN BASELINE Row */}
            <div className="p-2 bg-[#0f111a] border border-[#2e334d] rounded-lg flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-slate-300 font-bold uppercase tracking-wider text-[10px]">
                <Award className="w-3.5 h-3.5 text-emerald-400" /> HUMAN BASELINE
              </div>
              <span className="text-xs font-extrabold text-emerald-400">{baseline?.human ?? 'N/A'}</span>
            </div>

            {/* PPO BASELINE Row */}
            <div className="p-2 bg-[#0f111a] border border-[#2e334d] rounded-lg flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-slate-300 font-bold uppercase tracking-wider text-[10px]">
                <Activity className="w-3.5 h-3.5 text-indigo-400" /> PPO BASELINE
              </div>
              <span className="text-xs font-extrabold text-indigo-400">{baseline?.ppo ?? 'N/A'}</span>
            </div>

            {/* DQN BASELINE Row */}
            <div className="p-2 bg-[#0f111a] border border-[#2e334d] rounded-lg flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-slate-300 font-bold uppercase tracking-wider text-[10px]">
                <BarChart2 className="w-3.5 h-3.5 text-sky-400" /> DQN BASELINE
              </div>
              <span className="text-xs font-extrabold text-sky-400">{baseline?.dqn ?? 'N/A'}</span>
            </div>
          </div>
        </div>

        {/* Right Column (9/12 cols = 75% width): Description + ONLY On JAXAtari Performance Bar Plot */}
        <div className="md:col-span-9 flex flex-col gap-4 h-full">
          {/* Environment Description Card */}
          <div className="bg-[#16192b] border border-[#2e334d] p-4 rounded-xl flex flex-col gap-2 shadow-lg shrink-0">
            <div className="flex items-center justify-between border-b border-[#2e334d] pb-2">
              <h2 className="text-xs font-bold uppercase tracking-wider text-indigo-400 flex items-center gap-1.5">
                <Gamepad2 className="w-3.5 h-3.5" /> Environment Description
              </h2>
              <div className="flex items-center gap-2">
                {/* Technical Verification Link Button next to Environment Description */}
                <button
                  onClick={() => navigate(`/environment/${envInfo.id}/verif`)}
                  className="inline-flex items-center gap-1 text-[11px] text-indigo-300 hover:text-indigo-200 bg-indigo-500/10 hover:bg-indigo-500/20 px-2.5 py-0.5 rounded-md border border-indigo-500/30 transition-all"
                  title="View full ALE technical verification report"
                >
                  <ShieldCheck className="w-3 h-3" /> ALE Technical Verification
                </button>

                {envInfo.farama_url && (
                  <a
                    href={envInfo.farama_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] text-indigo-300 hover:text-indigo-200 bg-indigo-500/10 hover:bg-indigo-500/20 px-2.5 py-0.5 rounded-md border border-indigo-500/30 transition-all"
                  >
                    <ExternalLink className="w-3 h-3" /> Farama Docs
                  </a>
                )}
              </div>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed bg-[#0d0e17] border border-[#2e334d] p-3 rounded-lg shadow-inner">
              {envInfo.summary || `${envInfo.name} is an Atari 2600 game environment supported in JAXAtari.`}
            </p>
          </div>

          {/* On JAXAtari Performance Distribution (Dynamically Fills Available Right Side Height with Grid Active) */}
          <div className="bg-[#16192b] border border-[#2e334d] p-4 rounded-xl flex flex-col gap-2 shadow-lg flex-1 min-h-[220px]">
            <div className="flex items-center justify-between border-b border-[#2e334d] pb-2 shrink-0">
              <h2 className="text-xs font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-1.5">
                <BarChart2 className="w-3.5 h-3.5" /> On JAXAtari Performance
              </h2>
              <span className="text-[11px] text-slate-400">{jaxatariBoxData.length} Algorithms</span>
            </div>
            <div className="w-full flex-1 min-h-0 relative">
              <Plot
                data={jaxatariBoxData as any}
                layout={{
                  ...layoutBase,
                  autosize: true,
                  margin: { t: 15, r: 20, l: 50, b: 40 },
                  yaxis: { ...layoutBase.yaxis, title: 'Score / Return' }
                }}
                useResizeHandler={true}
                style={{ width: '100%', height: '100%', minHeight: '180px' }}
                config={{ displayModeBar: false, responsive: true }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Full-Width Section Below: All 3 Other Graphs Stacked Vertically with Doubled Vertical Height (700px) & Active Grid Lines */}
      <div className="flex flex-col gap-6">
        {/* Graph 1: JAXAtari vs ALE Performance Distribution */}
        <div className="bg-[#16192b] border border-[#2e334d] p-5 rounded-xl flex flex-col gap-3 shadow-lg">
          <div className="flex items-center justify-between border-b border-[#2e334d] pb-2">
            <h2 className="text-xs font-bold uppercase tracking-wider text-purple-400 flex items-center gap-1.5">
              <BarChart2 className="w-4 h-4" /> JAXAtari vs. ALE Performance
            </h2>
            <span className="text-[11px] text-slate-400">{vsAleBoxData.length} Series</span>
          </div>
          <div className="w-full h-[700px]">
            <Plot
              data={vsAleBoxData as any}
              layout={{
                ...layoutBase,
                height: 680,
                margin: { t: 20, r: 20, l: 55, b: 50 },
                font: { ...layoutBase.font, size: 12 },
                yaxis: { ...layoutBase.yaxis, title: 'Score / Return' }
              }}
              useResizeHandler={true}
              style={{ width: '100%', height: '100%' }}
              config={{ displayModeBar: false, responsive: true }}
            />
          </div>
        </div>

        {/* Graph 2: On JAXAtari Score Evolution Line Plot (Seed Aggregated) */}
        <div className="bg-[#16192b] border border-[#2e334d] p-5 rounded-xl flex flex-col gap-3 shadow-lg">
          <div className="flex items-center justify-between border-b border-[#2e334d] pb-2">
            <h2 className="text-xs font-bold uppercase tracking-wider text-indigo-400 flex items-center gap-1.5">
              <Activity className="w-4 h-4" /> On JAXAtari Evolution (Seed Aggregated)
            </h2>
            <span className="text-[11px] text-slate-400">{jaxatariAggLineData.length} Methods</span>
          </div>
          <div className="w-full h-[700px]">
            <Plot
              data={jaxatariAggLineData as any}
              layout={{
                ...layoutBase,
                height: 680,
                margin: { t: 20, r: 20, l: 55, b: 50 },
                font: { ...layoutBase.font, size: 12 },
                xaxis: { ...layoutBase.xaxis, title: 'Generations / Steps' },
                yaxis: { ...layoutBase.yaxis, title: 'Mean Return / Fitness' }
              }}
              useResizeHandler={true}
              style={{ width: '100%', height: '100%' }}
              config={{ displayModeBar: false, responsive: true }}
            />
          </div>
        </div>

        {/* Graph 3: JAXAtari vs ALE Score Evolution Line Plot (Seed Aggregated) */}
        <div className="bg-[#16192b] border border-[#2e334d] p-5 rounded-xl flex flex-col gap-3 shadow-lg">
          <div className="flex items-center justify-between border-b border-[#2e334d] pb-2">
            <h2 className="text-xs font-bold uppercase tracking-wider text-sky-400 flex items-center gap-1.5">
              <Activity className="w-4 h-4" /> JAXAtari vs. ALE Evolution (Seed Aggregated)
            </h2>
            <span className="text-[11px] text-slate-400">{vsAleAggLineData.length} Series</span>
          </div>
          <div className="w-full h-[700px]">
            <Plot
              data={vsAleAggLineData as any}
              layout={{
                ...layoutBase,
                height: 680,
                margin: { t: 20, r: 20, l: 55, b: 50 },
                font: { ...layoutBase.font, size: 12 },
                xaxis: { ...layoutBase.xaxis, title: 'Generations / Steps' },
                yaxis: { ...layoutBase.yaxis, title: 'Mean Return / Fitness' }
              }}
              useResizeHandler={true}
              style={{ width: '100%', height: '100%' }}
              config={{ displayModeBar: false, responsive: true }}
            />
          </div>
        </div>
      </div>

      {/* Full-Width Section Below: Selectors & Filters */}
      <div className="bg-[#16192b] border border-[#2e334d] p-4 rounded-xl flex flex-col gap-4 shadow-lg">
        <div className="flex items-center justify-between border-b border-[#2e334d] pb-3">
          <div className="flex items-center gap-2">
            <Sliders className="w-4 h-4 text-indigo-400" />
            <h2 className="text-sm font-bold text-white tracking-wide">Run Selection & Ranking Controls</h2>
          </div>
          <span className="text-[11px] text-slate-400 font-mono">{sortedRuns.length} Matching Runs</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 text-xs">
          {/* Method Filter */}
          <div className="flex flex-col gap-1">
            <label className="text-slate-400 uppercase font-bold tracking-wider text-[10px]">Algorithm / Method</label>
            <select
              value={selectedMethod}
              onChange={e => updateFilters({ selectedMethod: e.target.value })}
              className="bg-[rgba(0,0,0,0.3)] border border-[#2e334d] rounded-lg px-2.5 py-1.5 text-white focus:outline-none focus:border-indigo-500"
            >
              <option value="all">All Methods</option>
              {methods.map((m: any) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>

          {/* Observation Type */}
          <div className="flex flex-col gap-1">
            <label className="text-slate-400 uppercase font-bold tracking-wider text-[10px]">Obs Type</label>
            <select
              value={selectedObsType}
              onChange={e => updateFilters({ selectedObsType: e.target.value })}
              className="bg-[rgba(0,0,0,0.3)] border border-[#2e334d] rounded-lg px-2.5 py-1.5 text-white focus:outline-none focus:border-indigo-500"
            >
              <option value="all">All Obs Types</option>
              <option value="pixels">Pixels</option>
              <option value="oc">OC (Object-Centric)</option>
            </select>
          </div>

          {/* Metric Sort */}
          <div className="flex flex-col gap-1">
            <label className="text-slate-400 uppercase font-bold tracking-wider text-[10px]">Sort Metric</label>
            <select
              value={sortMetric}
              onChange={e => updateFilters({ sortMetric: e.target.value })}
              className="bg-[rgba(0,0,0,0.3)] border border-[#2e334d] rounded-lg px-2.5 py-1.5 text-white focus:outline-none focus:border-indigo-500"
            >
              <option value="comparison_score">Protocol comparison score</option>
              <option value="max_best_fitness">Max Best Fitness</option>
              <option value="min_y_best">Min Best Loss / Cost</option>
              <option value="id">Run ID</option>
            </select>
          </div>

          {/* Sort Order */}
          <div className="flex flex-col gap-1">
            <label className="text-slate-400 uppercase font-bold tracking-wider text-[10px]">Sort Order</label>
            <select
              value={sortOrder}
              onChange={e => updateFilters({ sortOrder: e.target.value as 'asc' | 'desc' })}
              className="bg-[rgba(0,0,0,0.3)] border border-[#2e334d] rounded-lg px-2.5 py-1.5 text-white focus:outline-none focus:border-indigo-500"
            >
              <option value="desc">Descending (High to Low)</option>
              <option value="asc">Ascending (Low to High)</option>
            </select>
          </div>
        </div>

        {/* Selected Runs Table / Checklist */}
        <div className="flex flex-col gap-2 border-t border-[#2e334d] pt-3">
          <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Available Runs for {envInfo.name}</span>
          <div className="max-h-52 overflow-y-auto custom-scrollbar flex flex-col gap-1.5 pr-1">
            {sortedRuns.map((run: any) => {
              const isSelected = selectedRuns.includes(run.id);
              return (
                <div
                  key={run.id}
                  onClick={() => {
                    setSelectedRuns(prev =>
                      isSelected ? prev.filter(id => id !== run.id) : [...prev, run.id]
                    );
                  }}
                  className={`p-2.5 rounded-lg border flex items-center justify-between cursor-pointer transition-all ${
                    isSelected
                      ? 'bg-indigo-500/10 border-indigo-500/50 text-white'
                      : 'bg-[#0f111a] border-[#2e334d] text-slate-300 hover:border-slate-600'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    {isSelected ? (
                      <CheckSquare className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                    ) : (
                      <Square className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                    )}
                    <div className="flex flex-col">
                      <span className="text-xs font-bold">{run.id}</span>
                      <span className="text-[10px] text-slate-400">
                        Method: <strong className="text-purple-300">{run.method}</strong> &bull; Model: {run.model}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 text-xs font-mono">
                    {run.comparison_score !== null && run.comparison_score !== undefined && (
                      <span className="text-emerald-400 font-bold" title={run.comparison_score_source}>Score: {run.comparison_score}</span>
                    )}
                    {run.max_best_fitness !== null && (
                      <span className="text-indigo-400 font-bold">Fit: {run.max_best_fitness}</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

export default EnvironmentDetails;
