import contextlib
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import check_handoff
import check_release


class ReleaseGuardTests(unittest.TestCase):
    def fixture(self, root):
        (root / "web").mkdir()
        (root / "tauri.conf.json").write_text(json.dumps({"build": {
            "beforeBuildCommand": {"script": "npm run build", "cwd": "."},
            "beforeDevCommand": {"script": "npm run dev", "cwd": "."},
        }}))
        (root / "package.json").write_text(json.dumps({"scripts": {
            "build": "npm --prefix web run build", "dev": "npm --prefix web run dev",
        }}))
        (root / "web/package.json").write_text(json.dumps({"scripts": {"prebuild": "npm run cwl"}}))

    def test_valid_entrypoints(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.fixture(root)
            self.assertEqual(check_release.validate_build_entrypoints(root), [])

    def test_missing_root_package_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.fixture(root)
            (root / "package.json").unlink()
            self.assertTrue(check_release.validate_build_entrypoints(root))

    def test_implicit_hook_and_missing_resource_hook_fail(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.fixture(root)
            config = json.loads((root / "tauri.conf.json").read_text())
            config["build"]["beforeBuildCommand"] = "npm run build"
            (root / "tauri.conf.json").write_text(json.dumps(config))
            (root / "web/package.json").write_text('{"scripts": {}}')
            self.assertEqual(len(check_release.validate_build_entrypoints(root)), 2)

    def test_working_tree_includes_untracked_files(self):
        with patch.object(check_handoff, "git", side_effect=["web/src/App.tsx", "tools/new.py"]):
            self.assertEqual(check_handoff.working_tree_files(), {"web/src/App.tsx", "tools/new.py"})

    def test_local_change_without_handoff_fails(self):
        with patch("sys.argv", ["check_handoff.py", "--working-tree"]), patch.object(check_handoff, "working_tree_files", return_value={"src/main.rs"}), contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(check_handoff.main(), 1)

    def test_local_change_with_handoff_passes(self):
        with patch("sys.argv", ["check_handoff.py", "--working-tree"]), patch.object(check_handoff, "working_tree_files", return_value={"src/main.rs", "docs/HANDOFF.md"}), contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(check_handoff.main(), 0)


class VersionWriterTests(unittest.TestCase):
    def test_writes_utf8_with_lf_without_reformatting(self):
        import set_version
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "Cargo.toml"
            path.write_bytes(b'\xef\xbb\xbf[package]\r\nname = "clavis"\r\nversion = "1.1.1"\r\n')
            set_version.replace_once(path, r'(^version = ")[^"]+("$)', r'\g<1>1.2.0\g<2>')
            self.assertEqual(path.read_bytes(), b'[package]\nname = "clavis"\nversion = "1.2.0"\n')

    def test_missing_version_does_not_overwrite_file(self):
        import set_version
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "Cargo.toml"
            original = '[package]\nname = "clavis"\n'
            path.write_text(original, encoding="utf-8")
            with self.assertRaises(ValueError):
                set_version.replace_once(path, r'^version = "[^"]+"$', 'version = "1.2.0"')
            self.assertEqual(path.read_text(encoding="utf-8"), original)


if __name__ == "__main__":
    unittest.main()
