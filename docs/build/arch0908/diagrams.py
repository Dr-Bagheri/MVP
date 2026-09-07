# -*- coding: utf-8 -*-
"""
The document's figures, drawn rather than screenshotted.

Why drawn: a diagram of a system has to say what the system IS, and every
generic drawing tool pulls toward what it can draw. These are laid out on a
grid with explicit cells, so a box's position carries meaning (a column is a
tier, a row is a hop) and nothing moves when the text changes length.

Rendered at 2x for print. Run:  python diagrams.py
"""
from pathlib import Path
import math
import textwrap

from PIL import Image, ImageDraw, ImageFont

OUT = Path(__file__).parent / "figures"
OUT.mkdir(exist_ok=True)

FONT = "C:/Windows/Fonts/segoeui.ttf"
BOLD = "C:/Windows/Fonts/segoeuib.ttf"

INK = "#16202B"
GROUND = "#F4F7F9"
HEAD = "#0B3B2E"          # the product's own dark green
HEAD_ALT = "#1F4E5F"      # a second tier, for boxes that are not ours
ACCENT = "#01743F"
LINE = "#7E8FA0"
CARD = "#FFFFFF"
EDGE = "#C9D5DE"
MUTED = "#4C5F70"

W, H = 2000, 1180
COLS, ROWS = 3, 3
PAD_X, PAD_Y = 70, 172
GAP_X, GAP_Y = 60, 62
BOX_W = (W - 2 * PAD_X - (COLS - 1) * GAP_X) // COLS
BOX_H = 230


def f(size, bold=False):
    return ImageFont.truetype(BOLD if bold else FONT, size)


def cell(col, row, span=1):
    x = PAD_X + col * (BOX_W + GAP_X)
    y = PAD_Y + row * (BOX_H + GAP_Y)
    return x, y, x + BOX_W * span + GAP_X * (span - 1), y + BOX_H


def arrow(d, a, b, bend=None, dashed=False):
    """Edge between two boxes, entering on the nearest faces."""
    ax, ay, ax2, ay2 = a
    bx, by, bx2, by2 = b
    if abs((ay + ay2) - (by + by2)) < 10:            # same row
        if bx > ax:
            p, q = (ax2, (ay + ay2) / 2), (bx, (by + by2) / 2)
        else:
            p, q = (ax, (ay + ay2) / 2), (bx2, (by + by2) / 2)
    elif by > ay:                                     # downward
        p, q = ((ax + ax2) / 2, ay2), ((bx + bx2) / 2, by)
        if bend is None and abs((ax + ax2) - (bx + bx2)) > 40:
            bend = ay2 + (by - ay2) / 2
    else:                                             # upward
        p, q = ((ax + ax2) / 2, ay), ((bx + bx2) / 2, by2)
        if bend is None and abs((ax + ax2) - (bx + bx2)) > 40:
            bend = by2 + (ay - by2) / 2

    if bend is not None:
        mid = bend
        pts = [p, (p[0], mid), (q[0], mid), q]
        for i in range(len(pts) - 1):
            d.line([pts[i], pts[i + 1]], fill=LINE, width=5)
        p = pts[-2]
    else:
        if dashed:
            n = 26
            for i in range(n):
                if i % 2:
                    continue
                t0, t1 = i / n, (i + 1) / n
                d.line([(p[0] + (q[0] - p[0]) * t0, p[1] + (q[1] - p[1]) * t0),
                        (p[0] + (q[0] - p[0]) * t1, p[1] + (q[1] - p[1]) * t1)],
                       fill=LINE, width=5)
        else:
            d.line([p, q], fill=LINE, width=5)

    ang = math.atan2(q[1] - p[1], q[0] - p[0])
    s = 18
    d.polygon([q,
               (q[0] - s * math.cos(ang - 0.45), q[1] - s * math.sin(ang - 0.45)),
               (q[0] - s * math.cos(ang + 0.45), q[1] - s * math.sin(ang + 0.45))],
              fill=LINE)


def box(d, rect, head, body, tone=HEAD, tag=None):
    x, y, x2, y2 = rect
    d.rounded_rectangle((x, y, x2, y2), radius=20, fill=CARD, outline=EDGE, width=2)
    d.rounded_rectangle((x, y, x2, y + 62), radius=18, fill=tone)
    d.rectangle((x, y + 36, x2, y + 62), fill=tone)
    d.text((x + 22, y + 15), head, font=f(30, True), fill="white")
    if tag:
        tw = d.textlength(tag, font=f(20, True))
        d.rounded_rectangle((x2 - tw - 34, y + 17, x2 - 14, y + 47), radius=9, fill="#FFFFFF")
        d.text((x2 - tw - 24, y + 21), tag, font=f(20, True), fill=tone)
    lines = []
    for para in body.split("\n"):
        lines += textwrap.wrap(para, 40) or [""]
    for i, line in enumerate(lines[:5]):
        d.text((x + 22, y + 82 + i * 32), line, font=f(25), fill=MUTED)


def canvas(title, subtitle=""):
    im = Image.new("RGB", (W, H), GROUND)
    d = ImageDraw.Draw(im)
    d.rectangle((0, 0, W, 8), fill=ACCENT)
    d.text((PAD_X, 48), title, font=f(46, True), fill=INK)
    if subtitle:
        d.text((PAD_X, 104), subtitle, font=f(26), fill=MUTED)
    return im, d


def foot(d, text):
    d.text((PAD_X, H - 66), text, font=f(24), fill=MUTED)


def save(im, name):
    im.save(OUT / (name + ".png"))
    print("drew", name)


# ── 1. topology ─────────────────────────────────────────────────────────
im, d = canvas("Runtime and deployment topology",
               "Three planes: control (identity), data (rows and objects), media (audio and video)")
b = {
    "browser": cell(0, 0), "bff": cell(1, 0), "tunnel": cell(2, 0),
    "core": cell(0, 1), "db": cell(1, 1), "ml": cell(2, 1),
    "providers": cell(0, 2), "connectors": cell(1, 2), "media": cell(2, 2),
}
box(d, b["browser"], "Browser", "Next.js / React interface\nPersian and English, RTL-first\nNo provider token ever reaches it", HEAD_ALT)
box(d, b["bff"], "Vercel — web/ BFF", "179 route files, 238 handlers\nHolds the session cookie\nPinned to Frankfurt (fra1)")
box(d, b["tunnel"], "Cloudflare Tunnel", "api.neurai.pt\nOutbound-only origin\nNo inbound port on the server", HEAD_ALT)
box(d, b["core"], "core/ — API + worker", "Fastify, 244 routes\nPipeline worker on 6 queues\nAgent runtime + workflow engine", tag="Hetzner")
box(d, b["db"], "Supabase Postgres 17.6", "67 tables · 177 policies\nRLS forced · 4 roles\npgmq queues · Auth · Storage", tag="managed")
box(d, b["ml"], "ml/ — speech", "FFmpeg · Silero VAD · STT lanes\nDiarization + voiceprints\nLoopback only, never public", tag="Hetzner")
box(d, b["providers"], "Model + speech providers", "OpenRouter (curated allow-list)\nSoniox (async + live)\nPiper voices on the box", HEAD_ALT)
box(d, b["connectors"], "Work connections", "Google · Slack · Zoom\nJira · Notion · GitHub · Dropbox\nTelegram · WhatsApp · MCP", HEAD_ALT)
box(d, b["media"], "Media plane", "LiveKit room, scoped token\nSigned object URLs to Storage\nBytes never pass the API", HEAD_ALT)
arrow(d, b["browser"], b["bff"])
arrow(d, b["bff"], b["tunnel"])
arrow(d, b["tunnel"], b["core"])
arrow(d, b["core"], b["db"])
arrow(d, b["db"], b["ml"])
arrow(d, b["core"], b["providers"])
arrow(d, b["core"], b["connectors"], bend=b["core"][3] + 30)
arrow(d, b["ml"], b["media"])
foot(d, "Dashed responsibilities: the browser reaches Storage and the room service directly, with credentials the server mints per object and per participant.")
save(im, "topology")

# ── 2. request / authority ──────────────────────────────────────────────
im, d = canvas("One request, from a browser to a permitted row",
               "Identity is resolved once, then carried into the transaction the query runs in")
b = {
    "s1": cell(0, 0), "s2": cell(1, 0), "s3": cell(2, 0),
    "s4": cell(0, 1), "s5": cell(1, 1), "s6": cell(2, 1),
    "human": cell(0, 2), "agent": cell(1, 2), "doors": cell(2, 2),
}
box(d, b["s1"], "1 · Session", "A cookie the browser cannot read\nNo access token in client code")
box(d, b["s2"], "2 · Verified identity", "ES256 signature against JWKS\nWho, which org, still active?")
box(d, b["s3"], "3 · Transaction", "SET ROLE for the caller's kind\nActor id set transaction-locally")
box(d, b["s4"], "4 · Domain operation", "Typed parameters, caller-scoped\nrepositories — no ambient client")
box(d, b["s5"], "5 · The wall", "Row-level security, FORCED\nGrants, constraints, definer doors", tone=ACCENT)
box(d, b["s6"], "6 · Result", "Permitted rows, or a refusal\nthat names which nothing it is")
box(d, b["human"], "Human path — echo_app", "Role and capability checks\nAdmin actions are recorded", HEAD_ALT)
box(d, b["agent"], "Agent path — echo_agent", "Reads on the caller's authority\nNO DELETE grant anywhere", HEAD_ALT)
box(d, b["doors"], "Named doors", "Definer functions with fixed\nreturn shapes, each with a reason", HEAD_ALT)
for a, c in [("s1", "s2"), ("s2", "s3"), ("s3", "s4"), ("s4", "s5"), ("s5", "s6")]:
    arrow(d, b[a], b[c])
arrow(d, b["s4"], b["human"])
arrow(d, b["s5"], b["agent"])
arrow(d, b["s6"], b["doors"])
foot(d, "Prompts guide behaviour. Policies, grants and constraints decide it — which is why an injected instruction cannot widen what a run may reach.")
save(im, "request")

# ── 3. pipeline ─────────────────────────────────────────────────────────
im, d = canvas("A conversation becomes a citable record",
               "Every stage is resumable; a failed part leaves a visible gap, never a silent one")
b = {
    "cap": cell(0, 0), "store": cell(1, 0), "speech": cell(2, 0),
    "text": cell(0, 1), "who": cell(1, 1), "sum": cell(2, 1),
    "min": cell(0, 2), "task": cell(1, 2), "find": cell(2, 2),
}
box(d, b["cap"], "Capture", "Room, microphone, or upload\nCut into parts with offsets\nLinked to the meeting at once")
box(d, b["store"], "Store and enqueue", "Signed upload to object storage\npgmq message per part\nCommits with the row it names")
box(d, b["speech"], "Speech", "FFmpeg → VAD → transcriber\nTwo lanes, each with its ceiling\nOnly speech is sent, and paid for")
box(d, b["text"], "Transcript", "Word → line → speech span\nAnchored to the part's offset\nPer-line language tag")
box(d, b["who"], "Who spoke", "Diarization per part\nVoiceprint match at 0.50\nOr the host names the voice")
box(d, b["sum"], "Summary version", "A named skill, a permitted model\nProvenance kept; failures visible", tone=ACCENT)
box(d, b["min"], "Minutes", "Draft → approve → sign → close\nClosed is the record of record", HEAD_ALT)
box(d, b["task"], "Tasks and follow-up", "Actions become cards with\npeople and dates on the board", HEAD_ALT)
box(d, b["find"], "Retrieval", "Search under the reader's own\npermissions; answers cite records", HEAD_ALT)
for a, c in [("cap", "store"), ("store", "speech"), ("speech", "text"),
             ("text", "who"), ("who", "sum"), ("sum", "min"), ("min", "task"), ("task", "find")]:
    arrow(d, b[a], b[c])
foot(d, "The transcript is the source record. Everything derived from it — summary, minutes, tasks — is rebuildable and carries where it came from.")
save(im, "pipeline")

# ── 4. agents ───────────────────────────────────────────────────────────
im, d = canvas("The agentic layer: who answers, what they may touch",
               "Reads run on the server; anything that changes something runs in the person's own session")
b = {
    "ask": cell(0, 0), "floor": cell(1, 0), "echo": cell(2, 0),
    "roya": cell(0, 1), "ava": cell(1, 1), "tools": cell(2, 1),
    "consent": cell(0, 2), "act": cell(1, 2), "record": cell(2, 2),
}
box(d, b["ask"], "A person asks", "In the assistant, a team room,\nor on a meeting's own page")
box(d, b["floor"], "Who answers", "A name gives that agent the floor\nTwo names, two answers, in order\nNo name → Echo")
box(d, b["echo"], "Echo", "Answers by default; delegates\nwhen the work is more than three\nseparate pieces", tone=ACCENT)
box(d, b["roya"], "Roya — operations", "Meetings, agendas, tasks,\nprojects, rooms, invitations", HEAD_ALT)
box(d, b["ava"], "Ava — analysis", "Records, transcripts, summary\nversions, evidence, comparisons", HEAD_ALT)
box(d, b["tools"], "Two kinds of hands", "5 server-side reads (agent role)\n97 client tools (the person's own\nsession, the same API a button uses)")
box(d, b["consent"], "Consent card", "Names the OBJECT, not just the verb\nYes · No · Yes for this session\nDeletes are never covered", tone=ACCENT)
box(d, b["act"], "The act", "Runs as the person, under their\npermissions, through the product's\nown routes", HEAD_ALT)
box(d, b["record"], "Written down", "Agent run, model, tokens, tools\nHuman decision recorded separately", HEAD_ALT)
arrow(d, b["ask"], b["floor"])
arrow(d, b["floor"], b["echo"])
arrow(d, b["echo"], b["roya"], bend=b["echo"][3] + 30)
arrow(d, b["echo"], b["ava"], bend=b["echo"][3] + 30)
arrow(d, b["echo"], b["tools"])
arrow(d, b["tools"], b["consent"], bend=b["tools"][3] + 30)
arrow(d, b["consent"], b["act"])
arrow(d, b["act"], b["record"])
foot(d, "Delegation is capped at four hops and an agent may not call itself — two agents naming each other never stop on their own.")
save(im, "agents")

# ── 5. connectors ───────────────────────────────────────────────────────
im, d = canvas("Connections are a registry, and the grant belongs to a person",
               "One definition per provider; the repository is generic over it")
b = {
    "def": cell(0, 0), "oauth": cell(1, 0), "token": cell(2, 0),
    "store": cell(0, 1), "read": cell(1, 1), "act": cell(2, 1),
    "google": cell(0, 2), "team": cell(1, 2), "mcp": cell(2, 2),
}
box(d, b["def"], "Provider definition", "Kind, scopes, sources, actions\nAdding a provider is a data entry", tone=ACCENT)
box(d, b["oauth"], "OAuth providers", "Google · Zoom · Slack · Jira\nNotion · GitHub · Dropbox\nOne dance, parameterised")
box(d, b["token"], "Token providers", "Telegram · WhatsApp · MCP\nVouched before anything is stored\nSecret fields never autofilled")
box(d, b["store"], "Encrypted store", "Per-person grant, per-org row\nPublic settings shown; secret never")
box(d, b["read"], "One read tool", "list_connector_items covers every\nprovider; refuses by name", HEAD_ALT)
box(d, b["act"], "Eight hands", "Send a message, create an issue,\na page, a meeting — each behind\nits own consent card", HEAD_ALT)
box(d, b["google"], "Mail and calendar", "Drafts wait in the person's own\nDrafts folder; the agent may insert\na draft and may never update one", HEAD_ALT)
box(d, b["team"], "Team messaging", "Slack, Telegram, WhatsApp —\nnever on a standing yes", HEAD_ALT)
box(d, b["mcp"], "Any MCP server", "Public HTTPS only; private and\nloopback ranges refused\nNever covered by a session grant", HEAD_ALT)
arrow(d, b["def"], b["oauth"])
arrow(d, b["oauth"], b["token"])
arrow(d, b["def"], b["store"])
arrow(d, b["store"], b["read"])
arrow(d, b["read"], b["act"])
arrow(d, b["store"], b["google"])
arrow(d, b["read"], b["team"])
arrow(d, b["act"], b["mcp"])
foot(d, "A connection is the person's, not the organisation's: an agent reaches exactly the mailbox its owner reached, and no further.")
save(im, "connectors")

# ── 6. data ─────────────────────────────────────────────────────────────
im, d = canvas("The domain, in nine groups",
               "67 tables; every one scoped to an organisation and forced under row-level security")
b = {
    "org": cell(0, 0), "rec": cell(1, 0), "der": cell(2, 0),
    "work": cell(0, 1), "meet": cell(1, 1), "conv": cell(2, 1),
    "flow": cell(0, 2), "conn": cell(1, 2), "gov": cell(2, 2),
}
box(d, b["org"], "Identity", "org · app_user · person\nRoles, seats, the speaker directory")
box(d, b["rec"], "The record", "call · call_part\ntranscript_segment · call_speaker")
box(d, b["der"], "Derived evidence", "Summary versions · notes · tags\nTranslations, per line and per call")
box(d, b["work"], "Work", "project · task_topic · task\nAssignees, checklists, recurrence")
box(d, b["meet"], "Meetings", "meeting · attendees · agenda\nMinutes, signatures, guest codes")
box(d, b["conv"], "Conversations", "agent_session · agent_message\nagent_run · human decisions")
box(d, b["flow"], "Workflows", "definition → version → run\nStep runs with provenance", HEAD_ALT)
box(d, b["conn"], "Connections", "Per-person grants, encrypted\nPublic settings kept separate", HEAD_ALT)
box(d, b["gov"], "Governance", "Role capabilities · admin actions\nRetention and purge contracts", HEAD_ALT)
arrow(d, b["org"], b["rec"])
arrow(d, b["rec"], b["der"])
arrow(d, b["work"], b["meet"])
arrow(d, b["meet"], b["conv"])
arrow(d, b["flow"], b["conn"])
arrow(d, b["conn"], b["gov"])
foot(d, "Domain inventory, not a schema dump: each group is a family of tables that share a lifetime and a permission story.")
save(im, "data")

print(f"figures → {OUT}")
