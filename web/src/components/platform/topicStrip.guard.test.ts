import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * THE FOLDER STRIP LIVES ONCE (2026-09-16, "unify").
 *
 * The task board's strip — «همه», a chip per folder with its count and its
 * ⋯, the inline name box, the dashed `+` — is `TopicStrip`, and the meetings
 * page reads it rather than drawing a second one. The two had been one shape
 * on 2026-09-03, a dropdown-and-menu on one side by 2026-09-08, and a strip
 * again by directive: that is the drift this guard ends.
 *
 * Two assertions, both by the FORM a real use must take (the 13½ corpus
 * rule): the two boards import the module and render it, and NEITHER spells
 * a folder chip itself — the retired recipe is a `filterChipClass(topic ===`
 * or a hand-rolled `<KebabMenu` beside a folder name. A count of imports
 * would be satisfied by an import nobody uses; a substring of the class name
 * would fire on the kit's own file. The control at the end proves the recipe
 * regex fires on the retired spelling before any file is believed clean.
 */
const HERE = join(process.cwd(), "src", "components", "platform");
const BOARDS = ["TaskBoard.tsx", "Meetings.tsx"] as const;

describe("the folder strip is one component (topicStrip.guard)", () => {
  it.each(BOARDS)("%s renders <TopicStrip> from the kit", (file) => {
    const src = readFileSync(join(HERE, file), "utf8");
    expect(src, `${file} imports the strip`).toMatch(/import \{[^}]*\bTopicStrip\b[^}]*\} from "\.\/TopicStrip";/);
    expect(src, `${file} renders the strip`).toContain("<TopicStrip");
  });

  it.each(BOARDS)("%s spells no folder chip of its own", (file) => {
    const src = readFileSync(join(HERE, file), "utf8");
    expect(src, `${file} draws a chip by hand`).not.toMatch(/filterChipClass\(topic ===/);
    expect(src, `${file} pins a folder's own menu`).not.toMatch(/triggerClassName="h-5 w-5 rounded text-current/);
  });

  it("the kit itself still carries the recipe (the control)", () => {
    const kit = readFileSync(join(HERE, "TopicStrip.tsx"), "utf8");
    expect(kit).toMatch(/triggerClassName="h-5 w-5 rounded text-current/);
    expect(kit).toContain("export function TopicStrip(");
    expect(kit).toContain("export function TopicChip(");
    /* and the retired spelling would fire: a staged copy of the old board
       chip fails the same regex the boards are held to */
    const staged = `<span className={\`\${filterChipClass(topic === entry.id)} cursor-default pe-1\`}>`;
    expect(staged).toMatch(/filterChipClass\(topic ===/);
  });
});
