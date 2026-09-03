import { Icon } from "@/components/icons";
import { agentColorClasses, agentIconName } from "./agentAppearance";

/**
 * AN AGENT'S FACE — the mark that stands beside its name in a room (db/0164).
 *
 * **It is deliberately NOT `<Avatar />`.** The person mark is a round well
 * with the first letter of a name in it, and that is exactly what an agent
 * must not wear: in a thread whose whole subject is machines answering each
 * other, a room where رؤیا and a colleague both show a letter in a circle is
 * a screen where the one fact a reader needs — who is a person and who is not
 * — has been thrown away in the rendering. An agent already HAS a face in the
 * database: `icon` and `color`, which db/0163 seeds and `agentAppearance`
 * already maps into the theme's own glyph registry and tone pairs.
 *
 * So: a person is a letter in a round well, an agent is its glyph in a
 * SQUIRCLE of its own tone. One glance separates them, in both themes,
 * without a caption saying which is which.
 *
 * Sizes mirror `Avatar`'s names on purpose — the two marks sit in the same
 * rows at the same scale, and a thread that used `sm` for one and a number
 * for the other would drift the first time either changed.
 */
const SIZE = {
  /** inside a chip — an @mention, a roster pill */
  xs: { box: "h-5 w-5 rounded-md", icon: "xs" },
  /** a message row, a menu row */
  sm: { box: "h-7 w-7 rounded-lg", icon: "sm" },
  /** a room card's roster */
  md: { box: "h-9 w-9 rounded-xl", icon: "md" },
} as const;

export function AgentMark({
  icon,
  color,
  size = "sm",
  className = "",
}: {
  /** the wire's own string; unknown spellings fall back rather than blank */
  icon: string;
  color: string;
  size?: keyof typeof SIZE;
  className?: string;
}) {
  const shape = SIZE[size];
  return (
    <span
      /* aria-hidden because the NAME is always beside it — a reader that
         announced the glyph would say the agent twice (Avatar's own reason) */
      aria-hidden
      className={`grid shrink-0 place-items-center ${shape.box} ${agentColorClasses(color)} ${className}`}
    >
      <Icon name={agentIconName(icon)} size={shape.icon} />
    </span>
  );
}
