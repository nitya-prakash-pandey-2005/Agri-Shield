"""
Minimal, dependency-free .xlsx reader (zipfile + ElementTree).

Used by the data builders so they run on a stock Python install without
openpyxl. Reads one worksheet into a list of rows (list of cell values);
numbers come back as float, shared/inline strings as str, empty cells as None.

Author: Nitya Prakash Pandey
"""
from __future__ import annotations

import re
import zipfile
import xml.etree.ElementTree as ET

NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
REL_NS = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"


def _col_index(ref: str) -> int:
    letters = re.match(r"[A-Z]+", ref).group(0)  # type: ignore[union-attr]
    n = 0
    for ch in letters:
        n = n * 26 + (ord(ch) - 64)
    return n - 1


def sheet_names(path: str) -> list[str]:
    with zipfile.ZipFile(path) as z:
        wb = ET.fromstring(z.read("xl/workbook.xml"))
        return [s.attrib["name"] for s in wb.find("m:sheets", NS)]  # type: ignore[union-attr]


def read_sheet(path: str, name: str) -> list[list[object]]:
    with zipfile.ZipFile(path) as z:
        wb = ET.fromstring(z.read("xl/workbook.xml"))
        rels = ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))
        target = None
        for s in wb.find("m:sheets", NS):  # type: ignore[union-attr]
            if s.attrib["name"] == name:
                rid = s.attrib[REL_NS]
                for r in rels:
                    if r.attrib["Id"] == rid:
                        target = r.attrib["Target"].lstrip("/")
        if target is None:
            raise KeyError(f"sheet {name!r} not found")
        if not target.startswith("xl/"):
            target = "xl/" + target
        shared: list[str] = []
        if "xl/sharedStrings.xml" in z.namelist():
            sst = ET.fromstring(z.read("xl/sharedStrings.xml"))
            for si in sst.findall("m:si", NS):
                shared.append("".join(t.text or "" for t in si.iter("{%s}t" % NS["m"])))
        root = ET.fromstring(z.read(target))
        rows: list[list[object]] = []
        for row in root.iter("{%s}row" % NS["m"]):
            out: list[object] = []
            for c in row.findall("m:c", NS):
                idx = _col_index(c.attrib["r"])
                while len(out) < idx:
                    out.append(None)
                t = c.attrib.get("t")
                v = c.find("m:v", NS)
                val: object = None
                if t == "s" and v is not None:
                    val = shared[int(v.text or 0)]
                elif t == "inlineStr":
                    val = "".join(x.text or "" for x in c.iter("{%s}t" % NS["m"]))
                elif v is not None and v.text is not None:
                    try:
                        val = float(v.text)
                    except ValueError:
                        val = v.text
                out.append(val)
            rows.append(out)
        return rows
