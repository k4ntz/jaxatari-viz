import os
import json
import gzip
import csv
import time
import hashlib
import re
import shutil
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from typing import List, Dict, Any, Optional
import subprocess
import sys

from backend.adapters import ARTIFACT_SCHEMA_VERSION, load_config, get_adapter

API_SCHEMA_VERSION = "jaxatari-viz.api.v2"
VIDEO_MANIFEST_SCHEMA_VERSION = "jaxatari-viz.video-manifest.v2"
TRAJECTORY_SCHEMA_VERSION = "jaxatari-viz.trajectory.v1"
LEGPS_TRAJECTORY_SCHEMA_VERSION = "legps.trajectory.v1"
LEGPS_RUN_MANIFEST_SCHEMA_VERSION = "legps.run-manifest.v1"

app = FastAPI(title="JAXAtari-Viz Backend API", version="2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin for origin in os.environ.get(
        "JAXATARI_VIZ_ALLOWED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
    ).split(",") if origin],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

CONFIG_PATH = Path("config.yaml")
if not CONFIG_PATH.exists():
    CONFIG_PATH = Path(__file__).parent.parent / "config.yaml"

APP_CONFIG = load_config(CONFIG_PATH)

_DIAGNOSTIC_EVENTS: List[Dict[str, Any]] = []


def record_diagnostic(kind: str, message: str, **context: Any) -> None:
    _DIAGNOSTIC_EVENTS.append({
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "kind": kind,
        "message": message,
        "context": context,
    })
    del _DIAGNOSTIC_EVENTS[:-200]


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def resolve_under(root: Path, relative: str | Path, *, must_exist: bool = False) -> Path:
    """Resolve a user-controlled path and prove it stays below the configured root."""
    root = root.resolve(strict=False)
    candidate = (root / Path(relative)).resolve(strict=False)
    try:
        candidate.relative_to(root)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Path escapes the configured project root") from exc
    if must_exist and not candidate.exists():
        raise HTTPException(status_code=404, detail="Requested artifact does not exist")
    return candidate

class RunInfo(BaseModel):
    id: str
    project_name: str
    config: Dict[str, Any]
    has_metrics: bool
    has_logs: bool
    backend: str = "jaxatari"
    obs_type: str = "pixels"

def get_project_by_name(project_name: str) -> Optional[Dict[str, Any]]:
    for proj in APP_CONFIG.get("projects", []):
        if proj["name"] == project_name:
            return proj
    return None


def resolve_run(run_id: str) -> tuple[str, Dict[str, Any], str, Path]:
    if "::" in run_id:
        project_name, run_folder = run_id.split("::", 1)
    else:
        project_name = APP_CONFIG.get("projects", [{}])[0].get("name", "")
        run_folder = run_id
    project = get_project_by_name(project_name)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    runs_dir = Path(project.get("runs_dir", "")).resolve(strict=False)
    run_path = resolve_under(runs_dir, run_folder, must_exist=True)
    if not run_path.is_dir():
        raise HTTPException(status_code=404, detail="Run not found")
    return project_name, project, run_folder, run_path

@app.get("/api/config")
def get_app_config():
    # Frontend colors/protocol hints are public; absolute host filesystem paths are not.
    return {
        "schema_version": API_SCHEMA_VERSION,
        "algorithm_colors": APP_CONFIG.get("algorithm_colors", {}),
        "algorithm_default_envs": APP_CONFIG.get("algorithm_default_envs", {}),
        "projects": [{
            key: project.get(key) for key in
            ("name", "adapter", "backend", "obs_type", "performance_metric", "primary_graphs", "color")
            if project.get(key) is not None
        } for project in APP_CONFIG.get("projects", [])],
    }

def scan_run_folders(runs_dir: Path) -> List[tuple[Path, str]]:
    """Yield (run_path, relative_run_folder) for direct or arbitrarily nested run directories."""
    found = []
    if not runs_dir.exists():
        return found

    for root, dirs, files in os.walk(runs_dir):
        # If this directory contains run markers, treat as a run folder and don't recurse into subdirectories
        if any(marker in files for marker in ("meta.json", "config.json", "results.json", "history.csv", "best.json")):
            p = Path(root)
            rel = p.relative_to(runs_dir).as_posix()
            found.append((p, rel))
            dirs.clear()

    return found

_RUNS_CACHE = {"fingerprint": None, "data": []}
_SUMMARY_CACHE = {"fingerprint": None, "data": []}

RELEVANT_ARTIFACT_NAMES = {"meta.json", "config.json", "results.json", "history.csv", "best.json",
                           "progress.csv", "detailed_log.md", "agent_card.json"}
RELEVANT_ARTIFACT_SUFFIXES = {".json", ".jsonl", ".csv", ".md", ".log", ".txt", ".py", ".parquet"}


def compute_projects_fingerprint() -> str:
    """Recursively fingerprint nested scientific artifacts across every project."""
    fingerprints: List[str] = []
    for proj in APP_CONFIG.get("projects", []):
        rdir = Path(proj.get("runs_dir", ""))
        project_name = str(proj.get("name", ""))
        fingerprints.append(f"project:{project_name}:{rdir}")
        if not rdir.exists():
            fingerprints.append("missing")
            continue
        try:
            for path in sorted(rdir.rglob("*")):
                if not path.is_file():
                    continue
                if "videos" in path.parts or ".cache" in path.parts:
                    continue
                if path.name not in RELEVANT_ARTIFACT_NAMES and path.suffix not in RELEVANT_ARTIFACT_SUFFIXES:
                    continue
                stat = path.stat()
                fingerprints.append(
                    f"{project_name}:{path.relative_to(rdir).as_posix()}:{stat.st_mtime_ns}:{stat.st_size}"
                )
        except OSError as exc:
            record_diagnostic("project_scan_error", str(exc), project=project_name)
    return hashlib.sha256("\n".join(fingerprints).encode()).hexdigest()

@app.get("/api/runs", response_model=List[RunInfo])
def get_runs():
    fingerprint = compute_projects_fingerprint()
    if _RUNS_CACHE["data"] and _RUNS_CACHE["fingerprint"] == fingerprint:
        return _RUNS_CACHE["data"]

    runs = []
    projects = APP_CONFIG.get("projects", [])

    for proj in projects:
        project_name = proj.get("name", "Default Project")
        runs_dir = Path(proj.get("runs_dir", "")).resolve(strict=False)
        adapter = get_adapter(proj.get("adapter", "auto"))

        proj_backend = proj.get("backend", "jaxatari")
        proj_obs_type = proj.get("obs_type", "pixels")

        if not runs_dir.exists():
            continue

        for run_path, run_folder_name in scan_run_folders(runs_dir):
            try:
                config_data = adapter.parse_config(run_path)
            except Exception as exc:
                record_diagnostic("config_parse_error", str(exc), project=project_name, run=run_folder_name)
                continue
            if config_data is None:
                continue

            # Ensure game, method, and model fields exist
            if "game" not in config_data or config_data["game"] == "unknown_game":
                config_data["game"] = config_data.get("env_name", config_data.get("env", "unknown_game"))
            if "method" not in config_data or config_data["method"] == "unknown_method":
                config_data["method"] = config_data.get("algorithm", "BlendRL" if "blend" in str(config_data.get("wandb_project_name", "")).lower() else "unknown_method")
            if "model" not in config_data or config_data["model"] == "unknown_model":
                config_data["model"] = config_data.get("exp_name", config_data.get("method", "unknown_model"))

            # Determine run-specific backend and obs_type
            backend = config_data.get("backend", proj_backend)
            if "PIXEL_BASED" in config_data:
                obs_type = "pixels" if config_data["PIXEL_BASED"] else "oc"
            elif "_pixel_" in run_folder_name.lower():
                obs_type = "pixels"
            elif "_oc_" in run_folder_name.lower():
                obs_type = "oc"
            else:
                obs_type = config_data.get("obs_type", proj_obs_type)

            # Store backend and obs_type directly on config_data as well
            config_data["backend"] = backend
            config_data["obs_type"] = obs_type

            # Fast existence checks without reading full CSV/log files
            has_metrics = (run_path / "history.csv").exists() or (run_path / "results.json").exists() or (run_path / "best.json").exists() or (run_path / "progress.csv").exists() or (run_path / "meta.json").exists()
            has_logs = (run_path / "output.log").exists() or (run_path / "stdout.log").exists() or (run_path / "train.log").exists() or any(run_path.glob("*.log")) or any(run_path.glob("*.txt"))

            # Composite ID incorporating project to avoid collisions across projects
            composite_id = f"{project_name}::{run_folder_name}"

            runs.append(RunInfo(
                id=composite_id,
                project_name=project_name,
                config=config_data,
                has_metrics=has_metrics,
                has_logs=has_logs,
                backend=backend,
                obs_type=obs_type
            ))

    # Sort runs by run folder name (descending)
    runs.sort(key=lambda x: x.id.split("::")[-1], reverse=True)
    _RUNS_CACHE["data"] = runs
    _RUNS_CACHE["fingerprint"] = fingerprint
    return runs

CACHE_DIR = Path(__file__).parent / ".cache"
CACHE_DIR.mkdir(parents=True, exist_ok=True)

def compute_run_hash(run_path: Path) -> str:
    fingerprints = []
    for path in sorted(run_path.rglob("*")):
        if not path.is_file() or "videos" in path.parts or ".cache" in path.parts:
            continue
        if path.name not in RELEVANT_ARTIFACT_NAMES and path.suffix not in RELEVANT_ARTIFACT_SUFFIXES:
            continue
        stat = path.stat()
        fingerprints.append(
            f"{path.relative_to(run_path).as_posix()}:{stat.st_mtime_ns}:{stat.st_size}"
        )
    return hashlib.sha256(";".join(fingerprints).encode()).hexdigest()

def get_run_cached_data(run_path: Path, project_name: str, rel_folder: str, adapter) -> Dict[str, Any]:
    run_hash = compute_run_hash(run_path)
    cache_identity = f"{ARTIFACT_SCHEMA_VERSION}::{project_name}::{run_path.resolve(strict=False)}::{rel_folder}"
    cache_file = CACHE_DIR / f"{hashlib.sha256(cache_identity.encode()).hexdigest()}.json"

    if cache_file.exists():
        try:
            with open(cache_file, "r") as f:
                cdata = json.load(f)
            if cdata.get("hash") == run_hash and cdata.get("schema_version") == ARTIFACT_SCHEMA_VERSION:
                return cdata
        except (OSError, json.JSONDecodeError) as exc:
            record_diagnostic("cache_read_error", str(exc), cache_file=str(cache_file))

    if hasattr(adapter, "diagnostics"):
        adapter.diagnostics.clear()
    try:
        metrics = adapter.parse_metrics(run_path) or []
    except Exception as exc:
        record_diagnostic("metrics_parse_error", str(exc), project=project_name, run=rel_folder)
        metrics = []
    try:
        evaluations = adapter.parse_evaluations(run_path) or []
    except Exception as exc:
        record_diagnostic("evaluation_parse_error", str(exc), project=project_name, run=rel_folder)
        evaluations = []
    parse_diagnostics = list(getattr(adapter, "diagnostics", []))
    for diagnostic in parse_diagnostics:
        record_diagnostic(
            diagnostic.get("kind", "artifact_parse_warning"),
            diagnostic.get("message", "Artifact parse warning"),
            project=project_name,
            run=rel_folder,
            artifact=Path(diagnostic.get("path", "")).name,
        )
    max_ret = None
    max_fitness = None
    min_y = None
    final_ret = None

    for m in metrics:
        if isinstance(m, dict):
            if "ret_mean" in m and m["ret_mean"] is not None:
                max_ret = max(max_ret, m["ret_mean"]) if max_ret is not None else m["ret_mean"]
                final_ret = m["ret_mean"]
            if "best_fitness" in m and m["best_fitness"] is not None:
                max_fitness = max(max_fitness, m["best_fitness"]) if max_fitness is not None else m["best_fitness"]
            if "min_y_best" in m and m["min_y_best"] is not None:
                min_y = min(min_y, m["min_y_best"]) if min_y is not None else m["min_y_best"]

    comparison_score = final_ret
    comparison_score_source = "final_observed_ret_mean" if final_ret is not None else None
    if evaluations:
        selected = next((row for row in evaluations if row.get("is_final_champion")), evaluations[-1])
        comparison_score = selected.get("robust_return_mean")
        comparison_score_source = "final_champion_noisy_mean"
        if comparison_score is None:
            comparison_score = selected.get("deterministic_return")
            comparison_score_source = "final_champion_deterministic_return"

    cdata = {
        "schema_version": ARTIFACT_SCHEMA_VERSION,
        "hash": run_hash,
        "max_ret_mean": max_ret,
        "final_ret_mean": final_ret,
        "comparison_score": comparison_score,
        "comparison_score_source": comparison_score_source,
        "max_best_fitness": max_fitness,
        "min_y_best": min_y,
        "metrics": metrics,
        "evaluations": evaluations,
        "parse_diagnostics": parse_diagnostics,
    }

    try:
        with open(cache_file, "w") as f:
            json.dump(cdata, f)
    except OSError as exc:
        record_diagnostic("cache_write_error", str(exc), cache_file=str(cache_file))

    return cdata

@app.get("/api/comparison_summary")
def get_comparison_summary():
    fingerprint = compute_projects_fingerprint()
    if _SUMMARY_CACHE["data"] and _SUMMARY_CACHE["fingerprint"] == fingerprint:
        return {"summary": _SUMMARY_CACHE["data"]}

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

            cdata = get_run_cached_data(run_path, project_name, run_folder_name, adapter)
            composite_id = f"{project_name}::{run_folder_name}"

            summary_list.append({
                "id": composite_id,
                "project_name": project_name,
                "game": config_data.get("game", "unknown_game"),
                "method": config_data.get("method", "unknown_method"),
                "model": config_data.get("model", "unknown_model"),
                "config": config_data,
                "max_ret_mean": cdata.get("max_ret_mean"),
                "final_ret_mean": cdata.get("final_ret_mean"),
                "comparison_score": cdata.get("comparison_score"),
                "comparison_score_source": cdata.get("comparison_score_source"),
                "max_best_fitness": cdata.get("max_best_fitness"),
                "min_y_best": cdata.get("min_y_best")
            })

    _SUMMARY_CACHE["data"] = summary_list
    _SUMMARY_CACHE["fingerprint"] = fingerprint
    return {"summary": summary_list}

@app.get("/api/runs/{run_id:path}/metrics")
def get_run_metrics(run_id: str):
    project_name, proj, run_folder, run_path = resolve_run(run_id)
    adapter = get_adapter(proj.get("adapter", "auto"))
    cdata = get_run_cached_data(run_path, project_name, run_folder, adapter)
    return {"schema_version": API_SCHEMA_VERSION, "data": cdata.get("metrics", [])}


@app.get("/api/runs/{run_id:path}/evaluations")
def get_run_evaluations(run_id: str):
    project_name, proj, run_folder, run_path = resolve_run(run_id)
    adapter = get_adapter(proj.get("adapter", "auto"))
    cdata = get_run_cached_data(run_path, project_name, run_folder, adapter)
    return {"schema_version": API_SCHEMA_VERSION, "data": cdata.get("evaluations", [])}

@app.get("/api/runs/{run_id:path}/logs")
def get_run_logs(run_id: str):
    _project_name, proj, _run_folder, run_path = resolve_run(run_id)
    runs_dir = Path(proj["runs_dir"]).resolve(strict=False)
    adapter = get_adapter(proj.get("adapter", "auto"))
    config_data = adapter.parse_config(run_path) or {}
    logs = adapter.parse_logs(run_path, runs_dir, config_data)
    return {"logs": logs}

GAME_METADATA_FILE = Path(__file__).parent / "game_metadata.json"
GAME_METADATA = {}
if GAME_METADATA_FILE.exists():
    try:
        with open(GAME_METADATA_FILE, "r") as f:
            GAME_METADATA = json.load(f)
    except Exception as e:
        print("Failed to load game_metadata.json:", e)

@app.get("/api/game_metadata")
def get_game_metadata():
    return GAME_METADATA

ENV_SUMMARIES_FILE = Path(__file__).parent / "env_summaries.json"
ENV_SUMMARIES = {}
if ENV_SUMMARIES_FILE.exists():
    try:
        with open(ENV_SUMMARIES_FILE, "r") as f:
            ENV_SUMMARIES = json.load(f)
    except Exception as e:
        print("Failed to load env_summaries.json:", e)

@app.get("/api/environments")
def get_environments():
    jaxatari_dir = Path(APP_CONFIG.get("jaxatari_dir", os.environ.get("JAXATARI_DIR", "../JAXAtari"))).resolve(strict=False)
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
                        
                        # Find Farama summary
                        env_sum_data = ENV_SUMMARIES.get(game_name, {})
                        summary_text = env_sum_data.get("summary", f"{game_name.replace('_', ' ').title()} is an Atari 2600 environment supported in JAXAtari.")
                        farama_url = env_sum_data.get("farama_url", f"https://ale.farama.org/environments/{game_name}/")

                        # Store or update unique environment by ID (preferring entries with higher mod counts or GIF availability)
                        if game_name not in environments_dict or mods_count > environments_dict[game_name]["mods_count"]:
                            environments_dict[game_name] = {
                                "id": game_name,
                                "name": game_name.replace("_", " ").title(),
                                "category": current_category,
                                "status": status,
                                "mods_count": mods_count,
                                "has_gif": has_gif,
                                "gif_url": f"/api/environments/gif/{game_name}" if has_gif else None,
                                "summary": summary_text,
                                "farama_url": farama_url
                            }
        except Exception as e:
            print("Failed to parse games_covered.md:", e)

    # Convert to list and sort alphabetically by name
    environments = list(environments_dict.values())
    environments.sort(key=lambda x: x["name"])

    return {"environments": environments}

@app.get("/api/environments/{env_id}")
def get_environment_by_id(env_id: str):
    all_envs = get_environments()["environments"]
    normalized_target = env_id.replace("-", "_").lower()
    for env in all_envs:
        if env["id"].lower() == normalized_target or env["name"].lower() == normalized_target:
            return env
    
    # Fallback if not directly found in games_covered.md
    env_sum_data = ENV_SUMMARIES.get(normalized_target, {})
    return {
        "id": env_id,
        "name": env_id.replace("_", " ").title(),
        "category": "Atari",
        "status": "🥇",
        "mods_count": 0,
        "has_gif": False,
        "gif_url": None,
        "summary": env_sum_data.get("summary", f"{env_id.replace('_', ' ').title()} is an Atari environment."),
        "farama_url": env_sum_data.get("farama_url", f"https://ale.farama.org/environments/{env_id}/")
    }

@app.get("/api/environments/gif/{game_id}")
def get_environment_gif(game_id: str):
    from fastapi.responses import FileResponse
    jaxatari_dir = Path(APP_CONFIG.get("jaxatari_dir", os.environ.get("JAXATARI_DIR", "../JAXAtari"))).resolve(strict=False)
    gifs_dir = jaxatari_dir / "docs" / "source" / "_static" / "gifs"
    
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


@app.get("/api/diagnostics")
def get_diagnostics():
    projects = []
    for project in APP_CONFIG.get("projects", []):
        runs_dir = Path(project.get("runs_dir", "")).resolve(strict=False)
        projects.append({
            "name": project.get("name"),
            "runs_dir_configured": bool(project.get("runs_dir")),
            "runs_dir_exists": runs_dir.is_dir(),
            "run_count": len(scan_run_folders(runs_dir)) if runs_dir.is_dir() else 0,
        })
    baseline = APP_CONFIG.get("ale_baselines_file")
    return {
        "schema_version": API_SCHEMA_VERSION,
        "artifact_schema_version": ARTIFACT_SCHEMA_VERSION,
        "video_manifest_schema_version": VIDEO_MANIFEST_SCHEMA_VERSION,
        "trajectory_schema_version": TRAJECTORY_SCHEMA_VERSION,
        "projects_fingerprint": compute_projects_fingerprint(),
        "projects": projects,
        "baselines_configured": bool(baseline),
        "baselines_available": bool(baseline and Path(baseline).is_file()),
        "events": list(_DIAGNOSTIC_EVENTS),
    }

@app.get("/api/baselines")
def get_baselines():
    baselines = []
    baselines_file_str = APP_CONFIG.get("ale_baselines_file")
    if not baselines_file_str:
        for proj in APP_CONFIG.get("projects", []):
            if proj.get("baselines_file"):
                baselines_file_str = proj.get("baselines_file")
                break

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
            except (OSError, csv.Error) as exc:
                record_diagnostic("baseline_parse_error", str(exc), path=str(baselines_file))
    return {
        "schema_version": API_SCHEMA_VERSION,
        "data": baselines,
        "normalization_available": bool(baselines),
        "score_semantics": "human_normalized" if baselines else "raw",
    }

from fastapi import Request

_RENDER_JOBS: Dict[str, Dict[str, Any]] = {}


def _render_script(project: Dict[str, Any], run_path: Path) -> Path:
    configured = project.get("render_script") or APP_CONFIG.get("render_script") or os.environ.get("THESIS_RENDER_SCRIPT")
    if configured:
        candidate = Path(configured).resolve(strict=False)
        if candidate.is_file():
            return candidate
    for ancestor in run_path.parents:
        candidate = ancestor / "scripts" / "render.py"
        if candidate.is_file():
            return candidate.resolve()
    raise HTTPException(
        status_code=503,
        detail="Render script unavailable; configure render_script or THESIS_RENDER_SCRIPT",
    )


def _render_spec(run_id: str, iteration: int) -> Dict[str, Any]:
    if iteration < 0:
        raise HTTPException(status_code=400, detail="Iteration must be non-negative")
    project_name, project, run_folder, run_path = resolve_run(run_id)
    adapter = get_adapter(project.get("adapter", "auto"))
    config = adapter.parse_config(run_path) or {}
    policy = resolve_under(run_path, Path("policies") / f"iter{iteration:02d}.py", must_exist=True)
    params = resolve_under(run_path, Path("params") / f"iter{iteration:02d}_best.json", must_exist=True)
    config_file = resolve_under(run_path, "config.json", must_exist=True)
    evaluation_file = resolve_under(run_path, Path("metrics") / f"iter{iteration:02d}_eval.json", must_exist=True)
    try:
        evaluation = json.loads(evaluation_file.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=422, detail="Evaluation JSON is unreadable") from exc
    treatment = (evaluation.get("candidate_dev")
                 if isinstance(evaluation.get("candidate_dev"), dict)
                 else evaluation.get("treatment")
                 if isinstance(evaluation.get("treatment"), dict) else evaluation)
    trace = (evaluation.get("candidate_trace")
             if isinstance(evaluation.get("candidate_trace"), dict)
             else evaluation.get("trace") if isinstance(evaluation.get("trace"), dict) else evaluation)
    seed_value = treatment.get("robust_worst_seed", trace.get("log_rollout_seed"))
    if seed_value is None:
        raise HTTPException(status_code=422, detail="Evaluation does not identify the localization rollout seed")
    seed = int(seed_value)
    expected_return = treatment.get("robust_worst_return", trace.get("deterministic_return"))
    render_script = _render_script(project, run_path)
    inputs = {
        "policy": {"path": policy.relative_to(run_path).as_posix(), "sha256": sha256_file(policy)},
        "params": {"path": params.relative_to(run_path).as_posix(), "sha256": sha256_file(params)},
        "config": {"path": config_file.relative_to(run_path).as_posix(), "sha256": sha256_file(config_file)},
        "evaluation": {"path": evaluation_file.relative_to(run_path).as_posix(), "sha256": sha256_file(evaluation_file)},
        "render_script": {"path": f"{render_script.parent.name}/{render_script.name}", "sha256": sha256_file(render_script)},
    }
    fingerprint_payload = {
        "schema": VIDEO_MANIFEST_SCHEMA_VERSION,
        "iteration": iteration,
        "seed": seed,
        "expected_return": expected_return,
        "inputs": inputs,
        "render": {"fps": 30, "stride": 2, "format": "h264-yuv420p-mp4"},
    }
    fingerprint = hashlib.sha256(json.dumps(fingerprint_payload, sort_keys=True).encode()).hexdigest()
    return {
        "project_name": project_name,
        "project": project,
        "run_folder": run_folder,
        "run_path": run_path,
        "config": config,
        "game": config.get("game", config.get("env", "unknown")),
        "noise": config.get("obs_noise_std", config.get("noise", 0.0)),
        "policy": policy,
        "params": params,
        "config_file": config_file,
        "evaluation_file": evaluation_file,
        "evaluation": evaluation,
        "render_script": render_script,
        "seed": seed,
        "expected_return": expected_return,
        "inputs": inputs,
        "fingerprint": fingerprint,
        "video_path": run_path / "videos" / "cache" / f"{fingerprint}.mp4",
        "manifest_path": run_path / "videos" / "manifests" / f"iter{iteration:02d}.json",
        "iteration": iteration,
    }


def _validated_video_manifest(spec: Dict[str, Any]) -> tuple[Optional[Dict[str, Any]], Optional[str]]:
    manifest_path: Path = spec["manifest_path"]
    if not manifest_path.is_file():
        return None, "missing provenance manifest"
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None, "unreadable provenance manifest"
    if manifest.get("schema_version") != VIDEO_MANIFEST_SCHEMA_VERSION:
        return None, "unsupported provenance schema"
    if manifest.get("input_fingerprint") != spec["fingerprint"]:
        return None, "policy, parameters, config, evaluation, or render protocol changed"
    try:
        video_path = resolve_under(spec["run_path"], manifest.get("video_file", ""), must_exist=True)
    except HTTPException:
        return None, "manifest video is missing or outside the run"
    expected_hash = manifest.get("video_sha256")
    if not expected_hash or sha256_file(video_path) != expected_hash:
        return None, "video content hash mismatch"
    verification = manifest.get("verification", {})
    if verification.get("status") != "passed":
        return None, "render score/seed verification did not pass"
    return manifest, None


def _video_url(run_id: str, manifest: Dict[str, Any]) -> str:
    return f"/runs/{run_id}/videos/{Path(manifest['video_file']).name}"


@app.api_route("/runs/{run_id:path}/videos/{filename}", methods=["GET", "HEAD"])
async def serve_video(request: Request, run_id: str, filename: str):
    from starlette.staticfiles import StaticFiles

    if Path(filename).name != filename or not re.fullmatch(r"[0-9a-f]{64}\.mp4", filename):
        raise HTTPException(status_code=400, detail="Only content-addressed MP4 artifacts may be served")
    _project_name, _project, _run_folder, run_path = resolve_run(run_id)
    video_path = resolve_under(run_path, Path("videos") / "cache" / filename, must_exist=True)
    manifests_dir = run_path / "videos" / "manifests"
    trusted = False
    if manifests_dir.is_dir():
        for manifest_path in manifests_dir.glob("iter*.json"):
            try:
                raw_manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
                if Path(raw_manifest.get("video_file", "")).name != filename:
                    continue
                iteration = int(raw_manifest.get("outer_iter"))
                current_spec = _render_spec(run_id, iteration)
                manifest, _reason = _validated_video_manifest(current_spec)
                trusted = (manifest is not None and
                           resolve_under(current_spec["run_path"], manifest.get("video_file", ""), must_exist=True) == video_path)
            except (OSError, ValueError, TypeError, json.JSONDecodeError, HTTPException):
                continue
            if trusted:
                break
    if not trusted:
        raise HTTPException(status_code=409, detail="Video has no valid provenance manifest")
    static_handler = StaticFiles(directory=str(video_path.parent))
    return await static_handler.get_response(video_path.name, request.scope)


def _ensure_browser_mp4(video_path: Path) -> None:
    """Convert the renderer's GIF fallback with imageio-ffmpeg, never serve GIF as video."""
    # Current thesis render.py produces and atomically verifies H.264/yuv420p itself.
    # Do not remux it: that would invalidate the renderer's own video_sha256 manifest.
    if video_path.is_file():
        return
    try:
        import imageio_ffmpeg
        ffmpeg_exe = imageio_ffmpeg.get_ffmpeg_exe()
    except Exception as exc:
        raise HTTPException(status_code=500, detail="imageio-ffmpeg is required for browser-safe MP4 output") from exc
    source_path = video_path.with_suffix(".gif")
    if not source_path.is_file():
        raise HTTPException(status_code=500, detail="Renderer produced neither MP4 nor GIF")
    browser_path = video_path.with_name(f"{video_path.stem}.browser.mp4")
    codec_args = ["-c:v", "libx264", "-pix_fmt", "yuv420p"]
    completed = subprocess.run([
        ffmpeg_exe, "-y", "-i", str(source_path), "-an", *codec_args,
        "-movflags", "+faststart", str(browser_path)
    ], capture_output=True, text=True)
    if completed.returncode == 0 and browser_path.is_file():
        browser_path.replace(video_path)
    if completed.returncode != 0 or not video_path.is_file():
        raise HTTPException(status_code=500, detail="Could not convert renderer fallback to H.264 MP4")


@app.post("/api/runs/{run_id:path}/render")
def render_video(run_id: str, iter: Optional[int] = 0, force: Optional[bool] = False):
    iteration = int(iter or 0)
    spec = _render_spec(run_id, iteration)
    manifest, stale_reason = _validated_video_manifest(spec)
    if manifest is not None and not force:
        return {"video_url": _video_url(run_id, manifest), "manifest": manifest}

    render_script = spec["render_script"]
    render_script_hash = sha256_file(render_script)
    repo_root = render_script.parent.parent
    python_exe = sys.executable
    venv_python = repo_root / ".venv" / "bin" / "python"
    if venv_python.exists():
        python_exe = str(venv_python)
    video_path: Path = spec["video_path"]
    video_path.parent.mkdir(parents=True, exist_ok=True)
    spec["manifest_path"].parent.mkdir(parents=True, exist_ok=True)

    cmd = [
        python_exe, str(render_script), "--game", str(spec["game"]),
        "--policy", str(spec["policy"]), "--noise", str(spec["noise"]),
        "--out", str(video_path), "--config", str(spec["config_file"]),
        "--params", str(spec["params"]), "--eval", str(spec["evaluation_file"]),
        "--seed", str(spec["seed"]),
        "--fps", "30", "--stride", "2",
    ]
    job_key = f"{run_id}::{iteration}"
    _RENDER_JOBS[job_key] = {
        "rendering": True, "progress": 0, "stage": "Initializing exact replay...",
        "video_url": None, "error": None, "stale_reason": stale_reason,
    }
    env_vars = os.environ.copy()
    env_vars["PYTHONPATH"] = str(repo_root) + os.pathsep + env_vars.get("PYTHONPATH", "")
    output_tail: List[str] = []
    try:
        with tempfile.TemporaryDirectory(prefix="jaxatari-viz-ffmpeg-") as ffmpeg_dir:
            if shutil.which("ffmpeg", path=env_vars.get("PATH")) is None:
                try:
                    import imageio_ffmpeg
                    Path(ffmpeg_dir, "ffmpeg").symlink_to(imageio_ffmpeg.get_ffmpeg_exe())
                    env_vars["PATH"] = ffmpeg_dir + os.pathsep + env_vars.get("PATH", "")
                except Exception:
                    pass
            proc = subprocess.Popen(
                cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
                cwd=str(repo_root), env=env_vars, bufsize=1,
            )
            if proc.stdout:
                for line in proc.stdout:
                    line = line.strip()
                    if not line:
                        continue
                    output_tail.append(line)
                    output_tail = output_tail[-40:]
                    match = re.search(r"\[PROGRESS\]\s*(\d+)%\s*-\s*(.*)", line)
                    if match:
                        _RENDER_JOBS[job_key]["progress"] = int(match.group(1))
                        _RENDER_JOBS[job_key]["stage"] = match.group(2)
            return_code = proc.wait()
        if return_code != 0:
            raise HTTPException(status_code=500, detail={
                "message": f"Rendering exited with code {return_code}", "output_tail": output_tail,
            })
        _ensure_browser_mp4(video_path)

        sidecar_path = video_path.with_suffix(".json")
        if not sidecar_path.is_file():
            gif_sidecar = video_path.with_suffix(".json")
            sidecar_path = gif_sidecar
        if not sidecar_path.is_file():
            raise HTTPException(status_code=500, detail="Renderer omitted its score/seed sidecar")
        sidecar = json.loads(sidecar_path.read_text(encoding="utf-8"))
        rendered_seed = sidecar.get("episode_seed")
        rendered_return = sidecar.get("rendered_return")
        seed_matches = rendered_seed == spec["seed"]
        score_matches = (spec["expected_return"] is not None and isinstance(rendered_return, (int, float)) and
                         abs(float(rendered_return) - float(spec["expected_return"])) < 1e-6)
        if not seed_matches or not score_matches:
            raise HTTPException(status_code=409, detail={
                "message": "Rendered rollout does not match the selected evaluation trace",
                "expected_seed": spec["seed"], "rendered_seed": rendered_seed,
                "expected_return": spec["expected_return"], "rendered_return": rendered_return,
            })
        rendered_video_hash = sha256_file(video_path)
        sidecar_hash_matches = (not sidecar.get("video_sha256") or
                                sidecar.get("video_sha256") == rendered_video_hash)
        renderer_verified = sidecar.get("verified") is not False
        if not sidecar_hash_matches or not renderer_verified:
            raise HTTPException(status_code=409, detail={
                "message": "Renderer provenance sidecar failed video verification",
                "sidecar_hash_matches": sidecar_hash_matches,
                "renderer_verified": renderer_verified,
            })

        public_sidecar = dict(sidecar)
        public_sidecar["policy"] = spec["inputs"]["policy"]["path"]
        public_sidecar["params"] = spec["inputs"]["params"]["path"]

        manifest = {
            "schema_version": VIDEO_MANIFEST_SCHEMA_VERSION,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "run_id": run_id,
            "outer_iter": iteration,
            "input_fingerprint": spec["fingerprint"],
            "inputs": spec["inputs"],
            "render_script_sha256": render_script_hash,
            "selection": {
                "criterion": "lexicographic(progress, return)",
                "localization_seed": spec["seed"],
                "expected_return": spec["expected_return"],
            },
            "video_file": video_path.relative_to(spec["run_path"]).as_posix(),
            "video_sha256": rendered_video_hash,
            "media": {"container": "mp4", "codec": "h264", "pixel_format": "yuv420p", "fps": 30},
            "renderer_sidecar": public_sidecar,
            "verification": {
                "status": "passed", "seed_matches": seed_matches, "score_matches": score_matches,
                "renderer_verified": renderer_verified,
                "sidecar_hash_matches": sidecar_hash_matches,
            },
            "synchronization": {
                "stride": 2,
                "frame_zero": {"phase": "initial_pre_action", "decision_t": None},
                "subsequent_formula": "decision_t=(video_frame-1)*stride; phase=post_action",
                "frames_written": sidecar.get("frames_written"),
                "decisions": sidecar.get("decisions"),
                "frame_map": sidecar.get("frame_map"),
                "transition_chain_sha256": sidecar.get("transition_chain_sha256"),
            },
        }
        temp_manifest = spec["manifest_path"].with_suffix(".tmp")
        temp_manifest.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
        temp_manifest.replace(spec["manifest_path"])
    except Exception as exc:
        _RENDER_JOBS[job_key] = {
            "rendering": False, "progress": 0, "stage": "Failed", "error": str(exc),
            "output_tail": output_tail,
        }
        if isinstance(exc, HTTPException):
            raise
        raise HTTPException(status_code=500, detail=f"Rendering error: {exc}") from exc

    video_url = _video_url(run_id, manifest)
    _RENDER_JOBS[job_key] = {
        "rendering": False, "progress": 100, "stage": "Verified exact replay",
        "video_url": video_url, "error": None,
    }
    return {"video_url": video_url, "manifest": manifest}


@app.get("/api/runs/{run_id:path}/video_status")
def get_video_status(run_id: str, iter: Optional[int] = 0):
    iteration = int(iter or 0)
    job_info = _RENDER_JOBS.get(f"{run_id}::{iteration}", {})
    try:
        spec = _render_spec(run_id, iteration)
        manifest, stale_reason = _validated_video_manifest(spec)
    except HTTPException as exc:
        manifest, stale_reason = None, str(exc.detail)
    if manifest is not None:
        return {
            "exists": True, "verified": True, "stale": False,
            "rendering": job_info.get("rendering", False), "progress": 100,
            "stage": "Verified exact replay", "video_url": _video_url(run_id, manifest),
            "manifest": manifest, "error": None,
        }
    return {
        "exists": False, "verified": False, "stale": True,
        "stale_reason": stale_reason,
        "rendering": job_info.get("rendering", False),
        "progress": job_info.get("progress", 0),
        "stage": job_info.get("stage", "Exact replay required"),
        "video_url": None, "error": job_info.get("error"),
    }


def _trajectory_artifact(run_path: Path, iteration: int) -> tuple[Optional[Path], Optional[Dict[str, Any]]]:
    trajectory_dir = run_path / "trajectories"
    # Current thesis runs register content-addressed gzip trajectories in the run-level
    # manifest. Resolve the evaluation's exact artifact id first, then fall back to an
    # iteration-matching trajectory entry. SQLite ids are deliberately never resolved.
    registry_path = run_path / "manifest.json"
    if registry_path.is_file():
        try:
            registry = json.loads(registry_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            raise HTTPException(status_code=422, detail="Run artifact manifest is unreadable") from exc
        if registry.get("schema") == LEGPS_RUN_MANIFEST_SCHEMA_VERSION:
            artifacts = registry.get("artifacts")
            if not isinstance(artifacts, dict):
                raise HTTPException(status_code=422, detail="Run artifact registry is invalid")
            requested_ids: List[str] = []
            evaluation_path = run_path / "metrics" / f"iter{iteration:02d}_eval.json"
            if evaluation_path.is_file():
                try:
                    evaluation = json.loads(evaluation_path.read_text(encoding="utf-8"))
                    direct_id = evaluation.get("trajectory_artifact_id")
                    if isinstance(direct_id, str):
                        requested_ids.append(direct_id)
                    candidate = evaluation.get("trajectory_artifacts", {}).get("candidate")
                    if isinstance(candidate, str):
                        requested_ids.append(candidate)
                    elif isinstance(candidate, dict) and isinstance(candidate.get("artifact_id"), str):
                        requested_ids.append(candidate["artifact_id"])
                except json.JSONDecodeError as exc:
                    raise HTTPException(status_code=422, detail="Evaluation JSON is unreadable") from exc
            requested_ids.extend([
                f"trajectory.iter{iteration:02d}.candidate",
                f"trajectory.iter{iteration:02d}",
            ])
            requested_ids.extend(
                artifact_id for artifact_id, entry in artifacts.items()
                if isinstance(entry, dict) and entry.get("kind") == "trajectory"
                and entry.get("metadata", {}).get("iteration") == iteration
            )
            for artifact_id in dict.fromkeys(requested_ids):
                entry = artifacts.get(artifact_id)
                if not isinstance(entry, dict) or entry.get("kind") != "trajectory":
                    continue
                data_file = resolve_under(run_path, entry.get("path", ""), must_exist=True)
                expected_hash = entry.get("sha256")
                if not expected_hash or sha256_file(data_file) != expected_hash:
                    raise HTTPException(status_code=409, detail="Trajectory content hash mismatch")
                expected_bytes = entry.get("bytes")
                if isinstance(expected_bytes, int) and data_file.stat().st_size != expected_bytes:
                    raise HTTPException(status_code=409, detail="Trajectory byte count mismatch")
                metadata = entry.get("metadata") if isinstance(entry.get("metadata"), dict) else {}
                return data_file, {
                    "schema_version": metadata.get("schema", LEGPS_TRAJECTORY_SCHEMA_VERSION),
                    "registry_schema": LEGPS_RUN_MANIFEST_SCHEMA_VERSION,
                    "artifact_id": artifact_id,
                    "data_file": entry.get("path"),
                    "sha256": expected_hash,
                    "game": metadata.get("game"),
                    "outer_iter": metadata.get("iteration"),
                    "seed": metadata.get("episode_seed"),
                    "decision_count": metadata.get("n_transitions"),
                    "return": metadata.get("return"),
                    "trajectory_id": metadata.get("trajectory_id"),
                    "consistency": metadata.get("consistency"),
                }
    manifest_path = trajectory_dir / f"iter{iteration:02d}.manifest.json"
    manifest = None
    if manifest_path.is_file():
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            data_file = resolve_under(run_path, manifest.get("data_file", ""), must_exist=True)
            if manifest.get("sha256") and sha256_file(data_file) != manifest["sha256"]:
                raise HTTPException(status_code=409, detail="Trajectory content hash mismatch")
            return data_file, manifest
        except json.JSONDecodeError as exc:
            raise HTTPException(status_code=422, detail="Trajectory manifest is unreadable") from exc
    for candidate in (
        trajectory_dir / f"iter{iteration:02d}.jsonl",
        trajectory_dir / f"iter{iteration:02d}.json",
    ):
        if candidate.is_file():
            return candidate, None
    return None, None


def _read_trajectory_rows(path: Path, offset: int, limit: int) -> tuple[List[Dict[str, Any]], int]:
    if path.suffix == ".jsonl":
        rows = []
        total = 0
        with path.open("r", encoding="utf-8") as handle:
            for line in handle:
                if not line.strip():
                    continue
                if offset <= total < offset + limit:
                    value = json.loads(line)
                    if isinstance(value, dict):
                        rows.append(value)
                total += 1
        return rows, total
    if path.name.endswith(".json.gz"):
        with gzip.open(path, "rt", encoding="utf-8") as handle:
            payload = json.load(handle)
    else:
        payload = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(payload, dict) and payload.get("schema") == LEGPS_TRAJECTORY_SCHEMA_VERSION:
        all_rows = payload.get("transitions", [])
    else:
        all_rows = payload.get("frames", []) if isinstance(payload, dict) else payload
    if not isinstance(all_rows, list):
        raise HTTPException(status_code=422, detail="Trajectory JSON must contain transitions[] or frames[]")
    rows = []
    for raw in all_rows[offset:offset + limit]:
        if not isinstance(raw, dict):
            continue
        row = dict(raw)
        # Promote the thesis transition convention into stable viewer aliases without
        # fabricating unavailable frame mappings or state hashes.
        row.setdefault("decision_t", row.get("t"))
        row.setdefault("phase", row.get("state_phase", row.get("transition__state_phase")))
        row.setdefault("policy_action", row.get("proposed_action", row.get("transition__proposed_action", row.get("action"))))
        row.setdefault("executed_action", row.get("transition__executed_action", row.get("action")))
        row.setdefault("done", row.get("terminated", row.get("transition__terminated")))
        row.setdefault("pre_state_hash", row.get("pre_state_sha256"))
        row.setdefault("post_state_hash", row.get("post_state_sha256"))
        row.setdefault("video_state_hash", row.get("video_state_sha256"))
        rows.append(row)
    return rows, len(all_rows)


@app.get("/api/runs/{run_id:path}/iterations/{iteration}/trajectory")
def get_trajectory(run_id: str, iteration: int, offset: int = 0, limit: int = 100):
    _project_name, project, _run_folder, run_path = resolve_run(run_id)
    if offset < 0 or limit < 1 or limit > 500:
        raise HTTPException(status_code=400, detail="offset must be non-negative and limit must be 1..500")
    path, manifest = _trajectory_artifact(run_path, iteration)
    if path is None:
        adapter = get_adapter(project.get("adapter", "auto"))
        evaluation = next((row for row in adapter.parse_evaluations(run_path)
                           if row.get("outer_iter") == iteration), {})
        return {
            "schema_version": TRAJECTORY_SCHEMA_VERSION,
            "available": False,
            "legacy_rollout_id": evaluation.get("rollout_id"),
            "warning": "Shared SQLite integer rollout IDs are not portable; package this iteration's trajectory in the run directory.",
            "required_fields": [
                "decision_t", "phase", "policy_action", "executed_action", "reward",
                "done", "pre_state_hash", "post_state_hash", "video_state_hash", "video_frame",
            ],
        }
    manifest_checks: Dict[str, bool] = {}
    if manifest is not None:
        required_manifest_fields = {
            "schema_version", "data_file", "sha256", "game",
            "outer_iter", "seed", "decision_count", "return",
        }
        missing_manifest_fields = sorted(required_manifest_fields.difference(manifest))
        if missing_manifest_fields:
            raise HTTPException(status_code=422, detail={
                "message": "Trajectory manifest is incomplete",
                "missing_fields": missing_manifest_fields,
            })
        adapter = get_adapter(project.get("adapter", "auto"))
        config = adapter.parse_config(run_path) or {}
        evaluation = next((row for row in adapter.parse_evaluations(run_path)
                           if row.get("outer_iter") == iteration), {})
        manifest_checks["schema_version"] = manifest.get("schema_version") in {
            TRAJECTORY_SCHEMA_VERSION, LEGPS_TRAJECTORY_SCHEMA_VERSION,
        }
        expected = {
            "game": config.get("game"),
            "outer_iter": iteration,
            "seed": evaluation.get("noisy", {}).get("localization_seed"),
            "decision_count": evaluation.get("trajectory", {}).get("decision_count"),
            "return": evaluation.get("noisy", {}).get("localization_return"),
        }
        for key, expected_value in expected.items():
            if expected_value is None:
                continue
            actual = manifest.get(key)
            if key == "return" and isinstance(actual, (int, float)):
                manifest_checks[key] = abs(float(actual) - float(expected_value)) < 1e-6
            else:
                manifest_checks[key] = actual == expected_value
        if not all(manifest_checks.values()):
            raise HTTPException(status_code=409, detail={
                "message": "Trajectory manifest does not match this run iteration",
                "checks": manifest_checks,
            })
    rows, total = _read_trajectory_rows(path, offset, limit)
    required = ["decision_t", "phase", "policy_action", "executed_action", "reward",
                "done", "pre_state_hash", "post_state_hash", "video_state_hash", "video_frame"]
    missing_counts = {field: sum(1 for row in rows if row.get(field) is None) for field in required}
    return {
        "schema_version": TRAJECTORY_SCHEMA_VERSION,
        "available": True,
        "portable": manifest is not None and manifest.get("schema_version") in {
            TRAJECTORY_SCHEMA_VERSION, LEGPS_TRAJECTORY_SCHEMA_VERSION,
        },
        "source_file": path.relative_to(run_path).as_posix(),
        "manifest": manifest,
        "manifest_checks": manifest_checks,
        "offset": offset, "limit": limit, "total": total, "rows": rows,
        "consistency": {"missing_field_counts_in_page": missing_counts},
    }


@app.get("/api/runs/{run_id:path}/iterations/{iteration}/synchronization")
def get_synchronization(run_id: str, iteration: int, start_frame: int = 0, limit: int = 120):
    if start_frame < 0 or limit < 1 or limit > 500:
        raise HTTPException(status_code=400, detail="start_frame must be non-negative and limit must be 1..500")
    spec = _render_spec(run_id, iteration)
    manifest, stale_reason = _validated_video_manifest(spec)
    if manifest is None:
        return {"schema_version": TRAJECTORY_SCHEMA_VERSION, "available": False, "warning": stale_reason}
    sync = manifest.get("synchronization", {})
    stride = int(sync.get("stride", 2))
    total = int(sync.get("frames_written") or 0)
    end = min(total, start_frame + limit) if total else start_frame + limit
    exact_frame_map = sync.get("frame_map") if isinstance(sync.get("frame_map"), list) else []
    mapping = []
    if exact_frame_map:
        for frame in exact_frame_map:
            video_frame = frame.get("video_frame")
            if not isinstance(video_frame, int) or not start_frame <= video_frame < end:
                continue
            decision = frame.get("decision")
            mapping.append({
                "video_frame": video_frame,
                "time_seconds": video_frame / float(manifest.get("media", {}).get("fps", 30)),
                "decision_t": None if decision in (-1, None) else decision,
                "phase": ("initial_pre_action" if frame.get("phase") == "initial"
                          else "post_action" if frame.get("phase") == "post" else frame.get("phase")),
                "video_state_sha256": frame.get("state_sha256"),
                "state_hash_verified": False,
                "mapping_source": "renderer_sidecar",
            })
    else:
        for video_frame in range(start_frame, end):
            mapping.append({
                "video_frame": video_frame,
                "time_seconds": video_frame / float(manifest.get("media", {}).get("fps", 30)),
                "decision_t": None if video_frame == 0 else (video_frame - 1) * stride,
                "phase": "initial_pre_action" if video_frame == 0 else "post_action",
                "state_hash_verified": False,
                "mapping_source": "legacy_stride_formula",
            })
    trajectory_path, _trajectory_manifest = _trajectory_artifact(spec["run_path"], iteration)
    frame_link_mismatches = 0
    frame_links_unverifiable = 0
    frame_links_verified = 0
    linked_frames = 0
    if trajectory_path is not None and mapping:
        decisions = [row["decision_t"] for row in mapping if row["decision_t"] is not None]
        decision_offset = min(decisions) if decisions else 0
        row_limit = min(500, (max(decisions) - decision_offset + 3) if decisions else 3)
        trajectory_rows, _total_rows = _read_trajectory_rows(trajectory_path, decision_offset, row_limit)
        by_decision = {row.get("decision_t"): row for row in trajectory_rows if row.get("decision_t") is not None}
        for frame_map in mapping:
            decision_t = frame_map["decision_t"]
            if decision_t is None:
                continue
            transition = by_decision.get(decision_t)
            if transition is None:
                frame_link_mismatches += 1
                continue
            linked_frames += 1
            explicit_video_frame = transition.get("video_frame")
            if explicit_video_frame is None:
                frame_links_unverifiable += 1
                frame_map["trajectory_link_verified"] = None
            else:
                link_ok = (explicit_video_frame == frame_map["video_frame"] and
                           transition.get("phase") in ("post_action", "s_t_to_s_t_plus_1"))
                frame_map["trajectory_link_verified"] = link_ok
                if link_ok:
                    frame_links_verified += 1
                else:
                    frame_link_mismatches += 1
            trajectory_state_hash = transition.get("post_state_hash")
            video_state_hash = frame_map.get("video_state_sha256") or transition.get("video_state_hash")
            frame_map["state_hash_verified"] = bool(
                trajectory_state_hash and video_state_hash and trajectory_state_hash == video_state_hash
            )
    return {
        "schema_version": TRAJECTORY_SCHEMA_VERSION,
        "available": True,
        "video_verified": True,
        "mapping_semantics": sync,
        "start_frame": start_frame, "limit": limit, "total_frames": total,
        "mapping": mapping,
        "consistency": {
            "trajectory_available": trajectory_path is not None,
            "linked_frames": linked_frames,
            "frame_links_verified": frame_links_verified,
            "frame_links_unverifiable": frame_links_unverifiable,
            "frame_link_mismatches": frame_link_mismatches,
            "all_frame_links_verified": bool(frame_links_verified) and frame_link_mismatches == 0
                                        and frame_links_unverifiable == 0,
            "state_hashes_verified": bool(mapping) and all(
                row.get("state_hash_verified", False) for row in mapping if row.get("decision_t") is not None
            ),
        },
        "warning": "State-hash verification requires pre_state_hash, post_state_hash, and video_state_hash in the packaged trajectory.",
    }

if __name__ == "__main__":
    import uvicorn
    server_cfg = APP_CONFIG.get("server", {})
    host = server_cfg.get("host", "127.0.0.1")
    port = server_cfg.get("port", 8000)
    uvicorn.run(app, host=host, port=port)
