# JAXAtari-Viz

An extensible, web-based visualization dashboard and experiment tracker for JAXAtari and Reinforcement Learning / Evolutionary algorithms (DQN, PPO, CMA-ES, LLM policies, etc.).

## Features
- **Multi-Project Support**: Monitor and compare experiment runs across multiple repository directories from a single unified interface.
- **Pluggable Adapter System**: Ingest custom metrics (`jsonl`, `json`) and logs seamlessly.
- **Interactive Plotly Visualizations**: Progress curves, game score benchmarking against PPO/DQN/Human baselines, and logs exploration.
- **Dark/Light Theme**: Built with React, Vite, TypeScript, and pure CSS design tokens.

---

## Directory Architecture
```
jaxatari-viz/
├── config.yaml          # Multi-project directory and adapter settings
├── backend/             # FastAPI backend server
│   ├── main.py          # API endpoints & config loader
│   └── adapters.py      # Pluggable metric & log parser adapters
└── frontend/            # React + Vite + TypeScript frontend
```

---

## Quick Start

### 1. Install Dependencies
Make sure you have Python (>= 3.10) and Node.js installed.

**Backend Setup:**
```bash
python -m venv .venv
source .venv/bin/activate
pip install fastapi uvicorn pyyaml pydantic
```

**Frontend Setup:**
```bash
cd frontend
npm install
```

---

### 2. Configure Your Projects (`config.yaml`)
Edit `config.yaml` to point to the run folders of your projects:

```yaml
projects:
  - name: "Thesis Policy Search"
    runs_dir: "/path/to/thesis/runs"
    adapter: "cma_jsonl"
    baselines_file: "/path/to/thesis/data/baselines.csv"

  - name: "JAXAtari DQN"
    runs_dir: "/path/to/dqn/runs"
    adapter: "standard_json"

server:
  host: "0.0.0.0"
  port: 8000
```

---

### 3. Launch `jaxatari-viz`

**Start Backend:**
```bash
python -m uvicorn backend.main:app --reload --port 8000
```

**Start Frontend:**
```bash
cd frontend
npm run dev
```

Open your browser at [http://localhost:5173](http://localhost:5173).
