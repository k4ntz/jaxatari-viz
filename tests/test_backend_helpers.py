import json
import gzip
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException

from backend.main import (
    VIDEO_MANIFEST_SCHEMA_VERSION,
    _render_spec,
    _read_trajectory_rows,
    _trajectory_artifact,
    _validated_video_manifest,
    compute_run_hash,
    resolve_under,
    sha256_file,
)


class BackendHelperTests(unittest.TestCase):
    def test_path_containment_rejects_traversal(self):
        with tempfile.TemporaryDirectory() as tempdir:
            root = Path(tempdir) / "runs"
            root.mkdir()
            self.assertEqual(resolve_under(root, "safe/file.json"), (root / "safe" / "file.json").resolve())
            with self.assertRaises(HTTPException):
                resolve_under(root, "../secret")

    def test_recursive_hash_changes_for_nested_metrics(self):
        with tempfile.TemporaryDirectory() as tempdir:
            run = Path(tempdir) / "run"
            metrics = run / "metrics"
            metrics.mkdir(parents=True)
            artifact = metrics / "iter00_eval.json"
            artifact.write_text('{"score": 1}', encoding="utf-8")
            first = compute_run_hash(run)
            artifact.write_text('{"score": 22}', encoding="utf-8")
            self.assertNotEqual(first, compute_run_hash(run))

    def test_video_manifest_requires_matching_input_and_content_hashes(self):
        with tempfile.TemporaryDirectory() as tempdir:
            run = Path(tempdir) / "run"
            video = run / "videos" / "cache" / ("a" * 64 + ".mp4")
            manifest_path = run / "videos" / "manifests" / "iter00.json"
            video.parent.mkdir(parents=True)
            manifest_path.parent.mkdir(parents=True)
            video.write_bytes(b"verified-video")
            manifest_path.write_text(json.dumps({
                "schema_version": VIDEO_MANIFEST_SCHEMA_VERSION,
                "input_fingerprint": "inputs-v1",
                "video_file": video.relative_to(run).as_posix(),
                "video_sha256": sha256_file(video),
                "verification": {"status": "passed"},
            }), encoding="utf-8")
            spec = {"manifest_path": manifest_path, "fingerprint": "inputs-v1", "run_path": run}
            manifest, reason = _validated_video_manifest(spec)
            self.assertIsNotNone(manifest)
            self.assertIsNone(reason)

            video.write_bytes(b"tampered")
            manifest, reason = _validated_video_manifest(spec)
            self.assertIsNone(manifest)
            self.assertEqual(reason, "video content hash mismatch")

    def test_render_spec_accepts_nondefault_environment_protocol(self):
        with tempfile.TemporaryDirectory() as tempdir:
            root = Path(tempdir)
            run = root / "runs" / "run"
            (run / "policies").mkdir(parents=True)
            (run / "params").mkdir()
            (run / "metrics").mkdir()
            render_script = root / "scripts" / "render.py"
            render_script.parent.mkdir()
            render_script.write_text("# renderer fixture\n", encoding="utf-8")
            protocol = {
                "game": "pong", "frame_skip": 3, "start_level": 2,
                "sticky_actions": True, "epsilon_random": 0.15, "eval_horizon": 321,
            }
            (run / "config.json").write_text(json.dumps(protocol), encoding="utf-8")
            (run / "policies" / "iter00.py").write_text("def policy(): pass\n", encoding="utf-8")
            (run / "params" / "iter00_best.json").write_text("{}\n", encoding="utf-8")
            (run / "metrics" / "iter00_eval.json").write_text(json.dumps({
                "candidate_trace": {"log_rollout_seed": 99, "deterministic_return": -7.0},
                "candidate_dev": {"robust_worst_seed": 99, "robust_worst_return": -7.0},
            }), encoding="utf-8")
            config = {
                "projects": [{"name": "demo", "runs_dir": str(root / "runs"),
                              "adapter": "cma_jsonl", "render_script": str(render_script)}]
            }

            with patch("backend.main.APP_CONFIG", config):
                spec = _render_spec("demo::run", 0)

            self.assertEqual(spec["config"]["frame_skip"], 3)
            self.assertEqual(spec["config"]["start_level"], 2)
            self.assertTrue(spec["config"]["sticky_actions"])
            self.assertEqual(spec["config"]["epsilon_random"], 0.15)
            self.assertEqual(spec["config"]["eval_horizon"], 321)
            self.assertEqual(spec["seed"], 99)
            self.assertEqual(spec["expected_return"], -7.0)

    def test_registered_legps_gzip_trajectory_is_hash_checked_and_normalized(self):
        with tempfile.TemporaryDirectory() as tempdir:
            run = Path(tempdir) / "run"
            trajectory = run / "trajectories" / "iter00_candidate_deadbeef.json.gz"
            trajectory.parent.mkdir(parents=True)
            payload = {
                "schema": "legps.trajectory.v1",
                "trajectory_id": "sha256:fixture",
                "metadata": {"iteration": 0},
                "transitions": [{
                    "t": 0, "action": 3, "proposed_action": 2,
                    "executed_action": 3, "reward": -1.0,
                    "transition__terminated": False,
                }],
            }
            with gzip.open(trajectory, "wt", encoding="utf-8") as handle:
                json.dump(payload, handle)
            entry = {
                "kind": "trajectory", "path": trajectory.relative_to(run).as_posix(),
                "sha256": sha256_file(trajectory), "bytes": trajectory.stat().st_size,
                "metadata": {
                    "schema": "legps.trajectory.v1", "game": "pong", "iteration": 0,
                    "episode_seed": 99, "n_transitions": 1, "return": -1.0,
                },
            }
            (run / "metrics").mkdir()
            (run / "metrics" / "iter00_eval.json").write_text(json.dumps({
                "trajectory_artifact_id": "trajectory.iter00.candidate",
            }), encoding="utf-8")
            (run / "manifest.json").write_text(json.dumps({
                "schema": "legps.run-manifest.v1",
                "artifacts": {"trajectory.iter00.candidate": entry},
            }), encoding="utf-8")

            path, manifest = _trajectory_artifact(run, 0)
            rows, total = _read_trajectory_rows(path, 0, 10)

            self.assertEqual(manifest["schema_version"], "legps.trajectory.v1")
            self.assertEqual(manifest["artifact_id"], "trajectory.iter00.candidate")
            self.assertEqual(total, 1)
            self.assertEqual(rows[0]["decision_t"], 0)
            self.assertEqual(rows[0]["policy_action"], 2)
            self.assertEqual(rows[0]["executed_action"], 3)
            self.assertFalse(rows[0]["done"])


if __name__ == "__main__":
    unittest.main()
