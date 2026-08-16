import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { fetchRunEvaluations, fetchRunMetrics, fetchRunLogs, fetchRuns, type EvaluationRecord, type RunInfo } from '../api';
import { ArrowLeft } from 'lucide-react';
import { DefaultRunDetails, BlendRLRunDetails, LeGPSRunDetails } from './run_details';

const RunDetails: React.FC = () => {
  const { runId } = useParams<{ runId: string }>();
  const navigate = useNavigate();
  
  const [runInfo, setRunInfo] = useState<RunInfo | null>(null);
  const [metrics, setMetrics] = useState<any[]>([]);
  const [logs, setLogs] = useState<string>('');
  const [evaluations, setEvaluations] = useState<EvaluationRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!runId) return;
    let active = true;
    setLoading(true);
    Promise.all([
      fetchRuns().then(runs => runs.find(r => r.id === runId) || null),
      fetchRunMetrics(runId).catch(() => []),
      fetchRunLogs(runId).catch(() => 'Failed to load logs.'),
      fetchRunEvaluations(runId).catch(() => [])
    ]).then(([info, met, lgs, evalRows]) => {
      if (!active) return;
      setRunInfo(info);
      setMetrics(met);
      setLogs(lgs);
      setEvaluations(evalRows);
      setLoading(false);
    });
    const refreshTimer = window.setInterval(() => {
      Promise.all([
        fetchRunMetrics(runId, true).catch(() => null),
        fetchRunEvaluations(runId, true).catch(() => null),
      ]).then(([met, evalRows]) => {
        if (!active) return;
        if (met) setMetrics(met);
        if (evalRows) setEvaluations(evalRows);
      });
    }, 5_000);
    return () => {
      active = false;
      window.clearInterval(refreshTimer);
    };
  }, [runId]);

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center h-full flex-col gap-4">
        <div className="w-12 h-12 rounded-full border-4 border-indigo-500/20 border-t-indigo-500 animate-spin" />
        <div className="text-indigo-400 font-medium">Loading run profile...</div>
      </div>
    );
  }

  if (!runInfo) {
    return (
      <div className="p-8 flex flex-col items-center justify-center h-full text-slate-400 relative">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-red-500/5 rounded-full blur-[100px] pointer-events-none" />
        <h2 className="text-3xl font-bold text-white mb-2 z-10">Run Not Found</h2>
        <p className="mb-6 z-10">The run you are looking for might have been deleted or moved.</p>
        <button onClick={() => navigate('/compare_on_jaxatari')} className="panel flex items-center gap-2 text-indigo-400 hover:text-indigo-300 z-10 transition-all hover:-translate-y-1">
          <ArrowLeft className="w-4 h-4" /> Return to Dashboard
        </button>
      </div>
    );
  }

  const methodStr = String(runInfo.config?.method || runInfo.config?.raw_alg || runInfo.config?.model || runInfo.project_name || '').toLowerCase();
  const idStr = runInfo.id.toLowerCase();

  // Route to specialized viewer depending on algorithm family:
  if (methodStr.includes('legps') || methodStr.includes('cma') || idStr.includes('legps')) {
    return <LeGPSRunDetails runInfo={runInfo} metrics={metrics} logs={logs} evaluations={evaluations} />;
  }

  if (methodStr.includes('blend') || idStr.includes('blend')) {
    return <BlendRLRunDetails runInfo={runInfo} metrics={metrics} logs={logs} />;
  }

  // Default viewer for DQN, Rainbow, PPO, PQN, etc.
  return <DefaultRunDetails runInfo={runInfo} metrics={metrics} logs={logs} />;
};

export default RunDetails;
