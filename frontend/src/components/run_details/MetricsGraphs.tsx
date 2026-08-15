import React, { useState } from 'react';
import Plot from 'react-plotly.js';
import { Activity, Play, ChevronDown, ChevronUp } from 'lucide-react';

interface MetricsGraphsProps {
  metrics: any[];
}

export const MetricsGraphs: React.FC<MetricsGraphsProps> = ({ metrics }) => {
  const [showAllMetrics, setShowAllMetrics] = useState(false);

  if (!metrics || metrics.length === 0) return null;

  const preparePlot = (metric: string, color: string = '#818cf8', markerColor: string = '#6366f1', fillColor: string = 'rgba(99,102,241,0.05)') => {
    const x: number[] = [];
    const y: number[] = [];
    metrics.forEach(m => {
      const stepVal = m.gen ?? m.global_step ?? m.step ?? m._step ?? m.iteration;
      const metricVal = m[metric] ?? m['charts/' + metric] ?? m['charts/episodic_return'] ?? m['charts/episodic_game_return'] ?? m['eval/episodic_return_mod'] ?? m['episodic_return'] ?? m['reward'];
      if (stepVal !== undefined && metricVal !== undefined && metricVal !== null) {
        x.push(stepVal);
        y.push(metricVal);
      }
    });
    return [{ 
      x, y, type: 'scatter', mode: 'lines+markers', 
      line: { color, width: 2 }, 
      marker: { color: markerColor, size: 6, line: { color: '#000', width: 1 } },
      fill: 'tozeroy', fillcolor: fillColor
    }];
  };

  // Identify all available numeric metric keys (ignoring step/index/internal keys)
  const ignoreKeys = new Set(['gen', 'iteration', 'step', 'global_step', '_step', '_timestamp', '_runtime', 'Unnamed: 0', 'ret_mean', 'best_fitness']);
  const availableKeys = Array.from(
    new Set(metrics.flatMap(m => Object.keys(m)))
  ).filter(k => !ignoreKeys.has(k) && typeof metrics.find(m => m[k] !== undefined)?.[k] === 'number');

  // Key metrics to highlight if available
  const primaryMetrics = [
    { key: 'ret_mean', title: 'Reward / Return', color: '#34d399', fill: 'rgba(16,185,129,0.05)' },
    { key: 'best_fitness', title: 'Fitness Progress', color: '#818cf8', fill: 'rgba(99,102,241,0.05)' },
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
                  xaxis: { gridcolor: 'rgba(255,255,255,0.05)', tickfont: { color: '#64748b' } },
                  yaxis: { gridcolor: 'rgba(255,255,255,0.05)', tickfont: { color: '#64748b' } },
                  hovermode: 'closest'
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
                        xaxis: { gridcolor: 'rgba(255,255,255,0.05)', tickfont: { color: '#64748b' } },
                        yaxis: { gridcolor: 'rgba(255,255,255,0.05)', tickfont: { color: '#64748b' } },
                        hovermode: 'closest'
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
