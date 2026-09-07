"""
Pull the screenshots this session took out of the session transcript and write
them as files.

WHY THIS EXISTS. The screens in the architecture document and the deck have to
be the PRODUCT AS IT IS, signed in, on production — which means they are taken
through the browser the operator is already signed into. That browser hands a
screenshot back as an image in the conversation; it does not leave a file on
disk. The transcript does: every tool result is recorded there, image payload
included. So the capture is "take the shots in order, then lift them out by
their tool-use id", and the id is what makes the mapping exact rather than
positional — a positional map silently mislabels every screen after the first
retake.

Usage:
    python pull_screens.py <out-dir> <name1> <name2> ...
Names are matched to the LAST len(names) screenshot results, in order, unless
--ids is given, in which case each name is paired with the id beside it:
    python pull_screens.py <out-dir> --ids dashboard=ss_abc assistant=ss_def
"""
import base64
import io
import json
import sys
from pathlib import Path

TRANSCRIPT = Path(
    "C:/Users/amirreza/.claude/projects/C--Users-amirreza-Desktop-mvp"
    "/41b903d3-cd6a-4374-93ee-2e012d2dbd1d.jsonl"
)


def shots():
    """Every screenshot result in the transcript, oldest first: (id, media, bytes)."""
    out = []
    for line in io.open(TRANSCRIPT, encoding="utf-8", errors="replace"):
        if '"image' not in line:
            continue
        try:
            rec = json.loads(line)
        except Exception:
            continue
        msg = rec.get("message") or {}
        for block in msg.get("content") or []:
            if not isinstance(block, dict) or block.get("type") != "tool_result":
                continue
            inner = block.get("content")
            if not isinstance(inner, list):
                continue
            """
            ONE RESULT CAN CARRY SEVERAL SHOTS. A browser batch returns its
            steps as alternating text/image blocks inside a single tool
            result, so a reader that keeps "the last image and the whole
            text" collapses six screens into one and labels it with whichever
            id it happened to keep. Walk the blocks IN ORDER and emit one
            entry per image, carrying the id from the text block just before
            it — which is where the capture line ("ID: ss_…") sits.
            """
            pending_id = ""
            for b in inner:
                if not isinstance(b, dict):
                    continue
                if b.get("type") == "text":
                    text = str(b.get("text") or "")
                    if "ID: " in text:
                        raw = text.split("ID: ", 1)[1]
                        pending_id = raw.split()[0].strip().rstrip(".,")
                        # a batch appends the next step's marker to the same
                        # line, so cut at the first character an id cannot hold
                        for stop in ("[", "—", "\n"):
                            pending_id = pending_id.split(stop)[0]
                if b.get("type") == "image":
                    src = b.get("source") or {}
                    if src.get("type") == "base64" and src.get("data"):
                        out.append((pending_id, src.get("media_type", "image/png"), src["data"]))
                        pending_id = ""
    return out


def main() -> int:
    args = sys.argv[1:]
    if not args:
        found = shots()
        print(f"{len(found)} screenshots in the transcript")
        for sid, media, payload in found[-12:]:
            print(f"  {sid or '(no id)':<16} {media} {len(payload)//1024} KB (base64)")
        return 0

    out_dir = Path(args[0])
    out_dir.mkdir(parents=True, exist_ok=True)
    found = shots()
    by_id = {sid: (media, payload) for sid, media, payload in found if sid}

    if len(args) > 1 and args[1] == "--ids":
        pairs = []
        for spec in args[2:]:
            name, _, sid = spec.partition("=")
            if sid not in by_id:
                print(f"MISSING {name}: no screenshot with id {sid}")
                return 1
            pairs.append((name, by_id[sid]))
    else:
        names = args[1:]
        tail = found[-len(names):]
        if len(tail) != len(names):
            print(f"only {len(found)} screenshots recorded, {len(names)} names given")
            return 1
        pairs = [(n, (m, p)) for n, (_, m, p) in zip(names, tail)]

    for name, (media, payload) in pairs:
        ext = ".png" if "png" in media else ".jpeg"
        path = out_dir / (name + ext)
        path.write_bytes(base64.b64decode(payload))
        print(f"wrote {path.name} ({path.stat().st_size // 1024} KB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
