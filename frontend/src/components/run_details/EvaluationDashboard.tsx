import React, { useMemo, useState } from 'react';
import Plot from 'react-plotly.js';
import { CheckCircle2, FlaskConical, ShieldAlert, XCircle } from 'lucide-react';
import type { EvaluationRecord } from '../../api';
import { RootConsistencyViewer } from './RootConsistencyViewer';

interface EvaluationDashboardProps {
  runId: string;
  evaluations: EvaluationRecord[];
}

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

export const EvaluationDashboard: React.FC<EvaluationDashboardProps> = ({ runId, evaluations }) => {
  const sorted = useMemo(() => [...evaluations].sort((a, b) => a.outer_iter - b.outer_iter), [evaluations]);
  const defaultIteration = sorted.find(row => row.is_final_champion)?.outer_iter ?? sorted.at(-1)?.outer_iter ?? 0;
  const [selectedIteration, setSelectedIteration] = useState(defaultIteration);
  const useInteractionAxis = sorted.length > 0 && sorted.every(row =>
    typeof row.optimizer_interactions?.cumulative_primary_env_steps === 'number' &&
    Number.isFinite(row.optimizer_interactions.cumulative_primary_env_steps)
  );
  const xValue = (row: EvaluationRecord) => useInteractionAxis
    ? row.optimizer_interactions!.cumulative_primary_env_steps!
    : row.outer_iter;

  if (!sorted.length) return null;

  const series = (name: string, selector: (row: EvaluationRecord) => number | undefined, color: string, dash = 'solid') => {
    const rows = sorted.filter(row => finite(selector(row)));
    return {
      x: rows.map(xValue), y: rows.map(selector), name,
      type: 'scatter', mode: 'lines+markers', line: { color, dash, width: 2 },
      marker: { size: 7, color },
      customdata: rows.map(row => [row.outer_iter, row.outer_accepted, row.is_final_champion,
        row.completion?.trace_label || 'completion unavailable']),
      hovertemplate: `${useInteractionAxis ? 'optimizer env steps %{x}' : 'outer iter %{x}'}<br>outer iter %{customdata[0]}<br>score %{y}<br>accepted %{customdata[1]}<br>final champion %{customdata[2]}<br>%{customdata[3]}<extra></extra>`,
    };
  };

  const noisyMean = series('Noisy mean', row => row.noisy?.mean, '#34d399');
  const noisyMin = series('Noisy minimum', row => row.noisy?.min, '#f87171');
  const cleanMean = series('Clean twin mean', row => row.clean?.mean, '#94a3b8', 'dash');
  const stickyMean = series('Sticky-action mean', row => row.sticky?.mean, '#fbbf24', 'dot');
  const deterministic = series('Logged localization rollout', row => row.deterministic_return, '#818cf8');

  return (
    <div className="panel flex flex-col gap-5">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--border-color)] pb-3">
        <div>
          <h2 className="text-sm font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
            <FlaskConical className="w-4 h-4 text-emerald-400" /> Report evaluation protocol
          </h2>
          <p className="text-xs text-slate-500 mt-1">Directly parsed from iterNN_eval.json; no Markdown/regex score inference.</p>
        </div>
        <select
          value={selectedIteration}
          onChange={event => setSelectedIteration(Number(event.target.value))}
          className="bg-[#0d101d] border border-[#2e334d] rounded-lg px-3 py-1.5 text-xs text-slate-300"
        >
          {sorted.map(row => <option key={row.outer_iter} value={row.outer_iter}>Iteration {row.outer_iter}</option>)}
        </select>
      </div>

      <div className="h-72 min-h-[288px]">
        <Plot
          data={[noisyMean, noisyMin, cleanMean, stickyMean, deterministic] as any}
          layout={{
            height: 288, paper_bgcolor: 'transparent', plot_bgcolor: 'transparent',
            margin: { t: 10, r: 10, l: 55, b: 40 },
            font: { color: '#94a3b8', family: 'Inter' },
            xaxis: { title: { text: useInteractionAxis
              ? 'Cumulative optimizer primary environment steps'
              : 'Outer iteration (interaction counts unavailable)' },
              ...(useInteractionAxis ? {} : { dtick: 1 }), gridcolor: 'rgba(255,255,255,0.05)' },
            yaxis: { title: { text: 'Environment return' }, gridcolor: 'rgba(255,255,255,0.05)', zeroline: true },
            legend: { orientation: 'h', y: -0.25 }, hovermode: 'closest',
          }}
          useResizeHandler style={{ width: '100%', height: '100%' }}
          config={{ displayModeBar: false, responsive: true }}
        />
      </div>

      <div className="overflow-x-auto custom-scrollbar">
        <table className="w-full text-xs text-slate-300">
          <thead className="text-[10px] uppercase tracking-wider text-slate-500">
            <tr>
              {['iter', 'accepted', 'noisy mean ± std', 'min-return episode', 'localization trace', 'completion', 'clean mean / min', 'sticky mean ± std', 'per-seed noisy returns'].map(label => (
                <th key={label} className="text-left px-2 py-2">{label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map(row => {
              const seedsDiffer = row.noisy?.min_return_seed !== undefined && row.noisy?.localization_seed !== undefined &&
                row.noisy.min_return_seed !== row.noisy.localization_seed;
              const scorePair = row.pong_score?.player !== undefined && row.pong_score?.enemy !== undefined
                ? `${row.pong_score.player}–${row.pong_score.enemy}` : null;
              const completionLabel = row.completion?.trace_label || 'completion unavailable';
              const completionSource = row.completion?.trace_source || 'unavailable';
              return (
                <tr key={row.outer_iter} className={`border-t border-[#252b40] ${row.outer_iter === selectedIteration ? 'bg-indigo-500/5' : ''}`}>
                  <td className="px-2 py-2 font-mono">{row.outer_iter}{row.is_final_champion ? ' ★' : ''}</td>
                  <td className="px-2 py-2" title={row.outer_accepted_source}>
                    {row.outer_accepted === true ? <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                      : row.outer_accepted === false ? <XCircle className="w-4 h-4 text-slate-500" /> : '—'}
                  </td>
                  <td className="px-2 py-2 font-mono">{finite(row.noisy?.mean) ? row.noisy.mean.toFixed(1) : '—'} ± {finite(row.noisy?.std) ? row.noisy.std.toFixed(1) : '—'}</td>
                  <td className="px-2 py-2 font-mono">seed {row.noisy?.min_return_seed ?? '—'} / {row.noisy?.min ?? '—'}</td>
                  <td className={`px-2 py-2 font-mono ${seedsDiffer ? 'text-amber-300' : ''}`} title="Selected by lexicographic progress, then return">
                    seed {row.noisy?.localization_seed ?? '—'} / {row.noisy?.localization_return ?? row.deterministic_return ?? '—'}
                    {scorePair && <span className="block text-[10px] text-slate-500">score {scorePair}</span>}
                    {seedsDiffer && <ShieldAlert className="inline w-3.5 h-3.5 ml-1" />}
                  </td>
                  <td className={`px-2 py-2 ${row.completion?.trace_truncated ? 'text-amber-300' : row.completion?.trace_terminated ? 'text-emerald-300' : 'text-slate-500'}`}
                      title={`source: ${completionSource}`}>
                    {completionLabel}
                    {row.trajectory?.decision_count !== undefined &&
                      <span className="block font-mono text-[10px] text-slate-500">{row.trajectory.decision_count} decisions</span>}
                  </td>
                  <td className="px-2 py-2 font-mono">{row.clean?.mean ?? '—'} / {row.clean?.min ?? '—'}</td>
                  <td className="px-2 py-2 font-mono">{finite(row.sticky?.mean) ? row.sticky.mean.toFixed(1) : '—'} ± {finite(row.sticky?.std) ? row.sticky.std.toFixed(1) : '—'}</td>
                  <td className="px-2 py-2 font-mono max-w-64 break-words">[{(row.noisy?.returns || []).join(', ')}]</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="text-[11px] text-slate-500">
        “Min-return episode” is the numeric minimum score. “Localization trace” is selected by the pipeline's progress-first lexicographic criterion and can be a different seed.
        {' '}A horizon-capped score is an incomplete episode, never a win; legacy completion inference is labelled separately.
        {' '}{useInteractionAxis
          ? 'Score evolution is plotted against cumulative optimizer primary environment steps.'
          : 'This legacy run has no interaction timeline, so the plot uses outer iteration.'}
      </div>

      <RootConsistencyViewer runId={runId} iteration={selectedIteration} />
    </div>
  );
};
