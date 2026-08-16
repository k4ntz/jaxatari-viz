import os
import json
import hashlib
import math
import re
from pathlib import Path
from typing import List, Dict, Any, Optional
import yaml

_PARSED_METRICS_CACHE: Dict[str, tuple[float, List[Dict[str, Any]]]] = {}
ARTIFACT_SCHEMA_VERSION = "jaxatari-viz.artifacts.v2"

class RunAdapter:
    """Base interface for parsing run metrics, configs, and logs."""

    def __init__(self):
        self.diagnostics: List[Dict[str, Any]] = []

    def diagnostic(self, kind: str, path: Path, message: str) -> None:
        self.diagnostics.append({"kind": kind, "path": str(path), "message": message})
    
    def parse_config(self, run_path: Path) -> Optional[Dict[str, Any]]:
        config_path = run_path / "config.json"
        if config_path.exists():
            try:
                with open(config_path, "r") as f:
                    return json.load(f)
            except (OSError, json.JSONDecodeError) as exc:
                self.diagnostic("config_parse_error", config_path, str(exc))
        return None

    def parse_metrics(self, run_path: Path) -> List[Dict[str, Any]]:
        raise NotImplementedError

    def parse_evaluations(self, run_path: Path) -> List[Dict[str, Any]]:
        """Read the report-evaluation artifacts without reparsing human-facing Markdown.

        The noisy minimum-return episode and the rollout selected for localization are
        deliberately represented separately: the pipeline selects the latter by the
        lexicographic (progress, return) criterion, so they need not be the same seed.
        """
        metrics_path = run_path / "metrics"
        if not metrics_path.exists():
            return []
        config = self.parse_config(run_path) or {}
        game = str(config.get("game", "")).lower()

        verdicts = self._parse_outer_verdicts(run_path)
        best_iter = None
        best_path = run_path / "best.json"
        if best_path.exists():
            try:
                best_iter = int(json.loads(best_path.read_text(encoding="utf-8")).get("iter"))
            except (OSError, ValueError, TypeError, json.JSONDecodeError):
                best_iter = None

        rows: List[Dict[str, Any]] = []
        for path in sorted(metrics_path.glob("iter*_eval.json")):
            match = re.search(r"iter(-?\d+)_eval\.json$", path.name)
            if not match:
                continue
            outer_iter = int(match.group(1))
            try:
                raw = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError) as exc:
                self.diagnostic("evaluation_parse_error", path, str(exc))
                continue
            if not isinstance(raw, dict):
                continue

            dev = raw.get("candidate_dev") if isinstance(raw.get("candidate_dev"), dict) else raw
            trace = raw.get("candidate_trace") if isinstance(raw.get("candidate_trace"), dict) else raw
            clean_payload = (raw.get("candidate_clean") if isinstance(raw.get("candidate_clean"), dict)
                             else raw.get("clean") if isinstance(raw.get("clean"), dict) else raw)
            sticky_payload = raw.get("sticky") if isinstance(raw.get("sticky"), dict) else raw

            returns = [float(value) for value in dev.get("robust_returns", [])
                       if isinstance(value, (int, float))]
            seed_values = [int(value) for value in dev.get("robust_seed_values", [])
                           if isinstance(value, (int, float))]
            if len(seed_values) != len(returns):
                seed_values = list(range(len(returns)))
            min_return_seed = None
            min_return = dev.get("robust_return_min")
            if returns:
                min_index = min(range(len(returns)), key=lambda index: returns[index])
                min_return_seed = seed_values[min_index]
                if min_return is None:
                    min_return = returns[min_index]

            localization_seed = dev.get("robust_worst_seed", trace.get("log_rollout_seed"))
            localization_return = dev.get("robust_worst_return")
            if localization_return is None and localization_seed in seed_values:
                localization_return = returns[seed_values.index(localization_seed)]

            terminated = dev.get("robust_terminated")
            truncated = dev.get("robust_truncated")
            decision_steps = dev.get("robust_decision_steps")
            terminated = ([bool(value) for value in terminated]
                          if isinstance(terminated, list) else [])
            truncated = ([bool(value) for value in truncated]
                         if isinstance(truncated, list) else [])
            decision_steps = ([int(value) for value in decision_steps]
                              if isinstance(decision_steps, list) else [])

            trace_terminated = trace.get("deterministic_terminated")
            trace_truncated = trace.get("deterministic_truncated")
            trace_completion_source = "artifact"
            if trace_terminated is not None:
                trace_terminated = bool(trace_terminated)
            if trace_truncated is not None:
                trace_truncated = bool(trace_truncated)
            if trace_terminated is None and trace_truncated is None:
                # A historical Pong trace whose final score is below 21 is provably incomplete:
                # JAXAtari Pong has no other terminal condition.  Do not call a score lead a win.
                player_score = trace.get("deterministic_score")
                enemy_score = trace.get("deterministic_enemy_score")
                if (game == "pong" and isinstance(player_score, (int, float))
                        and isinstance(enemy_score, (int, float))
                        and max(float(player_score), float(enemy_score)) < 21):
                    trace_terminated, trace_truncated = False, True
                    trace_completion_source = "legacy_pong_score_inference"
                else:
                    trace_completion_source = "unavailable"

            if trace_terminated is True and trace_truncated is not True:
                trace_completion_label = "complete"
            elif trace_truncated is True:
                trace_completion_label = "horizon-capped / incomplete"
            else:
                trace_completion_label = "completion unavailable"

            accepted = raw.get("accepted") if isinstance(raw.get("accepted"), bool) else verdicts.get(outer_iter)
            if isinstance(raw.get("accepted"), bool):
                accepted_source = "evaluation_json"
            elif accepted is None and best_iter is not None:
                # best.json only identifies the final champion, not every historical
                # acceptance. Keep the provenance explicit instead of inventing history.
                accepted_source = "final_champion_only"
                accepted = True if outer_iter == best_iter else None
            elif accepted is not None:
                accepted_source = "detailed_log_verdict"
            else:
                accepted_source = "unavailable"

            row = dict(raw)
            row.update({
                "schema_version": ARTIFACT_SCHEMA_VERSION,
                "record_type": "evaluation",
                "outer_iter": outer_iter,
                "iteration": outer_iter,
                "source_file": path.relative_to(run_path).as_posix(),
                "deterministic_return": trace.get("deterministic_return"),
                "robust_return_mean": dev.get("robust_return_mean"),
                "robust_return_min": min_return,
                "robust_return_std": dev.get("robust_return_std"),
                "robust_returns": returns,
                "no_noise_mean": clean_payload.get(
                    "robust_return_mean", raw.get("clean_return_mean", raw.get("no_noise_mean"))),
                "no_noise_min": clean_payload.get(
                    "robust_return_min", raw.get("clean_return_min", raw.get("no_noise_min"))),
                "noisy": {
                    "seed_count": dev.get("robust_seeds"),
                    "seed_values": seed_values,
                    "returns": returns,
                    "episodes": [{"seed": seed, "return": value}
                                 for seed, value in zip(seed_values, returns)],
                    "mean": dev.get("robust_return_mean"),
                    "min": min_return,
                    "std": dev.get("robust_return_std"),
                    "min_return_seed": min_return_seed,
                    "localization_seed": localization_seed,
                    "localization_return": localization_return,
                    "localization_progress": dev.get("robust_worst_climb"),
                    "selection_criterion": "lexicographic(progress, return)",
                },
                "clean": {
                    "mean": clean_payload.get(
                        "robust_return_mean", raw.get("clean_return_mean", raw.get("no_noise_mean"))),
                    "min": clean_payload.get(
                        "robust_return_min", raw.get("clean_return_min", raw.get("no_noise_min"))),
                },
                "sticky": {
                    "mean": sticky_payload.get("sticky_return_mean"),
                    "std": sticky_payload.get("sticky_return_std"),
                    "probability": sticky_payload.get("sticky_prob"),
                    "seed_count": sticky_payload.get("sticky_seeds"),
                },
                "completion": {
                    "terminated": terminated,
                    "truncated": truncated,
                    "decision_steps": decision_steps,
                    "termination_rate": dev.get("robust_termination_rate"),
                    "truncation_rate": dev.get("robust_truncation_rate"),
                    "trace_terminated": trace_terminated,
                    "trace_truncated": trace_truncated,
                    "trace_label": trace_completion_label,
                    "trace_source": trace_completion_source,
                },
                "pong_score": {
                    "player": trace.get("deterministic_score"),
                    "enemy": trace.get("deterministic_enemy_score"),
                } if game == "pong" else None,
                "trajectory": {
                    "legacy_rollout_id": raw.get("rollout_db_local_id", raw.get("rollout_id")),
                    "trajectory_id": raw.get("trajectory_id"),
                    "artifact_id": raw.get("trajectory_artifact_id"),
                    "artifact": (raw.get("trajectory_artifacts", {}).get("candidate")
                                 if isinstance(raw.get("trajectory_artifacts"), dict) else None),
                    "decision_count": trace.get("n_frames"),
                    "portable": bool(raw.get("trajectory_id") or raw.get("trajectory_artifact_id")),
                },
                "outer_accepted": accepted,
                "outer_accepted_source": accepted_source,
                "is_final_champion": best_iter is not None and outer_iter == best_iter,
            })
            rows.append(row)
        return rows

    @staticmethod
    def _parse_outer_verdicts(run_path: Path) -> Dict[int, bool]:
        path = run_path / "detailed_log.md"
        if not path.exists():
            return {}
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            return {}
        verdicts: Dict[int, bool] = {}
        sections = re.split(r"(?m)(?=^#\s+[^\n]*Iteration\s+-?\d+\s*$)", text)
        for section in sections:
            iteration = re.search(r"(?m)^#\s+[^\n]*Iteration\s+(-?\d+)\s*$", section)
            verdict = re.search(r"(?im)^-\s*\*\*Accepted:\*\*\s*(true|false)\s*$", section)
            if iteration and verdict:
                verdicts[int(iteration.group(1))] = verdict.group(1).lower() == "true"
        return verdicts

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

        metrics_data: List[Dict[str, Any]] = []
        config = self.parse_config(run_path) or {}
        cma_seed = config.get("cma_seed")
        eval_seed_count = config.get("eval_seeds")
        previous_params: Optional[Dict[str, float]] = None
        fallback_global_gen = 0
        for filepath in sorted(metrics_path.glob("iter*_cma.jsonl")):
            file_iter_match = re.search(r"iter(-?\d+)_cma\.jsonl$", filepath.name)
            file_iter = int(file_iter_match.group(1)) if file_iter_match else None
            try:
                with open(filepath, "r") as f:
                    for line in f:
                        if line.strip():
                            try:
                                raw = json.loads(line)
                            except json.JSONDecodeError as exc:
                                self.diagnostic("cma_jsonl_parse_error", filepath, str(exc))
                                continue
                            if not isinstance(raw, dict):
                                continue
                            row = dict(raw)
                            outer_iter = int(row.get("iter", file_iter if file_iter is not None else 0))
                            local_gen = int(row.get("gen", 0))
                            challenger = row.get("best_fitness")
                            incumbent = row.get("incumbent_fitness")
                            delta = row.get("paired_search_delta")
                            challenger_accepted = row.get("incumbent_updated")
                            if isinstance(challenger, (int, float)) and isinstance(incumbent, (int, float)):
                                if not isinstance(delta, (int, float)):
                                    delta = float(challenger) - float(incumbent)
                                if not isinstance(challenger_accepted, bool):
                                    challenger_accepted = float(delta) > 0

                            seed_values = row.get("search_seeds")
                            seed_set_id = row.get("search_seed_set_id")
                            seed_set_inferred = False
                            if (not isinstance(seed_values, list) and not seed_set_id and
                                    row.get("seed_protocol_version") is None and
                                    isinstance(cma_seed, int) and isinstance(eval_seed_count, int)):
                                seed_values = [1000 + cma_seed * 7919 + local_gen * 131 + index * 7
                                               for index in range(eval_seed_count)]
                                seed_digest = hashlib.sha256(json.dumps(seed_values).encode()).hexdigest()[:16]
                                seed_set_id = f"inferred:{seed_digest}"
                                seed_set_inferred = True

                            params = row.get("best_real") if isinstance(row.get("best_real"), dict) else None
                            param_l2_step = None
                            param_schema_changed = False
                            if params is not None and previous_params is not None:
                                common = sorted(set(params).intersection(previous_params))
                                param_schema_changed = set(params) != set(previous_params)
                                if not param_schema_changed and common and all(isinstance(params[key], (int, float)) and
                                                  isinstance(previous_params[key], (int, float)) for key in common):
                                    param_l2_step = math.sqrt(sum(
                                        (float(params[key]) - float(previous_params[key])) ** 2 for key in common
                                    ))
                            if params is not None:
                                previous_params = {key: float(value) for key, value in params.items()
                                                   if isinstance(value, (int, float))}

                            diagnostic_fields = (
                                "best_fitness", "mean_fitness", "incumbent_fitness", "ret_mean",
                                "min_y_best", "max_level", "level_finished", "deaths_mean",
                                "cma_sigma_before", "cma_sigma_after", "cma_condition_number",
                                "population_coordinate_std_mean",
                                "population_distance_from_incumbent_mean",
                                "challenger_distance_from_incumbent",
                                "boundary_parameter_fraction", "boundary_candidate_fraction",
                                "search_seed_set_id", "monitor_seed_set_id", "incumbent_updated",
                                "generation_episode_evaluations",
                                "generation_policy_decisions",
                                "generation_primary_env_steps",
                                "cumulative_optimizer_episode_evaluations",
                                "cumulative_optimizer_policy_decisions",
                                "cumulative_optimizer_primary_env_steps",
                                "primary_env_steps_exact",
                            )
                            available = [key for key in diagnostic_fields if row.get(key) is not None]
                            missing = [key for key in diagnostic_fields if row.get(key) is None]
                            exact_global_gen = row.get("global_gen")
                            if isinstance(exact_global_gen, int):
                                fallback_global_gen = max(fallback_global_gen, exact_global_gen + 1)
                            else:
                                exact_global_gen = fallback_global_gen
                                fallback_global_gen += 1
                            row.update({
                                "schema_version": ARTIFACT_SCHEMA_VERSION,
                                "record_type": "cma_generation",
                                "outer_iter": outer_iter,
                                "local_gen": local_gen,
                                "global_gen": exact_global_gen,
                                "global_gen_source": ("artifact" if isinstance(raw.get("global_gen"), int)
                                                      else "viewer_fallback"),
                                "challenger_fitness": challenger,
                                "fitness_delta": delta,
                                "challenger_accepted": challenger_accepted,
                                "seed_set_id": seed_set_id,
                                "seed_set": seed_values,
                                "seed_set_inferred": seed_set_inferred,
                                "param_l2_step": param_l2_step,
                                "param_schema_changed": param_schema_changed,
                                "diagnostics_available": available,
                                "diagnostics_missing": missing,
                                "source_file": filepath.relative_to(run_path).as_posix(),
                            })
                            metrics_data.append(row)
            except OSError as exc:
                self.diagnostic("cma_file_read_error", filepath, str(exc))
                continue
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
                cfg_lower = {str(k).lower(): v for k, v in cfg.items()} if isinstance(cfg, dict) else {}

                # Extract representation variant: OC vs Pixels
                is_oc = "oc" in run_path.name.lower() or "_oc" in str(run_path).lower() or cfg_lower.get("object_centric") is True or cfg_lower.get("pixel_based") is False
                is_pixel = not is_oc

                # Extract num_envs
                num_envs = cfg_lower.get("num_envs")
                if num_envs is None:
                    pstr = str(run_path)
                    for cand in [8192, 2048, 128, 64, 32, 8, 1]:
                        if f"_{cand}_" in pstr or f"/{cand}_" in pstr or f"/{cand}/" in pstr:
                            num_envs = cand
                            break
                if num_envs is None:
                    num_envs = 32
                cfg["num_envs"] = int(num_envs)

                # Extract backend
                if "ale" in str(run_path).lower().split("/"):
                    cfg["backend"] = "ale"
                elif "jaxatari" in str(run_path).lower().split("/"):
                    cfg["backend"] = "jaxatari"
                else:
                    cfg["backend"] = cfg_lower.get("backend", "jaxatari")

                # Automatically detect and normalize game
                game_raw = cfg_lower.get("env_name") or cfg_lower.get("env_id") or cfg_lower.get("game") or cfg_lower.get("env") or meta.get("name", "unknown_game")
                if isinstance(game_raw, str):
                    # Clean up common suffixes / prefixes
                    g_clean = game_raw.replace("-v5", "").replace("_v5", "").lower()
                    if "_" in g_clean and not any(k in g_clean for k in ("kangaroo", "seaquest", "skiing", "montezuma", "montezumarevenge", "space_invaders", "spaceinvaders", "asteroids", "bankheist", "bank_heist", "chopper_command", "choppercommand", "ice_hockey", "icehockey", "kung_fu_master", "kungfumaster", "robotank", "robo_tank", "fishing_derby", "fishingderby", "river_raid", "riverraid", "time_pilot", "timepilot", "word_zapper", "wordzapper", "sir_lancelot", "sirlancelot", "flag_capture", "flagcapture", "king_kong", "kingkong", "donkey_kong", "donkeykong")):
                        possible_game = g_clean.split("_")[0]
                        if possible_game not in ("ppo", "cma", "dqn", "rainbow", "pqn", "blendrl", "mlp"):
                            g_clean = possible_game
                    cfg["game"] = g_clean
                else:
                    cfg["game"] = "unknown_game"

                # Determine base method & clean representation tag
                exp_name = str(cfg_lower.get("exp_name") or cfg_lower.get("method") or cfg_lower.get("algorithm") or cfg_lower.get("alg_name") or cfg_lower.get("alg") or "").lower()
                algo = str(cfg_lower.get("algorithm") or cfg_lower.get("alg") or cfg_lower.get("alg_name") or "").lower()
                proj_name = str(cfg_lower.get("wandb_project_name") or cfg_lower.get("project") or "").lower()
                run_name = meta.get("name", run_path.name).lower()
                
                base_method = "Unknown"
                if "pqn" in exp_name or "pqn" in algo or "pqn" in run_name or "/pqn/" in str(run_path).lower():
                    base_method = "PQN"
                elif algo == "blender" or "blender" in cfg_lower or "blend" in proj_name or "blend" in run_name or "blendrl" in str(run_path).lower():
                    base_method = "BlendRL"
                elif "rainbow" in exp_name or "rainbow" in algo or "rainbow" in run_name or "/rainbow/" in str(run_path).lower():
                    base_method = "Rainbow"
                elif "dqn" in exp_name or "dqn" in algo or "dqn" in run_name or "/dqn/" in str(run_path).lower():
                    base_method = "DQN"
                elif "ppo" in exp_name or "ppo" in algo or "ppo" in run_name or "/ppo/" in str(run_path).lower():
                    base_method = "PPO"
                elif algo:
                    base_method = algo.upper() if len(algo) <= 4 else algo.title()
                elif exp_name:
                    base_method = exp_name.upper() if len(exp_name) <= 4 else exp_name.title()
                else:
                    base_method = "PPO"

                cfg["raw_alg"] = base_method
                rep_suffix = "(OC)" if is_oc else "(pixels)"
                cfg["method"] = f"{base_method} {rep_suffix}"

                if "model" not in cfg or cfg["model"] in ("wandb_run", "unknown_model"):
                    val_model = cfg_lower.get("valuation_model")
                    if isinstance(val_model, dict) and val_model.get("type") == "mlp":
                        cfg["model"] = "MLP"
                    elif is_oc:
                        cfg["model"] = "OC (Object Centric)"
                    elif is_pixel:
                        cfg["model"] = "Pixels"
                    elif exp_name.startswith("mlp"):
                        cfg["model"] = "MLP"
                    else:
                        cfg["model"] = base_method
                
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
            mtime = history_csv.stat().st_mtime
            cache_key = str(history_csv.resolve())
            if cache_key in _PARSED_METRICS_CACHE and _PARSED_METRICS_CACHE[cache_key][0] == mtime:
                return _PARSED_METRICS_CACHE[cache_key][1]

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
                                    m.get("charts/avg_episodic_return")
                                    if "charts/avg_episodic_return" in m
                                    else m.get("charts/episodic_return")
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
                    _PARSED_METRICS_CACHE[cache_key] = (mtime, metrics)
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
        super().__init__()
        self.wandb = WandbAdapter()
        self.cma = CMAJsonlAdapter()
        self.std = StandardJsonAdapter()

    def parse_config(self, run_path: Path) -> Optional[Dict[str, Any]]:
        res = self.wandb.parse_config(run_path)
        if res:
            return res
        return self.std.parse_config(run_path)

    def parse_metrics(self, run_path: Path) -> List[Dict[str, Any]]:
        for adapter in (self.wandb, self.cma, self.std):
            adapter.diagnostics.clear()
        res = self.wandb.parse_metrics(run_path)
        if res:
            self.diagnostics.extend(self.wandb.diagnostics)
            return res
        res = self.cma.parse_metrics(run_path)
        if res:
            self.diagnostics.extend(self.cma.diagnostics)
            return res
        res = self.std.parse_metrics(run_path)
        self.diagnostics.extend(self.wandb.diagnostics + self.cma.diagnostics + self.std.diagnostics)
        return res

def get_adapter(adapter_name: str) -> RunAdapter:
    adapters = {
        "wandb": WandbAdapter(),
        "cma_jsonl": CMAJsonlAdapter(),
        "standard_json": StandardJsonAdapter(),
        "auto": AutoAdapter(),
    }
    return adapters.get(adapter_name.lower(), AutoAdapter())

def _expand_config_value(value: Any, config_dir: Path) -> Any:
    if isinstance(value, list):
        return [_expand_config_value(item, config_dir) for item in value]
    if isinstance(value, dict):
        return {key: _expand_config_value(item, config_dir) for key, item in value.items()}
    if not isinstance(value, str):
        return value

    # Support ${NAME:-relative/default} in addition to the usual $NAME syntax.
    def replace_default(match: re.Match[str]) -> str:
        name, default = match.group(1), match.group(2)
        return os.environ.get(name, default or "")

    expanded = re.sub(r"\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}", replace_default, value)
    expanded = os.path.expanduser(os.path.expandvars(expanded))
    return expanded


def _resolve_config_paths(config: Dict[str, Any], config_dir: Path) -> Dict[str, Any]:
    path_keys = {"runs_dir", "baselines_file", "ale_baselines_file", "jaxatari_dir", "render_script"}
    expanded = _expand_config_value(config, config_dir)

    def walk(value: Any) -> Any:
        if isinstance(value, list):
            return [walk(item) for item in value]
        if not isinstance(value, dict):
            return value
        result = {}
        for key, item in value.items():
            item = walk(item)
            if key in path_keys and isinstance(item, str) and item:
                path = Path(item)
                if not path.is_absolute():
                    path = config_dir / path
                item = str(path.resolve(strict=False))
            result[key] = item
        return result

    return walk(expanded)


def load_config(config_path: Path = Path("config.yaml")) -> Dict[str, Any]:
    config_path = config_path.resolve(strict=False)
    if not config_path.exists():
        # A portable, empty default is safer than silently reading an author's machine.
        return _resolve_config_paths({
            "projects": [
                {
                    "name": "Default Thesis Runs",
                    "runs_dir": os.environ.get("THESIS_RUNS_DIR", "../thesis/runs"),
                    "adapter": "auto",
                    "baselines_file": os.environ.get("THESIS_BASELINES_FILE", "../thesis/data/baselines.csv")
                }
            ]
        }, config_path.parent)
    with open(config_path, "r") as f:
        loaded = yaml.safe_load(f) or {}
    if not isinstance(loaded, dict):
        raise ValueError(f"Configuration root must be a mapping: {config_path}")
    return _resolve_config_paths(loaded, config_path.parent)
