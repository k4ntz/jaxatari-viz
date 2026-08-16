import React, { useState } from 'react';
import { RunHeader } from './RunHeader';
import { MetricsGraphs } from './MetricsGraphs';
import { RawLogViewer } from './RawLogViewer';
import type { EvaluationRecord, RunInfo } from '../../api';

export interface RunDetailProps {
  runInfo: RunInfo;
  metrics: any[];
  logs: string;
  evaluations?: EvaluationRecord[];
}

export const DefaultRunDetails: React.FC<RunDetailProps> = ({ runInfo, metrics, logs }) => {
  const [showConfig, setShowConfig] = useState(false);

  return (
    <div className="p-8 flex flex-col h-full overflow-y-auto custom-scrollbar relative">
      <RunHeader
        runInfo={runInfo}
        showConfig={showConfig}
        setShowConfig={setShowConfig}
        tagColor="indigo"
      />

      <div className="flex flex-col gap-6 relative" style={{ zIndex: 1 }}>
        {/* Metric Curves */}
        <MetricsGraphs metrics={metrics} />

        {/* Console / Training Logs */}
        <RawLogViewer logs={logs} />
      </div>
    </div>
  );
};

export default DefaultRunDetails;
