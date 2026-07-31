import os
import json
import csv
from pathlib import Path
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from typing import List, Dict, Any, Optional
import subprocess
import sys

from backend.adapters import load_config, get_adapter

app = FastAPI(title="JAXAtari-Viz Backend API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

CONFIG_PATH = Path("config.yaml")
if not CONFIG_PATH.exists():
    CONFIG_PATH = Path(__file__).parent.parent / "config.yaml"

APP_CONFIG = load_config(CONFIG_PATH)

class RunInfo(BaseModel):
    id: str
    project_name: str
    config: Dict[str, Any]
    has_metrics: bool
    has_logs: bool

def get_project_by_name(project_name: str) -> Optional[Dict[str, Any]]:
    for proj in APP_CONFIG.get("projects", []):
        if proj["name"] == project_name:
            return proj
    return None

@app.get("/api/config")
def get_app_config():
    return APP_CONFIG

@app.get("/api/runs", response_model=List[RunInfo])
def get_runs():
    runs = []
    projects = APP_CONFIG.get("projects", [])

    for proj in projects:
        project_name = proj.get("name", "Default Project")
        runs_dir = Path(proj.get("runs_dir", ""))
        adapter = get_adapter(proj.get("adapter", "auto"))

        if not runs_dir.exists():
            continue

        for entry in os.scandir(runs_dir):
            if entry.is_dir():
                run_folder_name = entry.name
                run_path = Path(entry.path)
                
                config_data = adapter.parse_config(run_path)
                if config_data is None:
                    continue

                # Ensure game and model fields exist or provide sensible defaults
                if "game" not in config_data:
                    config_data["game"] = config_data.get("env", "unknown_game")
                if "model" not in config_data:
                    config_data["model"] = config_data.get("method", "unknown_model")

                has_metrics = len(adapter.parse_metrics(run_path)) > 0
                raw_logs = adapter.parse_logs(run_path, runs_dir, config_data)
                has_logs = "No logs found for this run." not in raw_logs

                # Composite ID incorporating project to avoid collisions across projects
                composite_id = f"{project_name}::{run_folder_name}"

                runs.append(RunInfo(
                    id=composite_id,
                    project_name=project_name,
                    config=config_data,
                    has_metrics=has_metrics,
                    has_logs=has_logs
                ))

    # Sort runs by run folder name (descending)
    runs.sort(key=lambda x: x.id.split("::")[-1], reverse=True)
    return runs

@app.get("/api/runs/{run_id:path}/metrics")
def get_run_metrics(run_id: str):
    if "::" in run_id:
        project_name, run_folder = run_id.split("::", 1)
    else:
        project_name = APP_CONFIG.get("projects", [{}])[0].get("name", "")
        run_folder = run_id

    proj = get_project_by_name(project_name)
    if not proj:
        raise HTTPException(status_code=404, detail="Project not found")

    run_path = Path(proj["runs_dir"]) / run_folder
    if not run_path.exists():
        raise HTTPException(status_code=404, detail="Run not found")

    adapter = get_adapter(proj.get("adapter", "auto"))
    metrics_data = adapter.parse_metrics(run_path)
    return {"data": metrics_data}

@app.get("/api/runs/{run_id:path}/logs")
def get_run_logs(run_id: str):
    if "::" in run_id:
        project_name, run_folder = run_id.split("::", 1)
    else:
        project_name = APP_CONFIG.get("projects", [{}])[0].get("name", "")
        run_folder = run_id

    proj = get_project_by_name(project_name)
    if not proj:
        raise HTTPException(status_code=404, detail="Project not found")

    runs_dir = Path(proj["runs_dir"])
    run_path = runs_dir / run_folder
    if not run_path.exists():
        raise HTTPException(status_code=404, detail="Run not found")

    adapter = get_adapter(proj.get("adapter", "auto"))
    config_data = adapter.parse_config(run_path) or {}
    logs = adapter.parse_logs(run_path, runs_dir, config_data)

    return {"logs": logs}

@app.get("/api/baselines")
def get_baselines():
    baselines = []
    for proj in APP_CONFIG.get("projects", []):
        baselines_file_str = proj.get("baselines_file")
        if baselines_file_str:
            baselines_file = Path(baselines_file_str)
            if baselines_file.exists():
                try:
                    with open(baselines_file, "r") as f:
                        reader = csv.DictReader(f)
                        for row in reader:
                            try:
                                baselines.append({
                                    "game": row.get("Game", row.get("game", "")),
                                    "ppo": float(row.get("PPO", row.get("ppo", 0))),
                                    "dqn": float(row.get("DQN", row.get("dqn", 0))),
                                    "human": float(row.get("Human", row.get("human", 0))),
                                    "random": float(row.get("Random", row.get("random", 0)))
                                })
                            except (ValueError, KeyError):
                                pass
                except Exception:
                    pass
    return {"data": baselines}

if __name__ == "__main__":
    import uvicorn
    server_cfg = APP_CONFIG.get("server", {})
    host = server_cfg.get("host", "0.0.0.0")
    port = server_cfg.get("port", 8000)
    uvicorn.run(app, host=host, port=port)
