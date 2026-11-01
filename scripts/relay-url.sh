#!/usr/bin/env bash
# Prints the sync server's address (wss://centra-relay.<your subdomain>.workers.dev), or nothing
# when there is none yet. Used by the workflows to build the apps with sync switched on.
#
#   1. the repository variable CENTRA_RELAY_URL, if you set one (another relay)
#   2. otherwise asked from Cloudflare with CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID
#
# With --ensure the relay is deployed first when it doesn't answer yet (needs `npm ci` done).
set -uo pipefail

if [ -n "${CENTRA_RELAY_URL:-}" ]; then echo "$CENTRA_RELAY_URL"; exit 0; fi
if [ -z "${CLOUDFLARE_API_TOKEN:-}" ] || [ -z "${CLOUDFLARE_ACCOUNT_ID:-}" ]; then exit 0; fi

SUB=$(curl -fsS -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/workers/subdomain" 2>/dev/null \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{process.stdout.write(JSON.parse(s).result.subdomain||'')}catch{}})")
if [ -z "$SUB" ]; then
  echo "Cloudflare: fandt intet workers.dev-subdomæne. Vælg et under Workers & Pages i Cloudflare." >&2
  exit 0
fi
HOST="centra-relay.$SUB.workers.dev"

if [ "${1:-}" = "--ensure" ] && ! curl -fsS "https://$HOST/" 2>/dev/null | grep -q "CENTRA relay"; then
  echo "Sync-serveren svarer ikke endnu: lægger den op." >&2
  (cd services/relay-cf && npx --yes wrangler@4 deploy >&2) || { echo "Kunne ikke lægge sync-serveren op." >&2; exit 0; }
fi
echo "wss://$HOST"
