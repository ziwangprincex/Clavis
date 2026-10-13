import json
from pathlib import Path
import tempfile
import unittest

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


class ReleaseNotesTests(unittest.TestCase):
    def notes(self, text):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "docs/releases").mkdir(parents=True)
            if text is not None:
                (root / "docs/releases/v1.9.0.md").write_text(text, encoding="utf-8")
            return check_release.validate_release_notes(root, "v1.9.0", "1.9.0")

    def test_heading_and_up_to_three_short_bullets_pass(self):
        self.assertEqual(self.notes("# Clavis 1.9.0\r\n\r\n- 修复表格。\r\n- Faster typing.\n"), [])

    def test_missing_wrong_heading_too_many_or_too_long_fail(self):
        self.assertTrue(self.notes(None))
        self.assertTrue(self.notes("# Clavis 1.8.0\n\n- a\n"))
        self.assertTrue(self.notes("# Clavis 1.9.0\n\n- a\n- b\n- c\n- d\n"))
        self.assertTrue(self.notes("# Clavis 1.9.0\n\nNot a bullet.\n"))
        self.assertTrue(self.notes("# Clavis 1.9.0\n\n- " + "长" * 240 + "\n"))


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
