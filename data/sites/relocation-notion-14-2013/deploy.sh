#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
cd "$SCRIPT_DIR"

PLACEHOLDER_KV_ID="placeholder-create-via-wrangler"
R2_BUCKET_NAME="spain-denyamsk-notion-images"
SITE_URL="https://spain.denyamsk.com"

print_step() {
  echo ""
  echo "$1"
}

fail() {
  echo ""
  echo "ERROR: $1" >&2
  exit 1
}

extract_configured_kv_id() {
  awk '
    $0 == "[[kv_namespaces]]" { in_kv=1; next }
    in_kv && /^id = "/ {
      gsub(/^id = "/, "", $0)
      gsub(/"$/, "", $0)
      print
      exit
    }
    in_kv && /^\[/ { exit }
  ' wrangler.toml
}

extract_kv_id_from_create_output() {
  printf '%s\n' "$1" | sed -n 's/.*id = "\(.*\)".*/\1/p' | head -1
}

read_notion_key() {
  if [ -n "${NOTION_API_KEY:-}" ]; then
    printf '%s' "$NOTION_API_KEY"
    return
  fi

  if [ ! -f .env ]; then
    return
  fi

  grep '^NOTION_API_KEY=' .env | head -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//"
}

ensure_cloudflare_auth() {
  if [ -n "${CLOUDFLARE_API_TOKEN:-}" ]; then
    return
  fi

  if bunx wrangler whoami >/dev/null 2>&1; then
    return
  fi

  fail "Cloudflare auth is not available. Either export CLOUDFLARE_API_TOKEN with Workers/KV/R2/Secrets permissions or run 'bunx wrangler login' in this shell, then rerun ./deploy.sh."
}

echo "=== Notion Mirror Deploy Script ==="
echo ""

ensure_cloudflare_auth

CURRENT_KV_ID=$(extract_configured_kv_id)

if [ -n "$CURRENT_KV_ID" ] && [ "$CURRENT_KV_ID" != "$PLACEHOLDER_KV_ID" ]; then
  print_step "Step 1: KV namespace already configured."
  KV_ID="$CURRENT_KV_ID"
  echo "   Reusing PAGE_CACHE namespace: $KV_ID"
else
  print_step "Step 1: Creating KV namespace..."
  KV_OUTPUT=$(bunx wrangler kv namespace create PAGE_CACHE 2>&1)
  echo "$KV_OUTPUT"

  KV_ID=$(extract_kv_id_from_create_output "$KV_OUTPUT")
  if [ -z "$KV_ID" ]; then
    fail "Wrangler did not return a KV namespace ID. Check the output above."
  fi

  echo "   KV namespace ID: $KV_ID"

  print_step "Step 2: Updating wrangler.toml with KV ID..."
  sed -i.bak "s/id = \"$PLACEHOLDER_KV_ID\"/id = \"$KV_ID\"/" wrangler.toml
  rm -f wrangler.toml.bak
  echo "   Done."
fi

print_step "Step 3: Creating R2 bucket..."
bunx wrangler r2 bucket create "$R2_BUCKET_NAME" 2>&1 || echo "   (Bucket may already exist, continuing...)"

print_step "Step 4: Setting NOTION_API_KEY secret..."
NOTION_KEY=$(read_notion_key || true)
if [ -z "${NOTION_KEY:-}" ]; then
  fail "NOTION_API_KEY was not found in the environment or .env. Set it before deploying."
fi

printf '%s' "$NOTION_KEY" | bunx wrangler secret put NOTION_API_KEY 2>&1
echo "   Secret set."

print_step "Step 5: Deploying worker..."
bunx wrangler deploy 2>&1

print_step "Step 6: Warming sitemap and page metadata..."
bun run warm:notion

echo ""
echo "=== Deploy complete! ==="
echo ""
echo "Your site should be live at: $SITE_URL"
echo ""
echo "Useful commands:"
echo "  bun run logs     - View live logs"
echo "  bun run dev      - Local development"
echo "  ?refresh=1       - Add to any URL to bust cache"
