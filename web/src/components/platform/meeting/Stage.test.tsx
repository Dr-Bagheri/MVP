import { useEffect } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { meetingFixture } from "@/test/fixtures";

/**
 * THE ROOM DOES NOT DROP WHEN YOU LOOK AT SOMETHING ELSE (user report,
 * 2026-09-07: "the video part of the online, when you switch between
 * whiteboard and video mid recording, gets disconnected and tries to connect
 * again and sets everything again as well — this will end up not recording
 * some parts of the conversation").
 *
 * The room used to render only in its own mode, so walking to the whiteboard
 * unmounted `LiveKitRoom`: the socket closed, every track was unpublished, the
 * audio tap cleared, and coming back renegotiated from nothing. What is
 * asserted here is the STRUCTURE that makes that impossible — the room stays
 * in the tree and only its pixels stop — because a reconnect is invisible to
 * any assertion about what is on screen.
 */
let CONNECTS = 0;
vi.mock("@livekit/components-react", () => ({
  LiveKitRoom: ({ children }: { children: React.ReactNode }) => {
    /*
     * COUNTED ON MOUNT, and the first draft of this counted RENDERS — which
     * came back 5 and then 12 for a room that had connected once, because a
     * function component re-renders every time its parent does. A reconnect
     * is a MOUNT: the effect with an empty dependency list is the only thing
     * here that fires once per instance.
     */
    useEffect(() => { CONNECTS += 1; }, []);
    return <div data-testid="livekit-room">{children}</div>;
  },
  GridLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ParticipantTile: () => <div />,
  ControlBar: () => <div />,
  RoomAudioRenderer: () => null,
  useTracks: () => [],
  useLocalParticipant: () => ({ isMicrophoneEnabled: true, isCameraEnabled: false }),
}));
vi.mock("./Whiteboard", () => ({ Whiteboard: () => <div data-testid="board" /> }));
/* useLocale too: the recall cards (item 7) render inside this stage and read
   the locale for their date. A mock that names only the hooks the test's
   subject uses breaks the moment the subject grows a neighbour. */
vi.mock("next-intl", () => ({
  useTranslations: () => (k: string) => k,
  useLocale: () => "fa",
}));
vi.mock("@/lib/notify", () => ({ notify: vi.fn() }));
vi.mock("@/api/client", () => ({
  api: {
    meetingRoomToken: async () => ({
      token: "t", url: "wss://example", expires_at: new Date(Date.now() + 3600_000).toISOString(),
    }),
    meetingAttachments: async () => [],
    meetingAttachmentUrl: async () => ({ url: "blob:x", content_type: "application/pdf" }),
    setMeetingPresenting: async () => meetingFixture({}),
  },
  BffError: class extends Error {},
}));

import { MeetingStage } from "./Stage";

beforeEach(() => {
  CONNECTS = 0;
});

async function online() {
  const view = render(
    <MeetingStage
      meeting={meetingFixture({ mode: "online" })}
      isHost
      onMeeting={() => undefined}
      recordingLive
    />,
  );
  /* anchored on the room being CONNECTED, not merely present: the mount
     effect lands a tick after the element does, and a test that read the
     counter in between would be measuring the moment before the subject
     exists */
  await waitFor(() => expect(CONNECTS).toBe(1));
  return view;
}

describe("the live stage keeps its room", () => {
  it("switching to the whiteboard HIDES the room — it does not unmount it", async () => {
    await online();

    await userEvent.click(screen.getByRole("button", { name: /modeBoard/ }));

    expect(screen.getByTestId("board")).toBeInTheDocument();
    /* still in the tree: the connection, the published tracks and the audio
       tap are exactly as they were, and only the pixels stopped */
    expect(screen.getByTestId("livekit-room")).toBeInTheDocument();
    expect(CONNECTS, "the room was rebuilt while the person looked at the board").toBe(1);
  });

  it("…and coming back does not reconnect either — the control for the whole report", async () => {
    await online();
    await userEvent.click(screen.getByRole("button", { name: /modeBoard/ }));
    await userEvent.click(screen.getByRole("button", { name: /modeVideo/ }));

    expect(screen.getByTestId("livekit-room")).toBeInTheDocument();
    expect(CONNECTS, "coming back minted a fresh ticket and renegotiated").toBe(1);
  });

  it("an IN-PERSON meeting has no room at all — there is nothing to keep mounted", async () => {
    /* the control that stops "always render the room" passing the two above:
       a meeting held in a room, recorded through a microphone, has no video
       room and offering one would be an empty state with a tab of its own */
    render(
      <MeetingStage
        meeting={meetingFixture({ mode: "in_person" })}
        isHost
        onMeeting={() => undefined}
        recordingLive
      />,
    );
    expect(screen.queryByTestId("livekit-room")).toBeNull();
    expect(screen.queryByRole("button", { name: /modeVideo/ })).toBeNull();
  });
});
