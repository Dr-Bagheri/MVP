# A component library, so the front end stops being built from zero

Written 2026-09-02, answering: *"one major problem I have is the front end, I
have to tell everything — can we install a package so when we add something
we don't need to do everything from zero?"*

That is the right diagnosis. This month alone the platform hand-built a
`Select`, a `Popover`, a `DateField`, a `TimeField`, an `Overlay` and a
`ConfirmDialog` — and each one shipped with a bug the others had already had:
the panel that changed the page's height, the list clipped by an ancestor,
the menu that truncated every label, the dialog that was the wrong width.
Those were not six mistakes. They were one library missing.

## The recommendation: shadcn/ui

<https://ui.shadcn.com> — and it is the right one for a specific reason, not
because it is popular.

**It is not a dependency.** The CLI copies component SOURCE into the repo.
There is no package that owns our buttons, no upgrade that changes them under
us, and no fight with a library's opinions — a component we need to behave
differently is a file we edit. For a codebase whose comments explain why
every control does what it does, that matters more than it would elsewhere.

**It is already our stack.** Tailwind, CSS variables for theming, React
Server Components, Next App Router. The tokens we already have
(`--accent`, `--surface`, `--border`, `--fg`) are exactly the shape its
theming expects, so the components arrive wearing our colours rather than
needing to be re-skinned.

**RTL is first-class as of January 2026.** Set `rtl: true` in
`components.json` and the CLI converts physical classes to logical ones on
the way in — `left-*`→`start-*`, `pr-*`→`pe-*`, icons get `rtl:rotate-180`.
That is the same discipline this codebase already follows by hand (and got
wrong at least once — `pr-9` where `pe-9` was meant, which looked right in
English and pushed Persian off the wrong side).

**Accessibility comes with it.** Its primitives are Radix/Base UI: focus
traps, roving tabindex, `aria-*` wiring, keyboard behaviour. Every one of
those is something our hand-rolled controls had to be told, one test at a
time.

### How we would do it

1. `pnpm dlx shadcn@latest init` in `web/`, answering: Tailwind yes, CSS
   variables yes, RTL yes.
2. **Point its tokens at ours** — `components.json` maps its variable names
   onto `--accent`, `--surface`, `--border`, `--fg`. This is the step that
   decides whether the result looks like our product or like a demo, and it
   is one file.
3. Adopt **incrementally, replacing rather than adding**: `dropdown-menu`
   first, since `Popover`/`Select` is where the pain was; then `dialog` for
   `Overlay`, `calendar` for the date picker, `command` for search. Each swap
   DELETES the hand-rolled one — two implementations of a dropdown is the
   problem this exists to end, and adding a library beside them makes it
   worse.
4. Keep the guards. `popover.guard.test.tsx` and `notifyRule.guard.test.ts`
   describe rules, not implementations; they should pass over shadcn's
   components unchanged, and if one does not, that is worth knowing before
   the swap rather than after.

### What it does NOT solve

It has no calendar that speaks Jalali, no Persian digits, and no notion of
our notification bus. `DateTimeFields`, `format.ts` and `notify.ts` stay
ours — they encode product decisions, not widget behaviour.

## The two considered and not chosen

**Mantine** — 120+ components and 70+ hooks, theming through CSS variables,
genuinely excellent. Rejected because it is a real dependency with its own
styling engine: we would be running Mantine's system beside Tailwind, and the
question "why does this look slightly different" would have two possible
answers forever.

**HeroUI** — React Aria accessibility, Tailwind v4, App Router support. The
closest runner-up. Rejected on the same axis as Mantine: it owns its
components, so a control that must behave differently is a wrapper and a
workaround rather than an edit.

## Sources

- <https://ui.shadcn.com/docs/rtl>
- <https://ui.shadcn.com/docs/changelog/2026-01-rtl>
- <https://ui.shadcn.com/docs/installation/next>
- <https://www.buildmvpfast.com/blog/mantine-vs-shadcn-component-library-mvp-2026>
- <https://heroui.com/en/blog/best-react-ui-component-libraries>
