import React, { useEffect, useState, useMemo } from 'react';
import { fetchEnvironments, fetchBaselines, type EnvironmentInfo, type BaselineInfo } from '../api';
import { Gamepad2, Search, Sliders, Layers, Award, Film, X } from 'lucide-react';

const EnvironmentsView: React.FC = () => {
  const [environments, setEnvironments] = useState<EnvironmentInfo[]>([]);
  const [baselines, setBaselines] = useState<Record<string, BaselineInfo>>({});
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  
  // Selected Environment for detail view
  const [activeEnv, setActiveEnv] = useState<EnvironmentInfo | null>(null);

  useEffect(() => {
    const loadData = async () => {
      try {
        const [envData, bData] = await Promise.all([
          fetchEnvironments(),
          fetchBaselines()
        ]);
        setEnvironments(envData);
        
        const bMap: Record<string, BaselineInfo> = {};
        bData.forEach(b => {
          bMap[b.game.toLowerCase()] = b;
          if (b.game.toLowerCase() === 'montezuma_revenge') {
            bMap['montezuma'] = b;
          }
        });
        setBaselines(bMap);
      } catch (err) {
        console.error("Failed to load environment data", err);
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, []);

  const categories = useMemo(() => {
    return Array.from(new Set(environments.map(e => e.category)));
  }, [environments]);

  const statuses = useMemo(() => {
    return Array.from(new Set(environments.map(e => e.status)));
  }, [environments]);

  const filteredEnvironments = useMemo(() => {
    return environments.filter(env => {
      const matchesSearch = env.name.toLowerCase().includes(searchTerm.toLowerCase()) || env.id.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesStatus = selectedStatus === 'all' || env.status === selectedStatus;
      const matchesCategory = selectedCategory === 'all' || env.category === selectedCategory;
      return matchesSearch && matchesStatus && matchesCategory;
    });
  }, [environments, searchTerm, selectedStatus, selectedCategory]);

  return (
    <div className="p-8 relative max-w-[1800px] mx-auto">
      {/* Header */}
      <div className="flex items-end justify-between mb-8 pb-6 border-b border-[#2e334d]">
        <div>
          <h1 className="text-3xl font-bold text-white mb-2 tracking-tight">Atari Environments</h1>
          <p className="text-slate-400">Environment status, available game modifications, animated previews, and baselines.</p>
        </div>
        <div className="badge border-indigo-500 text-indigo-400 bg-indigo-500/10 flex items-center gap-1.5 px-3.5 py-1.5">
          <Gamepad2 className="w-4 h-4 text-indigo-400" />
          <span>{environments.length} Total Environments</span>
        </div>
      </div>

      {/* Filter and Search Bar Panel */}
      <div className="bg-[#16192b] border border-[#2e334d] p-6 rounded-2xl flex flex-col gap-6 mb-8">
        <div className="flex items-center justify-between border-b border-[#2e334d] pb-4">
          <div className="flex items-center gap-2">
            <Sliders className="w-5 h-5 text-indigo-400" />
            <h2 className="text-base font-bold text-white tracking-wide">Environment Gallery Filters</h2>
          </div>
          <div className="relative group">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-indigo-400 transition-colors" />
            <input 
              type="text" 
              placeholder="Search environment..." 
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="bg-[rgba(0,0,0,0.3)] border border-[#2e334d] rounded-xl pl-9 pr-4 py-2 text-sm text-white focus:outline-none focus:border-indigo-500 transition-all shadow-inner w-64"
            />
          </div>
        </div>

        {/* Categories & Quality Status Filters using Filter Chip Pills */}
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Quality / Status</span>
            <div className="filter-chip-group">
              <button
                onClick={() => setSelectedStatus('all')}
                className={`filter-chip ${selectedStatus === 'all' ? 'active active-indigo' : ''}`}
              >
                <span className={`filter-chip-indicator ${selectedStatus === 'all' ? 'bg-indigo-400' : 'bg-slate-600'}`} />
                <span className="filter-chip-label">All Statuses</span>
              </button>
              {statuses.map(st => (
                <button
                  key={st}
                  onClick={() => setSelectedStatus(st)}
                  className={`filter-chip ${selectedStatus === st ? 'active active-indigo' : ''}`}
                >
                  <span className={`filter-chip-indicator ${selectedStatus === st ? 'bg-indigo-400' : 'bg-slate-600'}`} />
                  <span className="filter-chip-label">{st}</span>
                </button>
              ))}
            </div>
          </div>

          {categories.length > 1 && (
            <div className="flex flex-col gap-2">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Category</span>
              <div className="filter-chip-group">
                <button
                  onClick={() => setSelectedCategory('all')}
                  className={`filter-chip ${selectedCategory === 'all' ? 'active active-purple' : ''}`}
                >
                  <span className={`filter-chip-indicator ${selectedCategory === 'all' ? 'bg-purple-400' : 'bg-slate-600'}`} />
                  <span className="filter-chip-label">All Categories</span>
                </button>
                {categories.map(cat => (
                  <button
                    key={cat}
                    onClick={() => setSelectedCategory(cat)}
                    className={`filter-chip ${selectedCategory === cat ? 'active active-purple' : ''}`}
                  >
                    <span className={`filter-chip-indicator ${selectedCategory === cat ? 'bg-purple-400' : 'bg-slate-600'}`} />
                    <span className="filter-chip-label">{cat}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Loading state */}
      {loading && (
        <div className="flex items-center justify-center p-12 text-slate-400">
          <Gamepad2 className="w-8 h-8 animate-pulse text-indigo-400 mr-3" />
          <span>Loading JAXAtari Environment catalog...</span>
        </div>
      )}

      {/* Environment Cards Grid */}
      {!loading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6 mb-12">
          {filteredEnvironments.map(env => {
            const baseline = baselines[env.id.toLowerCase()] || baselines[env.name.toLowerCase()];
            return (
              <div 
                key={env.id}
                onClick={() => setActiveEnv(env)}
                className="panel bg-[#16192b] border border-[#2e334d] hover:border-indigo-500/50 p-5 rounded-2xl flex flex-col justify-between gap-4 cursor-pointer group transition-all hover:shadow-lg hover:shadow-indigo-500/10 relative overflow-hidden"
              >
                {/* GIF Preview Header or Placeholder */}
                <div className="w-full h-36 bg-[#0f111a] border border-[#2e334d] rounded-xl overflow-hidden flex items-center justify-center relative group-hover:border-indigo-500/30 transition-colors">
                  {env.has_gif ? (
                    <img 
                      src={`http://localhost:8000${env.gif_url}`} 
                      alt={env.name}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      loading="lazy"
                    />
                  ) : (
                    <div className="flex flex-col items-center gap-2 text-slate-600">
                      <Film className="w-8 h-8 opacity-40" />
                      <span className="text-xs italic">No preview available</span>
                    </div>
                  )}
                  
                  {/* Status Medal Badge Overlay - Top Left */}
                  <div className="absolute top-2.5 left-2.5 bg-slate-950/85 backdrop-blur-md px-3 py-1.5 rounded-xl border border-slate-700/60 text-2xl font-extrabold text-white flex items-center justify-center shadow-lg z-10">
                    <span>{env.status}</span>
                  </div>
                </div>

                {/* Env Info */}
                <div>
                  <h3 className="text-lg font-bold text-white group-hover:text-indigo-300 transition-colors flex items-center gap-2">
                    {env.name}
                  </h3>
                  <p className="text-xs text-slate-400 mt-1 font-mono">{env.id}</p>
                </div>

                {/* Metrics Badges */}
                <div className="flex items-center justify-between border-t border-[#2e334d] pt-3 text-xs text-slate-300">
                  <div className="flex items-center gap-1.5 text-slate-400">
                    <Layers className="w-3.5 h-3.5 text-purple-400" />
                    <span>{env.mods_count} Mods</span>
                  </div>

                  {baseline && (
                    <div className="flex items-center gap-1 text-emerald-400 font-medium">
                      <Award className="w-3.5 h-3.5" />
                      <span>Human: {baseline.human}</span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Detail Inspector Modal */}
      {activeEnv && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in">
          <div className="bg-[#16192b] border border-[#2e334d] p-8 rounded-3xl max-w-2xl w-full flex flex-col gap-6 relative shadow-2xl">
            <button 
              onClick={() => setActiveEnv(null)}
              className="absolute top-6 right-6 p-2 rounded-xl bg-slate-800/50 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-3">
              <div className="p-3 bg-indigo-500/20 rounded-2xl border border-indigo-500/30">
                <Gamepad2 className="w-7 h-7 text-indigo-400" />
              </div>
              <div>
                <h2 className="text-2xl font-bold text-white">{activeEnv.name}</h2>
                <span className="text-xs font-mono text-indigo-300">{activeEnv.id}</span>
              </div>
              <span className="badge ml-auto text-sm px-3 py-1 bg-slate-800 border border-slate-700 text-white">
                {activeEnv.status}
              </span>
            </div>

            {/* Media Animation Preview */}
            <div className="w-full h-56 bg-[#0f111a] border border-[#2e334d] rounded-2xl overflow-hidden flex items-center justify-center">
              {activeEnv.has_gif ? (
                <img 
                  src={`http://localhost:8000${activeEnv.gif_url}`} 
                  alt={activeEnv.name}
                  className="h-full object-contain"
                />
              ) : (
                <div className="flex flex-col items-center gap-2 text-slate-500">
                  <Film className="w-10 h-10 opacity-40" />
                  <span>No gameplay GIF preview recorded for this environment</span>
                </div>
              )}
            </div>

            {/* Details & Baselines Breakdown */}
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div className="p-4 bg-slate-900/50 border border-[#2e334d] rounded-xl flex flex-col gap-1">
                <span className="text-xs text-slate-400 uppercase font-bold tracking-wider">Available Game Mods</span>
                <span className="text-lg font-bold text-purple-300">{activeEnv.mods_count} Mods</span>
              </div>

              <div className="p-4 bg-slate-900/50 border border-[#2e334d] rounded-xl flex flex-col gap-1">
                <span className="text-xs text-slate-400 uppercase font-bold tracking-wider">Category / Suite</span>
                <span className="text-lg font-bold text-indigo-300">{activeEnv.category}</span>
              </div>
            </div>

            {baselines[activeEnv.id.toLowerCase()] && (
              <div className="p-4 bg-slate-900/50 border border-[#2e334d] rounded-xl flex flex-col gap-2">
                <span className="text-xs text-slate-400 uppercase font-bold tracking-wider mb-1">Standard Baselines</span>
                <div className="grid grid-cols-4 gap-2 text-center text-xs">
                  <div className="bg-slate-800/80 p-2 rounded-lg border border-slate-700">
                    <div className="text-slate-400">Human</div>
                    <div className="font-bold text-emerald-400 text-sm mt-0.5">{baselines[activeEnv.id.toLowerCase()].human}</div>
                  </div>
                  <div className="bg-slate-800/80 p-2 rounded-lg border border-slate-700">
                    <div className="text-slate-400">PPO</div>
                    <div className="font-bold text-indigo-400 text-sm mt-0.5">{baselines[activeEnv.id.toLowerCase()].ppo}</div>
                  </div>
                  <div className="bg-slate-800/80 p-2 rounded-lg border border-slate-700">
                    <div className="text-slate-400">DQN</div>
                    <div className="font-bold text-purple-400 text-sm mt-0.5">{baselines[activeEnv.id.toLowerCase()].dqn}</div>
                  </div>
                  <div className="bg-slate-800/80 p-2 rounded-lg border border-slate-700">
                    <div className="text-slate-400">Random</div>
                    <div className="font-bold text-slate-300 text-sm mt-0.5">{baselines[activeEnv.id.toLowerCase()].random}</div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default EnvironmentsView;
