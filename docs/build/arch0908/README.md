# The 2026-09-08 architecture document and demo deck

Two deliverables, one content model:

- `NeurAI-Platform-Architecture-2026-09-08.docx` — 36 pages: what the platform
  is, every component with why it was chosen and three alternatives, how a
  request is authorized, the pipeline, the agentic layer, each surface, the
  connectors, the rules that run, operations, honest limits, and two appendices
  (measurements with their conditions, and where each component is documented).
- `NeurAI-Platform-Demo-2026-09-08.pptx` — 15 slides for a production demo,
  with speaker notes on every slide.

Both outputs are gitignored (`*.docx`, `*.pptx`), as is every rendered PDF.
The source that builds them is here.

## Build

```
python diagrams.py       # redraws figures/ — do this first, it is gitignored
python build_docx.py
python build_pptx.py
```

On Windows, run with `PYTHONUTF8=1 PYTHONIOENCODING=utf-8`; the content is
partly Persian and every file here is UTF-8 without a BOM.

## The files

| File | What it holds |
|---|---|
| `content.py` | The chapters, as typed blocks (`p`, `h2`, `h3`, `ul`, `num`, `table`, `fig`, `screen`, `note`). Prose lives here, never in the builder. |
| `choices.py` | One entry per component: layer, role, why this one, and three alternatives with the trade-off each would impose. The document's longest chapter is generated from it. |
| `diagrams.py` | The six figures, drawn on an explicit grid so a box's position carries meaning and nothing moves when the text changes length. |
| `build_docx.py` | python-docx: styles, tables, the TOC field, the cover. |
| `build_pptx.py` | python-pptx: the dark deck. Diagram slides hand the whole slide to the figure — it carries its own title, and a 3×3 grid does not fit under a slide title on a 16:9 stage. |

## The screenshots

The `screen` blocks read `docs/screens-2026-09-08/*.jpeg` — eighteen captures
taken on production on 8 September 2026, signed in as the organisation's owner.

**They are not in the repository.** This repository is public and those images
show colleagues' real names, a real meeting's summary and real audit rows.
`.gitignore` says so at the entry that holds them out. Rebuilding the documents
elsewhere needs a fresh capture; `../pull_screens.py` is the extractor that
lifted them out of the browsing session that took them.

## Numbers

Every figure in the document that could rot is in the measurements appendix
with the date and the conditions it was taken under. Counts of code (routes,
tests, migrations) are re-counted from the repository before a rebuild —
`git ls-files`, a route grep, `ls db/migrations` — never carried forward from
the previous edition.
