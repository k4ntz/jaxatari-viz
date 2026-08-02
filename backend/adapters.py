import os
import json
from pathlib import Path
from typing import List, Dict, Any, Optional
import yaml

class RunAdapter:
    """Base interface for parsing run metrics, configs, and logs."""
    
    def parse_config(self, run_path: Path) -> Optional[Dict[str, Any]]:
        config_path = run_path / "config.json"
        if config_path.exists():
            try:
                with open(config_path, "r") as f:
                    return json.load(f)
            except Exception:
                pass
        return None

    def parse_metrics(self, run_path: Path) -> List[Dict[str, Any]]:
        raise NotImplementedError

    def parse_logs(self, run_path: Path, root_dir: Path, config_data: Dict[str, Any]) -> str:
        logs = ""
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
            tag = config_data.get("tag", "")
            if tag and (root_dir / f"{tag}_live.log").exists():
                log_file = root_dir / f"{tag}_live.log"
                logs += f"--- {log_file.name} ---\n"
                try:
                    with open(log_file, "r") as f:
                        logs += f.read()
                except Exception:
                    logs += "Error reading log.\n"
                logs += "\n"
            else:
                parts = run_path.name.split("_")
                suffix = parts[-1] if len(parts) > 0 else run_path.name
                possible_logs = list(root_dir.glob(f"*{suffix}*.log"))
                for log_file in possible_logs:
                    logs += f"--- {log_file.name} ---\n"
                    try:
                        with open(log_file, "r") as f:
                            logs += f.read()
                    except Exception:
                        logs += "Error reading log.\n"
                    logs += "\n"

        return logs if logs else "No logs found for this run."

class CMAJsonlAdapter(RunAdapter):
    """Adapter for CMA-ES / iter*_cma.jsonl metrics."""
    
    def parse_metrics(self, run_path: Path) -> List[Dict[str, Any]]:
        metrics_path = run_path / "metrics"
        if not metrics_path.exists():
            return []

        metrics_data = []
        for filepath in sorted(metrics_path.glob("iter*_cma.jsonl")):
            try:
                with open(filepath, "r") as f:
                    for line in f:
                        if line.strip():
                            try:
                                metrics_data.append(json.loads(line))
                            except json.JSONDecodeError:
                                continue
            except Exception:
                pass
        return metrics_data

class StandardJsonAdapter(RunAdapter):
    """Adapter for standard metrics.json or metrics.jsonl files."""
    
    def parse_metrics(self, run_path: Path) -> List[Dict[str, Any]]:
        metrics_data = []
        # Try metrics.jsonl
        jsonl_path = run_path / "metrics.jsonl"
        if jsonl_path.exists():
            try:
                with open(jsonl_path, "r") as f:
                    for line in f:
                        if line.strip():
                            metrics_data.append(json.loads(line))
                return metrics_data
            except Exception:
                pass
                
        # Try metrics.json
        json_path = run_path / "metrics.json"
        if json_path.exists():
            try:
                with open(json_path, "r") as f:
                    data = json.load(f)
                    if isinstance(data, list):
                        return data
            except Exception:
                pass

        return metrics_data

class WandbAdapter(RunAdapter):
    """Adapter for downloaded WandB runs (meta.json and history.csv)."""

    def parse_config(self, run_path: Path) -> Optional[Dict[str, Any]]:
        meta_path = run_path / "meta.json"
        if meta_path.exists():
            try:
                with open(meta_path, "r") as f:
                    meta = json.load(f)
                cfg = meta.get("config", {})
                if not isinstance(cfg, dict):
                    cfg = {}
                # Automatically detect game, method and model
                if "game" not in cfg or cfg["game"] == "unknown_game":
                    cfg["game"] = cfg.get("env_name", cfg.get("env", meta.get("name", "unknown_game")))

                if "method" not in cfg:
                    algo = str(cfg.get("algorithm", "")).lower()
                    proj_name = str(cfg.get("wandb_project_name", "")).lower()
                    if algo == "blender" or "blender" in cfg or "blend" in proj_name or "blend" in run_path.name.lower():
                        cfg["method"] = "BlendRL"
                    elif algo:
                        cfg["method"] = algo.title()
                    else:
                        cfg["method"] = "BlendRL"

                if "model" not in cfg or cfg["model"] in ("wandb_run", "unknown_model"):
                    val_model = cfg.get("valuation_model")
                    exp_name = str(cfg.get("exp_name", ""))
                    if isinstance(val_model, dict) and val_model.get("type") == "mlp":
                        cfg["model"] = "MLP"
                    elif exp_name.startswith("mlp"):
                        cfg["model"] = "MLP"
                    else:
                        cfg["model"] = exp_name or "Unknown"
                
                # Date extraction from timestamp
                summary = meta.get("summary", {})
                ts = summary.get("_timestamp") or meta.get("_timestamp") or meta.get("created_at")
                if ts:
                    try:
                        import datetime
                        dt = datetime.datetime.fromtimestamp(float(ts), datetime.timezone.utc)
                        cfg["date"] = dt.strftime("%Y-%m-%d")
                        cfg["date_str"] = dt.strftime("%Y-%m-%d")
                    except Exception:
                        pass

                cfg["wandb_id"] = meta.get("id")
                cfg["wandb_url"] = meta.get("url")
                cfg["tags"] = meta.get("tags", [])
                return cfg
            except Exception as exc:
                print("Error parsing meta.json:", exc)

        return super().parse_config(run_path)

    def parse_metrics(self, run_path: Path) -> List[Dict[str, Any]]:
        history_csv = run_path / "history.csv"
        if history_csv.exists():
            metrics = []
            try:
                import csv
                with open(history_csv, "r") as f:
                    reader = csv.DictReader(f)
                    for row_idx, row in enumerate(reader):
                        m = {}
                        for k, v in row.items():
                            if v is None or v == "":
                                continue
                            try:
                                if "." in v or "e" in v.lower():
                                    m[k] = float(v)
                                else:
                                    m[k] = int(v)
                            except ValueError:
                                m[k] = v
                        if m:
                            # Standardize step / gen index
                            step_val = m.get("global_step") if "global_step" in m else m.get("step") if "step" in m else m.get("_step") if "_step" in m else m.get("iteration")
                            if step_val is None:
                                step_val = row_idx
                            m["gen"] = step_val
                            m["iteration"] = step_val

                            # Standardize reward / ret_mean metric
                            if "ret_mean" not in m:
                                ret_val = (
                                    m.get("charts/episodic_return")
                                    if "charts/episodic_return" in m
                                    else m.get("charts/episodic_game_return")
                                    if "charts/episodic_game_return" in m
                                    else m.get("eval/episodic_return_mod")
                                    if "eval/episodic_return_mod" in m
                                    else m.get("episodic_return")
                                    if "episodic_return" in m
                                    else m.get("reward")
                                    if "reward" in m
                                    else m.get("returns")
                                )
                                if ret_val is not None:
                                    m["ret_mean"] = ret_val

                            # Standardize fitness
                            if "best_fitness" not in m:
                                m["best_fitness"] = m.get("ret_mean") if "ret_mean" in m else m.get("losses/loss")

                            metrics.append(m)
                if metrics:
                    return metrics
            except Exception as exc:
                print("Error reading history.csv:", exc)

    def parse_logs(self, run_path: Path, root_dir: Path, config_data: Dict[str, Any]) -> str:
        # Check if text log files exist first
        std_logs = super().parse_logs(run_path, root_dir, config_data)
        if "No logs found for this run." not in std_logs:
            return std_logs

        # Synthesize Markdown summary card from meta.json
        meta_path = run_path / "meta.json"
        if meta_path.exists():
            try:
                with open(meta_path, "r") as f:
                    meta = json.load(f)
                
                run_id = meta.get("id", run_path.name)
                url = meta.get("url", "")
                state = meta.get("state", "unknown")
                summary = meta.get("summary", {})
                cfg = meta.get("config", {})

                runtime_sec = summary.get("_runtime", 0)
                hours = int(runtime_sec // 3600)
                minutes = int((runtime_sec % 3600) // 60)
                seconds = int(runtime_sec % 60)
                runtime_str = f"{hours}h {minutes}m {seconds}s" if hours > 0 else f"{minutes}m {seconds}s"

                md = f"## 🚀 WandB Run Overview: `{run_id}`\n\n"
                md += f"- **State:** `{state.upper()}`\n"
                if url:
                    md += f"- **WandB Link:** [{url}]({url})\n"
                md += f"- **Runtime:** `{runtime_str}`\n"
                if "global_step" in summary:
                    md += f"- **Total Timesteps:** `{summary['global_step']:,}`\n"
                md += "\n"

                md += "### 📊 Final Summary Metrics\n\n"
                md += "| Metric | Value |\n|---|---|\n"
                key_metrics = [
                    ("Episodic Return", summary.get("charts/episodic_return")),
                    ("Game Return", summary.get("charts/episodic_game_return")),
                    ("Episodic Length", summary.get("charts/episodic_length")),
                    ("Steps Per Second (SPS)", summary.get("charts/SPS")),
                    ("Total Loss", summary.get("losses/loss")),
                    ("Value Loss", summary.get("losses/value_loss")),
                    ("Policy Loss", summary.get("losses/policy_loss")),
                    ("Entropy", summary.get("losses/entropy")),
                    ("Learning Rate", summary.get("charts/learning_rate")),
                ]
                for label, val in key_metrics:
                    if val is not None and not isinstance(val, dict):
                        if isinstance(val, float):
                            val_str = f"{val:.4f}" if abs(val) < 1e3 else f"{val:,.1f}"
                        else:
                            val_str = f"{val:,}" if isinstance(val, int) else str(val)
                        md += f"| **{label}** | `{val_str}` |\n"
                md += "\n"

                md += "### ⚙️ Hyperparameters\n\n"
                md += "| Parameter | Value |\n|---|---|\n"
                show_keys = ["learning_rate", "num_envs", "num_steps", "batch_size", "seed", "gamma", "gae_lambda", "ent_coef", "vf_coef", "algorithm", "actor_mode", "blender_mode", "reward_fn"]
                for k in show_keys:
                    if k in cfg:
                        md += f"| `{k}` | `{cfg[k]}` |\n"
                md += "\n"

                return md
            except Exception as exc:
                print("Error synthesizing WandB logs:", exc)

        return "No logs found for this run."


class AutoAdapter(RunAdapter):
    """Auto-detecting adapter that combines WandB, CMA, and Standard JSON."""
    
    def __init__(self):
        self.wandb = WandbAdapter()
        self.cma = CMAJsonlAdapter()
        self.std = StandardJsonAdapter()

    def parse_config(self, run_path: Path) -> Optional[Dict[str, Any]]:
        res = self.wandb.parse_config(run_path)
        if res:
            return res
        return self.std.parse_config(run_path)

    def parse_metrics(self, run_path: Path) -> List[Dict[str, Any]]:
        res = self.wandb.parse_metrics(run_path)
        if res:
            return res
        res = self.cma.parse_metrics(run_path)
        if res:
            return res
        return self.std.parse_metrics(run_path)

def get_adapter(adapter_name: str) -> RunAdapter:
    adapters = {
        "wandb": WandbAdapter(),
        "cma_jsonl": CMAJsonlAdapter(),
        "standard_json": StandardJsonAdapter(),
        "auto": AutoAdapter(),
    }
    return adapters.get(adapter_name.lower(), AutoAdapter())

def load_config(config_path: Path = Path("config.yaml")) -> Dict[str, Any]:
    if not config_path.exists():
        # Fallback default configuration
        return {
            "projects": [
                {
                    "name": "Default Thesis Runs",
                    "runs_dir": "/Users/kantoz/Research/legps/thesis/runs",
                    "adapter": "auto",
                    "baselines_file": "/Users/kantoz/Research/legps/thesis/data/baselines.csv"
                }
            ]
        }
    with open(config_path, "r") as f:
        return yaml.safe_load(f)
