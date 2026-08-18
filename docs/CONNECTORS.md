# Google and Microsoft work connectors

Echo's first work connectors power the two **manual** workflows:

- **Prepare me for meetings** uses a calendar event the person selects.
- **Draft email replies** uses an email the person selects and returns a draft
  for review. It never sends an email automatically.

The browser never receives provider access or refresh tokens. The OAuth
callback is bound to the configured public application origin, the BFF keeps
the short-lived PKCE verifier in an HttpOnly cookie, and core encrypts the
provider credential before storing it. Connections belong to the person who
authorised them; an organisation administrator cannot inspect another
person's mailbox/calendar connection.

## Required server configuration

Set these **server-side secrets only** (never in `NEXT_PUBLIC_*` variables or
the repository):

| Name | Purpose |
| --- | --- |
| `echo_platform_web_url` | Exact public origin, for example `https://app.example.com` |
| `echo_platform_connector_encryption_key` | Base64 encoding of exactly 32 random bytes (AES-256-GCM) |
| `echo_platform_google_oauth_client_id` | Google OAuth client id |
| `echo_platform_google_oauth_client_secret` | Google OAuth client secret |
| `echo_platform_microsoft_oauth_client_id` | Microsoft Entra application id |
| `echo_platform_microsoft_oauth_client_secret` | Microsoft Entra application secret |

Register these exact callback URLs at each provider (replace the origin with
the exact value of `echo_platform_web_url`):

```text
https://app.example.com/api/connectors/google/callback
https://app.example.com/api/connectors/microsoft/callback
```

The implementation asks only for read scopes: Google Calendar events and
Gmail, or Microsoft Calendars and Mail. Without a complete provider
configuration, Echo displays **Not configured** and does not present a fake
connected state.
