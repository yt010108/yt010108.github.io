import importlib.util
import io
import json
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "collect-news.py"
spec = importlib.util.spec_from_file_location("collect_news", SCRIPT)
news = importlib.util.module_from_spec(spec)
spec.loader.exec_module(news)


class PagesNewsTest(unittest.TestCase):
    def test_clean_checkout_uses_deployed_history_when_a_publisher_is_down(self):
        day = "2026-11-19"
        morning = day + "T08:51:00+09:00"
        noon = day + "T11:51:00+09:00"
        old = {"id": "kisa-1", "source": "kisa", "day": "2026-11-18", "published": "2026-11-18", "title": "Original"}
        published_only = {"id": "dailysecu-2", "source": "dailysecu", "day": day, "published": day}
        seed = {"version": 1, "checked": {"kisa": noon}, "lastComplete": None,
                "articles": [{**old, "title": "Revised", "day": day}]}
        live = {"version": 1, "checked": {"kisa": morning, "dailysecu": morning}, "lastComplete": morning,
                "articles": [old, published_only]}

        def read(source, previous, stamp, today):
            if source == "kisa":
                self.assertEqual(stamp, noon)
                raise OSError("publisher down")
            return []

        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            target = root / "assets/security-news.json"
            target.parent.mkdir()
            target.write_text(json.dumps(seed), encoding="utf-8")
            prior = root / "published.json"
            prior.write_text(json.dumps(live), encoding="utf-8")
            with patch.multiple(news, ROOT=root, OUTPUT=target, read_source=read), redirect_stdout(io.StringIO()) as log, redirect_stderr(io.StringIO()):
                self.assertEqual(news.update(prior), 0)
            self.assertIn("::warning::", log.getvalue())
            result = json.loads(target.read_text(encoding="utf-8"))
            rows = {row["id"]: row for row in result["articles"]}
            self.assertEqual(len(result["articles"]), 2)
            self.assertEqual(rows["kisa-1"]["title"], "Revised")
            self.assertEqual(rows["kisa-1"]["day"], "2026-11-18")
            self.assertIn("dailysecu-2", rows)
            self.assertEqual(result["lastComplete"], morning)
            self.assertEqual(result["failed"], ["kisa"])


if __name__ == "__main__":
    unittest.main()
