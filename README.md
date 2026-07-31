# Thesis Visualization Web App

I've successfully built the visualization web application based on our design discussions!

## Architecture & Stack
- **Backend**: FastAPI (Python). It automatically scans your `/Users/kantoz/Research/legps/thesis/runs` directory, parsing configuration files (`config.json`), metrics (`iter*_cma.jsonl`), and logs.
- **Frontend**: React + Vite + TypeScript.
- **Charting**: `plotly.js` via `react-plotly.js` for highly interactive data science charts.
- **Styling**: Premium dark mode aesthetics using pure CSS custom properties (`index.css`) and Tailwind-like utility classes.

## Features Built
1. **Sidebar Navigation & Filtering**: 
   - Dynamically extracts available configurations (e.g., Models, Methods) from your runs.
   - Provides checkboxes to quickly filter and select runs.
2. **Comparison View** (`/compare`):
   - Side-by-side Plotly charts plotting progress curves (Best Fitness, Game Score, and Min Y).
3. **Run Details View** (`/run/:runId`):
   - Click on any run in the sidebar to view its specific configuration (`config.json`), a dedicated progress chart, and a searchable/scrollable view of its raw logs (`*.log`).
4. **Logs Explorer** (`/logs`):
   - A dedicated interface to view logs from multiple runs simultaneously, complete with a text search filter to quickly find specific events (e.g., "exception", "error") across all selected runs.

## How to use
Both the backend and frontend servers have been started in the background.

- **Frontend URL**: [http://localhost:5173](http://localhost:5173) (or whatever port Vite assigned, usually 5173)
- **Backend API**: [http://localhost:8000](http://localhost:8000)

If you ever need to restart them manually in the future, you can run:

**Backend:**
```bash
cd /Users/kantoz/Research/legps/thesis
.venv/bin/python -m uvicorn viz_app.backend.main:app --reload --port 8000
```

**Frontend:**
```bash
cd /Users/kantoz/Research/legps/thesis/viz_app/frontend
npm run dev
```

Let me know if you'd like to adjust any of the charts, refine the parsing logic for specific metric keys, or add more views!
