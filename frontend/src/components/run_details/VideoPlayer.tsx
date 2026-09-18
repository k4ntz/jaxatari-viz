import React from 'react';

export const getFullVideoUrl = (rawUrl: string, ts?: number) => {
  if (!rawUrl) return '';
  const cleanUrl = rawUrl.startsWith('http://localhost:8000') ? rawUrl.replace('http://localhost:8000', '') : rawUrl;
  const parts = cleanUrl.split('/').map(p => encodeURIComponent(decodeURIComponent(p)));
  const base = `http://localhost:8000${parts.join('/')}`;
  return ts ? `${base}?t=${ts}` : base;
};

export const VideoPlayer: React.FC<{ runId: string; iter: number }> = () => {
  return (
    <div className="my-3">
      <div className="text-slate-500 text-xs italic bg-[#16192b] p-3 rounded-lg border border-[#2e334d]">
        Video rendering and playback is disabled in this static preview.
      </div>
    </div>
  );
};
