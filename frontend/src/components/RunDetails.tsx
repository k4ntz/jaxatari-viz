import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Plot from 'react-plotly.js';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { fetchRunMetrics, fetchRunLogs, fetchRuns, renderRunVideo, checkRunVideo, type RunInfo } from '../api';
import { ArrowLeft, Server, Settings, Terminal, Activity, Eye, Play, Film, Loader2 } from 'lucide-react';

const VideoPlayer: React.FC<{ runId: string; iter: number }> = ({ runId, iter }) => {
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    checkRunVideo(runId, iter).then(status => {
      if (isMounted && status.exists && status.video_url) {
        setVideoUrl(`http://localhost:8000${status.video_url}`);
      }
    }).catch(() => {});
    return () => { isMounted = false; };
  }, [runId, iter]);

  const handleRender = async () => {
    setLoading(true);
    setError(null);
    try {
      const url = await renderRunVideo(runId, iter);
      setVideoUrl(`http://localhost:8000${url}`);
    } catch (e: any) {
      setError('Failed to render video.');
    } finally {
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
        <div className="inline-flex items-center gap-2 text-indigo-400 text-xs font-medium bg-indigo-500/5 px-3 py-1.5 rounded-lg border border-indigo-500/20">
          <Loader2 className="w-4 h-4 animate-spin" /> Rendering rollout video frame-by-frame...
        </div>
      )}
      {error && <div className="text-red-400 text-xs my-1">{error}</div>}
      {videoUrl && (
        <div className="mt-3 rounded-xl overflow-hidden border border-[#2e334d] bg-black shadow-lg" style={{ width: '280px', maxWidth: '100%' }}>
          <video src={videoUrl} controls autoPlay className="rounded-xl block" style={{ width: '280px', height: 'auto', display: 'block' }} />
        </div>
      )}
    </div>
  );
};

const formatLogs = (rawLogs: string, currentRunId: string): string => {
  if (!rawLogs) return rawLogs;

  let formatted = rawLogs;

  // 1. Move Execution Time next to section title with emoji ⏱️
  formatted = formatted.replace(
    /(#{2,6}\s+.*?)(?:\r?\n)\*\*Execution Time:\*\*\s*(.*)/g,
    '$1 &nbsp;<span style="font-size:0.8rem; font-weight:normal; opacity:0.75;">⏱️ $2</span>'
  );

  // 2. Format Best Parameters JSON into a dotted list
  formatted = formatted.replace(
    /-\s*\*\*Best Parameters:\*\*\s*(\{.*?\})/g,
    (match, jsonStr) => {
      try {
        const normalized = jsonStr.replace(/'/g, '"');
        const obj = JSON.parse(normalized);
        const listItems = Object.entries(obj)
          .map(([k, v]) => `  - **${k}:** \`${v}\``)
          .join('\n');
        return `- **Best Parameters:**\n${listItems}`;
      } catch {
        return match;
      }
    }
  );

  // 3. Keep Failure Localization header above, place Video on left & details on right inside flex card with corresponding iteration number
  let currentIter = 0;
  const sections = formatted.split(/(?=#\s+🔄?\s*Iteration\s+\d+)/g);
  formatted = sections.map(sec => {
    const iterMatch = sec.match(/#\s+🔄?\s*Iteration\s+(\d+)/);
    if (iterMatch) {
      currentIter = parseInt(iterMatch[1], 10);
    }
    return sec.replace(
      /(###\s+🔍?\s*Failure Localization[^\r\n]*)(?:\r?\n+)([\s\S]*?)(?=(?:\r?\n\r?\n###|\r?\n\r?\n#|\r?\n\r?\n---|$))/g,
      (_, header, body) => {
        let bodyFormatted = body.trim().replace(/^\*\*Token Usage:\*\*/m, '- **Token Usage:**');
        return `${header}\n\n<div className="loc-flex-section">\n\n<div className="loc-video-wrapper">\n\n<video data-runid="${currentRunId}" data-iter="${currentIter}"></video>\n\n</div>\n\n<div className="loc-flex-content">\n\n${bodyFormatted}\n\n</div>\n\n</div>`;
      }
    );
  }).join('');

  // 4. Ensure Full Config details code blocks specify json language
  formatted = formatted.replace(
    /(<summary>\s*Full Config\s*<\/summary>\s*\r?\n\r?\n```)\s*(\r?\n)/gi,
    '$1json$2'
  );

  return formatted;
};

const RunDetails: React.FC = () => {
  const { runId } = useParams<{ runId: string }>();
  const navigate = useNavigate();
  
  const [runInfo, setRunInfo] = useState<RunInfo | null>(null);
  const [metrics, setMetrics] = useState<any[]>([]);
  const [logs, setLogs] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [showConfig, setShowConfig] = useState(false);

  useEffect(() => {
    if (!runId) return;
    
    setLoading(true);
    Promise.all([
      fetchRuns().then(runs => runs.find(r => r.id === runId) || null),
      fetchRunMetrics(runId).catch(() => []),
      fetchRunLogs(runId).catch(() => 'Failed to load logs.')
    ]).then(([info, met, lgs]) => {
      setRunInfo(info);
      setMetrics(met);
      setLogs(lgs);
      setLoading(false);
    });
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
        <button onClick={() => navigate('/compare')} className="panel flex items-center gap-2 text-indigo-400 hover:text-indigo-300 z-10 transition-all hover:-translate-y-1">
          <ArrowLeft className="w-4 h-4" /> Return to Dashboard
        </button>
      </div>
    );
  }

  const preparePlot = (metric: string, color: string = '#818cf8', markerColor: string = '#6366f1', fillColor: string = 'rgba(99,102,241,0.05)') => {
    const x = metrics.map(m => m.gen).filter(v => v !== undefined);
    const y = metrics.map(m => m[metric]).filter(v => v !== undefined);
    return [{ 
      x, y, type: 'scatter', mode: 'lines+markers', 
      line: { color, width: 2 }, 
      marker: { color: markerColor, size: 6, line: { color: '#000', width: 1 } },
      fill: 'tozeroy', fillcolor: fillColor
    }];
  };

  return (
    <div className="p-8 flex flex-col h-full overflow-y-auto custom-scrollbar relative">
      {/* Header */}
      <div className="flex items-center gap-6 mb-8 pb-6 border-b border-[#2e334d] shrink-0 relative" style={{ zIndex: 1000 }}>
        <button onClick={() => navigate(-1)} className="panel-btn w-10 h-10 flex items-center justify-center border rounded-xl transition-all">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1">
          <h1 className="text-3xl font-bold text-white tracking-tight flex items-center gap-3">
            {runInfo.id}
          </h1>
          <div className="flex items-center gap-6 mt-2">
            <span className="flex items-center gap-2 text-sm text-slate-400">
              <Server className="w-4 h-4 text-indigo-400" /> Model: <strong className="text-white font-medium bg-[rgba(255,255,255,0.05)] px-2 py-0.5 rounded border border-[#2e334d]">{runInfo.config.model || 'Unknown'}</strong>
            </span>
            <span className="flex items-center gap-2 text-sm text-slate-400">
              <Settings className="w-4 h-4 text-purple-400" /> Method: <strong className="text-white font-medium bg-[rgba(255,255,255,0.05)] px-2 py-0.5 rounded border border-[#2e334d]">{runInfo.config.method || 'Unknown'}</strong>
            </span>
          </div>
        </div>
        
        {/* Hover Config Popup Button */}
        <div 
          className="relative"
          style={{ zIndex: 1000 }}
          onMouseEnter={() => setShowConfig(true)}
          onMouseLeave={() => setShowConfig(false)}
        >
          <button className="panel-btn flex items-center gap-2 border px-4 py-2 rounded-lg transition-all font-medium text-sm">
            <Eye className="w-4 h-4" /> View Config
          </button>

          {showConfig && (
            <div className="absolute top-full right-0 mt-2 w-80 sm:w-96 max-w-[calc(100vw-3rem)] pointer-events-auto shadow-2xl" style={{ zIndex: 1000 }}>
              <div className="flex flex-col p-6 rounded-2xl border border-indigo-500/30 bg-[#06080F] shadow-2xl" style={{ zIndex: 1000 }}>
                <h2 className="text-sm font-bold uppercase tracking-wider text-slate-300 mb-4 flex items-center gap-2 shrink-0">
                  <Settings className="w-4 h-4 text-purple-400" /> Configuration
                </h2>
                <div className="bg-[#000000] rounded-lg border border-[#2e334d] max-h-96 overflow-y-auto custom-scrollbar">
                  <SyntaxHighlighter
                    language="json"
                    style={vscDarkPlus}
                    customStyle={{ margin: 0, padding: '1rem', background: '#000000', fontSize: '1.12rem' }}
                  >
                    {JSON.stringify(runInfo.config, null, 2)}
                  </SyntaxHighlighter>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex flex-col gap-6 relative" style={{ zIndex: 1 }}>
        {metrics.length > 0 && (
          <div className="panel flex flex-col gap-4">
            <div className="flex items-center justify-between border-b border-[var(--border-color)] pb-3">
              <h2 className="text-sm font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
                <Activity className="w-4 h-4 text-indigo-400" /> Training Metrics & Graphs
              </h2>
            </div>
            <div className="flex flex-col md:flex-row gap-6 w-full" style={{ display: 'flex', flexDirection: 'row', gap: '1.5rem', width: '100%' }}>
              {/* Reward Plot */}
              <div className="panel flex flex-col border-emerald-500/20 shadow-none overflow-hidden" style={{ flex: '1 1 50%', minWidth: 0 }}>
                <div className="flex items-center justify-between mb-2">
                  <h2 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
                    <Play className="w-3.5 h-3.5 text-emerald-400" /> Reward Progress
                  </h2>
                </div>
                <div className="w-full h-56 min-h-[220px]">
                  <Plot
                    data={preparePlot('ret_mean', '#34d399', '#10b981', 'rgba(16,185,129,0.05)') as any}
                    layout={{
                      height: 220,
                      paper_bgcolor: 'transparent',
                      plot_bgcolor: 'transparent',
                      margin: { t: 10, r: 10, l: 35, b: 30 },
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

              {/* Fitness Plot */}
              <div className="panel flex flex-col border-indigo-500/20 shadow-none overflow-hidden" style={{ flex: '1 1 50%', minWidth: 0 }}>
                <div className="flex items-center justify-between mb-2">
                  <h2 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
                    <Activity className="w-3.5 h-3.5 text-indigo-400" /> Fitness Progress
                  </h2>
                </div>
                <div className="w-full h-56 min-h-[220px]">
                  <Plot
                    data={preparePlot('best_fitness') as any}
                    layout={{
                      height: 220,
                      paper_bgcolor: 'transparent',
                      plot_bgcolor: 'transparent',
                      margin: { t: 10, r: 10, l: 35, b: 30 },
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
            </div>
          </div>
        )}

        {/* Execution Logs */}
        <div className="panel flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
              <Terminal className="w-4 h-4 text-emerald-400" /> Execution Logs
            </h2>
            <span className="badge border-emerald-500/30 text-emerald-400 bg-emerald-500/10">Live</span>
          </div>
          <div className="prose prose-invert max-w-none text-sm text-slate-300">
            <ReactMarkdown 
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeRaw]}
              components={{
                video(props: any) {
                  const rid = props['data-runid'] || props.dataRunid || props.node?.properties?.dataRunid || props.node?.properties?.['data-runid'];
                  const it = props['data-iter'] || props.dataIter || props.node?.properties?.dataIter || props.node?.properties?.['data-iter'];
                  return <VideoPlayer runId={rid || ''} iter={Number(it || 0)} />;
                },
                h2({ children, ...props }: any) {
                  return <h2 {...props}>{children}</h2>;
                },
                h3({ children, ...props }: any) {
                  return <h3 {...props}>{children}</h3>;
                },
                pre({ children }: any) {
                  return <div className="my-4">{children}</div>;
                },
                code({ node, inline, className, children, ...props }: any) {
                  const match = /language-(\w+)/.exec(className || '');
                  return !inline && match ? (
                    <SyntaxHighlighter
                      style={vscDarkPlus}
                      language={match[1]}
                      PreTag="div"
                      codeTagProps={{ style: { background: 'transparent' } }}
                      customStyle={{
                        background: '#0d0e17',
                        border: '1px solid rgba(255, 255, 255, 0.08)',
                        borderRadius: '8px',
                        padding: '1rem',
                        margin: 0,
                        fontSize: '1.12rem'
                      }}
                      {...props}
                    >
                      {String(children).replace(/\n$/, '')}
                    </SyntaxHighlighter>
                  ) : (
                    <code className={className} {...props}>
                      {children}
                    </code>
                  );
                }
              }}
            >
              {formatLogs(logs, runId || '')}
            </ReactMarkdown>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RunDetails;
