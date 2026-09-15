import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * EVERY PERSON MARK SHOWS THE PHOTO THERE IS (2026-09-08: the people in the
 * mock data needed a picture on every mark that draws them).
 *
 * The pictures were already in the database by that point — a seeder had
 * written one for every human in the demo org days earlier — and they appeared
 * on exactly four marks: the account menu, the rail, the profile page and its
 * editor, all of them the SIGNED-IN PERSON's own. Eighteen colleague-facing
 * marks passed `name` and nothing else, so a colleague was an initial
 * everywhere, and the producer had no consumer.
 *
 * That is not a bug anyone can see by reading a call site: `<Avatar name={…}>`
 * is valid, renders correctly, and is wrong only against a record it did not
 * ask for. So this counts them instead — a mark drawn for a person must be
 * handed that person's photo, and a new surface that forgets is a red rather
 * than a fortnight of initials nobody reports.
 *
 * The exceptions are entries WITH REASONS, never a loosened rule: each one is
 * a mark whose caller genuinely holds no record to read a photo from.
 */
const ROOT = join(process.cwd(), "src");

/** a mark that cannot carry a photo, and why it cannot */
const NO_RECORD: Record<string, string> = {
  "src/app/[locale]/workflows/[handle]/page.tsx":
    "the creator is a NAME on the workflow row — the wire carries no id, so " +
    "there is nobody to look a photo up for",
  /*
   * SpeakersDirectory's entry LEFT on 2026-09-10, in the stale-entry direction
   * this list deliberately fires in. Its reason was sound while it held — a
   * directory person is not an account, `echo.person` has no avatar_url, and a
   * voice may belong to somebody with no row in app_user at all — but the screen
   * it described is gone: the directory is a TABLE of voices now and draws no
   * `<Avatar>` at all. Deleted rather than zeroed, because a key whose file has
   * no mark left reads as coverage and is a hole.
   */
};

function sources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sources(full, out);
    else if (/\.tsx$/.test(entry) && !/\.test\.tsx$/.test(entry)) out.push(full);
  }
  return out;
}

/*
 * COMMENTS ARE NOT CODE, and this file's first run proved it: five of its six
 * "offenders" were prose — three comments that quote `<Avatar>` while
 * explaining a decision about it, and `<AvatarEditor>`, whose name simply
 * starts with the tag. A checker that reports working code is one nobody runs
 * twice, so the text is stripped first and the tag has to end at a word
 * boundary.
 */
function code(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ");
}

/** every `<Avatar …/>` element in a file, as its own text */
function marks(text: string): string[] {
  const out: string[] = [];
  const src = code(text);
  for (const m of src.matchAll(/<Avatar(?=[\s/>])[\s\S]*?\/>/g)) out.push(m[0]);
  return out;
}

describe("the person mark", () => {
  it("is handed the photo wherever the caller holds one", { timeout: 30_000 }, () => {
    const offenders: string[] = [];
    const covered = new Set<string>();
    for (const file of sources(ROOT)) {
      const rel = file.replace(ROOT, "src").replaceAll("\\", "/");
      const text = readFileSync(file, "utf8");
      for (const mark of marks(text)) {
        if (mark.includes("src=")) continue;
        if (NO_RECORD[rel] !== undefined) { covered.add(rel); continue; }
        offenders.push(`${rel}: ${mark.replace(/\s+/g, " ").slice(0, 80)}`);
      }
    }
    expect(offenders).toEqual([]);

    /* AND THE LIST SHRINKS WHEN THE TREE DOES. An allow-list entry for a file
       that no longer draws a photoless mark reads as coverage and is a hole —
       the same failure the rhythm guard carries, for the same reason. */
    expect([...covered].sort()).toEqual(Object.keys(NO_RECORD).sort());
  });
});
