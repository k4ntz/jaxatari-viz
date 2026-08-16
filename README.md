# JAXAtari-Viz

An extensible, web-based visualization dashboard and experiment tracker for JAXAtari and Reinforcement Learning / Evolutionary algorithms (DQN, PPO, CMA-ES, LLM policies, etc.).

## Features
- **Multi-Project Support**: Monitor and compare experiment runs across multiple repository directories from a single unified interface.
- **Pluggable Adapter System**: Ingest custom metrics (`jsonl`, `json`) and logs seamlessly.
- **Interactive Plotly Visualizations**: Progress curves, game score benchmarking against PPO/DQN/Human baselines, and logs exploration.
- **Protocol-aware LeGPS/LeGPS2 Views**: Direct `iterNN_eval.json` ingestion, noisy/clean/sticky evaluations, per-seed returns, CMA challenger/incumbent diagnostics, and distinct numeric-minimum vs. localization seeds.
- **Comparable Interaction Axes**: Current LeGPS2 curves use exact cumulative primary environment steps, so they can be compared with DQN/Rainbow-style learning curves without treating one CMA generation as one frame.
- **Episode Completion Semantics**: Terminal episodes and horizon-capped episodes are shown separately; a historical Pong trace ending 19–0 is never labelled a completed win or a score of 21−2.
- **Verified Media**: Content-addressed MP4s are served only when their policy, parameters, config, evaluation, renderer, seed, score, and video hashes match a versioned provenance manifest.
- **Transition Consistency Hooks**: Portable per-run trajectories can expose pre/post state hashes, proposed/executed actions, and an explicit video-frame/decision mapping.
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
pip install -r requirements.txt
```

> **Note on Video Rendering:** Generating rollout videos requires `jax`, `jaxlib`, and `ffmpeg` (or `imageio`). The backend will automatically detect and use the target repository's virtual environment (e.g. `thesis/.venv`) if present, or fallback to the active environment running `jaxatari-viz`.

**Frontend Setup:**
```bash
cd frontend
npm install
```

---

### 2. Configure Your Projects (`config.yaml`)
Edit `config.yaml` to point to the run folders of your projects:

```yaml
ale_baselines_file: "${THESIS_BASELINES_FILE:-../thesis/data/baselines.csv}"
jaxatari_dir: "${JAXATARI_DIR:-../JAXAtari}"
render_script: "${THESIS_RENDER_SCRIPT:-../thesis/scripts/render.py}"

projects:
  - name: "Thesis Policy Search"
    runs_dir: "${THESIS_RUNS_DIR:-../thesis/runs}"
    adapter: "cma_jsonl"

  - name: "JAXAtari DQN"
    runs_dir: "${DQN_RUNS_DIR:-../dqn/runs}"
    adapter: "standard_json"

server:
  host: "127.0.0.1"
  port: 8000
```

Paths are expanded from environment variables and resolved relative to `config.yaml`; no author-specific path is required. The browser uses same-origin `/api` and `/runs` URLs. Vite proxies these paths to `127.0.0.1:8000` during development.

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

## Scientific artifact semantics

- `/api/runs/{id}/metrics` returns CMA/training rows. Current CMA rows preserve the artifact's exact `global_gen`, `cma_sigma_before/after`, condition number, population/challenger distances, boundary fractions, search/monitor seed-set IDs, and `incumbent_updated` verdict. `challenger_accepted` is a normalized alias for that logged verdict. Only historical rows without a versioned seed protocol may receive a `seed_set_id` marked `seed_set_inferred=true`.
- `/api/runs/{id}/evaluations` returns normalized report-evaluation rows. `noisy.min_return_seed` is the numeric minimum-return episode; `noisy.localization_seed` is the progress-first lexicographic trace selected by the pipeline. They are intentionally not conflated.
- Current CMA rows also carry cumulative episode-evaluation, policy-decision, and primary-environment-step counts. Cross-algorithm plots use the environment-step count (or a native RL step field) and omit legacy generation-only records rather than silently mixing units.
- Evaluation completion comes from explicit termination/truncation fields. For legacy Pong artifacts only, a sub-21 score pair is conservatively inferred to be incomplete and is labelled as a legacy inference.
- Comparison summaries use the protocol-selected final champion for LeGPS and the final exact `ret_mean` for legacy runs. They never select the maximum training observation. Aggregates retain all runs/seeds.
- A missing human/random baseline produces a raw-score label on a single-game chart and exclusion with an explicit warning on normalized aggregate charts. Raw and normalized values are never mixed.

The normalized record contract is versioned in [`schemas/run-artifacts-v2.schema.json`](schemas/run-artifacts-v2.schema.json), and the portable trajectory manifest in [`schemas/trajectory-v1.schema.json`](schemas/trajectory-v1.schema.json). `/api/diagnostics` reports project availability, recursive cache state, baseline availability, schema versions, and bounded parse/cache events.

## Video and trajectory provenance

Legacy `videos/iterNN.mp4` files have no trustworthy link to an iteration and are reported as stale. Rendering writes `videos/cache/<input-sha256>.mp4` plus `videos/manifests/iterNN.json`; only a manifest whose input fingerprint, video content hash, localization seed, and replay score all verify is served. GIF fallback output is converted to H.264/yuv420p MP4 with `imageio-ffmpeg`.

Current thesis runs are read directly from their `legps.run-manifest.v1` registry and
content-addressed `legps.trajectory.v1` gzip artifacts. Their file hash and byte count are checked
before use. The following standalone viewer format remains supported for older producers:

```text
trajectories/
  iter00.jsonl
  iter00.manifest.json
```

The manifest should use schema `jaxatari-viz.trajectory.v1`, name `data_file` relative to the run, and include its `sha256`. Each JSONL transition should include `decision_t`, `phase`, `policy_action`, `executed_action`, `reward`, `done`, `pre_state_hash`, `post_state_hash`, `video_state_hash`, and `video_frame`. Shared SQLite integer IDs are displayed only as warnings and are never dereferenced because they are not portable across database copies.

Frame mapping is explicit: video frame 0 is the initial pre-action state; subsequent frame `k` is the post-action state for decision `(k-1) * stride`. State consistency remains unverified until the packaged trajectory contains hashes.

## Validation

```bash
python -m unittest discover -s tests -v
python -m py_compile backend/main.py backend/adapters.py
cd frontend && npm ci && npm run build && npm run lint
```

GitHub Actions runs the backend tests/compile checks and the frontend build/lint on every push and pull request.
