"""Clean the CESA and CoBiVa metadata CSVs and write aggregated data.js for the dashboard.

Run from the dashboard folder:  python3 build_data.py
Re-run whenever the CSVs in data/ change.
"""
import csv
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"

SOURCES = [
    ("CESA", "CESA Metadata(Revised Metadata).csv", "Tucson, AZ"),
    ("CoBiVa", "CoBiVa Metadata(Revision of cleaned metadata).csv", "Rio Grande Valley, TX"),
]

# Column index (in the CSV) -> field name. Headers are spread over 5 rows,
# so columns are addressed by position; both files share the same layout.
FIELDS = {
    1: "sex", 2: "birthYear", 3: "interviewYear", 4: "age", 5: "education",
    6: "residence", 7: "birthCity", 8: "birthState", 9: "birthCountry",
    12: "motherCountry", 15: "fatherCountry",
    16: "generation", 17: "yearsResidence", 18: "yearsUS",
}
PAIRED = [  # (first column, key) - each key has a Spanish then English column
    (19, "LH_ageLearn"), (21, "LH_comfortSpeaking"), (23, "LH_numberClasses"),
    (25, "LH_yearsCountry"), (27, "LH_yearsFamily"), (29, "LH_yearsWork"),
    (31, "LU_friends"), (33, "LU_family"), (35, "LU_schoolWork"),
    (37, "LU_think"), (39, "LU_math"),
]
SINGLE_PAIRS = [  # competency + attitudes: Spanish col, English col
    (41, "C_speak"), (43, "C_understand"), (45, "C_read"), (47, "C_write"),
    (49, "A_feelMyself"), (51, "A_identify"), (53, "A_nativeSpeaker"),
    (55, "A_perceivedNative"),
]

# Answers meaning "from the start" for age-learned / age-comfortable.
FROM_START = {"primera lengua", "first language", "siempre", "always",
              "desde siempre", "desde que sabia hablar"}

EDUCATION = [
    ("Less than high school", ["sixth grade", "3rd grade", "7th grade", "9th",
                               "junior high school"]),
    ("High school", ["high school", "12th grade"]),
    ("Some college / in college", [
        "some college", "sophomore college", "junior college", "freshman college",
        "senior college", "still in college", "college", "few years of college",
        "community coollege", "junior", "current college s.", "technical school",
        "university"]),
    ("Associate's degree", ["associate's degree", "associate degree"]),
    ("Bachelor's degree", ["bachelors degree", "bachelors", "college graduate"]),
    ("Graduate degree", ["master's degree", "doctoral degree"]),
]
EDU_LOOKUP = {raw: label for label, raws in EDUCATION for raw in raws}

COUNTRY = {"us": "USA", "usa": "USA", "mx": "Mexico", "mexico": "Mexico"}


def num(value, from_start_zero=False):
    """Parse a numeric survey answer; return None when it isn't one."""
    v = value.strip().lower()
    if not v or v in {"na", "n/a", "n-a", "-"}:
        return None
    if from_start_zero and v in FROM_START:
        return 0
    m = re.fullmatch(r"(\d+(?:\.\d+)?)\s*meses", v)  # "18 meses" -> years
    if m:
        return round(float(m.group(1)) / 12, 2)
    m = re.fullmatch(r"(\d+)\s+(\d)/(\d)", v)  # "1 1/2"
    if m:
        return int(m.group(1)) + int(m.group(2)) / int(m.group(3))
    m = re.match(r"(\d+(?:\.\d+)?)(\+|\s*\(|$)", v)  # "18+", "10 (2 in canada)"
    if m:
        f = float(m.group(1))
        return int(f) if f.is_integer() else f
    return None


def country(value):
    v = value.strip()
    if not v or v.upper() == "NA":
        return None
    return COUNTRY.get(v.lower(), v)


def read_rows(path):
    raw = path.read_bytes()
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = raw.decode("cp1252")
    rows = list(csv.reader(text.splitlines()))[5:]
    return [r for r in rows if any(c.strip() for c in r)]


def build():
    participants, unmapped = [], set()
    for corpus, filename, place in SOURCES:
        seen = {}
        for r in read_rows(DATA / filename):
            r = r + [""] * (57 - len(r))
            rid = r[0].strip()
            seen[rid] = seen.get(rid, 0) + 1
            pid = rid if corpus == "CESA" else f"CoBiVa{rid.zfill(3)}"
            if seen[rid] > 1:  # duplicate interview number in the source
                pid += f"-{seen[rid]}"
            p = {"id": pid, "corpus": corpus}
            for col, key in FIELDS.items():
                p[key] = r[col].strip() or None
            p["sex"] = p["sex"].strip() if p["sex"] else None
            for key in ("birthYear", "interviewYear", "age", "generation",
                        "yearsResidence", "yearsUS"):
                p[key] = num(r[[c for c, k in FIELDS.items() if k == key][0]])
            p["educationRaw"] = p["education"]
            if p["education"]:
                p["education"] = EDU_LOOKUP.get(p["education"].lower())
                if p["education"] is None:
                    unmapped.add(p["educationRaw"])
            for key in ("birthCountry", "motherCountry", "fatherCountry"):
                p[key] = country(r[[c for c, k in FIELDS.items() if k == key][0]])
            for col, key in PAIRED + SINGLE_PAIRS:
                start = key in ("LH_ageLearn", "LH_comfortSpeaking")
                p[key + "_es"] = num(r[col], start)
                p[key + "_en"] = num(r[col + 1], start)
            participants.append(p)

    return participants, unmapped


# Age bands used by the dashboard's "Age" filter (must match index.html).
AGE_BANDS = [(0, 24), (25, 39), (40, 200)]
# Variables shipped as value -> count histograms (additive across cells).
HIST_KEYS = (["age", "interviewYear", "education", "birthCountry",
              "motherCountry", "fatherCountry"]
             + [k + s for _, k in PAIRED + SINGLE_PAIRS for s in ("_es", "_en")
                if not k.startswith("LH_numberClasses")])
# Spanish-vs-English pairs shipped as (es, en) -> count, for the scatter.
PAIR_KEYS = ["LH_ageLearn", "LH_comfortSpeaking", "LH_yearsCountry",
             "LH_yearsFamily", "LH_yearsWork"]


def age_band(age):
    if age is None:
        return None
    for lo, hi in AGE_BANDS:
        if lo <= age <= hi:
            return f"{lo}-{hi}"
    return None


def aggregate(participants):
    """Collapse participants into cells keyed by every filter dimension.

    Each cell holds only counts, so any combination of dashboard filters is
    answered by summing cells - no individual records are written out.
    """
    cells = {}
    for p in participants:
        key = (p["corpus"], p["sex"], p["generation"], age_band(p["age"]))
        cell = cells.setdefault(key, {"n": 0, "hist": {}, "pairs": {}})
        cell["n"] += 1
        for k in HIST_KEYS:
            v = p[k]
            if v is not None:
                h = cell["hist"].setdefault(k, {})
                h[v] = h.get(v, 0) + 1
        for k in PAIR_KEYS:
            es, en = p[k + "_es"], p[k + "_en"]
            if es is not None and en is not None:
                h = cell["pairs"].setdefault(k, {})
                h[(es, en)] = h.get((es, en), 0) + 1

    def sort_key(v):
        return (isinstance(v, str), v)

    out = []
    for (corpus, sex, gen, band), c in sorted(
            cells.items(), key=lambda kv: tuple(sort_key(x or 0) for x in kv[0])):
        out.append({
            "corpus": corpus, "sex": sex, "gen": gen, "ageBand": band, "n": c["n"],
            "hist": {k: sorted(([v, n] for v, n in h.items()), key=lambda x: sort_key(x[0]))
                     for k, h in c["hist"].items()},
            "pairs": {k: sorted([es, en, n] for (es, en), n in h.items())
                      for k, h in c["pairs"].items()},
        })
    return out


def write(participants, unmapped):
    cells = aggregate(participants)
    meta = {
        "corpora": [{"key": c, "place": pl} for c, _, pl in SOURCES],
        "educationOrder": [label for label, _ in EDUCATION],
        "total": len(participants),
    }
    out = ROOT / "data.js"
    out.write_text(
        "// Generated by build_data.py - do not edit by hand.\n"
        "// Aggregated counts only (no individual participant records).\n"
        f"window.CORPUS_META = {json.dumps(meta, ensure_ascii=False)};\n"
        "window.CORPUS_CELLS = [\n"
        + ",\n".join(json.dumps(c, ensure_ascii=False, separators=(",", ":")) for c in cells)
        + "\n];\n",
        encoding="utf-8",
    )
    print(f"Wrote {out.name}: {len(participants)} participants in {len(cells)} aggregate cells")
    if unmapped:
        print("Unmapped education values:", sorted(unmapped))


if __name__ == "__main__":
    write(*build())
