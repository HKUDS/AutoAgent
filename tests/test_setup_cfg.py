import configparser
from pathlib import Path
import unittest


class SetupCfgTests(unittest.TestCase):
    def test_python_requires_is_defined_under_options(self):
        setup_cfg = Path(__file__).resolve().parents[1] / "setup.cfg"
        parser = configparser.ConfigParser()
        parser.read(setup_cfg, encoding="utf-8")

        self.assertTrue(parser.has_option("options", "python_requires"))
        self.assertEqual(parser.get("options", "python_requires"), ">=3.10")

    def test_python_requires_is_not_under_packages_find(self):
        setup_cfg = Path(__file__).resolve().parents[1] / "setup.cfg"
        parser = configparser.ConfigParser()
        parser.read(setup_cfg, encoding="utf-8")

        self.assertFalse(parser.has_option("options.packages.find", "python_requires"))


if __name__ == "__main__":
    unittest.main()
