import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Sidebar from './components/Sidebar';
import ComparisonView from './components/ComparisonView';
import RunDetails from './components/RunDetails';
import LogsExplorer from './components/LogsExplorer';

function App() {
  const [selectedRuns, setSelectedRuns] = React.useState<string[]>([]);
  const [theme, setTheme] = React.useState<string>(() => {
    return localStorage.getItem('theme') || 'light';
  });

  React.useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  const toggleTheme = () => setTheme(prev => prev === 'dark' ? 'light' : 'dark');

  return (
    <BrowserRouter>
      <div className="flex h-full w-full bg-[#0f111a] text-[#f8fafc]">
        {/* Sidebar */}
        <Sidebar selectedRuns={selectedRuns} setSelectedRuns={setSelectedRuns} theme={theme} toggleTheme={toggleTheme} />

        {/* Main Content Area */}
        <main className="flex-1 flex flex-col h-full overflow-y-auto">
          <Routes>
            <Route path="/" element={<Navigate to="/compare" replace />} />
            <Route path="/compare" element={<ComparisonView selectedRuns={selectedRuns} theme={theme} />} />
            <Route path="/run/:runId" element={<RunDetails />} />
            <Route path="/logs" element={<LogsExplorer selectedRuns={selectedRuns} />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}

export default App;
