import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { BrainCircuit } from 'lucide-react';
import { VideoPlayer } from './VideoPlayer';
import type { EvaluationRecord } from '../../api';

interface LeGPSLogViewerProps {
  logs: string;
  runId: string;
  evaluations?: EvaluationRecord[];
}

const formatLeGPSLogs = (rawLogs: string, currentRunId: string, evaluations: EvaluationRecord[] = []): string => {
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

  // 3. Keep Failure Localization header above, annotate with analyzed score/seed, place Video on left & details on right inside flex card
  let currentIter = 0;
  const sections = formatted.split(/(?=#\s+🔄?\s*Iteration\s+\d+)/g);
  formatted = sections.map(sec => {
    const iterMatch = sec.match(/#\s+🔄?\s*Iteration\s+(\d+)/);
    if (iterMatch) {
      currentIter = parseInt(iterMatch[1], 10);
    }
    
    // Extract evaluated score & seed from this iteration's Evaluation section
    const realReturnMatch = sec.match(/-\s*\*\*Real Return:\*\*\s*(-?[\d.]+)/i);
    const worstReturnMatch = sec.match(/-\s*\*\*Robustness \(Min\):\*\*\s*(-?[\d.]+)/i);
    const worstSeedMatch = sec.match(/-\s*\*\*Worst Seed:\*\*\s*(\d+)/i);

    const evaluation = evaluations.find(row => row.outer_iter === currentIter);
    const analyzedScore = evaluation?.noisy?.localization_return ?? evaluation?.deterministic_return ??
      (realReturnMatch ? realReturnMatch[1] : null);
    const analyzedSeed = evaluation?.noisy?.localization_seed ?? (worstSeedMatch ? worstSeedMatch[1] : null);
    const minScore = evaluation?.noisy?.min ?? (worstReturnMatch ? worstReturnMatch[1] : null);
    const minSeed = evaluation?.noisy?.min_return_seed;

    let scoreBadge = '';
    if (analyzedScore !== null) {
      scoreBadge = ` &nbsp;<span style="font-size:0.75rem; font-weight:600; padding:2px 8px; border-radius:6px; background:rgba(239,68,68,0.15); border:1px solid rgba(239,68,68,0.3); color:#fca5a5;">🎯 Localization trace: seed ${analyzedSeed ?? '—'}, score ${analyzedScore}${minScore !== null ? ` · Numeric minimum: seed ${minSeed ?? '—'}, score ${minScore}` : ''}</span>`;
    }

    return sec.replace(
      /(###\s+🔍?\s*Failure Localization[^\r\n]*)(?:\r?\n+)([\s\S]*?)(?=(?:\r?\n\r?\n###|\r?\n\r?\n#|\r?\n\r?\n---|$))/g,
      (_, header, body) => {
        let bodyFormatted = body.trim().replace(/^\*\*Token Usage:\*\*/m, '- **Token Usage:**');
        return `${header}${scoreBadge}\n\n<div className="loc-flex-section">\n\n<div className="loc-video-wrapper">\n\n<video data-runid="${currentRunId}" data-iter="${currentIter}"></video>\n\n</div>\n\n<div className="loc-flex-content">\n\n${bodyFormatted}\n\n</div>\n\n</div>`;
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

export const LeGPSLogViewer: React.FC<LeGPSLogViewerProps> = ({ logs, runId, evaluations = [] }) => {
  return (
    <div className="panel flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
          <BrainCircuit className="w-4 h-4 text-emerald-400" /> LeGPS Evolution & LLM Localization Trace
        </h2>
        <span className="badge border-indigo-500/30 text-indigo-400 bg-indigo-500/10">LeGPS Trace</span>
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
            code({ inline, className, children, ...props }: any) {
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
          {formatLeGPSLogs(logs, runId, evaluations)}
        </ReactMarkdown>
      </div>
    </div>
  );
};
