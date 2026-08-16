import React, { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Database, RefreshCw } from 'lucide-react';
import { fetchSynchronization, fetchTrajectory } from '../../api';

interface RootConsistencyViewerProps {
  runId: string;
  iteration: number;
}

export const RootConsistencyViewer: React.FC<RootConsistencyViewerProps> = ({ runId, iteration }) => {
  const [trajectory, setTrajectory] = useState<any>(null);
  const [sync, setSync] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    Promise.all([
      fetchTrajectory(runId, iteration, 0, 40),
      fetchSynchronization(runId, iteration, 0, 40),
    ]).then(([trajectoryData, syncData]) => {
      if (!active) return;
      setTrajectory(trajectoryData);
      setSync(syncData);
    }).catch(reason => {
      if (active) setError(reason?.response?.data?.detail || reason?.message || String(reason));
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [runId, iteration]);

  const missingFields = trajectory?.consistency?.missing_field_counts_in_page || {};
  const hasMissingFields = Object.values(missingFields).some(value => Number(value) > 0);

  return (
    <div className="border border-[#2e334d] rounded-xl bg-[#0d101d] p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
          <Database className="w-4 h-4 text-cyan-400" /> Transition / frame consistency — iter {iteration}
        </h3>
        {loading && <RefreshCw className="w-4 h-4 text-cyan-400 animate-spin" />}
      </div>

      {error && <div className="text-xs text-red-300">{String(error)}</div>}

      {!loading && trajectory && !trajectory.available && (
        <div className="flex items-start gap-2 text-xs text-amber-300 bg-amber-500/10 border border-amber-500/20 p-3 rounded-lg">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <div>
            <div>{trajectory.warning}</div>
            {trajectory.legacy_rollout_id !== undefined && (
              <div className="mt-1 text-slate-400">Legacy rollout ID {trajectory.legacy_rollout_id} is shown only as a diagnostic; it is never dereferenced.</div>
            )}
          </div>
        </div>
      )}

      {!loading && trajectory?.available && (
        <>
          <div className={`flex items-center gap-2 text-xs ${trajectory.portable && !hasMissingFields ? 'text-emerald-300' : 'text-amber-300'}`}>
            {trajectory.portable && !hasMissingFields
              ? <CheckCircle2 className="w-4 h-4" />
              : <AlertTriangle className="w-4 h-4" />}
            {trajectory.portable ? 'Portable trajectory manifest found.' : 'Trajectory has no portable manifest.'}
            {hasMissingFields && ' Some transition-integrity fields are absent on this page.'}
          </div>
          <div className="overflow-x-auto max-h-72 custom-scrollbar">
            <table className="w-full text-[11px] font-mono text-slate-300">
              <thead className="text-slate-500 sticky top-0 bg-[#0d101d]">
                <tr>
                  {['t', 'phase', 'policy action', 'executed', 'reward', 'done', 'video frame', 'pre hash', 'post hash'].map(label => (
                    <th key={label} className="text-left px-2 py-1">{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(trajectory.rows || []).map((row: any, index: number) => (
                  <tr key={`${row.decision_t ?? index}-${index}`} className="border-t border-[#20263a]">
                    <td className="px-2 py-1">{row.decision_t ?? '—'}</td>
                    <td className="px-2 py-1">{row.phase ?? '—'}</td>
                    <td className="px-2 py-1">{row.policy_action ?? '—'}</td>
                    <td className="px-2 py-1">{row.executed_action ?? '—'}</td>
                    <td className="px-2 py-1">{row.reward ?? '—'}</td>
                    <td className="px-2 py-1">{String(row.done ?? '—')}</td>
                    <td className="px-2 py-1">{row.video_frame ?? '—'}</td>
                    <td className="px-2 py-1 truncate max-w-28" title={row.pre_state_hash}>{row.pre_state_hash ?? '—'}</td>
                    <td className="px-2 py-1 truncate max-w-28" title={row.post_state_hash}>{row.post_state_hash ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {!loading && sync && (
        <div className={`text-xs p-2 rounded-lg border ${sync.available ? 'text-cyan-300 border-cyan-500/20 bg-cyan-500/5' : 'text-amber-300 border-amber-500/20 bg-amber-500/5'}`}>
          {sync.available
            ? `Verified video mapping: frame 0 is pre-action; later frames map to post-action decision t=(frame−1)×${sync.mapping_semantics?.stride ?? 2}. State hashes remain ${sync.mapping?.some((row: any) => row.state_hash_verified) ? 'verified' : 'unverified'}.`
            : `Frame synchronization unavailable: ${sync.warning || 'render a verified exact replay first'}`}
        </div>
      )}
    </div>
  );
};
