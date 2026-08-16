import React, { useState } from 'react';
import { RunHeader } from './RunHeader';
import { MetricsGraphs } from './MetricsGraphs';
import { LeGPSLogViewer } from './LeGPSLogViewer';
import { Sparkles, Dna, Cpu } from 'lucide-react';
import type { RunDetailProps } from './DefaultRunDetails';
import { EvaluationDashboard } from './EvaluationDashboard';

export const LeGPSRunDetails: React.FC<RunDetailProps> = ({ runInfo, metrics, logs, evaluations = [] }) => {
  const [showConfig, setShowConfig] = useState(false);

  return (
    <div className="p-8 flex flex-col h-full overflow-y-auto custom-scrollbar relative">
      <RunHeader
        runInfo={runInfo}
        showConfig={showConfig}
        setShowConfig={setShowConfig}
        tagColor="emerald"
      />

      <div className="flex flex-col gap-6 relative" style={{ zIndex: 1 }}>
        {/* LeGPS Evolution & LLM Summary Banner */}
        <div className="panel bg-[#12162a] border border-indigo-500/30 p-4 rounded-xl flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white flex items-center gap-2">
                LeGPS Evolutionary Run
                <span className="badge text-[10px] bg-indigo-500/10 border border-indigo-500/30 text-indigo-300">
                  CMA-ES + LLM
                </span>
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Language-guided evolutionary policy search with failure localization and parameter optimization.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 text-xs">
            {runInfo.config.popsize && (
              <div className="flex items-center gap-1.5 bg-[#0e101a] border border-[#2e334d] px-3 py-1.5 rounded-lg text-slate-300 font-mono">
                <Dna className="w-3.5 h-3.5 text-purple-400" />
                <span>Pop: {runInfo.config.popsize}</span>
              </div>
            )}
            {runInfo.config.cma_seed !== undefined && (
              <div className="flex items-center gap-1.5 bg-[#0e101a] border border-[#2e334d] px-3 py-1.5 rounded-lg text-slate-300 font-mono">
                <Cpu className="w-3.5 h-3.5 text-emerald-400" />
                <span>Seed {runInfo.config.cma_seed}</span>
              </div>
            )}
          </div>
        </div>

        {/* Metric Curves */}
        <MetricsGraphs metrics={metrics} />

        <EvaluationDashboard runId={runInfo.id} evaluations={evaluations} />

        {/* LeGPS Rich Interactive Markdown Logs & Iteration Rollout Video Players */}
        <LeGPSLogViewer logs={logs} runId={runInfo.id} evaluations={evaluations} />
      </div>
    </div>
  );
};

export default LeGPSRunDetails;
