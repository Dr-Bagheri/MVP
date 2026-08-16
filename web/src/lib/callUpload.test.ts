import { describe, expect, it } from "vitest";
import { PartUploader, uploadOnePart, type UploadApi } from "./callUpload";

/**
 * The upload orchestration, against a scripted api. The fake is the WIRE
 * ANSWER (resolve/reject per call), never the orchestrator's own logic.
 */

function blob(): Blob {
  return new Blob(["aa"], { type: "audio/webm" });
}

function scriptedApi(script: {
  signFails?: number[];
  putFails?: number[];
  registerFails?: number[];
}): { api: UploadApi; log: string[] } {
  const log: string[] = [];
  const api: UploadApi = {
    async signCallPart(_callId, input) {
      log.push(`sign:${input.idx}`);
      if (script.signFails?.includes(input.idx)) throw new Error("sign refused");
      return {
        upload_url: `https://storage/upload/${input.idx}`,
        path: `call/${input.idx}-x.webm`,
        content_type: input.content_type,
      };
    },
    async putSignedPart(url) {
      const idx = Number(url.split("/").pop());
      log.push(`put:${idx}`);
      if (script.putFails?.includes(idx)) {
        // consume the scripted failure so the retry can succeed
        script.putFails = script.putFails.filter((i) => i !== idx);
        throw new Error("put failed");
      }
    },
    async registerCallPart(_callId, input) {
      log.push(`register:${input.idx}`);
      if (script.registerFails?.includes(input.idx)) throw new Error("register refused");
      return { part_id: `part-${input.idx}` };
    },
  };
  return { api, log };
}

describe("uploadOnePart", () => {
  it("a part is whole or it is nothing: sign → PUT → register, in that order", async () => {
    const { api, log } = scriptedApi({});
    await uploadOnePart(api, "c", { idx: 0, offsetMs: 0, blob: blob(), contentType: "audio/webm" });
    expect(log).toEqual(["sign:0", "put:0", "register:0"]);
  });

  it("a refused PUT never registers — no row may point at absent bytes", async () => {
    const { api, log } = scriptedApi({ putFails: [0, 0] });
    // putFails consumed one at a time; [0,0] makes both attempts fail
    await expect(
      uploadOnePart(api, "c", { idx: 0, offsetMs: 0, blob: blob(), contentType: "audio/webm" }),
    ).rejects.toThrow();
    expect(log).not.toContain("register:0");
  });
});

describe("PartUploader", () => {
  it("uploads strictly in order while parts keep arriving", async () => {
    const { api, log } = scriptedApi({});
    const up = new PartUploader(api, "c");
    up.enqueue({ idx: 0, offsetMs: 0, blob: blob(), contentType: "audio/webm" });
    up.enqueue({ idx: 1, offsetMs: 1_800_000, blob: blob(), contentType: "audio/webm" });
    const result = await up.settle();
    expect(result).toEqual({ clean: true, failed: 0 });
    expect(log).toEqual(["sign:0", "put:0", "register:0", "sign:1", "put:1", "register:1"]);
  });

  it("one transient failure heals itself with the automatic retry", async () => {
    const { api, log } = scriptedApi({ putFails: [0] });
    const up = new PartUploader(api, "c");
    up.enqueue({ idx: 0, offsetMs: 0, blob: blob(), contentType: "audio/webm" });
    const result = await up.settle();
    expect(result.clean).toBe(true);
    expect(log.filter((l) => l === "put:0")).toHaveLength(2);
  });

  it("a part that fails twice is KEPT — settle says not-clean, retryFailed re-runs it with its bytes", async () => {
    const script = { registerFails: [1] };
    const { api } = scriptedApi(script);
    const states: number[] = [];
    const up = new PartUploader(api, "c", (p) => states.push(p.failed));
    up.enqueue({ idx: 0, offsetMs: 0, blob: blob(), contentType: "audio/webm" });
    up.enqueue({ idx: 1, offsetMs: 1_800_000, blob: blob(), contentType: "audio/webm" });
    const first = await up.settle();
    expect(first).toEqual({ clean: false, failed: 1 });
    expect(Math.max(...states)).toBe(1);

    // the failure clears server-side; the kept bytes go through unchanged
    script.registerFails = [];
    up.retryFailed();
    const second = await up.settle();
    expect(second).toEqual({ clean: true, failed: 0 });
  });
});
