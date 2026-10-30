#!/usr/bin/env python3
"""Extract ONLY CRM-target CNPJs from Receita Federal's public ZIP files.

Input: Cnaes.zip + Estabelecimentos*.zip for ONE monthly publication, plus a
one-column CSV of target CNPJs. Does not need all ~70M rows in memory or unpack
the ZIPs. No database connection, HTTP calls or third-party dependencies.
"""
import argparse
import csv
import io
import json
import os
from pathlib import Path
import re
import sys
import zipfile

CNPJ = re.compile(r"[A-Z0-9]{12}[0-9]{2}$")
CNAE = re.compile(r"[0-9]{7}$")

def normalized_cnpj(value):
    item = re.sub(r"[^A-Z0-9]", "", value.strip().upper())
    return item if CNPJ.fullmatch(item) else None

def zip_rows(path):
    with zipfile.ZipFile(path) as archive:
        entries = [name for name in archive.namelist()
                   if not name.endswith("/") and not name.startswith("__MACOSX")]
        if len(entries) != 1:
            raise ValueError(f"{path}: esperado um arquivo de dados por ZIP")
        with archive.open(entries[0]) as raw:
            with io.TextIOWrapper(raw, encoding="latin-1", newline="") as stream:
                yield from csv.reader(stream, delimiter=";", quotechar='"')

def load_targets(path):
    with open(path, encoding="utf-8-sig", newline="") as stream:
        items = set()
        for record in csv.reader(stream):
            if not record:
                continue
            normalized = normalized_cnpj(record[0])
            if normalized:
                items.add(normalized)
        return items

def cnae_descriptions(path):
    result = {}
    for row in zip_rows(path):
        if len(row) >= 2 and CNAE.fullmatch(row[0].strip()):
            result[row[0].strip()] = row[1].strip()
    if not result:
        raise ValueError("Tabela de CNAEs vazia ou malformada.")
    return result

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--targets", required=True, help="CSV de CNPJs exportado do CRM")
    parser.add_argument("--estabelecimentos", required=True, help="Pasta contendo Estabelecimentos*.zip")
    parser.add_argument("--cnaes", required=True, help="Cnaes.zip da mesma competência")
    parser.add_argument("--reference", required=True, help="Competência AAAA-MM")
    parser.add_argument("--output", required=True, help="JSONL de CNAEs encontrados")
    args = parser.parse_args()
    if not re.fullmatch(r"20[0-9]{2}-(0[1-9]|1[0-2])", args.reference):
        parser.error("--reference precisa estar em AAAA-MM")
    zips = sorted(Path(args.estabelecimentos).glob("Estabelecimentos*.zip"))
    if not zips:
        parser.error("Pasta sem Estabelecimentos*.zip")
    if Path(args.output).resolve() == Path(args.targets).resolve():
        parser.error("Saída não pode sobrescrever a lista de CNPJs")
    targets = load_targets(args.targets)
    if not targets:
        parser.error("Nenhum CNPJ válido na lista de entrada")
    descriptions = cnae_descriptions(args.cnaes)
    remaining = targets.copy()
    found = 0
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    temp = output.with_name(output.name + ".partial")
    try:
        with open(temp, "w", encoding="utf-8", newline="") as result:
            for index, zip_path in enumerate(zips, start=1):
                rows = 0
                for row in zip_rows(zip_path):
                    rows += 1
                    if len(row) < 13:
                        continue
                    # Layout oficial: raiz, ordem, DV, ... principal (12ª),
                    # CNAEs secundários separados por vírgula (13ª).
                    cnpj = normalized_cnpj("".join(row[:3]))
                    if cnpj not in remaining:
                        continue
                    code = row[11].strip()
                    if not CNAE.fullmatch(code):
                        continue
                    secondary = []
                    used = {code}
                    for item in row[12].split(","):
                        item = item.strip()
                        if CNAE.fullmatch(item) and item not in used:
                            secondary.append({"code": item, "description": descriptions.get(item, "")})
                            used.add(item)
                    data = {
                        "cnpj": cnpj,
                        "principal": {"code": code, "description": descriptions.get(code, "")},
                        "secondaries": secondary,
                        "source": "RECEITA",
                        "reference": args.reference,
                    }
                    result.write(json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n")
                    remaining.remove(cnpj)
                    found += 1
                print(f"[{index}/{len(zips)}] {zip_path.name}: {rows} linhas analisadas", file=sys.stderr)
        os.replace(temp, output)
    finally:
        if temp.exists():
            temp.unlink()
    print(f"CNPJs solicitados: {len(targets)}; encontrados: {found}; sem resultado: {len(remaining)}")
    print(f"Arquivo gerado: {output}")

if __name__ == "__main__":
    main()
