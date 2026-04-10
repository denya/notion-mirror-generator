---
name: setup-cloudflare
description: Set up Cloudflare prerequisites for deploying a Worker — Wrangler CLI, authentication, DNS zone management, and domain/subdomain configuration.
user-invocable: true
---

# Setup Cloudflare

Use this skill when a user wants to deploy a Cloudflare Worker to a custom domain and any of these are unresolved:

- Wrangler CLI is not installed or not functional
- No Cloudflare account exists
- Authentication is not confirmed
- The target domain/zone is not on Cloudflare
- The user is unsure which DNS path to take

This skill is not specific to any particular project. It applies to any Cloudflare Worker that needs a custom domain with KV and R2.

## Workflow

Work through each phase in order. Skip phases where the prerequisite is already met.

### Phase A: Wrangler CLI readiness

In generated project repos, `wrangler` is a devDependency. Running `bun install` in the project handles installation.

Verify:

```sh
bunx wrangler --version
```

Expected: version 4.x or later. If the command fails, the fix is usually `bun install` in the project directory.

**OS-specific notes:**

- **macOS / Linux**: `bun install` and `bunx wrangler` work out of the box. If bun is not installed: `curl -fsSL https://bun.sh/install | bash`.
- **Windows**: Recommend running everything inside WSL2. Native Windows may have path issues with wrangler. If the user is on native Windows without WSL, suggest `npx wrangler` instead of `bunx wrangler`.
- **Headless servers** (no desktop browser): `bunx wrangler login` prints a URL to open in a browser on another machine. Alternatively, use an API token (Phase C, Method 2).

### Phase B: Cloudflare account

Ask: do you already have a Cloudflare account?

**No account**: Go to `https://dash.cloudflare.com/sign-up` and create a free account. The free tier includes Workers (100k requests/day), KV, R2 (10 GB free), and DNS management. No credit card is required for basic usage.

**Has account**: Skip to Phase C.

### Phase C: Authentication

Two methods. Ask which they prefer, or detect based on environment.

**Method 1: Interactive browser login (recommended for local development)**

```sh
bunx wrangler login
```

Opens a browser tab for OAuth consent. On headless or remote servers, wrangler prints a URL — copy it and open it in any browser, authorize, and the CLI picks up the token.

**Method 2: API token (recommended for CI, headless, or shared environments)**

1. Go to `https://dash.cloudflare.com/profile/api-tokens`
2. Create a custom token with these permissions:
   - Account > Workers Scripts > Edit
   - Account > Workers KV Storage > Edit
   - Account > Workers R2 Storage > Edit
   - Zone > DNS > Edit (for the target zone, or all zones)
3. Export the token:

```sh
export CLOUDFLARE_API_TOKEN=<token>
```

**Verify** (either method):

```sh
bunx wrangler whoami
```

Expected: account name and account ID displayed. If it fails, the token is invalid or `wrangler login` was not completed.

### Phase D: Domain and DNS setup

Ask the user one question at a time. Do not present the whole decision tree at once.

**Question: What domain do you want to deploy to?**

Then route based on the answer:

---

**The domain is already on Cloudflare.**

Verify the zone is active:

```sh
bunx wrangler dns list <domain>
```

Or check the Cloudflare dashboard — the zone should show status "Active".

If using a subdomain (e.g., `mirror.example.com`): no extra DNS setup is needed. The `custom_domain = true` setting in `wrangler.toml` auto-creates the DNS record when the worker is deployed. Just confirm the parent zone (`example.com`) is active on Cloudflare.

Deployment mode: **custom_domain**. Proceed to Phase E.

---

**The domain is NOT yet on Cloudflare.**

The `custom_domain = true` feature in wrangler.toml requires the zone to be managed by Cloudflare. Guide the user to add it:

1. Log in to the Cloudflare dashboard
2. Click "Add a Site" and enter the domain (e.g., `example.com`)
3. Select the Free plan
4. Cloudflare scans and imports all existing DNS records — review them, add any missing ones
5. Cloudflare shows two nameserver addresses
6. Go to the domain registrar (GoDaddy, Namecheap, Porkbun, etc.) and replace the current nameservers with the Cloudflare nameservers
7. Wait for propagation

Cloudflare has good built-in instructions during this process. Reassure the user:

- This is free. Cloudflare's DNS management costs nothing.
- All existing DNS records (email MX, subdomains, other services) are auto-imported and continue working.
- The only change is which nameservers are authoritative. Existing services are unaffected.
- Propagation usually takes under 1 hour, though it can take up to 24 hours in rare cases.

Check propagation:

```sh
dig NS example.com +short
```

When the nameservers show Cloudflare's (e.g., `*.ns.cloudflare.com`), the zone is active. The Cloudflare dashboard also shows propagation status.

If propagation is still pending: deployment mode is **deferred**. Proceed with local backup and scaffolding. Return to deploy when the zone is active.

If propagation is complete: deployment mode is **custom_domain**. Proceed to Phase E.

---

**The user does NOT want to use Cloudflare DNS at all.**

The only option without Cloudflare DNS is deploying to a `workers.dev` URL:

- The worker is accessible at `<worker-name>.<account-subdomain>.workers.dev`
- No custom domain, no DNS changes required
- To configure this: comment out or remove the `routes` array in `wrangler.toml` and keep `workers_dev = true`

Deployment mode: **workers_dev_only**.

Note: a CNAME from external DNS to the workers.dev URL does not give the worker a custom domain with SSL. Cloudflare cannot issue a certificate for a domain whose zone it does not manage. If the user wants a custom domain, they need to add the zone to Cloudflare.

### Phase E: Verification checklist

Run through this checklist to confirm everything is ready:

1. **Wrangler works**: `bunx wrangler --version` returns 4.x
2. **Auth works**: `bunx wrangler whoami` shows account name and ID
3. **Zone is active** (custom_domain mode only): Cloudflare dashboard shows the zone as "Active", or `bunx wrangler dns list <domain>` succeeds
4. **Permissions are sufficient**: test by creating a throwaway KV namespace:
   ```sh
   bunx wrangler kv namespace create SETUP_TEST
   ```
   If this succeeds, permissions are good. Clean up:
   ```sh
   bunx wrangler kv namespace delete --namespace-id <id-from-above>
   ```

Report back with:

- **Authentication**: confirmed / not confirmed
- **Deployment mode**: `custom_domain` / `workers_dev_only` / `deferred`
- **Domain/zone**: the domain name and whether it is active on Cloudflare
- **Pending actions**: e.g., "waiting for nameserver propagation — recheck in 1 hour"

## Troubleshooting

**`bunx wrangler login` hangs or shows no browser.**
On headless servers or SSH sessions, wrangler prints a URL to stdout. Copy it and open it in a browser on another machine. If that is not practical, use an API token (Phase C, Method 2).

**`wrangler deploy` says "zone not found".**
The domain zone is not on the Cloudflare account that wrangler is authenticated with. Run `bunx wrangler whoami` to check the account, then verify the zone exists in that account's dashboard. If the user has multiple accounts, log out (`bunx wrangler logout`) and log back in with the correct one, or use an API token scoped to the correct account.

**Nameserver propagation is slow.**
Use `dig NS example.com +short` to check. Cloudflare dashboard also shows status. Can take up to 48 hours in rare cases, but usually resolves in under 1 hour. There is nothing to do but wait.

**"Custom domain requires orange-clouded DNS".**
The DNS record for the custom domain must be proxied (orange cloud icon in Cloudflare). When using `custom_domain = true`, wrangler auto-creates a proxied record. This error usually means someone manually created a DNS-only (gray cloud) record. Delete the manual record and let `wrangler deploy` recreate it.

**Multiple Cloudflare accounts.**
`bunx wrangler whoami` shows which account is active. To switch: `bunx wrangler logout` then `bunx wrangler login`, or use an API token for the target account.
