#!/usr/bin/env python3
"""Rebuild the complete, pinned HYG 4.1 JSON using Python's standard library."""

import argparse
import csv
import gzip
import hashlib
import json
import math
from pathlib import Path
import tempfile
import urllib.request


REVISION = "c7f7f883fe678cc7680169a50ccd7dcc49b060ce"
SOURCE = (
    "https://raw.githubusercontent.com/astronexus/HYG-Database/"
    f"{REVISION}/hyg/CURRENT/hygdata_v41.csv"
)
SOURCE_SHA256 = "d9f69fd86bbf90a4e4d52b4c5c53eacfa6dfc0bfdef85bfd94f095e0bebe4ebd"
FIELDS = (
    "id hip hd hr gl bf proper ra dec dist pmra pmdec rv mag absmag spect ci "
    "x y z vx vy vz rarad decrad pmrarad pmdecrad bayer flam con comp "
    "comp_primary base lum var var_min var_max"
).split()
STRING_FIELDS = {"gl", "bf", "proper", "spect", "bayer", "flam", "con", "base", "var"}
INTEGER_FIELDS = {"id", "hip", "hd", "hr", "comp", "comp_primary"}
ROOT = Path(__file__).resolve().parents[1]


def convert(source_path: Path, destination: Path) -> None:
    digest = hashlib.sha256(source_path.read_bytes()).hexdigest()
    if digest != SOURCE_SHA256:
        raise ValueError(f"Unexpected HYG source SHA-256: {digest}")

    rows = []
    seen_ids = set()
    excluded_sun = 0
    with source_path.open(encoding="utf-8", newline="") as source_file:
        reader = csv.DictReader(source_file)
        if reader.fieldnames != FIELDS:
            raise ValueError("HYG column schema changed; inspect before rebuilding.")
        for record in reader:
            if record["id"] == "0":
                excluded_sun += 1
                continue
            row = []
            for field in FIELDS:
                raw = record[field]
                if raw == "":
                    value = None
                elif field in STRING_FIELDS:
                    value = raw
                elif field in INTEGER_FIELDS:
                    value = int(raw)
                else:
                    value = float(raw)
                    if not math.isfinite(value):
                        raise ValueError(f"Non-finite {field} for HYG {record['id']}")
                row.append(value)
            star_id, ra, dec, magnitude = row[0], row[7], row[8], row[13]
            if not isinstance(star_id, int) or star_id <= 0 or star_id in seen_ids:
                raise ValueError(f"Invalid or duplicate ID: {star_id}")
            if ra is None or dec is None or magnitude is None:
                raise ValueError(f"Missing position or magnitude for HYG {star_id}")
            if not 0 <= ra < 24 or not -90 <= dec <= 90:
                raise ValueError(f"Invalid sky position for HYG {star_id}")
            seen_ids.add(star_id)
            rows.append(row)

    if len(rows) != 119625 or excluded_sun != 1:
        raise ValueError("Unexpected catalogue size; the release must be reviewed.")

    document = {
        "schemaVersion": 1,
        "metadata": {
            "name": "HYG Database",
            "version": "4.1",
            "count": len(rows),
            "epoch": "J2000.0",
            "license": "CC BY-SA 4.0",
            "licenseUrl": "https://creativecommons.org/licenses/by-sa/4.0/",
            "source": SOURCE,
            "revision": REVISION,
            "sourceSha256": digest,
            "excludedSun": excluded_sun,
            "fields": len(FIELDS),
        },
        "columns": FIELDS,
        "rows": rows,
    }
    destination.parent.mkdir(parents=True, exist_ok=True)
    # A shared column header preserves every field without repeating 4.4M keys.
    encoded = json.dumps(document, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
    payload = (encoded + "\n").encode("utf-8")
    destination.write_bytes(payload)
    compressed_destination = destination.with_suffix(destination.suffix + ".gz")
    # Empty filename and fixed timestamp make the gzip header reproducible.
    with compressed_destination.open("wb") as compressed_file:
        with gzip.GzipFile(filename="", mode="wb", fileobj=compressed_file,
                           compresslevel=9, mtime=0) as compressor:
            compressor.write(payload)
    print(f"Wrote {len(rows):,} stars, {len(FIELDS)} fields: {destination}")
    print(f"JSON size: {destination.stat().st_size / 1_000_000:.2f} MB")
    print(f"Gzip size: {compressed_destination.stat().st_size / 1_000_000:.2f} MB")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, help="Existing official CSV (SHA-256 verified)")
    parser.add_argument("--output", type=Path, default=ROOT / "public/data/stars.json")
    args = parser.parse_args()
    if args.source:
        convert(args.source, args.output)
        return
    with tempfile.TemporaryDirectory(prefix="star-hyg-") as temporary:
        source_path = Path(temporary) / "hygdata_v41.csv"
        request = urllib.request.Request(SOURCE, headers={"User-Agent": "StarAtlas-CatalogBuilder/1"})
        with urllib.request.urlopen(request, timeout=120) as response:
            source_path.write_bytes(response.read())
        convert(source_path, args.output)


if __name__ == "__main__":
    main()
