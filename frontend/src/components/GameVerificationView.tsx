import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { fetchEnvironmentById, type EnvironmentInfo } from '../api';
import { ArrowLeft, ShieldCheck, FileText, ExternalLink, Gamepad2 } from 'lucide-react';

interface GameVerificationViewProps {
  theme?: string;
}

export const GameVerificationView: React.FC<GameVerificationViewProps> = () => {
  const { envId } = useParams<{ envId: string }>();
  const navigate = useNavigate();

  const [envInfo, setEnvInfo] = useState<EnvironmentInfo | null>(null);
  const [verifMarkdown, setVerifMarkdown] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!envId) return;

    let isMounted = true;
    setLoading(true);

    // Fetch env info
    fetchEnvironmentById(envId)
      .then(info => {
        if (isMounted) setEnvInfo(info);
      })
      .catch(() => null);

    // Fetch verification markdown
    const verifCandidates = [
      envId.toLowerCase(),
      envId.toLowerCase().replace(/[-_]/g, ''),
      envId.toLowerCase().replace(/-/g, '_')
    ];

    const tryFetchVerif = async () => {
      for (const cand of verifCandidates) {
        try {
          const res = await fetch(`/game_verifs/${cand}.md`);
          if (res.ok) {
            const text = await res.text();
            if (isMounted) {
              setVerifMarkdown(text);
              setLoading(false);
            }
            return;
          }
        } catch {
          // Continue
        }
      }
      if (isMounted) {
        setVerifMarkdown(null);
        setLoading(false);
      }
    };

    tryFetchVerif();

    return () => {
      isMounted = false;
    };
  }, [envId]);

  return (
    <div className="p-6 relative max-w-[1400px] mx-auto flex flex-col gap-6">
      {/* Header Bar */}
      <div className="flex items-center gap-4 pb-4 border-b border-[#2e334d]">
        <button
          onClick={() => navigate(`/environment/${envId}`)}
          className="panel-btn w-9 h-9 flex items-center justify-center border rounded-lg transition-all hover:bg-indigo-500/10 hover:border-indigo-500/40 text-slate-300"
        >
          <ArrowLeft className="w-4 h-4 text-indigo-400" />
        </button>
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-extrabold text-white tracking-tight">
              {envInfo?.name || envId} Verification & ALE Fidelity
            </h1>
            <span className="badge text-[10px] px-2 py-0.5 bg-slate-800 border border-slate-700 text-slate-300 font-mono">
              {envId}
            </span>
            {verifMarkdown && (
              <span className="badge text-xs px-2.5 py-0.5 bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 font-bold flex items-center gap-1">
                <ShieldCheck className="w-3.5 h-3.5" /> ALE 1-1 Verified
              </span>
            )}
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            Detailed technical analysis of game mechanics, action spaces, reward signals, and JAXAtari implementation fidelity.
          </p>
        </div>
      </div>

      {/* Main Content Card */}
      <div className="bg-[#16192b] border border-[#2e334d] p-6 rounded-2xl flex flex-col gap-6 shadow-xl">
        {loading ? (
          <div className="p-16 flex flex-col items-center justify-center gap-3 text-slate-400">
            <Gamepad2 className="w-8 h-8 animate-pulse text-indigo-400" />
            <span className="text-sm font-medium">Loading verification document...</span>
          </div>
        ) : verifMarkdown ? (
          <div className="prose text-slate-300 max-w-none text-xs leading-relaxed">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeRaw]}
              components={{
                h1: ({ children }) => (
                  <h1 className="text-xl font-bold text-white border-b border-[#2e334d] pb-2 mt-4 mb-3 tracking-tight">
                    {children}
                  </h1>
                ),
                h2: ({ children }) => (
                  <h2 className="text-base font-bold text-indigo-300 border-b border-[#2e334d]/60 pb-1.5 mt-6 mb-3 tracking-wide flex items-center gap-2">
                    {children}
                  </h2>
                ),
                h3: ({ children }) => (
                  <h3 className="text-sm font-semibold text-purple-300 mt-4 mb-2">
                    {children}
                  </h3>
                ),
                h4: ({ children }) => (
                  <h4 className="text-xs font-bold text-emerald-400 mt-3 mb-1.5 flex items-center gap-1.5">
                    {children}
                  </h4>
                ),
                p: ({ children }) => (
                  <p className="mb-3 text-slate-300 leading-relaxed text-xs">
                    {children}
                  </p>
                ),
                table: ({ children }) => (
                  <div className="overflow-x-auto my-4 border border-[#2e334d] rounded-xl bg-[#0f111a] shadow-inner">
                    <table className="w-full text-left text-xs border-collapse">
                      {children}
                    </table>
                  </div>
                ),
                thead: ({ children }) => (
                  <thead className="bg-[#16192b] border-b border-[#2e334d] text-indigo-300 font-bold uppercase tracking-wider text-[11px]">
                    {children}
                  </thead>
                ),
                tbody: ({ children }) => (
                  <tbody className="divide-y divide-[#2e334d]/50">
                    {children}
                  </tbody>
                ),
                tr: ({ children }) => (
                  <tr className="hover:bg-slate-800/40 transition-colors">
                    {children}
                  </tr>
                ),
                th: ({ children }) => (
                  <th className="p-3 font-semibold border-r border-[#2e334d]/40 last:border-r-0">
                    {children}
                  </th>
                ),
                td: ({ children }) => (
                  <td className="p-3 leading-relaxed border-r border-[#2e334d]/40 last:border-r-0 text-slate-300">
                    {children}
                  </td>
                ),
                code: ({ children }) => (
                  <code className="bg-[#1e2238] text-indigo-300 px-1.5 py-0.5 rounded font-mono text-[11px] border border-indigo-500/30">
                    {children}
                  </code>
                ),
                a: ({ href, children }) => (
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-indigo-400 hover:text-indigo-300 underline font-medium inline-flex items-center gap-1"
                  >
                    {children} <ExternalLink className="w-3 h-3" />
                  </a>
                )
              }}
            >
              {verifMarkdown}
            </ReactMarkdown>
          </div>
        ) : (
          <div className="p-16 flex flex-col items-center justify-center gap-3 text-slate-500 bg-[#0d0e17] rounded-xl border border-[#2e334d]">
            <FileText className="w-12 h-12 opacity-30" />
            <span className="text-base font-semibold text-slate-300">No Verification Report Found</span>
            <p className="text-xs text-slate-500 max-w-md text-center">
              A verification file (`{envId}.md`) has not yet been created for this game in `game_verifs/`.
            </p>
            <button
              onClick={() => navigate(`/environment/${envId}`)}
              className="mt-2 panel-btn text-indigo-400 border border-indigo-500/30 px-3 py-1.5 rounded-lg text-xs flex items-center gap-1.5"
            >
              <ArrowLeft className="w-3.5 h-3.5" /> Return to Environment Profile
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default GameVerificationView;
