import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Sidebar from './components/Sidebar';
import ComparisonView from './components/ComparisonView';
import RunDetails from './components/RunDetails';
import LogsExplorer from './components/LogsExplorer';
import EnvironmentsView from './components/EnvironmentsView';
import EnvironmentDetails from './components/EnvironmentDetails';

function App() {
  const [selectedRuns, setSelectedRuns] = React.useState<string[]>(() => {
    try {
      const stored = localStorage.getItem('jaxatari_selected_runs');
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  const [theme, setTheme] = React.useState<string>(() => {
    return localStorage.getItem('theme') || 'light';
  });

  React.useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  React.useEffect(() => {
    try {
      localStorage.setItem('jaxatari_selected_runs', JSON.stringify(selectedRuns));
    } catch (e) {
      console.error('Failed to save selectedRuns to localStorage', e);
    }
  }, [selectedRuns]);

  const toggleTheme = () => setTheme(prev => (prev === 'dark' ? 'light' : 'dark'));

  return (
    <BrowserRouter>
      <div className="flex h-full w-full bg-[#0f111a] text-[#f8fafc]">
        {/* Sidebar */}
        <Sidebar theme={theme} toggleTheme={toggleTheme} />

        {/* Main Content Area */}
        <main className="flex-1 flex flex-col h-full overflow-y-auto">
          <Routes>
            <Route path="/" element={<Navigate to="/compare_on_jaxatari" replace />} />
            <Route path="/compare" element={<Navigate to="/compare_on_jaxatari" replace />} />
            <Route
              path="/compare_on_jaxatari"
              element={
                <ComparisonView
                  activeTab="jaxatari"
                  selectedRuns={selectedRuns}
                  setSelectedRuns={setSelectedRuns}
                  theme={theme}
                />
              }
            />
            <Route
              path="/compare_ale_jaxatari"
              element={
                <ComparisonView
                  activeTab="vs_ale"
                  selectedRuns={selectedRuns}
                  setSelectedRuns={setSelectedRuns}
                  theme={theme}
                />
              }
            />
            <Route path="/environments" element={<EnvironmentsView />} />
            <Route
              path="/environment/:envId"
              element={
                <EnvironmentDetails
                  selectedRuns={selectedRuns}
                  setSelectedRuns={setSelectedRuns}
                  theme={theme}
                />
              }
            />
            <Route path="/run/:runId" element={<RunDetails />} />
            <Route
              path="/logs"
              element={<LogsExplorer selectedRuns={selectedRuns} setSelectedRuns={setSelectedRuns} />}
            />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}

export default App;
