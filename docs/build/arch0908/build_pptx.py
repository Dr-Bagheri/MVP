# -*- coding: utf-8 -*-
"""
Builds docs/NeurAI-Platform-Demo-2026-09-08.pptx — fifteen slides for a live
demonstration of the running product.

Dark, because the product is dark: a light deck would put every screenshot in a
white frame and make the thing being demonstrated look like a foreign object.

Every figure on these slides is either a diagram from figures/ or a screenshot
taken on production on 8 September 2026. Each slide carries speaker notes with
what to say and, where it applies, what to click.

Run:  python build_pptx.py
"""
from pathlib import Path

from PIL import Image
from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import PP_ALIGN
from pptx.util import Emu, Inches, Pt

HERE = Path(__file__).parent
FIGURES = HERE / "figures"
SCREENS = HERE.parent.parent / "screens-2026-09-08"
OUT = HERE.parent.parent / "NeurAI-Platform-Demo-2026-09-08.pptx"

GROUND = RGBColor(0x0F, 0x14, 0x18)
CARD = RGBColor(0x18, 0x1F, 0x24)
EDGE = RGBColor(0x2A, 0x34, 0x3B)
ACCENT = RGBColor(0x12, 0xA4, 0x5A)
TEXT = RGBColor(0xEC, 0xF1, 0xF4)
MUTED = RGBColor(0x93, 0xA3, 0xAE)

W, H = Inches(13.333), Inches(7.5)
MARGIN = Inches(0.72)


def deck():
    prs = Presentation()
    prs.slide_width, prs.slide_height = W, H
    return prs


def blank(prs):
    return prs.slides.add_slide(prs.slide_layouts[6])


def rect(slide, x, y, w, h, fill=None, line=None, radius=False):
    shape = slide.shapes.add_shape(
        MSO_SHAPE.ROUNDED_RECTANGLE if radius else MSO_SHAPE.RECTANGLE, x, y, w, h)
    if radius:
        try:
            shape.adjustments[0] = 0.06
        except Exception:
            pass
    if fill is None:
        shape.fill.background()
    else:
        shape.fill.solid()
        shape.fill.fore_color.rgb = fill
    if line is None:
        shape.line.fill.background()
    else:
        shape.line.color.rgb = line
        shape.line.width = Pt(1)
    shape.shadow.inherit = False
    return shape


def text(slide, x, y, w, h, runs, align=PP_ALIGN.LEFT, spacing=None):
    """runs: list of (text, size, colour, bold) — one paragraph each."""
    box = slide.shapes.add_textbox(x, y, w, h)
    tf = box.text_frame
    tf.word_wrap = True
    tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = 0
    for i, (t, size, colour, bold) in enumerate(runs):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.alignment = align
        if spacing:
            p.space_after = Pt(spacing)
        r = p.add_run()
        r.text = t
        r.font.size = Pt(size)
        r.font.bold = bold
        r.font.color.rgb = colour
        r.font.name = "Segoe UI"
    return box


def chrome(prs, slide, index, kicker, title):
    rect(slide, 0, 0, W, Inches(0.07), fill=ACCENT)
    if kicker:
        text(slide, MARGIN, Inches(0.5), Inches(11), Inches(0.3),
             [(kicker.upper(), 11, ACCENT, True)])
    if title:
        text(slide, MARGIN, Inches(0.82), Inches(11.9), Inches(0.9),
             [(title, 30, TEXT, True)])
    text(slide, MARGIN, H - Inches(0.52), Inches(9), Inches(0.3),
         [("NeurAI Platform  ·  production demonstration  ·  8 September 2026", 9, MUTED, False)])
    text(slide, W - MARGIN - Inches(1), H - Inches(0.52), Inches(1), Inches(0.3),
         [(f"{index:02d}", 9, MUTED, False)], align=PP_ALIGN.RIGHT)


def notes(slide, body):
    slide.notes_slide.notes_text_frame.text = body


def shot(slide, name, x, y, w, caption=None, folder=None):
    """Place an image scaled to width, with an edge and an optional caption."""
    path = (folder or SCREENS) / name
    with Image.open(path) as im:
        ratio = im.height / im.width
    h = Emu(int(w * ratio))
    rect(slide, x - Inches(0.035), y - Inches(0.035),
         w + Inches(0.07), h + Inches(0.07), fill=EDGE)
    slide.shapes.add_picture(str(path), x, y, width=w, height=h)
    if caption:
        text(slide, x, y + h + Inches(0.12), w, Inches(0.4),
             [(caption, 10, MUTED, False)])
    return h


def figure(slide, name, top=Inches(0.26), bottom=Inches(0.64)):
    """A drawn diagram gets the whole slide.

    It carries its own title, subtitle and footnote, so repeating them in the
    slide chrome would print the same sentence twice — and a 3x3 grid is about
    0.59 as tall as it is wide, which does not fit under a title on a 16:9
    stage. So: fit to the height between the accent bar and the footer, and
    centre it.
    """
    path = FIGURES / name
    with Image.open(path) as im:
        ratio = im.height / im.width
    h = H - top - bottom
    w = Emu(int(h / ratio))
    x = Emu(int((W - w) / 2))
    rect(slide, x - Inches(0.03), top - Inches(0.03),
         w + Inches(0.06), h + Inches(0.06), fill=EDGE)
    slide.shapes.add_picture(str(path), x, top, width=w, height=h)


def tiles(slide, y, items, cols=4, height=Inches(1.42)):
    gap = Inches(0.22)
    total = W - 2 * MARGIN
    w = int((total - gap * (cols - 1)) / cols)
    for i, (big, small) in enumerate(items):
        col, row = i % cols, i // cols
        x = MARGIN + col * (w + gap)
        yy = y + row * (height + gap)
        rect(slide, x, yy, w, height, fill=CARD, line=EDGE, radius=True)
        text(slide, x + Inches(0.28), yy + Inches(0.2), w - Inches(0.4), Inches(0.5),
             [(big, 25, ACCENT, True)])
        text(slide, x + Inches(0.28), yy + Inches(0.72), w - Inches(0.5), Inches(0.6),
             [(small, 11.5, MUTED, False)])


def bullets(slide, x, y, w, items, size=14, gap=13):
    runs = []
    for item in items:
        runs.append(("•  " + item, size, TEXT, False))
    text(slide, x, y, w, Inches(4.5), runs, spacing=gap)


def build():
    prs = deck()
    n = 0

    # 01 ── title ────────────────────────────────────────────────────────
    n += 1
    s = blank(prs)
    rect(s, 0, 0, W, H, fill=GROUND)
    rect(s, 0, 0, Inches(0.14), H, fill=ACCENT)
    text(s, MARGIN, Inches(2.15), Inches(8.4), Inches(1.2),
         [("NeurAI Platform", 54, TEXT, True)])
    text(s, MARGIN, Inches(3.35), Inches(8.0), Inches(1.6),
         [("A Persian-first work platform where the meeting becomes a record, "
           "the record becomes work, and the agents doing that work can never "
           "exceed the authority of the person they work for.", 17, MUTED, False)])
    text(s, MARGIN, Inches(5.4), Inches(9), Inches(0.9),
         [("Live production system  ·  8 September 2026", 13, ACCENT, True),
          ("42 recordings · 2,395 transcript lines · 607 agent runs · 207 migrations", 12, MUTED, False)],
         spacing=6)
    notes(s, "Open on the product, not on the deck. This is a running system with real "
             "data in it — everything shown today was measured or captured on 8 September.")

    # 02 ── the problem ─────────────────────────────────────────────────
    n += 1
    s = blank(prs)
    rect(s, 0, 0, W, H, fill=GROUND)
    chrome(prs, s, n, "the problem", "Three things leak out of every organisation")
    tiles(s, Inches(2.1), [
        ("What was said", "The meeting happened. The recording, if there is one, is a file "
                          "nobody opens again."),
        ("What was decided", "Decisions live in someone's memory and in three different "
                             "chat threads."),
        ("Who owes what", "Actions are agreed out loud and never become work with a name "
                          "and a date."),
    ], cols=3, height=Inches(2.0))
    text(s, MARGIN, Inches(4.65), Inches(11.9), Inches(1.4),
         [("Every one of those is a retrieval problem with a permission problem inside it. "
           "That is why this is a platform and not a note-taker.", 16, TEXT, False)])
    notes(s, "Keep this short. The audience already believes the problem; the deck's job is "
             "to show that the answer is built, not described.")

    # 03 ── what it is ──────────────────────────────────────────────────
    n += 1
    s = blank(prs)
    rect(s, 0, 0, W, H, fill=GROUND)
    chrome(prs, s, n, "what it is", "One platform, four things it does")
    tiles(s, Inches(2.0), [
        ("Work", "Meetings, tasks, projects and team rooms — the surfaces people already "
                 "live in, in Persian."),
        ("Record", "Recordings become transcripts, named voices, summaries, minutes and "
                   "citable evidence."),
        ("Agents", "Echo and two colleagues that read the record and act on the same "
                   "surfaces, with consent."),
        ("Governance", "Roles, an audit trail, a curated model list, retention — enforced "
                       "by the database."),
    ], cols=4, height=Inches(2.1))
    text(s, MARGIN, Inches(4.75), Inches(11.9), Inches(1.2),
         [("The AI is not a panel bolted to the side. It is a participant with a seat, a "
           "role, and a line in the audit log.", 16, TEXT, False)])
    notes(s, "The one sentence that separates this from a meeting-notes tool: the agents "
             "have seats in the organisation and their authority is a database grant.")

    # 04 ── live today ──────────────────────────────────────────────────
    n += 1
    s = blank(prs)
    rect(s, 0, 0, W, H, fill=GROUND)
    chrome(prs, s, n, "not a prototype", "What is running right now")
    tiles(s, Inches(1.95), [
        ("42", "recordings, 32 fully processed"),
        ("2,395", "transcript lines under permission"),
        ("607", "agent runs, 580 completed"),
        ("14", "member accounts, 3 roles"),
        ("207", "database migrations applied"),
        ("177", "row-level policies, RLS forced on all 67 tables"),
        ("2,921", "automated tests in web, core and ml"),
        ("13", "connectors on the shelf, 6 connected"),
    ], cols=4, height=Inches(1.5))
    text(s, MARGIN, Inches(5.3), Inches(11.9), Inches(0.8),
         [("Read from the production database and the running services on the morning of "
           "this deck. Uptime and cost per meeting are deliberately absent — neither has "
           "been measured over a long enough window to state.", 12.5, MUTED, False)])
    notes(s, "If somebody asks for uptime, the honest answer is that it has not been "
             "measured over a meaningful window. Say that rather than guessing.")

    # 05 ── the pipeline ────────────────────────────────────────────────
    n += 1
    s = blank(prs)
    rect(s, 0, 0, W, H, fill=GROUND)
    chrome(prs, s, n, None, None)
    figure(s, "pipeline.png")
    notes(s, "Point at three things: parts are queued as they are captured (a dying tab "
             "does not lose the meeting); only detected speech is sent to the paid "
             "transcriber; and everything downstream of the transcript is rebuildable.")

    # 06 ── the record ──────────────────────────────────────────────────
    n += 1
    s = blank(prs)
    rect(s, 0, 0, W, H, fill=GROUND)
    chrome(prs, s, n, "demo · the record", "A real meeting, eighteen minutes, in Persian")
    shot(s, "record-summary.jpeg", MARGIN, Inches(1.85), Inches(7.6),
         "The summary of a management meeting: performance, finance, hiring, appointments.")
    bullets(s, Inches(9.0), Inches(1.95), Inches(3.7), [
        "Sectioned summary, not a wall of text",
        "Every version kept, with the model that wrote it",
        "Word error rate 2.1% on Persian (measured, 13 Aug)",
        "Click any word to hear that second",
        "Searchable — under the reader's own permissions",
    ], size=13, gap=14)
    notes(s, "This is the strongest single screen in the demo. It is real Persian audio "
             "from a real meeting; open the transcript tab next and click a word to seek.")

    # 07 ── persian-first ───────────────────────────────────────────────
    n += 1
    s = blank(prs)
    rect(s, 0, 0, W, H, fill=GROUND)
    chrome(prs, s, n, "why it works here", "Persian-first is a build decision, not a translation")
    shot(s, "record-transcript.jpeg", MARGIN, Inches(1.85), Inches(7.6),
         "Named voices, per-line direction, click-to-seek, and a speaker filter.")
    bullets(s, Inches(9.0), Inches(1.95), Inches(3.7), [
        "Right-to-left everywhere, including menus and dialogs",
        "Persian digits — typed as well as displayed",
        "Jalali calendar; months follow the calendar, digits follow the language",
        "Names normalised (ی/ي, ک/ك, ZWNJ) once, in SQL",
        "A mixed Persian/English line keeps its own direction",
    ], size=13, gap=14)
    notes(s, "Most products translate an English product. Here the default path is Persian "
             "and English is the mirror — which is why the RTL details are right.")

    # 08 ── the agents ──────────────────────────────────────────────────
    n += 1
    s = blank(prs)
    rect(s, 0, 0, W, H, fill=GROUND)
    chrome(prs, s, n, "the agents", "Echo, and two colleagues with seats")
    shot(s, "agents.jpeg", MARGIN, Inches(1.85), Inches(7.3),
         "Roya runs the operational work; Ava reads the record and reports.")
    bullets(s, Inches(8.7), Inches(1.95), Inches(4.0), [
        "Name one and it keeps the floor until you name another",
        "Two names in one message: both answer, in order",
        "Echo hands work over when it is more than three pieces",
        "Each agent has a member seat, so its actions are attributable",
        "In a team room they answer only when named or replied to",
    ], size=13, gap=14)
    notes(s, "Demo: say «رؤیا» and ask for something operational, then ask a follow-up "
             "without naming anyone — she still answers, and the chip shows why.")

    # 09 ── the hands ───────────────────────────────────────────────────
    n += 1
    s = blank(prs)
    rect(s, 0, 0, W, H, fill=GROUND)
    chrome(prs, s, n, "the strength", "The agent acts — and asks first, by name")
    tiles(s, Inches(1.95), [
        ("5", "server-side READS, on the agent's own database role"),
        ("97", "client tools that run in your session, through the same API a button uses"),
        ("0", "DELETE grants held by the agent role, anywhere in the schema"),
    ], cols=3, height=Inches(1.6))
    text(s, MARGIN, Inches(3.85), Inches(11.9), Inches(2.2),
         [("The consent card names the OBJECT, not just the verb.", 18, TEXT, True),
          ("«Delete the task “budget review”» — not «delete task». A card that names only "
           "the verb collects a yes to anything. You may grant a yes for the whole session, "
           "and that grant never covers deletions, messages, invitations, revocations, role "
           "or permission changes, record scope, approved minutes, shared conversations, or "
           "the model list.", 14, MUTED, False)], spacing=10)
    notes(s, "This slide answers the question every serious buyer asks: what stops it doing "
             "something stupid? Answer: it cannot — the grant is missing — and where it can, "
             "you saw the object named before you said yes.")

    # 10 ── authority ───────────────────────────────────────────────────
    n += 1
    s = blank(prs)
    rect(s, 0, 0, W, H, fill=GROUND)
    chrome(prs, s, n, None, None)
    figure(s, "request.png")
    notes(s, "Prompts guide behaviour; policies decide it. An injected instruction cannot "
             "widen what a run may reach, because the widening would have to happen in the "
             "grant table.")

    # 11 ── voice identity ──────────────────────────────────────────────
    n += 1
    s = blank(prs)
    rect(s, 0, 0, W, H, fill=GROUND)
    chrome(prs, s, n, "how we work", "We measure the thing, then choose")
    text(s, MARGIN, Inches(1.85), Inches(11.9), Inches(0.7),
         [("Voice identification was failing. Four models were scored on the organisation's "
           "own recordings — the same voice through two microphones, against impostors from "
           "a four-person conversation.", 14.5, MUTED, False)])
    rows = [
        ("eres2net_base  (what we shipped)", "0.368 – 0.437", "0.364", "0.014"),
        ("ERes2NetV2  (now live)", "0.571 – 0.638", "0.351", "0.226"),
        ("CAM++", "0.487 – 0.554", "0.376", "0.111"),
        ("WeSpeaker ResNet34", "0.670 – 0.776", "0.682", "−0.011"),
    ]
    head_y = Inches(2.75)
    cols = [Inches(4.6), Inches(2.6), Inches(2.2), Inches(2.5)]
    xs, acc = [], MARGIN
    for c in cols:
        xs.append(acc)
        acc += c
    for i, label in enumerate(["Model", "Same voice, other mic", "Best impostor", "Gap"]):
        text(s, xs[i], head_y, cols[i], Inches(0.4), [(label, 12, ACCENT, True)])
    for r, row in enumerate(rows):
        y = head_y + Inches(0.5) + r * Inches(0.62)
        rect(s, MARGIN - Inches(0.12), y - Inches(0.09), Inches(12.05), Inches(0.55),
             fill=CARD if r % 2 == 0 else None, line=None, radius=False)
        for i, cellv in enumerate(row):
            bold = (r == 1)
            colour = ACCENT if (r == 1 and i == 3) else (TEXT if bold else MUTED)
            text(s, xs[i], y, cols[i], Inches(0.4), [(cellv, 13, colour, bold)])
    text(s, MARGIN, Inches(6.1), Inches(11.9), Inches(0.8),
         [("The gap is the whole story: the old model left 0.014 of room, so no threshold "
           "could both accept a person and refuse a stranger. Every earlier complaint was "
           "answered by moving a bar inside that window.", 13, MUTED, False)])
    notes(s, "Use this slide when somebody asks how technical decisions get made here. The "
             "answer is: with numbers taken on our own data, and the losing options written "
             "down beside the winner.")

    # 12 ── work surfaces ───────────────────────────────────────────────
    n += 1
    s = blank(prs)
    rect(s, 0, 0, W, H, fill=GROUND)
    chrome(prs, s, n, "demo · the work", "The record turns into work people can be held to")
    shot(s, "tasks.jpeg", MARGIN, Inches(1.85), Inches(7.6),
         "One board: kanban, list, calendar and archive; folders a project owns.")
    bullets(s, Inches(9.0), Inches(1.95), Inches(3.7), [
        "Cards carry an owner, a deadline and a priority",
        "Repeat is triggered by completion, never by a clock",
        "Every move is written to an append-only event log",
        "Projects own their folder; progress is counted, never stored",
        "An agent files cards here — behind a consent card",
    ], size=13, gap=14)
    notes(s, "Demo: ask Echo to file the actions from the meeting we just looked at, and "
             "decline one of the consent cards to show that no means no.")

    # 13 ── connections ─────────────────────────────────────────────────
    n += 1
    s = blank(prs)
    rect(s, 0, 0, W, H, fill=GROUND)
    chrome(prs, s, n, "connections", "The tools the organisation already uses")
    shot(s, "integrations.jpeg", MARGIN, Inches(1.85), Inches(7.9),
         "Thirteen connectors; Google, Slack and Zoom connected on this deployment.")
    bullets(s, Inches(9.25), Inches(1.95), Inches(3.5), [
        "A connection belongs to the person, not the company",
        "The agent reaches exactly the mailbox its owner reached",
        "Eight actions, each behind its own consent card",
        "A drafted reply waits in your own Drafts folder",
        "Any MCP server can be added — never on a standing yes",
    ], size=13, gap=14)
    notes(s, "The mail rule is the one to say out loud: the agent may insert a draft and "
             "may never update or send one. That is a database grant, not a promise.")

    # 14 ── governance ──────────────────────────────────────────────────
    n += 1
    s = blank(prs)
    rect(s, 0, 0, W, H, fill=GROUND)
    chrome(prs, s, n, "governance", "Everything an administrator needs to answer for")
    shot(s, "audit.jpeg", MARGIN, Inches(1.9), Inches(5.85),
         "Audit: admin actions, human decisions and agent runs — codes, never content.")
    shot(s, "models.jpeg", Inches(7.05), Inches(1.9), Inches(5.55),
         "The model allow-list an owner curates. Anthropic models are excluded by rule.")
    text(s, MARGIN, Inches(5.5), Inches(11.9), Inches(1.0),
         [("Roles and privileges per organisation · every admin action recorded with the "
           "field it changed, never the value · a nightly retention job that deletes objects "
           "before the rows that point at them · service health with live queue depths.",
           13, MUTED, False)])
    notes(s, "For a compliance-minded audience, open the audit page live and filter by "
             "source. Point out that the run rows carry model and token counts.")

    # 15 ── how it stays correct + close ────────────────────────────────
    n += 1
    s = blank(prs)
    rect(s, 0, 0, W, H, fill=GROUND)
    chrome(prs, s, n, "why you can trust it", "Built so that a mistake fails loudly")
    tiles(s, Inches(1.9), [
        ("2,921", "tests in web, core and ml, on every change"),
        ("65", "SQL test files that re-assert the permission wall against the live catalogue"),
        ("207", "migrations, each proving its own claim before it commits"),
    ], cols=3, height=Inches(1.55))
    text(s, MARGIN, Inches(3.75), Inches(11.9), Inches(2.4),
         [("A test is only trusted here after it has been made to fail for its own reason.",
           17, TEXT, True),
          ("Guards enforce the design system, the copy rules, the icon set and the "
           "right-to-left rules. Boot tests start every service under the production runtime "
           "and make it answer a request. An encoding sweep reads every tracked file as "
           "bytes. The known limits — crosstalk, lexical-only search, one enrolled voice on "
           "this deployment — are written down and dated rather than left for a customer to "
           "discover.", 13.5, MUTED, False),
          ("", 8, MUTED, False),
          ("What is next: semantic retrieval, an overlap detector for crosstalk, and the "
           "connectors that are configured but not yet exercised.", 13.5, ACCENT, False)],
         spacing=11)
    notes(s, "Close on the honest slide. The limits list is the reason to believe the rest "
             "of the deck: a team that writes its weaknesses down is telling you the truth "
             "about its strengths.")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    prs.save(OUT)
    print(f"wrote {OUT}  ({len(prs.slides.__iter__.__self__._sldIdLst)} slides)")


if __name__ == "__main__":
    build()
