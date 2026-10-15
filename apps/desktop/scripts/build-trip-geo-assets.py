"""Build offline trip place suggestions and world outlines from licensed source data.

Inputs: geonamescache 3.0.2 wheel (GeoNames CC BY) and Natural Earth 110m
countries GeoJSON (public domain). Generated JSON ships with the renderer, so
typing a trip destination never sends employee travel plans to a map provider.
"""

from __future__ import annotations

import argparse
import json
import re
import zipfile
from pathlib import Path
from typing import Any


def _aliases(name: str, values: list[str]) -> list[str]:
    seen = {name.casefold()}
    cyrillic: list[str] = []
    latin: list[str] = []
    for value in values:
        value = value.strip()
        key = value.casefold()
        if not 2 <= len(value) <= 48 or key in seen or not value[0].isalpha():
            continue
        seen.add(key)
        if re.search(r"[\u0400-\u04ff]", value):
            cyrillic.append(value)
        elif re.search(r"[A-Za-z]", value):
            latin.append(value)
    return cyrillic[:6] + latin[:4]


def _project(point: list[float]) -> str:
    longitude, latitude = point[:2]
    return f"{(longitude + 180) * 1000 / 360:.1f},{(90 - latitude) * 500 / 180:.1f}"


def _rings(geometry: dict[str, Any]) -> list[list[list[float]]]:
    if geometry["type"] == "Polygon":
        polygons = [geometry["coordinates"]]
    elif geometry["type"] == "MultiPolygon":
        polygons = geometry["coordinates"]
    else:
        return []
    rings: list[list[list[float]]] = []
    for polygon in polygons:
        if not isinstance(polygon, list):
            continue
        for ring in polygon:
            if not isinstance(ring, list):
                continue
            points: list[list[float]] = []
            for point in ring:
                if (isinstance(point, list) and len(point) >= 2
                        and isinstance(point[0], (int, float))
                        and isinstance(point[1], (int, float))):
                    points.append([float(point[0]), float(point[1])])
            if len(points) > 2:
                rings.append(points)
    return rings


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--geonames-wheel", required=True, type=Path)
    parser.add_argument("--natural-earth", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()

    with zipfile.ZipFile(args.geonames_wheel) as archive:
        raw_cities = json.loads(archive.read("geonamescache/data/cities15000.json"))
        raw_countries = json.loads(archive.read("geonamescache/data/countries.json"))
    earth = json.loads(args.natural_earth.read_text(encoding="utf-8"))

    city_rows = []
    for city in raw_cities.values():
        code = city["countrycode"]
        if code not in raw_countries:
            continue
        city_rows.append([
            city["geonameid"], city["name"], code,
            round(city["latitude"], 5), round(city["longitude"], 5),
            city["population"], city["admin1code"],
            _aliases(city["name"], city["alternatenames"]),
        ])
    city_rows.sort(key=lambda row: (-row[5], row[1], row[0]))

    centers: dict[str, list[float]] = {}
    land = []
    for feature in earth["features"]:
        properties = feature["properties"]
        code = properties.get("ISO_A2")
        if code and code != "-99":
            centers[code] = [properties["LABEL_Y"], properties["LABEL_X"]]
        for ring in _rings(feature["geometry"]):
            if len(ring) > 2:
                land.append("M" + "L".join(_project(point) for point in ring) + "Z")

    country_rows = []
    for code, country in sorted(raw_countries.items()):
        center = centers.get(code)
        if center is None:
            capital = country.get("capital", "")
            match = next(
                (city for city in city_rows if city[2] == code and city[1] == capital),
                None,
            )
            center = [match[3], match[4]] if match else None
        country_rows.append([code, country["name"], center])

    args.output.mkdir(parents=True, exist_ok=True)
    (args.output / "trip-places.json").write_text(
        json.dumps({"cities": city_rows, "countries": country_rows}, ensure_ascii=False,
                   separators=(",", ":")), encoding="utf-8",
    )
    (args.output / "trip-world-land.json").write_text(
        json.dumps({"path": "".join(land)}, separators=(",", ":")), encoding="utf-8",
    )
    print(f"Wrote {len(city_rows)} cities, {len(country_rows)} countries and {len(land)} rings")


if __name__ == "__main__":
    main()
