import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.adapters import ARTIFACT_SCHEMA_VERSION, CMAJsonlAdapter, load_config


class CMAJsonlAdapterTests(unittest.TestCase):
    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory()
        self.run = Path(self.tempdir.name) / "run"
        (self.run / "metrics").mkdir(parents=True)
        (self.run / "config.json").write_text(json.dumps({
            "game": "pong", "method": "LeGPS", "cma_seed": 2, "eval_seeds": 3,
        }), encoding="utf-8")
        (self.run / "best.json").write_text(json.dumps({"iter": 1}), encoding="utf-8")
        (self.run / "detailed_log.md").write_text(
            "# 🔄 Iteration 0\n\n### ⚖️ Verdict\n\n- **Accepted:** True\n\n"
            "# 🔄 Iteration 1\n\n### ⚖️ Verdict\n\n- **Accepted:** False\n",
            encoding="utf-8",
        )

    def tearDown(self):
        self.tempdir.cleanup()

    def test_global_generations_and_same_seed_challenger_diagnostics(self):
        rows = [
            {"iter": 0, "gen": 0, "best_fitness": 2.0, "mean_fitness": 1.0,
             "incumbent_fitness": 1.5, "best_real": {"x": 1.0}, "ret_mean": -2.0},
            {"iter": 0, "gen": 1, "best_fitness": 1.0, "mean_fitness": 0.5,
             "incumbent_fitness": 1.2, "best_real": {"x": 2.0}, "ret_mean": -3.0},
        ]
        (self.run / "metrics" / "iter00_cma.jsonl").write_text(
            "".join(json.dumps(row) + "\n" for row in rows), encoding="utf-8"
        )
        (self.run / "metrics" / "iter01_cma.jsonl").write_text(
            json.dumps({**rows[0], "iter": 1}) + "\n{malformed\n", encoding="utf-8"
        )

        adapter = CMAJsonlAdapter()
        parsed = adapter.parse_metrics(self.run)

        self.assertEqual([row["global_gen"] for row in parsed], [0, 1, 2])
        self.assertEqual([row["outer_iter"] for row in parsed], [0, 0, 1])
        self.assertTrue(parsed[0]["challenger_accepted"])
        self.assertFalse(parsed[1]["challenger_accepted"])
        self.assertAlmostEqual(parsed[1]["fitness_delta"], -0.2)
        self.assertEqual(parsed[0]["ret_mean"], -2.0)
        self.assertTrue(parsed[0]["seed_set_inferred"])
        self.assertEqual(parsed[0]["seed_set"], [16838, 16845, 16852])
        self.assertIn("cma_sigma_before", parsed[0]["diagnostics_missing"])
        self.assertEqual(adapter.diagnostics[0]["kind"], "cma_jsonl_parse_error")

    def test_exact_generation_seed_and_cma_diagnostics_are_preserved(self):
        exact = {
            "iter": 2, "gen": 3, "global_gen": 17,
            "best_fitness": 4.0, "mean_fitness": 2.0,
            "incumbent_fitness": 1.0, "paired_search_delta": 3.0,
            "ret_mean": -2.0, "min_y_best": 1.0, "max_level": 2,
            "level_finished": False, "deaths_mean": 1.5,
            "search_seeds": [701, 709], "monitor_seeds": [901, 907],
            "search_seed_set_id": "sha256:search", "monitor_seed_set_id": "sha256:monitor",
            "cma_sigma_before": 0.4, "cma_sigma_after": 0.35,
            "cma_condition_number": 7.5,
            "population_coordinate_std_mean": 0.11,
            "population_distance_from_incumbent_mean": 0.23,
            "challenger_distance_from_incumbent": 0.19,
            "boundary_parameter_fraction": 0.02,
            "boundary_candidate_fraction": 0.25,
            "generation_episode_evaluations": 16,
            "generation_policy_decisions": 800,
            "generation_primary_env_steps": 1234,
            "cumulative_optimizer_episode_evaluations": 64,
            "cumulative_optimizer_policy_decisions": 3200,
            "cumulative_optimizer_primary_env_steps": 5678,
            "primary_env_steps_exact": True,
            # Acceptance is an exact logged protocol decision, not re-derived by the viewer.
            "incumbent_updated": False,
        }
        (self.run / "metrics" / "iter02_cma.jsonl").write_text(
            json.dumps(exact) + "\n", encoding="utf-8"
        )

        row = CMAJsonlAdapter().parse_metrics(self.run)[0]

        self.assertEqual(row["global_gen"], 17)
        self.assertEqual(row["global_gen_source"], "artifact")
        self.assertEqual(row["search_seed_set_id"], "sha256:search")
        self.assertEqual(row["monitor_seed_set_id"], "sha256:monitor")
        self.assertEqual(row["seed_set_id"], "sha256:search")
        self.assertEqual(row["seed_set"], [701, 709])
        self.assertFalse(row["seed_set_inferred"])
        self.assertFalse(row["incumbent_updated"])
        self.assertFalse(row["challenger_accepted"])
        for field in (
            "cma_sigma_before", "cma_sigma_after", "cma_condition_number",
            "population_coordinate_std_mean", "population_distance_from_incumbent_mean",
            "challenger_distance_from_incumbent", "boundary_parameter_fraction",
            "boundary_candidate_fraction", "search_seed_set_id", "monitor_seed_set_id",
            "incumbent_updated", "generation_episode_evaluations",
            "generation_policy_decisions", "generation_primary_env_steps",
            "cumulative_optimizer_episode_evaluations",
            "cumulative_optimizer_policy_decisions",
            "cumulative_optimizer_primary_env_steps", "primary_env_steps_exact",
        ):
            self.assertIn(field, row["diagnostics_available"])
            self.assertNotIn(field, row["diagnostics_missing"])

    def test_evaluation_keeps_numeric_minimum_and_localization_trace_separate(self):
        payload = {
            "deterministic_return": -7.0,
            "robust_return_mean": 1.0,
            "robust_return_min": -10.0,
            "robust_return_std": 8.0,
            "robust_returns": [5.0, -10.0, 8.0],
            "robust_worst_seed": 0,
            "robust_worst_return": 5.0,
            "robust_worst_climb": -3.0,
            "no_noise_mean": -2.0,
            "no_noise_min": -4.0,
            "sticky_return_mean": -6.0,
            "rollout_id": 96,
            "n_frames": 123,
        }
        (self.run / "metrics" / "iter00_eval.json").write_text(json.dumps(payload), encoding="utf-8")

        row = CMAJsonlAdapter().parse_evaluations(self.run)[0]

        self.assertEqual(row["schema_version"], ARTIFACT_SCHEMA_VERSION)
        self.assertEqual(row["noisy"]["min_return_seed"], 1)
        self.assertEqual(row["noisy"]["min"], -10.0)
        self.assertEqual(row["noisy"]["localization_seed"], 0)
        self.assertEqual(row["noisy"]["localization_return"], 5.0)
        self.assertTrue(row["outer_accepted"])
        self.assertEqual(row["outer_accepted_source"], "detailed_log_verdict")
        self.assertFalse(row["trajectory"]["portable"])

    def test_nested_evaluation_uses_actual_seed_values_and_clean_protocol(self):
        payload = {
            "accepted": False,
            "optimizer_interactions": {
                "iteration_primary_env_steps": 1234,
                "primary_env_steps_exact": True,
                "cumulative_primary_env_steps": 5678,
            },
            "candidate_trace": {"deterministic_return": -4.0, "log_rollout_seed": 1201,
                                "n_frames": 44, "deterministic_terminated": 0,
                                "deterministic_truncated": 1,
                                "deterministic_score": 19,
                                "deterministic_enemy_score": 0},
            "candidate_dev": {
                "robust_return_mean": -3.0, "robust_return_min": -9.0,
                "robust_return_std": 4.5, "robust_returns": [-4.0, -9.0, 4.0],
                "robust_seed_values": [1201, 1208, 1215],
                "robust_worst_seed": 1201, "robust_worst_return": -4.0,
                "robust_worst_climb": -2.0,
                "robust_terminated": [False, False, True],
                "robust_truncated": [True, True, False],
                "robust_decision_steps": [44, 44, 31],
                "robust_termination_rate": 1 / 3,
                "robust_truncation_rate": 2 / 3,
            },
            "candidate_clean": {"robust_return_mean": -1.0, "robust_return_min": -6.0},
            "sticky": {"sticky_return_mean": -7.0, "sticky_return_std": 2.0,
                       "sticky_prob": 0.25, "sticky_seeds": 5},
            "trajectory_artifact_id": "trajectory.iter00.candidate",
            "trajectory_id": "sha256:trajectory",
        }
        (self.run / "metrics" / "iter00_eval.json").write_text(json.dumps(payload), encoding="utf-8")

        row = CMAJsonlAdapter().parse_evaluations(self.run)[0]

        self.assertEqual(row["noisy"]["min_return_seed"], 1208)
        self.assertEqual(row["noisy"]["localization_seed"], 1201)
        self.assertEqual(row["noisy"]["episodes"][1], {"seed": 1208, "return": -9.0})
        self.assertEqual(row["clean"], {"mean": -1.0, "min": -6.0})
        self.assertEqual(row["sticky"]["probability"], 0.25)
        self.assertEqual(row["completion"]["terminated"], [False, False, True])
        self.assertEqual(row["completion"]["trace_label"], "horizon-capped / incomplete")
        self.assertEqual(row["completion"]["trace_source"], "artifact")
        self.assertEqual(row["pong_score"], {"player": 19, "enemy": 0})
        self.assertEqual(row["optimizer_interactions"]["cumulative_primary_env_steps"], 5678)
        self.assertFalse(row["outer_accepted"])
        self.assertEqual(row["outer_accepted_source"], "evaluation_json")
        self.assertTrue(row["trajectory"]["portable"])

    def test_legacy_pong_score_below_21_is_never_presented_as_a_win(self):
        payload = {
            "deterministic_return": 19.0,
            "deterministic_score": 19,
            "deterministic_enemy_score": 0,
            "robust_returns": [21.0, 19.0],
            "n_frames": 15000,
        }
        (self.run / "metrics" / "iter00_eval.json").write_text(
            json.dumps(payload), encoding="utf-8")

        row = CMAJsonlAdapter().parse_evaluations(self.run)[0]

        self.assertEqual(row["completion"]["trace_label"], "horizon-capped / incomplete")
        self.assertEqual(row["completion"]["trace_source"], "legacy_pong_score_inference")
        self.assertFalse(row["completion"]["trace_terminated"])
        self.assertTrue(row["completion"]["trace_truncated"])


class ConfigTests(unittest.TestCase):
    def test_paths_expand_relative_to_config_and_support_environment_defaults(self):
        with tempfile.TemporaryDirectory() as tempdir:
            root = Path(tempdir)
            config = root / "config.yaml"
            config.write_text(
                "projects:\n  - name: demo\n    runs_dir: '${TEST_RUNS_DIR:-runs}'\n"
                "ale_baselines_file: data/baselines.csv\n",
                encoding="utf-8",
            )
            with patch.dict(os.environ, {}, clear=False):
                os.environ.pop("TEST_RUNS_DIR", None)
                loaded = load_config(config)
            self.assertEqual(Path(loaded["projects"][0]["runs_dir"]), (root / "runs").resolve())
            self.assertEqual(Path(loaded["ale_baselines_file"]), (root / "data" / "baselines.csv").resolve())

    def test_checked_in_schemas_match_runtime_versions(self):
        repo_root = Path(__file__).resolve().parents[1]
        artifacts = json.loads((repo_root / "schemas" / "run-artifacts-v2.schema.json").read_text(encoding="utf-8"))
        trajectory = json.loads((repo_root / "schemas" / "trajectory-v1.schema.json").read_text(encoding="utf-8"))
        self.assertEqual(
            artifacts["$defs"]["evaluation"]["properties"]["schema_version"]["const"],
            ARTIFACT_SCHEMA_VERSION,
        )
        self.assertEqual(
            trajectory["properties"]["schema_version"]["enum"],
            ["jaxatari-viz.trajectory.v1", "legps.trajectory.v1"],
        )


if __name__ == "__main__":
    unittest.main()
