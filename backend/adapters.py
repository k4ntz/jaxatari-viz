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

class AutoAdapter(RunAdapter):
    """Auto-detecting adapter that combines CMA and Standard JSON."""
    
    def __init__(self):
        self.cma = CMAJsonlAdapter()
        self.std = StandardJsonAdapter()

    def parse_metrics(self, run_path: Path) -> List[Dict[str, Any]]:
        res = self.cma.parse_metrics(run_path)
        if res:
            return res
        return self.std.parse_metrics(run_path)

def get_adapter(adapter_name: str) -> RunAdapter:
    adapters = {
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
