import React, { useState } from 'react';
import Plot from 'react-plotly.js';
import { Activity, Play, ChevronDown, ChevronUp } from 'lucide-react';

interface MetricsGraphsProps {
  metrics: any[];
}

export const MetricsGraphs: React.FC<MetricsGraphsProps> = ({ metrics }) => {
  const [showAllMetrics, setShowAllMetrics] = useState(false);

  if (!metrics || metrics.length === 0) return null;

  const isCma = metrics.some(m => m.record_type === 'cma_generation');
  const inferredSeedSets = isCma && metrics.some(m => m.seed_set_inferred);
  const missingCmaDiagnostics = isCma
    ? Array.from(new Set(metrics.flatMap(m => Array.isArray(m.diagnostics_missing) ? m.diagnostics_missing : [])))
    : [];

  const preparePlot = (metric: string, color: string = '#818cf8', markerColor: string = '#6366f1', fillColor: string = 'rgba(99,102,241,0.05)') => {
    const x: number[] = [];
    const y: number[] = [];
    const customdata: any[] = [];
    metrics.forEach(m => {
      const stepVal = m.global_gen ?? m.global_step ?? m.step ?? m._step ?? m.iteration ?? m.gen;
      // A missing metric stays missing. Substituting episodic return/loss here silently
      // mixed units in a single trace and made scientific comparisons invalid.
      const metricVal = m[metric];
      if (stepVal !== undefined && metricVal !== undefined && metricVal !== null) {
        x.push(stepVal);
        y.push(metricVal);
        customdata.push([
          m.outer_iter,
          m.local_gen,
          m.search_seed_set_id ?? m.seed_set_id,
          m.monitor_seed_set_id,
          m.incumbent_updated ?? m.challenger_accepted,
        ]);
      }
    });
    return [{ 
      x, y, type: 'scatter', mode: 'lines+markers', 
      line: { color, width: 2 }, 
      marker: {
        color: isCma && metric === 'best_fitness'
          ? customdata.map(row => row[4] === true ? '#34d399' : row[4] === false ? '#f87171' : markerColor)
          : markerColor,
        size: isCma && metric === 'best_fitness' ? 8 : 6,
        line: { color: '#000', width: 1 },
      },
      fill: 'none', fillcolor: fillColor,
      customdata,
      hovertemplate: isCma
        ? 'global gen %{x}<br>value %{y}<br>outer iter %{customdata[0]} / local gen %{customdata[1]}<br>search seed set %{customdata[2]}<br>monitor seed set %{customdata[3]}<br>incumbent updated %{customdata[4]}<extra></extra>'
        : undefined,
    }];
  };

  const cmaFacetDecorations = (() => {
    if (!isCma) return { shapes: [], annotations: [] };
    const groups = new Map<number, number[]>();
    metrics.forEach(m => {
      if (typeof m.outer_iter !== 'number' || typeof m.global_gen !== 'number') return;
      groups.set(m.outer_iter, [...(groups.get(m.outer_iter) || []), m.global_gen]);
    });
    const entries = Array.from(groups.entries()).sort((a, b) => a[0] - b[0]);
    return {
      shapes: entries.slice(1).map(([, xs]) => ({
        type: 'line' as const,
        x0: Math.min(...xs) - 0.5, x1: Math.min(...xs) - 0.5,
        y0: 0, y1: 1, yref: 'paper' as const,
        line: { color: 'rgba(148,163,184,0.35)', width: 1, dash: 'dot' as const },
      })),
      annotations: entries.map(([outerIter, xs]) => ({
        x: (Math.min(...xs) + Math.max(...xs)) / 2, y: 1.04, yref: 'paper' as const,
        text: `outer ${outerIter}`, showarrow: false,
        font: { size: 9, color: '#64748b' },
      })),
    };
  })();

  // Identify all available numeric metric keys (ignoring step/index/internal keys)
  const ignoreKeys = new Set([
    'gen', 'local_gen', 'global_gen', 'outer_iter', 'iteration', 'iter', 'step', 'global_step', '_step',
    '_timestamp', '_runtime', 'Unnamed: 0', 'ret_mean', 'best_fitness', 'challenger_fitness',
    'schema_version', 'record_type', 'source_file', 'seed_set', 'seed_set_id', 'seed_set_inferred',
    'search_seeds', 'monitor_seeds', 'search_seed_set_id', 'monitor_seed_set_id',
    'challenger_accepted', 'incumbent_updated', 'diagnostics_available', 'diagnostics_missing',
    'param_schema_changed',
  ]);
  const availableKeys = Array.from(
    new Set(metrics.flatMap(m => Object.keys(m)))
  ).filter(k => !ignoreKeys.has(k) && typeof metrics.find(m => m[k] !== undefined)?.[k] === 'number');

  // Key metrics to highlight if available
  const primaryMetrics = [
    { key: 'best_fitness', title: 'Challenger Fitness', color: '#818cf8', fill: 'rgba(99,102,241,0.05)' },
    { key: 'incumbent_fitness', title: 'Incumbent Fitness (same seeds)', color: '#fbbf24', fill: 'rgba(251,191,36,0.05)' },
    { key: 'fitness_delta', title: 'Challenger − Incumbent', color: '#f472b6', fill: 'rgba(244,114,182,0.05)' },
    { key: 'mean_fitness', title: 'Population Mean Fitness', color: '#c084fc', fill: 'rgba(192,132,252,0.05)' },
    { key: 'ret_mean', title: 'Challenger Return (training seeds)', color: '#34d399', fill: 'rgba(16,185,129,0.05)' },
    { key: 'cma_sigma_before', title: 'CMA Sigma Before Update', color: '#38bdf8', fill: 'rgba(56,189,248,0.05)' },
    { key: 'cma_sigma_after', title: 'CMA Sigma After Update', color: '#22d3ee', fill: 'rgba(34,211,238,0.05)' },
    { key: 'cma_condition_number', title: 'CMA Condition Number', color: '#fb7185', fill: 'rgba(251,113,133,0.05)' },
    { key: 'population_coordinate_std_mean', title: 'Population Coordinate Std Mean', color: '#a78bfa', fill: 'rgba(167,139,250,0.05)' },
    { key: 'population_distance_from_incumbent_mean', title: 'Population Distance from Incumbent (Mean)', color: '#f59e0b', fill: 'rgba(245,158,11,0.05)' },
    { key: 'challenger_distance_from_incumbent', title: 'Challenger Distance from Incumbent', color: '#f472b6', fill: 'rgba(244,114,182,0.05)' },
    { key: 'boundary_parameter_fraction', title: 'Boundary Parameter Fraction', color: '#f87171', fill: 'rgba(248,113,113,0.05)' },
    { key: 'boundary_candidate_fraction', title: 'Boundary Candidate Fraction', color: '#fb923c', fill: 'rgba(251,146,60,0.05)' },
    { key: 'param_l2_step', title: 'Parameter Movement (L2)', color: '#38bdf8', fill: 'rgba(56,189,248,0.05)' },
    { key: 'losses/loss', title: 'Total Loss', color: '#f87171', fill: 'rgba(248,113,113,0.05)' },
    { key: 'losses/value_loss', title: 'Value Loss', color: '#f59e0b', fill: 'rgba(245,158,11,0.05)' },
    { key: 'losses/policy_loss', title: 'Policy Loss', color: '#a78bfa', fill: 'rgba(167,139,250,0.05)' },
    { key: 'charts/episodic_length', title: 'Episode Length', color: '#38bdf8', fill: 'rgba(56,189,248,0.05)' },
    { key: 'charts/SPS', title: 'Steps Per Second (SPS)', color: '#2dd4bf', fill: 'rgba(45,212,191,0.05)' },
  ];

  // Filter to metrics that actually exist in this run's data
  const plotsToRender = primaryMetrics.filter(p => 
    metrics.some(m => m[p.key] !== undefined && m[p.key] !== null)
  );

  // Add any remaining unclassified metrics
  availableKeys.forEach((key, idx) => {
    if (!primaryMetrics.some(p => p.key === key)) {
      const palette = ['#c084fc', '#f472b6', '#fbbf24', '#2dd4bf', '#a78bfa'];
      plotsToRender.push({
        key,
        title: key.replace(/^charts\//, '').replace(/^losses\//, '').replace(/_/g, ' '),
        color: palette[idx % palette.length],
        fill: 'rgba(255,255,255,0.03)'
      });
    }
  });

  const primaryPlots = plotsToRender.slice(0, 2);
  const extraPlots = plotsToRender.slice(2);

  return (
    <div className="panel flex flex-col gap-4">
      <div className="flex items-center justify-between border-b border-[var(--border-color)] pb-3">
        <h2 className="text-sm font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
          <Activity className="w-4 h-4 text-indigo-400" /> Training Metrics & Graphs ({plotsToRender.length})
        </h2>
      </div>

      {isCma && (
        <div className="text-[11px] text-slate-400 bg-[#0d101d] border border-[#2e334d] rounded-lg p-2">
          Green challenger markers beat the incumbent on the same seed set; red markers did not.
          {inferredSeedSets && ' Seed-set IDs are protocol-inferred because historical JSONL rows did not store seeds.'}
          {missingCmaDiagnostics.length > 0 && ` Not logged historically: ${missingCmaDiagnostics.join(', ')}.`}
        </div>
      )}

      {/* Primary 2 Graphs */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full">
        {primaryPlots.map(plotCfg => (
          <div key={plotCfg.key} className="panel flex flex-col border-slate-700/30 shadow-none overflow-hidden" style={{ minWidth: 0 }}>
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
                <Play className="w-3.5 h-3.5" style={{ color: plotCfg.color }} /> {plotCfg.title}
              </h2>
              <span className="text-[10px] text-slate-500 font-mono">{plotCfg.key}</span>
            </div>
            <div className="w-full h-56 min-h-[220px]">
              <Plot
                data={preparePlot(plotCfg.key, plotCfg.color, plotCfg.color, plotCfg.fill) as any}
                layout={{
                  height: 220,
                  paper_bgcolor: 'transparent',
                  plot_bgcolor: 'transparent',
                  margin: { t: 10, r: 10, l: 40, b: 30 },
                  font: { color: '#94a3b8', family: 'Inter' },
                  xaxis: { title: { text: isCma ? 'Global generation' : 'Step' }, gridcolor: 'rgba(255,255,255,0.05)', tickfont: { color: '#64748b' } },
                  yaxis: { gridcolor: 'rgba(255,255,255,0.05)', tickfont: { color: '#64748b' } },
                  hovermode: 'closest',
                  shapes: cmaFacetDecorations.shapes,
                  annotations: cmaFacetDecorations.annotations,
                }}
                useResizeHandler={true}
                style={{ width: '100%', height: '100%' }}
                config={{ displayModeBar: false, responsive: true }}
              />
            </div>
          </div>
        ))}
      </div>

      {/* Expandable Panel for Additional Graphs */}
      {extraPlots.length > 0 && (
        <div className="flex flex-col gap-4 mt-2">
          <button
            onClick={() => setShowAllMetrics(!showAllMetrics)}
            className="flex items-center justify-between w-full bg-[#16192b] hover:bg-[#1f243f] border border-[#2e334d] px-4 py-3 rounded-xl transition-colors text-sm font-semibold text-slate-300"
          >
            <span className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-indigo-400" />
              {showAllMetrics
                ? 'Hide Additional Metric Graphs'
                : `Show ${extraPlots.length} Additional Metric Graph${extraPlots.length > 1 ? 's' : ''}`}
            </span>
            {showAllMetrics ? (
              <ChevronUp className="w-4 h-4 text-slate-400" />
            ) : (
              <ChevronDown className="w-4 h-4 text-slate-400" />
            )}
          </button>

          {showAllMetrics && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full animate-in fade-in slide-in-from-top-2 duration-200">
              {extraPlots.map(plotCfg => (
                <div key={plotCfg.key} className="panel flex flex-col border-slate-700/30 shadow-none overflow-hidden" style={{ minWidth: 0 }}>
                  <div className="flex items-center justify-between mb-2">
                    <h2 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
                      <Play className="w-3.5 h-3.5" style={{ color: plotCfg.color }} /> {plotCfg.title}
                    </h2>
                    <span className="text-[10px] text-slate-500 font-mono">{plotCfg.key}</span>
                  </div>
                  <div className="w-full h-56 min-h-[220px]">
                    <Plot
                      data={preparePlot(plotCfg.key, plotCfg.color, plotCfg.color, plotCfg.fill) as any}
                      layout={{
                        height: 220,
                        paper_bgcolor: 'transparent',
                        plot_bgcolor: 'transparent',
                        margin: { t: 10, r: 10, l: 40, b: 30 },
                        font: { color: '#94a3b8', family: 'Inter' },
                        xaxis: { title: { text: isCma ? 'Global generation' : 'Step' }, gridcolor: 'rgba(255,255,255,0.05)', tickfont: { color: '#64748b' } },
                        yaxis: { gridcolor: 'rgba(255,255,255,0.05)', tickfont: { color: '#64748b' } },
                        hovermode: 'closest',
                        shapes: cmaFacetDecorations.shapes,
                        annotations: cmaFacetDecorations.annotations,
                      }}
                      useResizeHandler={true}
                      style={{ width: '100%', height: '100%' }}
                      config={{ displayModeBar: false, responsive: true }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
