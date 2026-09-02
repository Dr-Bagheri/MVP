# The video room — what to replace Jitsi with

Written 2026-09-02, after the user said the Jitsi embed "is not good enough"
and asked for something solid, searched for rather than assumed, with a small
budget available.

## What is wrong with what we have

The room works, and two things about it are not ours:

1. **It is an iframe.** Jitsi draws its own interface inside our box. We can
   turn features off through `configOverwrite`, but the type, the spacing,
   the colours and the layout are theirs. On a product whose whole point this
   month has been matching one visual system, that is a rectangle in the
   middle of the page that follows a different one.
2. **`meet.jit.si` is a public instance.** It asked the user to sign in with
   Google to become a moderator (their screenshot) — that is the public
   instance's own moderation rule, not a setting we can turn off from
   outside. Self-hosting removes it, and self-hosting is the part the server
   cannot currently carry (measured: 1.1 GiB free, the bridge wants ~1 GiB).

## The recommendation: LiveKit

[LiveKit](https://github.com/livekit/livekit) — Apache-2.0, a Go SFU, and the
one that changes the shape of the problem rather than the host:

**Its client is React components, not a frame.** `@livekit/components-react`
gives participant tiles, a control bar and a grid as ordinary components, so
the room is laid out by our own CSS, in our own theme, inside our own page.
That is the difference the user is pointing at, and no amount of Jitsi
configuration reaches it.

**Nobody signs in.** Participants join with a token WE mint server-side
against our API key. No account, no moderator, no lobby — a link and a token,
which is what was asked for.

**The cloud and the self-host are the same code.** LiveKit Cloud has a free
tier; the server is one binary or a container when we want it. Moving between
them is one URL, exactly like the Jitsi domain switch — but with the UI
already ours, the move is invisible to anyone using it.

### What it costs, honestly

- **Cloud:** free tier, then usage-priced. This is the "small amount of
  money" case, and it needs no server.
- **Self-hosted:** free, and it needs MORE open ports than Jitsi — 443, 80,
  7881/tcp, 3478/udp, and **50000–60000/udp** — plus a box with room. The
  same measurement that blocks Jitsi blocks this: not on the current server
  beside the API.

### What I cannot do

Creating the LiveKit account and minting the API key/secret is yours — I do
not create accounts or handle credentials. Once they exist:

    echo_platform_livekit_api_key      (DPAPI store, then core.env)
    echo_platform_livekit_api_secret
    NEXT_PUBLIC_LIVEKIT_URL             (Vercel)

Then the work is: a token route in core (a short-lived JWT naming the room
and the participant), swapping `meeting/Room.tsx` from the Jitsi frame to
LiveKit components, and deleting `scripts/install-meet.sh`. The room name
derivation and everything around it stays as it is.

## The two considered and not chosen

**Daily.co / Whereby Embedded** — the easiest possible embed and a free tier,
but both are prebuilt iframes again. They would fix the moderator prompt and
not the thing the user actually objected to.

**mediasoup / Janus** — lower-level SFUs. More control, and no client UI at
all: we would be writing the video layer ourselves. That is a project, not a
component, and nothing here needs it.

## Sources

- <https://github.com/livekit/livekit>
- <https://docs.livekit.io/home/self-hosting/vm/>
- <https://github.com/livekit-examples/meet>
- <https://www.forasoft.com/blog/article/jitsi-alternatives>
