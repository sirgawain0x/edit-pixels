# CLI and agent authorization

Pixels hosts Privy's browser approval page at `/authorize`. It accepts
`?user_code=ABCD-1234` from the CLI's `verification_uri_complete`, or lets the
user enter the code manually. Signing in does not approve access; the user
must confirm the code and choose **Approve access** or **Deny access**.

## Deployment setup

1. Deploy the page with the existing `VITE_PRIVY_APP_ID` configuration.
2. In the matching Privy app, open **Authentication → Advanced** and enable
   **CLI and agent access**.
3. Set the verification URL to
   `https://create.creativeplatform.xyz/authorize`.
4. Start device authorization from your CLI or agent, open its verification
   link, sign in, confirm the matching code, and approve or deny the request.

The browser sends the signed-in user's access token and decision directly to
Privy's public `/api/oauth/v2/device_verify` endpoint. It does not use an app
secret, store agent tokens, or poll for tokens. The CLI handles requesting a
device code, polling, secure token storage, and subsequent wallet operations.

Invalid or expired codes require a new login request from the CLI. Failed
network requests can be retried. This page does not depend on workspace folder
access or successful Alchemy smart account provisioning.

See [Privy's agent authorization guide](https://docs.privy.io/recipes/agent-integrations/agent-authorization)
for the CLI protocol, token lifetimes, and authorization revocation endpoints.
