# -*- coding: utf-8 -*-
"""
Builds docs/NeurAI-Platform-Architecture-2026-09-08.docx

Everything the document says comes from two data modules — content.py (prose)
and choices.py (the component ledger) — plus figures/ and the fresh screens in
docs/screens-2026-09-08/. This file is layout only: if a fact needs changing it
changes in one place, and no fact is typed twice.

Run:  python build_docx.py
"""
from pathlib import Path

from docx import Document
from docx.enum.section import WD_SECTION_START
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches, Pt, RGBColor

from choices import CHOICES, SOURCES
from content import CHAPTERS, STAMP, SUBTITLE, TITLE

HERE = Path(__file__).parent
FIGURES = HERE / "figures"
SCREENS = HERE.parent.parent / "screens-2026-09-08"
OUT = HERE.parent.parent / "NeurAI-Platform-Architecture-2026-09-08.docx"

GREEN = "0B3B2E"
ACCENT = "01743F"
INK = "16202B"
MUTED = "4C5F70"
HEAD_FILL = "0B3B2E"
ROW_FILL = "F1F5F7"


def el(parent, tag, **attrs):
    e = OxmlElement(tag)
    for k, v in attrs.items():
        e.set(qn(k), str(v))
    parent.append(e)
    return e


def shade(cell, colour):
    el(cell._tc.get_or_add_tcPr(), "w:shd", **{"w:val": "clear", "w:fill": colour})


def field(paragraph, instr):
    """A Word field (page number, total pages, table of contents)."""
    run = paragraph.add_run()
    el(run._r, "w:fldChar", **{"w:fldCharType": "begin"})
    t = OxmlElement("w:instrText")
    t.set(qn("xml:space"), "preserve")
    t.text = instr
    run._r.append(t)
    el(run._r, "w:fldChar", **{"w:fldCharType": "separate"})
    el(run._r, "w:fldChar", **{"w:fldCharType": "end"})
    return run


def styles(doc):
    for name, size, colour, bold in [
        ("Normal", 10.5, INK, False),
        ("Body Text", 10.5, INK, False),
        ("Heading 1", 19, GREEN, True),
        ("Heading 2", 13.5, ACCENT, True),
        ("Heading 3", 11.5, INK, True),
        ("Caption", 8.5, MUTED, False),
        ("Title", 30, GREEN, True),
        ("Subtitle", 13, MUTED, False),
        ("List Bullet", 10.5, INK, False),
        ("List Number", 10.5, INK, False),
    ]:
        st = doc.styles[name]
        st.font.name = "Calibri"
        st.font.size = Pt(size)
        st.font.bold = bold
        st.font.color.rgb = RGBColor.from_string(colour)
        rpr = st.element.get_or_add_rPr()
        fonts = rpr.find(qn("w:rFonts"))
        if fonts is None:
            fonts = el(rpr, "w:rFonts")
        for k in ("w:ascii", "w:hAnsi", "w:cs"):
            fonts.set(qn(k), "Calibri")
    doc.styles["Normal"].paragraph_format.space_after = Pt(7)
    doc.styles["Normal"].paragraph_format.line_spacing = 1.13
    for n in ("Heading 1", "Heading 2", "Heading 3"):
        doc.styles[n].paragraph_format.keep_with_next = True
    doc.styles["Heading 1"].paragraph_format.space_before = Pt(2)
    doc.styles["Heading 1"].paragraph_format.space_after = Pt(11)
    doc.styles["Heading 2"].paragraph_format.space_before = Pt(15)
    doc.styles["Heading 3"].paragraph_format.space_before = Pt(11)


def para(doc, text, style=None, size=None, colour=None, italic=False, after=None):
    p = doc.add_paragraph(style=style)
    r = p.add_run(text)
    if size:
        r.font.size = Pt(size)
    if colour:
        r.font.color.rgb = RGBColor.from_string(colour)
    r.italic = italic
    if after is not None:
        p.paragraph_format.space_after = Pt(after)
    return p


def table(doc, headers, rows, widths):
    t = doc.add_table(rows=1, cols=len(headers))
    t.autofit = False
    borders = el(t._tbl.tblPr, "w:tblBorders")
    for edge in ("top", "left", "bottom", "right", "insideH", "insideV"):
        el(borders, "w:" + edge, **{"w:val": "single", "w:sz": "4", "w:color": "D5DFE6"})
    for i, h in enumerate(headers):
        t.rows[0].cells[i].text = h
    for row in rows:
        cells = t.add_row().cells
        for c, v in zip(cells, row):
            c.text = str(v)
    for ri, row in enumerate(t.rows):
        el(row._tr.get_or_add_trPr(), "w:cantSplit")
        if ri == 0:
            el(row._tr.get_or_add_trPr(), "w:tblHeader")
        for ci, c in enumerate(row.cells):
            c.width = Inches(widths[ci])
            shade(c, HEAD_FILL if ri == 0 else (ROW_FILL if ri % 2 else "FFFFFF"))
            margins = el(c._tc.get_or_add_tcPr(), "w:tcMar")
            for edge, w in (("top", 70), ("left", 95), ("bottom", 70), ("right", 95)):
                el(margins, "w:" + edge, **{"w:w": str(w), "w:type": "dxa"})
            for p in c.paragraphs:
                p.paragraph_format.space_after = Pt(2)
                p.paragraph_format.space_before = Pt(1)
                for r in p.runs:
                    r.font.size = Pt(9)
                    r.bold = ri == 0
                    r.font.color.rgb = RGBColor.from_string("FFFFFF" if ri == 0 else INK)
    doc.add_paragraph().paragraph_format.space_after = Pt(3)
    return t


def picture(doc, path, width, caption):
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_after = Pt(3)
    p.paragraph_format.keep_with_next = True
    run = p.add_run()
    run.add_picture(str(path), width=Inches(width))
    run._r.getparent().getparent().xpath(".//pic:cNvPr")[0].set("descr", caption)
    c = doc.add_paragraph(style="Caption")
    c.alignment = WD_ALIGN_PARAGRAPH.CENTER
    c.add_run(caption)
    c.paragraph_format.space_after = Pt(12)


def cover(doc):
    for _ in range(3):
        doc.add_paragraph()
    para(doc, TITLE, style="Title", after=2)
    para(doc, SUBTITLE, style="Subtitle", after=18)
    picture(doc, FIGURES / "topology.png", 6.4,
            "The platform as deployed on 8 September 2026.")
    para(doc, STAMP, size=10, colour=MUTED, italic=True, after=2)
    para(doc, "Persian-first · agent-native · authority enforced by the database",
         size=10, colour=MUTED, after=2)
    doc.add_paragraph().add_run().add_break(WD_BREAK.PAGE)


def contents(doc):
    para(doc, "Contents", style="Heading 1")
    p = doc.add_paragraph()
    field(p, r'TOC \o "1-2" \h \z \u')
    para(doc, "Right-click the table above and choose “Update field” to build the page "
              "numbers in Word.", style="Caption", after=0)
    doc.add_paragraph().add_run().add_break(WD_BREAK.PAGE)


def ledger(doc):
    """Chapter: every component, why it was chosen, and three alternatives."""
    para(doc, "Every component, and why", style="Heading 1")
    para(doc, "This is the chapter to argue with. Each entry names a part the platform is "
              "actually built from, what it does here, why it was taken, and three "
              "alternatives that could stand in the same slot — with the trade-off each "
              "would impose. Where a choice was settled by measurement rather than by "
              "preference, the measurement is named.")
    para(doc, "Read the alternatives as a migration map: they are the options this system "
              "would consider if a constraint changed, not a list of things that were "
              "rejected as bad.")
    grouped = {}
    for entry in CHOICES:
        grouped.setdefault(entry[1], []).append(entry)
    for layer, entries in grouped.items():
        para(doc, layer, style="Heading 2")
        for name, _layer, role, why, alts in entries:
            emit_choice(doc, name, role, why, alts)


def emit_choice(doc, name, role, why, alts):
    if True:
        para(doc, name, style="Heading 3")
        p = doc.add_paragraph()
        r = p.add_run("Role. ")
        r.bold = True
        r.font.color.rgb = RGBColor.from_string(ACCENT)
        p.add_run(role)
        p.paragraph_format.space_after = Pt(3)
        p = doc.add_paragraph()
        r = p.add_run("Why this one. ")
        r.bold = True
        r.font.color.rgb = RGBColor.from_string(ACCENT)
        p.add_run(why)
        p.paragraph_format.space_after = Pt(5)
        table(doc, ["Alternative", "What it would cost or change"],
              [[a, t] for a, t in alts], [1.75, 4.45])


def sources(doc):
    para(doc, "Appendix — where the components are documented", style="Heading 1")
    para(doc, "Home pages only. Nothing here is a claim about a version; the versions in "
              "this document were read from the repository and the running services.")
    table(doc, ["Area", "Documentation"],
          [[row[0], "  ·  ".join(row[1:])] for row in SOURCES], [1.3, 4.9])


def measurements(doc):
    para(doc, "Appendix — measurements and their conditions", style="Heading 1")
    para(doc, "Every number in this document that could rot, with the date and the "
              "conditions under which it was taken. A measurement without its conditions "
              "is a claim, not a fact.")
    table(doc, ["Measurement", "Value", "Taken"],
          [["Tests (web, core, ml)", "2,921 (web 1,340 · core 1,433 · ml 148)", "8 Sep 2026"],
           ["SQL test files against the live catalogue", "65", "8 Sep 2026"],
           ["Migrations applied", "207", "8 Sep 2026"],
           ["Tables · policies · functions", "67 · 177 · 114", "8 Sep 2026, owner altitude"],
           ["API routes", "244", "8 Sep 2026, source count"],
           ["BFF route files · handlers", "179 · 238", "8 Sep 2026, source count"],
           ["Agent tools", "5 server reads · 97 client hands", "8 Sep 2026, registry count"],
           ["Persian word error rate", "2.1%",
            "13 Aug 2026 · one corrected reference recording"],
           ["Voiceprint gap (same voice vs impostor)", "0.226 with ERes2NetV2 (was 0.014)",
            "7 Sep 2026 · four models on the same clips"],
           ["BFF round trip, cache-busted /api/me", "295 ms (was 686 ms)",
            "5 Sep 2026 · after pinning functions to fra1"],
           ["Server", "3.8 GB RAM · 38 GB disk, 32% used · 14 days uptime", "8 Sep 2026"]],
          [2.0, 2.3, 1.9])


def build():
    doc = Document()
    s = doc.sections[0]
    s.page_width, s.page_height = Inches(8.27), Inches(11.69)
    s.top_margin = s.bottom_margin = Inches(0.75)
    s.left_margin = s.right_margin = Inches(0.78)
    styles(doc)

    core = doc.core_properties
    core.title = f"{TITLE} — {SUBTITLE}"
    core.author = "NeurAI Platform"
    core.comments = STAMP

    footer = s.footer.paragraphs[0]
    footer.alignment = WD_ALIGN_PARAGRAPH.CENTER
    footer.add_run(f"{TITLE} · architecture · 8 September 2026        ").font.size = Pt(8)
    field(footer, "PAGE")
    for r in footer.runs:
        r.font.size = Pt(8)
        r.font.color.rgb = RGBColor.from_string(MUTED)

    cover(doc)
    contents(doc)

    for index, (title, blocks) in enumerate(CHAPTERS):
        para(doc, title, style="Heading 1")
        for block in blocks:
            kind = block[0]
            if kind == "p":
                para(doc, block[1])
            elif kind == "h2":
                para(doc, block[1], style="Heading 2")
            elif kind == "h3":
                para(doc, block[1], style="Heading 3")
            elif kind == "ul":
                for item in block[1]:
                    doc.add_paragraph(item, style="List Bullet")
            elif kind == "num":
                for item in block[1]:
                    doc.add_paragraph(item, style="List Number")
            elif kind == "table":
                table(doc, block[1], block[2], block[3])
            elif kind == "fig":
                picture(doc, FIGURES / (block[1] + ".png"), 6.55, block[2])
            elif kind == "screen":
                # 5.3in, not the full column: a screenshot block is image plus
                # caption, and at full width two of them plus a heading leave a
                # third stranded — which is how a chapter ends up with pages
                # that are three inches of white under one picture.
                picture(doc, SCREENS / (block[1] + ".jpeg"), 5.3, block[2])
            elif kind == "note":
                p = doc.add_paragraph()
                r = p.add_run("Note. ")
                r.bold = True
                r.font.color.rgb = RGBColor.from_string(ACCENT)
                r.font.size = Pt(9.5)
                r2 = p.add_run(block[1])
                r2.font.size = Pt(9.5)
                r2.font.color.rgb = RGBColor.from_string(MUTED)
        # the ledger sits after the "shape" chapter, where a reader has just
        # been shown the four packages and is asking what they are made of
        if index == 1:
            doc.add_paragraph().add_run().add_break(WD_BREAK.PAGE)
            ledger(doc)
        doc.add_paragraph().add_run().add_break(WD_BREAK.PAGE)

    measurements(doc)
    doc.add_paragraph().add_run().add_break(WD_BREAK.PAGE)
    sources(doc)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    doc.save(OUT)
    print(f"wrote {OUT}")


if __name__ == "__main__":
    build()
