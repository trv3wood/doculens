#!/usr/bin/env python3
"""Extract the fixed M0 sample or the stratified M1 SmartDoc benchmark."""
import argparse
from collections import defaultdict
import csv
import gzip
import json
from pathlib import Path
import tarfile


def extract(archive, output, expanded=False):
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
        if expanded or (int(row["bg_id"]) == 0 and int(row["model_subid"]) in (1, 2, 3, 4)):
            documents[(row["bg_name"], row["model_name"])].append(row)
    if not expanded and len(documents) != 24:
        raise ValueError(f"Expected 24 independent documents; found {len(documents)}")

    truth = {}
    partitions = defaultdict(dict)
    for rows in documents.values():
        rows.sort(key=lambda row: int(row["frame_index"]))
        positions = (1, 2, 3) if expanded else (2,)
        for quarter in positions:
            row = rows[len(rows) * quarter // 4]
            name = row["image_path"]
            truth[name] = [
                [float(row[f"{corner}_{axis}"]) for axis in ("x", "y")]
                for corner in ("tl", "tr", "br", "bl")
            ]
            if expanded:
                split = "development" if int(row["model_subid"]) < 3 else "validation"
                partitions[(split, row["bg_name"])][name] = truth[name]
    if expanded and (len(documents) != 150 or len(truth) != 450):
        raise ValueError("Expected 150 document/background sequences and 450 distinct frames")
    targets = {
        name: output / split / bg / name
        for (split, bg), frames in partitions.items()
        for name in frames
    }
    remaining = set(truth)
    with tarfile.open(archive, "r|gz") as source:
        while member := source.next():
            name = member.name.lstrip("./")
            if name in remaining and member.isfile():
                target = targets.get(name, output / name)
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(source.extractfile(member).read())
                remaining.remove(name)
                if not remaining:
                    break
        if remaining:
            raise ValueError(f"Missing {len(remaining)} selected frames")
    if expanded:
        for (split, bg), frames in partitions.items():
            (output / split / bg / "truth.json").write_text(json.dumps(frames, indent=2) + "\n")
    else:
        (output / "truth.json").write_text(json.dumps(truth, indent=2) + "\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--expanded", action="store_true", help="Select three quartiles per sequence across backgrounds")
    options = parser.parse_args()
    extract(options.archive, options.output, options.expanded)
