import os
import json
import glob
from pathlib import Path
import csv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Dict, Any, Optional

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

BASE_DIR = Path("/Users/kantoz/Research/legps/thesis/runs")

class RunInfo(BaseModel):
    id: str
    config: Dict[str, Any]
    has_metrics: bool
    has_logs: bool

@app.get("/api/runs", response_model=List[RunInfo])
def get_runs():
    runs = []
    if not BASE_DIR.exists():
        return runs

    for entry in os.scandir(BASE_DIR):
        if entry.is_dir():
            run_id = entry.name
            run_path = Path(entry.path)
            config_path = run_path / "config.json"
            
            if not config_path.exists():
                continue
                
            config_data = {}
            try:
                with open(config_path, "r") as f:
                    config_data = json.load(f)
            except Exception:
                continue
                
            if "game" not in config_data:
                continue
            
            has_metrics = (run_path / "metrics").exists() and any((run_path / "metrics").glob("*.jsonl"))
            
            tag = config_data.get("tag", "")
            has_logs = any(run_path.glob("*.log")) or (run_path / "detailed_log.md").exists()
            if not has_logs:
                if tag and (BASE_DIR / f"{tag}_live.log").exists():
                    has_logs = True
                else:
                    parts = run_id.split("_")
                    suffix = parts[-1] if len(parts) > 0 else run_id
                    has_logs = any(BASE_DIR.glob(f"*{suffix}*.log"))
            
            # Extract basic tags from run_id if config misses them
            if "model" not in config_data:
                config_data["model"] = "unknown"
            
            runs.append(RunInfo(
                id=run_id,
                config=config_data,
                has_metrics=has_metrics,
                has_logs=has_logs
            ))
            
    # Sort runs by name (which starts with date) in descending order
    runs.sort(key=lambda x: x.id, reverse=True)
    return runs

@app.get("/api/runs/{run_id}/metrics")
def get_run_metrics(run_id: str):
    run_path = BASE_DIR / run_id
    if not run_path.exists():
        raise HTTPException(status_code=404, detail="Run not found")
        
    metrics_path = run_path / "metrics"
    if not metrics_path.exists():
        return {"data": []}
        
    metrics_data = []
    # Read iter*_cma.jsonl files
    for filepath in sorted(metrics_path.glob("iter*_cma.jsonl")):
        try:
            with open(filepath, "r") as f:
                for line in f:
                    if line.strip():
                        try:
                            item = json.loads(line)
                            metrics_data.append(item)
                        except json.JSONDecodeError:
                            continue
        except Exception as e:
            pass
            
    return {"data": metrics_data}

@app.get("/api/runs/{run_id}/logs")
def get_run_logs(run_id: str):
    run_path = BASE_DIR / run_id
    if not run_path.exists():
        raise HTTPException(status_code=404, detail="Run not found")
        
    logs = ""
    # Try inside run folder
    run_logs = list(run_path.glob("*.log"))
    if (run_path / "detailed_log.md").exists():
        run_logs.append(run_path / "detailed_log.md")
        
    if run_logs:
        for log_file in run_logs:
            logs += f"--- {log_file.name} ---\n"
            try:
                with open(log_file, "r") as f:
                    logs += f.read()
            except Exception:
                logs += "Error reading log.\n"
            logs += "\n"
    else:
        # Try outside in root runs dir matching the tag in config.json
        config_path = run_path / "config.json"
        tag = ""
        if config_path.exists():
            try:
                with open(config_path, "r") as f:
                    config_data = json.load(f)
                    tag = config_data.get("tag", "")
            except Exception:
                pass
                
        if tag and (BASE_DIR / f"{tag}_live.log").exists():
            log_file = BASE_DIR / f"{tag}_live.log"
            logs += f"--- {log_file.name} ---\n"
            try:
                with open(log_file, "r") as f:
                    logs += f.read()
            except Exception:
                logs += "Error reading log.\n"
            logs += "\n"
        else:
            # Fallback to suffix matching
            parts = run_id.split("_")
            suffix = parts[-1] if len(parts) > 0 else run_id
            possible_logs = list(BASE_DIR.glob(f"*{suffix}*.log"))
            for log_file in possible_logs:
                logs += f"--- {log_file.name} ---\n"
                try:
                    with open(log_file, "r") as f:
                        logs += f.read()
                except Exception:
                    logs += "Error reading log.\n"
                logs += "\n"

    if not logs:
        logs = "No logs found for this run."
        
    return {"logs": logs}

@app.get("/api/baselines")
def get_baselines():
    baselines_file = Path("/Users/kantoz/Research/legps/thesis/data/baselines.csv")
    if not baselines_file.exists():
        return {"data": []}
    
    baselines = []
    try:
        with open(baselines_file, "r") as f:
            reader = csv.DictReader(f)
            for row in reader:
                try:
                    baselines.append({
                        "game": row["Game"],
                        "ppo": float(row["PPO"]),
                        "dqn": float(row["DQN"]),
                        "human": float(row["Human"]),
                        "random": float(row["Random"])
                    })
                except ValueError:
                    pass
    except Exception as e:
        pass
    return {"data": baselines}

from fastapi.staticfiles import StaticFiles
import subprocess
import sys

app.mount("/runs", StaticFiles(directory=str(BASE_DIR)), name="runs")

@app.post("/api/runs/{run_id}/render")
def render_video(run_id: str, iter: Optional[int] = 0):
    run_path = BASE_DIR / run_id
    if not run_path.exists():
        raise HTTPException(status_code=404, detail="Run not found")
        
    config_path = run_path / "config.json"
    if not config_path.exists():
        raise HTTPException(status_code=404, detail="Config not found")
        
    with open(config_path, "r") as f:
        cfg = json.load(f)
        
    game = cfg.get("game", "kangaroo")
    noise = cfg.get("noise", cfg.get("obs_noise_std", 2.0))
    
    # Check for policy file for specific iteration or best
    pol_file = run_path / "policies" / f"iter{iter:02d}.py"
    if not pol_file.exists():
        pol_file = run_path / "best_policy.py"
    if not pol_file.exists():
        raise HTTPException(status_code=404, detail="Policy file not found")
        
    videos_dir = run_path / "videos"
    videos_dir.mkdir(parents=True, exist_ok=True)
    video_filename = f"iter{iter:02d}.mp4"
    video_path = videos_dir / video_filename
    
    # Render if not already rendered
    if not video_path.exists():
        cmd = [
            sys.executable,
            "/Users/kantoz/Research/legps/thesis/scripts/render.py",
            "--game", str(game),
            "--policy", str(pol_file),
            "--noise", str(noise),
            "--out", str(video_path)
        ]
        try:
            res = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
            if res.returncode != 0:
                raise HTTPException(status_code=500, detail=f"Rendering failed: {res.stderr}")
        except subprocess.TimeoutExpired:
            raise HTTPException(status_code=500, detail="Rendering timed out")
            
    return {"video_url": f"/runs/{run_id}/videos/{video_filename}"}

@app.get("/api/runs/{run_id}/video_status")
def get_video_status(run_id: str, iter: Optional[int] = 0):
    run_path = BASE_DIR / run_id
    video_filename = f"iter{iter:02d}.mp4"
    video_path = run_path / "videos" / video_filename
    if video_path.exists():
        return {"exists": True, "video_url": f"/runs/{run_id}/videos/{video_filename}"}
    return {"exists": False, "video_url": None}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
