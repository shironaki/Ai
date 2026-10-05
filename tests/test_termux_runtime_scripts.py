from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]


class TermuxRuntimeScriptRegressionTests(unittest.TestCase):
    def test_control_plane_reads_newest_issue_comments(self):
        source = (ROOT / "scripts" / "termux_control.py").read_text(encoding="utf-8")
        self.assertIn("def fetch_issue_comments(after_id: int | None = None)", source)
        self.assertIn("sort=created&direction=desc", source)
        self.assertIn("comments = fetch_issue_comments(last)", source)

    def test_update_syncs_owned_untracked_qa_files(self):
        source = (ROOT / "scripts" / "termux_update.sh").read_text(encoding="utf-8")
        self.assertIn('"scripts/qa_agent.py"', source)
        self.assertIn('"qa/scenarios.json"', source)
        self.assertIn('if [[ "$line" == "?? "* ]]; then', source)
        self.assertIn("backed up stale untracked Termux/QA file", source)

    def test_supervisor_restarts_changed_control_process(self):
        source = (ROOT / "scripts" / "termux_supervisor.sh").read_text(encoding="utf-8")
        self.assertIn('CONTROL_HASHFILE="$REPO/termux-control.sha256"', source)
        self.assertIn('running_hash="$(cat "$CONTROL_HASHFILE"', source)
        self.assertIn('running_hash" != "$current_hash"', source)

    def test_qa_agent_refreshes_catalog_and_bounds_reports(self):
        source = (ROOT / "scripts" / "qa_agent.py").read_text(encoding="utf-8")
        self.assertIn("refresh_scenarios_from_github", source)
        self.assertIn('/contents/qa/scenarios.json?ref={QA_BRANCH}', source)
        self.assertIn("limit = 60000", source)
        self.assertIn("scenario_ok = all(item[\"ok\"] for item in results)", source)
        self.assertIn("if not scenario_ok:", source)


if __name__ == "__main__":
    unittest.main()
