#!/usr/bin/env python3
"""Extract one preselected frame per independent SmartDoc document."""
import argparse
from collections import defaultdict
import csv
import gzip
import json
from pathlib import Path
import tarfile


def extract(archive, output):
    output.mkdir(parents=True, exist_ok=True)
    with tarfile.open(archive, "r|gz") as source:
        for member in source:
            if Path(member.name).name == "metadata.csv.gz" and member.isfile():
                metadata = gzip.decompress(source.extractfile(member).read()).decode()
                break
        else:
            raise ValueError("SmartDoc metadata.csv.gz is missing")

    documents = defaultdict(list)
    for row in csv.DictReader(metadata.splitlines()):
        if int(row["bg_id"]) == 0 and int(row["model_subid"]) in (1, 2, 3, 4):
            documents[row["model_name"]].append(row)
    if len(documents) != 24:
        raise ValueError(f"Expected 24 independent documents; found {len(documents)}")

    truth = {}
    for rows in documents.values():
        rows.sort(key=lambda row: int(row["frame_index"]))
        row = rows[len(rows) // 2]
        truth[row["image_path"]] = [
            [float(row[f"{corner}_{axis}"]) for axis in ("x", "y")]
            for corner in ("tl", "tr", "br", "bl")
        ]
    remaining = set(truth)
    with tarfile.open(archive, "r|gz") as source:
        while member := source.next():
            name = member.name.lstrip("./")
            if name in remaining and member.isfile():
                target = output / name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(source.extractfile(member).read())
                remaining.remove(name)
                if not remaining:
                    break
        if remaining:
            raise ValueError(f"Missing {len(remaining)} selected frames")
    (output / "truth.json").write_text(json.dumps(truth, indent=2) + "\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path)
    parser.add_argument("output", type=Path)
    options = parser.parse_args()
    extract(options.archive, options.output)
