import React, { useState } from 'react';
import { RunHeader } from './RunHeader';
import { MetricsGraphs } from './MetricsGraphs';
import { RawLogViewer } from './RawLogViewer';
import { Layers, Network } from 'lucide-react';
import type { RunDetailProps } from './DefaultRunDetails';

export const BlendRLRunDetails: React.FC<RunDetailProps> = ({ runInfo, metrics, logs }) => {
  const [showConfig, setShowConfig] = useState(false);

  return (
    <div className="p-8 flex flex-col h-full overflow-y-auto custom-scrollbar relative">
      <RunHeader
        runInfo={runInfo}
        showConfig={showConfig}
        setShowConfig={setShowConfig}
        tagColor="orange"
      />

      <div className="flex flex-col gap-6 relative" style={{ zIndex: 1 }}>
        {/* BlendRL Summary Banner */}
        <div className="panel bg-[#151928] border border-orange-500/30 p-4 rounded-xl flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-orange-500/10 border border-orange-500/30 flex items-center justify-center text-orange-400">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white flex items-center gap-2">
                BlendRL Policy Blending Run
                <span className="badge text-[10px] bg-orange-500/10 border border-orange-500/30 text-orange-300">
                  BlendRL
                </span>
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Multi-environment policy blending architecture with ensemble rollouts.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-4 text-xs">
            {runInfo.config.num_envs && (
              <div className="flex items-center gap-1.5 bg-[#0e101a] border border-[#2e334d] px-3 py-1.5 rounded-lg text-slate-300 font-mono">
                <Network className="w-3.5 h-3.5 text-orange-400" />
                <span>{runInfo.config.num_envs} Envs</span>
              </div>
            )}
          </div>
        </div>

        {/* Metric Curves */}
        <MetricsGraphs metrics={metrics} />

        {/* Console / Training Logs */}
        <RawLogViewer logs={logs} />
      </div>
    </div>
  );
};

export default BlendRLRunDetails;
