import React, { useEffect, useState } from 'react';
import { renderRunVideo, checkRunVideo } from '../../api';
import { Film, Loader2 } from 'lucide-react';

export const getFullVideoUrl = (rawUrl: string) => {
  if (!rawUrl) return '';
  const cleanUrl = rawUrl.startsWith('http://localhost:8000') ? rawUrl.replace('http://localhost:8000', '') : rawUrl;
  const parts = cleanUrl.split('/').map(p => encodeURIComponent(decodeURIComponent(p)));
  return `http://localhost:8000${parts.join('/')}`;
};

export const VideoPlayer: React.FC<{ runId: string; iter: number }> = ({ runId, iter }) => {
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    checkRunVideo(runId, iter).then(status => {
      if (isMounted && status.exists && status.video_url) {
        setVideoUrl(getFullVideoUrl(status.video_url));
      }
    }).catch(() => {});
    return () => { isMounted = false; };
  }, [runId, iter]);

  const handleRender = async () => {
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
          setVideoUrl(getFullVideoUrl(st.video_url));
          setLoading(false);
          if (timer) clearInterval(timer);
        }
      } catch {
        // ignore polling errors
      }
    };

    timer = setInterval(pollStatus, 500);

    try {
      const url = await renderRunVideo(runId, iter);
      if (url) {
        setVideoUrl(getFullVideoUrl(url));
        setProgress(100);
        setStage('Complete!');
      }
    } catch (e: any) {
      const detail = e.response?.data?.detail || e.message || 'Failed to render video.';
      setError(`Failed to render video: ${detail}`);
    } finally {
      if (timer) clearInterval(timer);
      setLoading(false);
    }
  };

  return (
    <div className="my-3">
      {!videoUrl && !loading && (
        <button
          onClick={handleRender}
          className="inline-flex items-center gap-2 bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
        >
          <Film className="w-4 h-4 text-indigo-400" /> Render Failure Rollout Video
        </button>
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
        <div className="mt-3 rounded-xl overflow-hidden border border-[#2e334d] bg-black shadow-lg" style={{ width: '280px', maxWidth: '100%' }}>
          <video key={videoUrl} src={videoUrl} controls autoPlay className="rounded-xl block" style={{ width: '280px', height: 'auto', display: 'block' }} />
        </div>
      )}
    </div>
  );
};
