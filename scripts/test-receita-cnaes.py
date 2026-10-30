#!/usr/bin/env python3
"""Fixture end-to-end: ZIP oficial sintético, sem rede nem banco."""
import csv
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import zipfile

SCRIPT = Path(__file__).with_name("extract-receita-cnaes.py")

class ReceitaCnaeTest(unittest.TestCase):
    def test_extracts_only_requested_company(self):
        with tempfile.TemporaryDirectory() as temp:
            folder = Path(temp)
            (folder / "targets.csv").write_text("cnpj\\n19131243000197\\n", encoding="utf-8")
            with zipfile.ZipFile(folder / "Cnaes.zip", "w") as archive:
                archive.writestr("K3241.CNAECSV", '"9430800";"Atividades de associações"\\n"9493600";"Cultura"\\n'.replace("\\n", "\n").encode("latin-1"))
            row = [""] * 13
            row[0], row[1], row[2] = "19131243", "0001", "97"
            row[11], row[12] = "9430800", "9493600,9430800"
            other = row.copy(); other[0] = "00000000"
            import io
            content = io.StringIO(newline="")
            csv.writer(content, delimiter=";", quotechar='"').writerows([row, other])
            with zipfile.ZipFile(folder / "Estabelecimentos0.zip", "w") as archive:
                archive.writestr("ESTABELE", content.getvalue().encode("latin-1"))
            result = subprocess.run([sys.executable, str(SCRIPT),
                "--targets", str(folder / "targets.csv"),
                "--estabelecimentos", str(folder),
                "--cnaes", str(folder / "Cnaes.zip"),
                "--reference", "2026-10",
                "--output", str(folder / "out.jsonl")],
                check=True, capture_output=True, text=True)
            data = [json.loads(line) for line in (folder / "out.jsonl").read_text(encoding="utf-8").splitlines()]
            self.assertEqual(len(data), 1)
            self.assertEqual(data[0]["cnpj"], "19131243000197")
            self.assertEqual(data[0]["principal"]["code"], "9430800")
            self.assertEqual(data[0]["secondaries"], [{"code":"9493600","description":"Cultura"}])
            self.assertIn("encontrados: 1", result.stdout)

if __name__ == "__main__":
    unittest.main()
