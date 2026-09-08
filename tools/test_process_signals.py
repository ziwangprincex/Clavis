"""Reject ambiguous process-group kill arguments before native tests run."""
import re
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
KILL_ARGS = re.compile(r'::new\("kill"\)\s*\.args\(\[([^\]]+)\]\)', re.S)


def safe_group_args(arguments):
    return re.fullmatch(
        r'\s*"-(?:TERM|KILL)"\s*,\s*"--"\s*,\s*&format!\("-\{pid\}"\)\s*',
        arguments,
    ) is not None


class ProcessSignalTests(unittest.TestCase):
    def test_negative_group_is_an_operand_not_an_option(self):
        for source in ("src/latex/engine.rs", "src/tasks.rs"):
            with self.subTest(source=source):
                calls = KILL_ARGS.findall((ROOT / source).read_text(encoding="utf-8"))
                self.assertTrue(calls, "Expected process-group termination call")
                for arguments in calls:
                    self.assertTrue(safe_group_args(arguments), arguments)

    def test_rejects_legacy_and_misplaced_separator(self):
        for arguments in (
            '"-KILL", &format!("-{pid}")',
            '"-TERM", &format!("-{pid}"), "--"',
            '"-KILL", "--", "0"',
            '"-KILL", "--", "-1"',
        ):
            with self.subTest(arguments=arguments):
                self.assertFalse(safe_group_args(arguments))
        self.assertTrue(safe_group_args('"-KILL", "--", &format!("-{pid}")'))


if __name__ == "__main__":
    unittest.main()
