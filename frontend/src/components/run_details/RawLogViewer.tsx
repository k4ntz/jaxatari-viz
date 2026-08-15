import React from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { Terminal } from 'lucide-react';

interface RawLogViewerProps {
  logs: string;
}

export const RawLogViewer: React.FC<RawLogViewerProps> = ({ logs }) => {
  return (
    <div className="panel flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
          <Terminal className="w-4 h-4 text-emerald-400" /> Execution Logs
        </h2>
        <span className="badge border-emerald-500/30 text-emerald-400 bg-emerald-500/10">Console</span>
      </div>
      <div className="bg-[#0d0e17] rounded-xl border border-[rgba(255,255,255,0.08)] max-h-[700px] overflow-y-auto custom-scrollbar">
        <SyntaxHighlighter
          style={vscDarkPlus}
          language="text"
          PreTag="div"
          codeTagProps={{ style: { background: 'transparent' } }}
          customStyle={{
            background: 'transparent',
            padding: '1.25rem',
            margin: 0,
            fontSize: '1.05rem',
            lineHeight: '1.6'
          }}
        >
          {logs || 'No execution logs recorded.'}
        </SyntaxHighlighter>
      </div>
    </div>
  );
};
