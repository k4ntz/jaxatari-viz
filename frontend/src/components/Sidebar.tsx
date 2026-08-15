import React, { useState, useEffect } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { Activity, BarChart2, FileText, Moon, Sun, Gamepad2, Code2, BookOpen, ExternalLink, ChevronDown, Layers } from 'lucide-react';

interface SidebarProps {
  theme?: string;
  toggleTheme?: () => void;
}

const Sidebar: React.FC<SidebarProps> = ({ theme = 'light', toggleTheme }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const isCompareRoute = location.pathname.startsWith('/compare');
  const [compareExpanded, setCompareExpanded] = useState(isCompareRoute);

  useEffect(() => {
    if (isCompareRoute) {
      setCompareExpanded(true);
    }
  }, [isCompareRoute]);

  const handleCompareClick = (e: React.MouseEvent) => {
    e.preventDefault();
    setCompareExpanded(prev => !prev);
    navigate('/compare_on_jaxatari');
  };

  return (
    <div className="w-64 bg-[#16192b] border-r border-[#2e334d] h-full flex flex-col justify-between shadow-lg z-10 relative shrink-0">
      <div>
        <div className="p-6 border-b border-[#2e334d] flex items-center gap-3">
          <div className="p-2 bg-indigo-500/20 rounded-lg border border-indigo-500/30 shadow-glow">
            <Activity className="text-indigo-400 w-6 h-6" />
          </div>
          <div className="flex-1 flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold text-gradient-accent">
                JAXAtari
              </h1>
            </div>
            {toggleTheme && (
              <button 
                onClick={toggleTheme}
                className="p-2 rounded-lg bg-[rgba(0,0,0,0.2)] hover:bg-[rgba(255,255,255,0.05)] border border-[#2e334d] transition-colors flex items-center justify-center shrink-0 ml-2"
                title={`Switch to ${theme === 'dark' ? 'Light' : 'Dark'} Mode`}
              >
                {theme === 'dark' ? <Sun className="w-4 h-4 text-orange-400" /> : <Moon className="w-4 h-4 text-indigo-400" />}
              </button>
            )}
          </div>
        </div>

        <nav className="p-4 flex flex-col gap-2">
          <NavLink to="/environments" className={({isActive}) => `sidebar-link ${isActive ? 'active' : ''}`}>
            <Gamepad2 className="w-5 h-5" />
            <span>Environments</span>
          </NavLink>

          {/* Expandable Compare Runs Item */}
          <div className="flex flex-col gap-1">
            <div
              onClick={handleCompareClick}
              className={`sidebar-link cursor-pointer justify-between ${isCompareRoute ? 'active' : ''}`}
            >
              <div className="flex items-center gap-3">
                <BarChart2 className="w-5 h-5" />
                <span>Compare Runs</span>
              </div>
              <ChevronDown className={`w-4 h-4 transition-transform duration-200 ${compareExpanded ? 'rotate-180' : ''}`} />
            </div>

            {compareExpanded && (
              <div className="flex flex-col gap-1 ml-4 pl-3 border-l border-[#2e334d]/80 animate-in fade-in slide-in-from-top-2 duration-200">
                <NavLink
                  to="/compare_on_jaxatari"
                  className={({isActive}) => `sidebar-link text-xs py-2 px-3 ${isActive ? 'active text-indigo-300 font-semibold' : 'text-slate-400 hover:text-white'}`}
                >
                  <Layers className="w-3.5 h-3.5" />
                  <span>All JAXAtari Runs</span>
                </NavLink>

                <NavLink
                  to="/compare_env_scaling"
                  className={({isActive}) => `sidebar-link text-xs py-2 px-3 ${isActive ? 'active text-indigo-300 font-semibold' : 'text-slate-400 hover:text-white'}`}
                >
                  <Activity className="w-3.5 h-3.5" />
                  <span>Env Scalability (1→8192)</span>
                </NavLink>

                <NavLink
                  to="/compare_algorithms"
                  className={({isActive}) => `sidebar-link text-xs py-2 px-3 ${isActive ? 'active text-indigo-300 font-semibold' : 'text-slate-400 hover:text-white'}`}
                >
                  <BarChart2 className="w-3.5 h-3.5" />
                  <span>Algorithm Comparison</span>
                </NavLink>

                <NavLink
                  to="/compare_ale_jaxatari"
                  className={({isActive}) => `sidebar-link text-xs py-2 px-3 ${isActive ? 'active text-indigo-300 font-semibold' : 'text-slate-400 hover:text-white'}`}
                >
                  <BarChart2 className="w-3.5 h-3.5" />
                  <span>JAXAtari vs ALE</span>
                </NavLink>
              </div>
            )}
          </div>

          <NavLink to="/logs" className={({isActive}) => `sidebar-link ${isActive ? 'active' : ''}`}>
            <FileText className="w-5 h-5" />
            <span>Logs Explorer</span>
          </NavLink>
        </nav>
      </div>

      {/* External Resources Section */}
      <div className="p-4 border-t border-[#2e334d] flex flex-col gap-2">
        <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider px-3 mb-1">
          Resources
        </div>
        <a
          href="https://github.com/k4ntz/JAXAtari"
          target="_blank"
          rel="noopener noreferrer"
          className="sidebar-link hover:bg-slate-800/40 text-slate-300 hover:text-white transition-colors"
        >
          <Code2 className="w-4 h-4 text-indigo-400" />
          <span className="flex-1 text-xs">JAXAtari GitHub</span>
          <ExternalLink className="w-3 h-3 text-slate-500" />
        </a>
        <a
          href="https://arxiv.org"
          target="_blank"
          rel="noopener noreferrer"
          className="sidebar-link hover:bg-slate-800/40 text-slate-300 hover:text-white transition-colors"
        >
          <BookOpen className="w-4 h-4 text-emerald-400" />
          <span className="flex-1 text-xs">JAXAtari Paper</span>
          <ExternalLink className="w-3 h-3 text-slate-500" />
        </a>
      </div>
    </div>
  );
};

export default Sidebar;
