import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Plot from 'react-plotly.js';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { fetchRunMetrics, fetchRunLogs, fetchRuns, renderRunVideo, checkRunVideo, type RunInfo } from '../api';
import { ArrowLeft, Server, Settings, Terminal, Activity, Eye, Play, Film, Loader2, ChevronDown, ChevronUp } from 'lucide-react';

const getFullVideoUrl = (rawUrl: string) => {
  if (!rawUrl) return '';
  const cleanUrl = rawUrl.startsWith('http://localhost:8000') ? rawUrl.replace('http://localhost:8000', '') : rawUrl;
  const parts = cleanUrl.split('/').map(p => encodeURIComponent(decodeURIComponent(p)));
  return `http://localhost:8000${parts.join('/')}`;
};

const VideoPlayer: React.FC<{ runId: string; iter: number }> = ({ runId, iter }) => {
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

  // 4. Append Video player for the Best Iteration in Final Run Summary
  formatted = formatted.replace(
    /(##\s+🏁?\s*Final Run Summary[\s\S]*?)(?=(?:\r?\n\r?\n#|\r?\n\r?\n---|$))/g,
    (match) => {
      const bestIterMatch = match.match(/-\s*\*\*Best Iteration:\*\*\s*(\d+)/i) || formatted.match(/-\s*\*\*Best Iteration:\*\*\s*(\d+)/i);
      const bestIter = bestIterMatch ? parseInt(bestIterMatch[1], 10) : 0;
      return `${match}\n\n### 🎬 Best Iteration Video (Iter ${bestIter})\n\n<video data-runid="${currentRunId}" data-iter="${bestIter}"></video>`;
    }
  );

  // 5. Ensure Full Config details code blocks specify json language
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
  const [showAllMetrics, setShowAllMetrics] = useState(false);

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
        <button onClick={() => navigate('/compare_on_jaxatari')} className="panel flex items-center gap-2 text-indigo-400 hover:text-indigo-300 z-10 transition-all hover:-translate-y-1">
          <ArrowLeft className="w-4 h-4" /> Return to Dashboard
        </button>
      </div>
    );
  }

  const preparePlot = (metric: string, color: string = '#818cf8', markerColor: string = '#6366f1', fillColor: string = 'rgba(99,102,241,0.05)') => {
    const x: number[] = [];
    const y: number[] = [];
    metrics.forEach(m => {
      const stepVal = m.gen ?? m.global_step ?? m.step ?? m._step ?? m.iteration;
      const metricVal = m[metric] ?? m['charts/' + metric] ?? m['charts/episodic_return'] ?? m['charts/episodic_game_return'] ?? m['eval/episodic_return_mod'] ?? m['episodic_return'] ?? m['reward'];
      if (stepVal !== undefined && metricVal !== undefined && metricVal !== null) {
        x.push(stepVal);
        y.push(metricVal);
      }
    });
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
        {metrics.length > 0 && (() => {
          // Identify all available numeric metric keys (ignoring step/index/internal keys)
          const ignoreKeys = new Set(['gen', 'iteration', 'step', 'global_step', '_step', '_timestamp', '_runtime', 'Unnamed: 0', 'ret_mean', 'best_fitness']);
          const availableKeys = Array.from(
            new Set(metrics.flatMap(m => Object.keys(m)))
          ).filter(k => !ignoreKeys.has(k) && typeof metrics.find(m => m[k] !== undefined)?.[k] === 'number');

          // Key metrics to highlight if available
          const primaryMetrics = [
            { key: 'ret_mean', title: 'Reward / Return', color: '#34d399', fill: 'rgba(16,185,129,0.05)' },
            { key: 'best_fitness', title: 'Fitness Progress', color: '#818cf8', fill: 'rgba(99,102,241,0.05)' },
            { key: 'losses/loss', title: 'Total Loss', color: '#f87171', fill: 'rgba(248,113,113,0.05)' },
            { key: 'losses/value_loss', title: 'Value Loss', color: '#f59e0b', fill: 'rgba(245,158,11,0.05)' },
            { key: 'losses/policy_loss', title: 'Policy Loss', color: '#a78bfa', fill: 'rgba(167,139,250,0.05)' },
            { key: 'charts/episodic_length', title: 'Episode Length', color: '#38bdf8', fill: 'rgba(56,189,248,0.05)' },
            { key: 'charts/SPS', title: 'Steps Per Second (SPS)', color: '#2dd4bf', fill: 'rgba(45,212,191,0.05)' },
          ];

          // Filter to metrics that actually exist in this run's data
          const plotsToRender = primaryMetrics.filter(p => 
            metrics.some(m => m[p.key] !== undefined && m[p.key] !== null)
          );

          // Add any remaining unclassified metrics
          availableKeys.forEach((key, idx) => {
            if (!primaryMetrics.some(p => p.key === key)) {
              const palette = ['#c084fc', '#f472b6', '#fbbf24', '#2dd4bf', '#a78bfa'];
              plotsToRender.push({
                key,
                title: key.replace(/^charts\//, '').replace(/^losses\//, '').replace(/_/g, ' '),
                color: palette[idx % palette.length],
                fill: 'rgba(255,255,255,0.03)'
              });
            }
          });

          const primaryPlots = plotsToRender.slice(0, 2);
          const extraPlots = plotsToRender.slice(2);

          return (
            <div className="panel flex flex-col gap-4">
              <div className="flex items-center justify-between border-b border-[var(--border-color)] pb-3">
                <h2 className="text-sm font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
                  <Activity className="w-4 h-4 text-indigo-400" /> Training Metrics & Graphs ({plotsToRender.length})
                </h2>
              </div>

              {/* Primary 2 Graphs */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full">
                {primaryPlots.map(plotCfg => (
                  <div key={plotCfg.key} className="panel flex flex-col border-slate-700/30 shadow-none overflow-hidden" style={{ minWidth: 0 }}>
                    <div className="flex items-center justify-between mb-2">
                      <h2 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
                        <Play className="w-3.5 h-3.5" style={{ color: plotCfg.color }} /> {plotCfg.title}
                      </h2>
                      <span className="text-[10px] text-slate-500 font-mono">{plotCfg.key}</span>
                    </div>
                    <div className="w-full h-56 min-h-[220px]">
                      <Plot
                        data={preparePlot(plotCfg.key, plotCfg.color, plotCfg.color, plotCfg.fill) as any}
                        layout={{
                          height: 220,
                          paper_bgcolor: 'transparent',
                          plot_bgcolor: 'transparent',
                          margin: { t: 10, r: 10, l: 40, b: 30 },
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
                ))}
              </div>

              {/* Expandable Panel for Additional Graphs */}
              {extraPlots.length > 0 && (
                <div className="flex flex-col gap-4 mt-2">
                  <button
                    onClick={() => setShowAllMetrics(!showAllMetrics)}
                    className="flex items-center justify-between w-full bg-[#16192b] hover:bg-[#1f243f] border border-[#2e334d] px-4 py-3 rounded-xl transition-colors text-sm font-semibold text-slate-300"
                  >
                    <span className="flex items-center gap-2">
                      <Activity className="w-4 h-4 text-indigo-400" />
                      {showAllMetrics
                        ? 'Hide Additional Metric Graphs'
                        : `Show ${extraPlots.length} Additional Metric Graph${extraPlots.length > 1 ? 's' : ''}`}
                    </span>
                    {showAllMetrics ? (
                      <ChevronUp className="w-4 h-4 text-slate-400" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-slate-400" />
                    )}
                  </button>

                  {showAllMetrics && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full animate-in fade-in slide-in-from-top-2 duration-200">
                      {extraPlots.map(plotCfg => (
                        <div key={plotCfg.key} className="panel flex flex-col border-slate-700/30 shadow-none overflow-hidden" style={{ minWidth: 0 }}>
                          <div className="flex items-center justify-between mb-2">
                            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
                              <Play className="w-3.5 h-3.5" style={{ color: plotCfg.color }} /> {plotCfg.title}
                            </h2>
                            <span className="text-[10px] text-slate-500 font-mono">{plotCfg.key}</span>
                          </div>
                          <div className="w-full h-56 min-h-[220px]">
                            <Plot
                              data={preparePlot(plotCfg.key, plotCfg.color, plotCfg.color, plotCfg.fill) as any}
                              layout={{
                                height: 220,
                                paper_bgcolor: 'transparent',
                                plot_bgcolor: 'transparent',
                                margin: { t: 10, r: 10, l: 40, b: 30 },
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
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })()}

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
