/**
 * Editing your own profile (M24 round 1).
 *
 * Two things here are easy to get subtly wrong and hard to notice:
 *
 *  1. **null vs undefined.** `coalesce($n, column)` is the reflex for an
 *     optional patch, and it makes clearing a field impossible — you can set
 *     a Latin name forever but never remove one, and the bug presents as "the
 *     save button does nothing" for exactly one interaction.
 *  2. **Which refusal the caller sees.** A taken username and a malformed one
 *     are different problems with different fixes, and both arrive from
 *     Postgres as five-digit codes on the same statement.
 */
import { describe, expect, it } from "vitest";

import { ConflictError, NotFoundError, ValidationError } from "../src/api/errors.ts";
import { createMembersRepo } from "../src/api/members.ts";
import { createDb, type SqlClient, type SqlTx } from "../src/db/identity.ts";
import type { Identity } from "../src/agent/types.ts";

const IDENTITY: Identity = {
  userId: "11111111-1111-4111-8111-111111111111",
  orgId: "22222222-2222-4222-8222-222222222222",
  role: "member",
  isActive: true,
};

const ROW = {
  id: IDENTITY.userId, email: "a@b.c", display_name: "علی",
  display_name_en: null, username: null, role: "member", status: "active",
  accepted_at: null, last_seen_at: null, created_at: new Date("2026-08-01T00:00:00Z"),
  preferred_model: null, org_name: "سازمان",
};

function fakeDb(onUpdate?: () => never) {
  const log: { sql: string; params?: unknown[] | undefined }[] = [];
  const make = (): SqlClient => ({
    async begin<T>(fn: (tx: SqlTx) => Promise<T>): Promise<T> {
      const tx = (async () => []) as unknown as SqlTx;
      (tx as unknown as { unsafe: SqlTx["unsafe"] }).unsafe = (async (sql: string, params?: unknown[]) => {
        log.push({ sql, params });
        if (sql.includes("update echo.app_user") && onUpdate) onUpdate();
        return sql.includes("set local") || sql.includes("set_config") ? [] : [ROW];
      }) as SqlTx["unsafe"];
      return fn(tx);
    },
    async end() {},
  });
  return { db: createDb({ app: make(), agent: make() }), log };
}

const updateParams = (log: { sql: string; params?: unknown[] | undefined }[]) =>
  log.find((l) => l.sql.includes("update echo.app_user"))!.params!;

describe("clearing a field is expressible", () => {
  it("distinguishes 'clear it' from 'leave it alone'", async () => {
    // Params are [id, setName, name, setNameEn, nameEn, setUsername, username].
    // Clearing sends supplied=true with a null VALUE; omitting sends
    // supplied=false. `coalesce` cannot represent the first case at all.
    const { db, log } = fakeDb();
    await createMembersRepo(db).updateProfile(IDENTITY, { display_name_en: null });
    const params = updateParams(log);
    expect(params[3]).toBe(true);    // display_name_en was supplied
    expect(params[4]).toBeNull();    // ...as null, meaning clear it
    expect(params[5]).toBe(false);   // username untouched
  });

  it("treats an all-whitespace Latin name as clearing it", async () => {
    // Otherwise it passes this layer and dies on
    // app_user_display_name_en_not_blank as an unexplained 400.
    const { db, log } = fakeDb();
    await createMembersRepo(db).updateProfile(IDENTITY, { display_name_en: "   " });
    expect(updateParams(log)[4]).toBeNull();
  });

  it("refuses an empty Persian name rather than letting NOT NULL do it", async () => {
    const { db } = fakeDb();
    await expect(createMembersRepo(db).updateProfile(IDENTITY, { display_name: "  " }))
      .rejects.toBeInstanceOf(ValidationError);
  });

  it("refuses an empty patch instead of a no-op UPDATE", async () => {
    const { db } = fakeDb();
    await expect(createMembersRepo(db).updateProfile(IDENTITY, {}))
      .rejects.toBeInstanceOf(ValidationError);
  });
});

describe("refusals carry a machine-readable code (FE1's Persian UI)", () => {
  /**
   * My English prose was reaching users in an RTL Persian screen. The client
   * owns the sentence; the api owns the rule and the numbers in it — and the
   * PARAMS are what keep a translation true when the rule changes.
   */
  it("codes the username format refusal WITH its bounds", async () => {
    const { db } = fakeDb();
    const failure = await createMembersRepo(db)
      .updateProfile(IDENTITY, { username: "ab" })
      .catch((error: unknown) => error) as ValidationError;
    expect(failure.code).toBe("username_format");
    // Move USERNAME_MIN and every locale updates at once; a catalogue that
    // hard-coded "three" would silently start lying.
    expect(failure.params).toEqual({ min: 3, max: 32 });
  });

  it("uses DISTINCT codes for taken and retired", async () => {
    // Different facts: "taken" implies someone has it and could be asked;
    // "retired" means the account is deleted and it never comes back. One
    // shared code would force a translator to pick one meaning for both.
    const conflict = (retired: boolean) => {
      const { db } = fakeDb();
      const original = db.withIdentity.bind(db);
      db.withIdentity = ((identity: unknown, fn: (tx: SqlTx) => Promise<unknown>, options?: unknown) =>
        original(identity as never, async (tx: SqlTx) => {
          (tx as unknown as { unsafe: SqlTx["unsafe"] }).unsafe = (async (sql: string) => {
            if (sql.includes("update echo.app_user")) {
              throw Object.assign(new Error("dup"), {
                code: "23505", constraint_name: "app_user_username_per_org",
              });
            }
            if (sql.includes("tombstoned_at is not null")) return retired ? [{ id: "gone" }] : [];
            return [];
          }) as SqlTx["unsafe"];
          return fn(tx);
        }, options as never)) as typeof db.withIdentity;
      // Typed as the failure, because that is the only outcome asserted here
      // — a resolved promise would fail the expectation below anyway, and
      // narrowing keeps the assertion about `code` honest.
      return createMembersRepo(db).updateProfile(IDENTITY, { username: "ghost" })
        .then(() => undefined, (error: unknown) => error as ConflictError);
    };
    expect((await conflict(true))?.code).toBe("username_retired");
    expect((await conflict(false))?.code).toBe("username_taken");
  });

  it("keeps the English sentence as the fallback for an uncatalogued client", async () => {
    // A blank screen is worse than a sentence in the wrong language.
    const { db } = fakeDb();
    const failure = await createMembersRepo(db)
      .updateProfile(IDENTITY, { calendar: "hijri" })
      .catch((error: unknown) => error) as ValidationError;
    expect(failure.code).toBe("calendar_unknown");
    expect(failure.message).toMatch(/auto, jalali, gregorian/);
  });

  it("codes the timezone and locale refusals too", async () => {
    const { db } = fakeDb();
    const zone = await createMembersRepo(db)
      .updateProfile(IDENTITY, { timezone: "Mars/Olympus_Mons" })
      .catch((error: unknown) => error) as ValidationError;
    expect(zone.code).toBe("timezone_unknown");

    const locale = await createMembersRepo(db)
      .updateProfile(IDENTITY, { locale: "Persian" })
      .catch((error: unknown) => error) as ValidationError;
    expect(locale.code).toBe("locale_shape");
  });
});

describe("locale is a preference like the others", () => {
  it("writes it through the same supplied-flag shape", async () => {
    const { db, log } = fakeDb();
    await createMembersRepo(db).updateProfile(IDENTITY, { locale: "en" });
    // [.., setLocale, locale] are indices 11 and 12.
    expect(updateParams(log)[11]).toBe(true);
    expect(updateParams(log)[12]).toBe("en");
  });

  it("accepts a regional tag and refuses a language name", async () => {
    const { db } = fakeDb();
    await expect(createMembersRepo(db).updateProfile(IDENTITY, { locale: "en-GB" }))
      .resolves.toBeTruthy();
    await expect(createMembersRepo(db).updateProfile(IDENTITY, { locale: "farsi" }))
      .rejects.toBeInstanceOf(ValidationError);
  });
});

describe("the avatar is a capped data URL, never a remote address", () => {
  const PIXEL =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

  it("writes a valid data URL through the supplied-flag shape", async () => {
    const { db, log } = fakeDb();
    await createMembersRepo(db).updateProfile(IDENTITY, { avatar_url: PIXEL });
    // [.., setAvatar, avatar] are indices 13 and 14.
    expect(updateParams(log)[13]).toBe(true);
    expect(updateParams(log)[14]).toBe(PIXEL);
  });

  it("null clears it — removing a photo is a real instruction", async () => {
    const { db, log } = fakeDb();
    await createMembersRepo(db).updateProfile(IDENTITY, { avatar_url: null });
    expect(updateParams(log)[13]).toBe(true);
    expect(updateParams(log)[14]).toBeNull();
  });

  it("refuses an https URL — a remote avatar is a tracking pixel", async () => {
    const { db } = fakeDb();
    await expect(
      createMembersRepo(db).updateProfile(IDENTITY, { avatar_url: "https://example.com/me.png" }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("refuses an oversized image and names the fix", async () => {
    const { db } = fakeDb();
    const huge = `data:image/jpeg;base64,${"A".repeat(140000)}`;
    await expect(createMembersRepo(db).updateProfile(IDENTITY, { avatar_url: huge }))
      .rejects.toMatchObject({ code: "avatar_too_large" });
  });
});

describe("date preferences: auto is a value, not an absence", () => {
  /**
   * Params are [id, setName, name, setNameEn, nameEn, setUsername, username,
   *             setCalendar, calendar, setTimezone, timezone] — so `$8` is
   * index 7. I wrote these using the placeholder numbers as indices first and
   * all four went red at once, which is the good failure: an off-by-one that
   * asserts the WRONG field would have passed while proving nothing.
   */
  const CALENDAR_SET = 7, CALENDAR_VALUE = 8, TIMEZONE_SET = 9, TIMEZONE_VALUE = 10;

  it("accepts every published calendar preference", async () => {
    for (const calendar of ["auto", "jalali", "gregorian"]) {
      const { db, log } = fakeDb();
      await createMembersRepo(db).updateProfile(IDENTITY, { calendar });
      expect(updateParams(log)[CALENDAR_SET]).toBe(true);
      expect(updateParams(log)[CALENDAR_VALUE]).toBe(calendar);
    }
  });

  it("rejects an unknown calendar and names the set", async () => {
    // "invalid calendar" leaves a dropdown with three options and no way to
    // know which the server disliked.
    const { db } = fakeDb();
    const failure = await createMembersRepo(db)
      .updateProfile(IDENTITY, { calendar: "hijri" })
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ValidationError);
    expect((failure as Error).message).toMatch(/auto, jalali, gregorian/);
  });

  it("leaves both alone when neither is supplied", async () => {
    const { db, log } = fakeDb();
    await createMembersRepo(db).updateProfile(IDENTITY, { display_name: "علی" });
    expect(updateParams(log)[CALENDAR_SET]).toBe(false);
    expect(updateParams(log)[TIMEZONE_SET]).toBe(false);
  });

  it("treats setting auto as a normal write, not a clear", async () => {
    // There is no clear operation: the column is NOT NULL and resetting IS
    // choosing. A supplied-flag with a value is the only shape.
    const { db, log } = fakeDb();
    await createMembersRepo(db).updateProfile(IDENTITY, { calendar: "auto" });
    expect(updateParams(log)[CALENDAR_SET]).toBe(true);
    expect(updateParams(log)[CALENDAR_VALUE]).toBe("auto");
  });

  it("stores the auto sentinel for timezone rather than resolving it here", async () => {
    // Snapshotting the caller's zone would silently freeze a traveller's
    // dates — FE2's point, and why `auto` is stored as itself.
    const { db, log } = fakeDb();
    await createMembersRepo(db).updateProfile(IDENTITY, { timezone: "auto" });
    expect(updateParams(log)[TIMEZONE_VALUE]).toBe("auto");
  });
});

describe("timezone is validated by the runtime, not by a list", () => {
  it.each(["auto", "Asia/Tehran", "Europe/London", "Pacific/Kiritimati", "UTC"])(
    "accepts %s", async (timezone) => {
      // Kiritimati is here deliberately: it is the case a hand-curated
      // server-side list forgets, and B3 pinned it on their side too.
      const { db } = fakeDb();
      await expect(createMembersRepo(db).updateProfile(IDENTITY, { timezone }))
        .resolves.toBeTruthy();
    },
  );

  it.each(["Mars/Olympus_Mons", "", "Not A Zone", "Asia/Tehran; drop table"])(
    "rejects %s", async (timezone) => {
      const { db } = fakeDb();
      await expect(createMembersRepo(db).updateProfile(IDENTITY, { timezone }))
        .rejects.toBeInstanceOf(ValidationError);
    },
  );

});

describe("the username rule is stated, not just enforced", () => {
  it.each([
    ["9lives", "must not start with a digit"],
    ["_x", "must not start with an underscore"],
    ["ab", "too short — three characters minimum"],
    ["a".repeat(33), "too long — thirty-two maximum"],
    ["has-hyphen", "hyphens are not in the set"],
    ["has space", "spaces are not in the set"],
    ["نام", "non-Latin script"],
  ])("rejects %s (%s) with a message naming the format", async (candidate) => {
    const { db } = fakeDb();
    const failure = await createMembersRepo(db)
      .updateProfile(IDENTITY, { username: candidate })
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ValidationError);
    // The steward's requirement: "a 422 that doesn't state the format is a
    // support ticket". Assert the rule travels with the refusal.
    expect((failure as Error).message).toMatch(/3–32|lowercase/);
  });

  it.each(["ali", "a_1", "ali_reza_2026", `a${"b".repeat(31)}`])(
    "accepts %s", async (candidate) => {
      const { db } = fakeDb();
      await expect(createMembersRepo(db).updateProfile(IDENTITY, { username: candidate }))
        .resolves.toBeTruthy();
    },
  );

  it("lower-cases rather than refusing on case alone", async () => {
    // The constraint is lowercase-only and the fix is mechanical; rejecting
    // "Ali" is pedantry the caller experiences as a bug.
    const { db, log } = fakeDb();
    await createMembersRepo(db).updateProfile(IDENTITY, { username: "  Ali  " });
    expect(updateParams(log)[6]).toBe("ali");
  });

  it("allows clearing the username with an explicit null", async () => {
    const { db, log } = fakeDb();
    await createMembersRepo(db).updateProfile(IDENTITY, { username: null });
    expect(updateParams(log)[5]).toBe(true);
    expect(updateParams(log)[6]).toBeNull();
  });
});

describe("database refusals become the right answer", () => {
  it("maps a taken username to 409 naming the FIELD", async () => {
    const { db } = fakeDb(() => {
      throw Object.assign(new Error("dup"), {
        code: "23505", constraint_name: "app_user_username_per_org",
      });
    });
    const failure = await createMembersRepo(db)
      .updateProfile(IDENTITY, { username: "taken" })
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ConflictError);
    // "conflict" alone leaves a form with three inputs and no idea which one.
    expect((failure as Error).message).toContain("username");
  });

  it("says RETIRED, not taken, when the handle belonged to a deleted account", async () => {
    /**
     * Both collisions land on `app_user_username_per_org`, so the constraint
     * name cannot tell them apart — only the follow-up look can. "Taken"
     * implies a person currently has it and could be asked for it, which
     * after a tombstone is exactly what is not true.
     */
    let sawUpdate = false;
    const { db } = fakeDb();
    const original = db.withIdentity.bind(db);
    db.withIdentity = ((identity: unknown, fn: (tx: SqlTx) => Promise<unknown>, options?: unknown) =>
      original(identity as never, async (tx: SqlTx) => {
        (tx as unknown as { unsafe: SqlTx["unsafe"] }).unsafe = (async (sql: string) => {
          if (sql.includes("update echo.app_user")) {
            sawUpdate = true;
            throw Object.assign(new Error("dup"), {
              code: "23505", constraint_name: "app_user_username_per_org",
            });
          }
          // The follow-up look: a tombstoned row holds this handle.
          if (sql.includes("tombstoned_at is not null")) return [{ id: "gone" }];
          return [];
        }) as SqlTx["unsafe"];
        return fn(tx);
      }, options as never)) as typeof db.withIdentity;

    const failure = await createMembersRepo(db)
      .updateProfile(IDENTITY, { username: "ghost" })
      .catch((error: unknown) => error);
    expect(sawUpdate).toBe(true);
    expect(failure).toBeInstanceOf(ConflictError);
    expect((failure as Error).message).toMatch(/retired/);
  });

  it("falls back to 'taken' when the retired look cannot answer", async () => {
    // A tombstoned row invisible to this caller, or any failure in the look,
    // must produce the vaguer message rather than a wrong one.
    const { db } = fakeDb();
    const original = db.withIdentity.bind(db);
    db.withIdentity = ((identity: unknown, fn: (tx: SqlTx) => Promise<unknown>, options?: unknown) =>
      original(identity as never, async (tx: SqlTx) => {
        (tx as unknown as { unsafe: SqlTx["unsafe"] }).unsafe = (async (sql: string) => {
          if (sql.includes("update echo.app_user")) {
            throw Object.assign(new Error("dup"), {
              code: "23505", constraint_name: "app_user_username_per_org",
            });
          }
          if (sql.includes("tombstoned_at is not null")) throw new Error("cannot see");
          return [];
        }) as SqlTx["unsafe"];
        return fn(tx);
      }, options as never)) as typeof db.withIdentity;

    const failure = await createMembersRepo(db)
      .updateProfile(IDENTITY, { username: "ghost" })
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ConflictError);
    expect((failure as Error).message).toMatch(/already taken/);
  });

  it("turns a format violation that slipped past us back into the rule", async () => {
    // Only reachable if the mirrored regex drifts from the constraint. The
    // database stays the enforcer; this makes its refusal legible instead of
    // surfacing a bare 23514.
    const { db } = fakeDb(() => {
      throw Object.assign(new Error("bad"), {
        code: "23514", constraint_name: "app_user_username_format",
      });
    });
    const failure = await createMembersRepo(db)
      .updateProfile(IDENTITY, { username: "ali" })
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ValidationError);
    expect((failure as Error).message).toMatch(/lowercase/);
  });

  it("does not swallow an unrelated database error", async () => {
    // A catch that maps everything is a catch that hides the next bug.
    const { db } = fakeDb(() => {
      throw Object.assign(new Error("boom"), { code: "40001" });
    });
    await expect(createMembersRepo(db).updateProfile(IDENTITY, { username: "ali" }))
      .rejects.toMatchObject({ code: "40001" });
  });

  it("reports a vanished row as 404 rather than crashing", async () => {
    const log: { sql: string }[] = [];
    const make = (): SqlClient => ({
      async begin<T>(fn: (tx: SqlTx) => Promise<T>): Promise<T> {
        const tx = (async () => []) as unknown as SqlTx;
        (tx as unknown as { unsafe: SqlTx["unsafe"] }).unsafe = (async (sql: string) => {
          log.push({ sql });
          return [];
        }) as SqlTx["unsafe"];
        return fn(tx);
      },
      async end() {},
    });
    const db = createDb({ app: make(), agent: make() });
    await expect(createMembersRepo(db).updateProfile(IDENTITY, { username: "ali" }))
      .rejects.toBeInstanceOf(NotFoundError);
  });
});
