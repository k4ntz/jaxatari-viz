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

def scan_run_folders(runs_dir: Path) -> List[tuple[Path, str]]:
    """Yield (run_path, relative_run_folder) for direct or nested run directories."""
    found = []
    if not runs_dir.exists():
        return found

    for entry in os.scandir(runs_dir):
        if entry.is_dir():
            p = Path(entry.path)
            # Check if this directory itself is a run folder
            if (p / "meta.json").exists() or (p / "config.json").exists() or (p / "results.json").exists() or (p / "history.csv").exists() or (p / "best.json").exists():
                found.append((p, p.name))
            else:
                # Check 1 level deeper for nested project folders (e.g. blendrl/, ppo/)
                try:
                    for sub_entry in os.scandir(p):
                        if sub_entry.is_dir():
                            sp = Path(sub_entry.path)
                            if (sp / "meta.json").exists() or (sp / "config.json").exists() or (sp / "results.json").exists() or (sp / "history.csv").exists() or (sp / "best.json").exists():
                                found.append((sp, f"{p.name}/{sp.name}"))
                except Exception:
                    pass
    return found

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

        for run_path, run_folder_name in scan_run_folders(runs_dir):
            config_data = adapter.parse_config(run_path)
            if config_data is None:
                continue

            # Ensure game, method, and model fields exist
            if "game" not in config_data or config_data["game"] == "unknown_game":
                config_data["game"] = config_data.get("env_name", config_data.get("env", "unknown_game"))
            if "method" not in config_data or config_data["method"] == "unknown_method":
                config_data["method"] = config_data.get("algorithm", "BlendRL" if "blend" in str(config_data.get("wandb_project_name", "")).lower() else "unknown_method")
            if "model" not in config_data or config_data["model"] == "unknown_model":
                config_data["model"] = config_data.get("exp_name", config_data.get("method", "unknown_model"))

            metrics_data = adapter.parse_metrics(run_path) or []
            has_metrics = len(metrics_data) > 0
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

import hashlib

CACHE_DIR = Path(__file__).parent / ".cache"
CACHE_DIR.mkdir(parents=True, exist_ok=True)

def compute_run_hash(run_path: Path) -> str:
    fingerprints = [f"{f.name}:{f.stat().st_mtime}:{f.stat().st_size}" for f in sorted(run_path.glob("*")) if f.is_file()]
    return hashlib.sha256(";".join(fingerprints).encode()).hexdigest()

def get_run_cached_data(run_path: Path, rel_folder: str, adapter) -> Dict[str, Any]:
    run_hash = compute_run_hash(run_path)
    cache_file = CACHE_DIR / f"{hashlib.md5(rel_folder.encode()).hexdigest()}.json"

    if cache_file.exists():
        try:
            with open(cache_file, "r") as f:
                cdata = json.load(f)
            if cdata.get("hash") == run_hash:
                return cdata
        except Exception:
            pass

    metrics = adapter.parse_metrics(run_path) or []
    max_ret = None
    max_fitness = None
    min_y = None

    for m in metrics:
        if isinstance(m, dict):
            if "ret_mean" in m and m["ret_mean"] is not None:
                max_ret = max(max_ret, m["ret_mean"]) if max_ret is not None else m["ret_mean"]
            if "best_fitness" in m and m["best_fitness"] is not None:
                max_fitness = max(max_fitness, m["best_fitness"]) if max_fitness is not None else m["best_fitness"]
            if "min_y_best" in m and m["min_y_best"] is not None:
                min_y = min(min_y, m["min_y_best"]) if min_y is not None else m["min_y_best"]

    cdata = {
        "hash": run_hash,
        "max_ret_mean": max_ret,
        "max_best_fitness": max_fitness,
        "min_y_best": min_y,
        "metrics": metrics
    }

    try:
        with open(cache_file, "w") as f:
            json.dump(cdata, f)
    except Exception as e:
        print("Cache write error:", e)

    return cdata

@app.get("/api/comparison_summary")
def get_comparison_summary():
    summary_list = []
    projects = APP_CONFIG.get("projects", [])

    for proj in projects:
        project_name = proj.get("name", "Default Project")
        runs_dir = Path(proj.get("runs_dir", ""))
        adapter = get_adapter(proj.get("adapter", "auto"))

        if not runs_dir.exists():
            continue

        for run_path, run_folder_name in scan_run_folders(runs_dir):
            config_data = adapter.parse_config(run_path)
            if config_data is None:
                continue

            cdata = get_run_cached_data(run_path, run_folder_name, adapter)
            composite_id = f"{project_name}::{run_folder_name}"

            summary_list.append({
                "id": composite_id,
                "project_name": project_name,
                "game": config_data.get("game", "unknown_game"),
                "method": config_data.get("method", "unknown_method"),
                "model": config_data.get("model", "unknown_model"),
                "config": config_data,
                "max_ret_mean": cdata.get("max_ret_mean"),
                "max_best_fitness": cdata.get("max_best_fitness"),
                "min_y_best": cdata.get("min_y_best")
            })

    return {"summary": summary_list}

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
    cdata = get_run_cached_data(run_path, run_folder, adapter)
    return {"data": cdata.get("metrics", [])}

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

@app.get("/api/environments")
def get_environments():
    jaxatari_dir = Path("/Users/kantoz/Research/JAXAtari")
    games_covered_file = jaxatari_dir / "games_covered.md"
    gifs_dir = jaxatari_dir / "docs" / "source" / "_static" / "gifs"
    
    available_gifs = set()
    if gifs_dir.exists():
        for g in os.listdir(gifs_dir):
            if g.endswith(".gif"):
                available_gifs.add(g.replace(".gif", "").replace("_", "").lower())

    environments_dict = {}
    
    if games_covered_file.exists():
        try:
            content = games_covered_file.read_text()
            current_category = "General"
            
            for line in content.splitlines():
                line_str = line.strip()
                if line_str.startswith("## "):
                    current_category = line_str.replace("## ", "").strip()
                elif line_str.startswith("|") and not line_str.startswith("| Game") and not line_str.startswith("|---"):
                    parts = [p.strip() for p in line_str.split("|")[1:-1]]
                    if len(parts) >= 3:
                        game_name = parts[0]
                        status = parts[1]
                        mods_str = parts[2]
                        
                        try:
                            mods_count = int(mods_str)
                        except ValueError:
                            mods_count = 0
                            
                        # Normalize key for GIF lookup
                        normalized_key = game_name.replace("_", "").lower()
                        if normalized_key == "montezumarevenge":
                            normalized_key = "montezuma"
                        elif normalized_key == "mspacman":
                            normalized_key = "mspacman"
                            
                        has_gif = any(normalized_key in gif_key or gif_key in normalized_key for gif_key in available_gifs)
                        
                        # Store or update unique environment by ID (preferring entries with higher mod counts or GIF availability)
                        if game_name not in environments_dict or mods_count > environments_dict[game_name]["mods_count"]:
                            environments_dict[game_name] = {
                                "id": game_name,
                                "name": game_name.replace("_", " ").title(),
                                "category": current_category,
                                "status": status,
                                "mods_count": mods_count,
                                "has_gif": has_gif,
                                "gif_url": f"/api/environments/gif/{game_name}" if has_gif else None
                            }
        except Exception as e:
            print("Failed to parse games_covered.md:", e)

    # Convert to list and sort alphabetically by name
    environments = list(environments_dict.values())
    environments.sort(key=lambda x: x["name"])

    return {"environments": environments}

@app.get("/api/environments/gif/{game_id}")
def get_environment_gif(game_id: str):
    from fastapi.responses import FileResponse
    gifs_dir = Path("/Users/kantoz/Research/JAXAtari/docs/source/_static/gifs")
    
    if not gifs_dir.exists():
        raise HTTPException(status_code=404, detail="GIF directory not found")
        
    normalized_id = game_id.replace("_", "").lower()
    
    # Try exact or fuzzy matches
    for gif_file in os.listdir(gifs_dir):
        if gif_file.endswith(".gif"):
            gif_name = gif_file.replace(".gif", "").replace("_", "").lower()
            if gif_name == normalized_id or normalized_id in gif_name or gif_name in normalized_id:
                return FileResponse(gifs_dir / gif_file, media_type="image/gif")
                
    raise HTTPException(status_code=404, detail="GIF preview not found for environment")

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

@app.get("/runs/{run_id:path}/videos/{filename:path}")
def serve_video(run_id: str, filename: str):
    from fastapi.responses import FileResponse
    if "::" in run_id:
        project_name, run_folder = run_id.split("::", 1)
    else:
        project_name = APP_CONFIG.get("projects", [{}])[0].get("name", "")
        run_folder = run_id

    proj = get_project_by_name(project_name)
    if not proj:
        raise HTTPException(status_code=404, detail="Project not found")

    run_path = Path(proj["runs_dir"]) / run_folder
    video_path = run_path / "videos" / filename
    if not video_path.exists():
        video_path = run_path / "media" / "videos" / filename
    if not video_path.exists():
        video_path = run_path / filename

    if not video_path.exists():
        raise HTTPException(status_code=404, detail="Video file not found")

    media_type = "video/mp4"
    if filename.endswith(".gif"):
        media_type = "image/gif"
    elif filename.endswith(".webm"):
        media_type = "video/webm"

    return FileResponse(video_path, media_type=media_type)

@app.post("/api/runs/{run_id:path}/render")
def render_video(run_id: str, iter: Optional[int] = 0):
    if "::" in run_id:
        project_name, run_folder = run_id.split("::", 1)
    else:
        project_name = APP_CONFIG.get("projects", [{}])[0].get("name", "")
        run_folder = run_id

    proj = get_project_by_name(project_name)
    if not proj:
        raise HTTPException(status_code=404, detail=f"Project '{project_name}' not found")

    run_path = Path(proj["runs_dir"]) / run_folder
    if not run_path.exists():
        raise HTTPException(status_code=404, detail=f"Run directory not found: {run_path}")

    adapter = get_adapter(proj.get("adapter", "auto"))
    cfg = adapter.parse_config(run_path) or {}

    game = cfg.get("game", cfg.get("env", "kangaroo"))
    noise = cfg.get("noise", cfg.get("obs_noise_std", 2.0))

    pol_file = run_path / "policies" / f"iter{iter:02d}.py"
    if not pol_file.exists():
        pol_file = run_path / "best_policy.py"
    if not pol_file.exists():
        raise HTTPException(
            status_code=404,
            detail=f"Policy file not found for iter {iter} in {run_path} (checked iter{iter:02d}.py and best_policy.py)"
        )

    videos_dir = run_path / "videos"
    videos_dir.mkdir(parents=True, exist_ok=True)
    video_filename = f"iter{iter:02d}.mp4"
    video_path = videos_dir / video_filename

    if not video_path.exists():
        render_script = Path(__file__).parent.parent.parent / "thesis" / "scripts" / "render.py"
        if not render_script.exists():
            render_script = Path("/Users/kantoz/Research/legps/thesis/scripts/render.py")

        if not render_script.exists():
            raise HTTPException(status_code=500, detail=f"Render script not found at {render_script}")

        env_vars = os.environ.copy()
        repo_root = render_script.parent.parent
        env_vars["PYTHONPATH"] = str(repo_root) + os.pathsep + env_vars.get("PYTHONPATH", "")

        python_exe = sys.executable
        venv_python = repo_root / ".venv" / "bin" / "python"
        if venv_python.exists():
            python_exe = str(venv_python)

        cmd = [
            python_exe,
            str(render_script),
            "--game", str(game),
            "--policy", str(pol_file),
            "--noise", str(noise),
            "--out", str(video_path)
        ]

        try:
            res = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=120,
                cwd=str(repo_root),
                env=env_vars
            )
            if res.returncode != 0:
                err_msg = res.stderr.strip() or res.stdout.strip() or f"Process exited with code {res.returncode}"
                raise HTTPException(status_code=500, detail=f"Rendering failed: {err_msg}")
        except subprocess.TimeoutExpired:
            raise HTTPException(status_code=500, detail="Rendering timed out after 120 seconds")
        except Exception as e:
            if isinstance(e, HTTPException):
                raise e
            raise HTTPException(status_code=500, detail=f"Rendering error: {str(e)}")

    if not video_path.exists() and (videos_dir / f"iter{iter:02d}.gif").exists():
        video_filename = f"iter{iter:02d}.gif"

    return {"video_url": f"/runs/{run_id}/videos/{video_filename}"}

@app.get("/api/runs/{run_id:path}/video_status")
def get_video_status(run_id: str, iter: Optional[int] = 0):
    if "::" in run_id:
        project_name, run_folder = run_id.split("::", 1)
    else:
        project_name = APP_CONFIG.get("projects", [{}])[0].get("name", "")
        run_folder = run_id

    proj = get_project_by_name(project_name)
    if not proj:
        return {"exists": False, "video_url": None}

    run_path = Path(proj["runs_dir"]) / run_folder
    video_filename = f"iter{iter:02d}.mp4"
    video_path = run_path / "videos" / video_filename
    if video_path.exists():
        return {"exists": True, "video_url": f"/runs/{run_id}/videos/{video_filename}"}

    gif_filename = f"iter{iter:02d}.gif"
    gif_path = run_path / "videos" / gif_filename
    if gif_path.exists():
        return {"exists": True, "video_url": f"/runs/{run_id}/videos/{gif_filename}"}

    # Check for any video files in videos/ or media/videos/
    video_dirs = [run_path / "videos", run_path / "media" / "videos"]
    for vdir in video_dirs:
        if vdir.exists():
            for vfile in os.listdir(vdir):
                if vfile.endswith((".mp4", ".gif", ".webm")):
                    return {"exists": True, "video_url": f"/runs/{run_id}/videos/{vfile}"}

    return {"exists": False, "video_url": None}

if __name__ == "__main__":
    import uvicorn
    server_cfg = APP_CONFIG.get("server", {})
    host = server_cfg.get("host", "0.0.0.0")
    port = server_cfg.get("port", 8000)
    uvicorn.run(app, host=host, port=port)
