import React, { useEffect, useState } from 'react';
import { renderRunVideo, checkRunVideo } from '../../api';
import { Film, Loader2 } from 'lucide-react';

export const getFullVideoUrl = (rawUrl: string, ts?: number) => {
  if (!rawUrl) return '';
  const url = new URL(rawUrl, window.location.origin);
  url.pathname = url.pathname.split('/').map(part => encodeURIComponent(decodeURIComponent(part))).join('/');
  if (ts) url.searchParams.set('t', String(ts));
  return url.toString();
};

export const VideoPlayer: React.FC<{ runId: string; iter: number }> = ({ runId, iter }) => {
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [staleReason, setStaleReason] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    checkRunVideo(runId, iter).then(status => {
      if (isMounted && status.exists && status.video_url) {
        setVideoUrl(getFullVideoUrl(status.video_url, Date.now()));
      } else if (isMounted && status.stale) {
        setStaleReason(status.stale_reason || 'Existing media has no matching provenance manifest.');
      }
    }).catch(() => {});
    return () => { isMounted = false; };
  }, [runId, iter]);

  const handleRender = async (force: boolean = false) => {
    setLoading(true);
    setError(null);
    setProgress(5);
    setStage('Initializing environment & policy...');

    let timer: any = null;
    const pollStatus = async () => {
      try {
        const st = await checkRunVideo(runId, iter);
        if (st.progress !== undefined) setProgress(st.progress);
        if (st.stage) setStage(st.stage);
        if (st.exists && st.video_url) {
          setVideoUrl(getFullVideoUrl(st.video_url, Date.now()));
          setLoading(false);
          if (timer) clearInterval(timer);
        }
      } catch {
        // ignore polling errors
      }
    };

    timer = setInterval(pollStatus, 500);

    try {
      const url = await renderRunVideo(runId, iter, force);
      if (url) {
        setVideoUrl(getFullVideoUrl(url, Date.now()));
        setProgress(100);
        setStage('Complete!');
      }
    } catch (e: any) {
      let detail = e.response?.data?.detail || e.message || 'Failed to render video.';
      if (typeof detail === 'object') {
        try {
          detail = JSON.stringify(detail);
        } catch {
          detail = String(detail);
        }
      }
      setError(`Failed to render video: ${detail}`);
    } finally {
      if (timer) clearInterval(timer);
      setLoading(false);
    }
  };

  return (
    <div className="my-3">
      {!videoUrl && !loading && (
        <div className="flex flex-col gap-2 items-start">
          {staleReason && (
            <div className="text-amber-300 text-xs bg-amber-500/10 border border-amber-500/20 p-2 rounded-lg max-w-xl">
              Stale video refused: {staleReason}
            </div>
          )}
          <button
            onClick={() => handleRender(false)}
            className="inline-flex items-center gap-2 bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
          >
            <Film className="w-4 h-4 text-indigo-400" /> Render and verify exact rollout
          </button>
        </div>
      )}
      {loading && (
        <div className="flex flex-col gap-2 p-3 bg-[#16192b] border border-indigo-500/30 rounded-xl max-w-sm my-2 shadow-lg">
          <div className="flex items-center justify-between text-xs font-medium text-indigo-300 gap-2">
            <span className="flex items-center gap-2 truncate">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-400 shrink-0" />
              <span className="truncate">{stage || 'Rendering rollout video...'}</span>
            </span>
            <span className="font-mono text-indigo-400 font-bold shrink-0">{progress}%</span>
          </div>
          <div className="w-full bg-[#1e2338] h-2 rounded-full overflow-hidden border border-[#2e334d]">
            <div
              className="bg-indigo-500 h-full rounded-full transition-all duration-300 ease-out shadow-[0_0_8px_rgba(99,102,241,0.8)]"
              style={{ width: `${Math.max(5, progress)}%` }}
            />
          </div>
        </div>
      )}
      {error && (
        <div className="text-red-400 text-xs my-1 bg-red-500/10 border border-red-500/20 p-2 rounded-lg break-words max-w-xl whitespace-pre-wrap">
          {error}
        </div>
      )}
      {videoUrl && (
        <div className="mt-3 flex flex-col gap-1.5" style={{ width: '280px', maxWidth: '100%' }}>
          <div className="rounded-xl overflow-hidden border border-[#2e334d] bg-black shadow-lg">
            <video key={videoUrl} src={videoUrl} controls playsInline className="rounded-xl block" style={{ width: '280px', height: 'auto', display: 'block' }} />
          </div>
          <div className="flex justify-end">
            <button
              onClick={() => handleRender(true)}
              disabled={loading}
              className="text-[11px] text-slate-400 hover:text-indigo-300 flex items-center gap-1 transition-colors px-1 py-0.5"
              title="Force re-render rollout video matching exact evaluation seed"
            >
              <Film className="w-3 h-3" /> Re-render video
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
