import React from 'react';
import { Gamepad2, Construction, Layers, ShieldCheck, Cpu } from 'lucide-react';

const EnvironmentsView: React.FC = () => {
  return (
    <div className="p-8 relative max-w-7xl mx-auto">
      <div className="flex items-end justify-between mb-8 pb-6 border-b border-[#2e334d]">
        <div>
          <h1 className="text-3xl font-bold text-white mb-2 tracking-tight">Atari Environments</h1>
          <p className="text-slate-400">Environment configurations, state spaces, observation rules, and benchmark baselines.</p>
        </div>
        <div className="badge border-indigo-500 text-indigo-400 bg-indigo-500/10 flex items-center gap-1.5 px-3 py-1">
          <Construction className="w-4 h-4 text-indigo-400" />
          <span>Under Construction</span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="panel bg-[#16192b] border border-[#2e334d] p-6 rounded-2xl flex flex-col gap-3">
          <div className="p-3 bg-indigo-500/20 rounded-xl border border-indigo-500/30 w-fit">
            <Gamepad2 className="w-6 h-6 text-indigo-400" />
          </div>
          <h3 className="text-lg font-bold text-white">Supported Games</h3>
          <p className="text-sm text-slate-400">Kangaroo, Montezuma's Revenge, Breakout, Space Invaders, and custom JAXAtari environments.</p>
        </div>

        <div className="panel bg-[#16192b] border border-[#2e334d] p-6 rounded-2xl flex flex-col gap-3">
          <div className="p-3 bg-purple-500/20 rounded-xl border border-purple-500/30 w-fit">
            <Layers className="w-6 h-6 text-purple-400" />
          </div>
          <h3 className="text-lg font-bold text-white">Observation Spaces</h3>
          <p className="text-sm text-slate-400">Support for RAM states, symbolic object extraction, and pixel-level observation matrices.</p>
        </div>

        <div className="panel bg-[#16192b] border border-[#2e334d] p-6 rounded-2xl flex flex-col gap-3">
          <div className="p-3 bg-emerald-500/20 rounded-xl border border-emerald-500/30 w-fit">
            <ShieldCheck className="w-6 h-6 text-emerald-400" />
          </div>
          <h3 className="text-lg font-bold text-white">Standard Baselines</h3>
          <p className="text-sm text-slate-400">Configured human scores, PPO, and CleanRL / JAX DQN evaluation standard references.</p>
        </div>
      </div>

      <div className="panel bg-[#16192b] border border-[#2e334d] p-8 rounded-2xl flex flex-col items-center justify-center text-center py-16 gap-4">
        <Cpu className="w-12 h-12 text-indigo-400 animate-pulse" />
        <h2 className="text-xl font-bold text-white">Environment Explorer & Inspector</h2>
        <p className="text-slate-400 max-w-lg text-sm">
          Interactive environment parameter inspector, state representation breakdown, and step-by-step frame debugger tab will be completed here.
        </p>
      </div>
    </div>
  );
};

export default EnvironmentsView;
