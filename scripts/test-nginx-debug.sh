#!/usr/bin/env bash
# Nginx/proxy debug tests for SmugMug app. See docs/nginx-proxy-debug.md.
# Run from the machine where the app listens (default port 1337). Usage:
#   ./scripts/test-nginx-debug.sh [PORT]

set -e
PORT="${1:-1337}"
BASE="http://127.0.0.1:${PORT}"

echo "=== 1. Request without Host override (may get 401 or wrong host) ==="
CODE=$(curl -s -o /tmp/diagnose1.json -w "%{http_code}" "$BASE/api/diagnose")
echo "HTTP $CODE"
if [ "$CODE" = "200" ]; then
  echo "Body (hostInDomains, rawHeaders):"
  (command -v jq >/dev/null && jq '{ hostInDomains: .routeGuard.hostInDomains, rawHeaders: .rawHeaders }' /tmp/diagnose1.json) || cat /tmp/diagnose1.json
fi
echo ""

echo "=== 2. With Host: mistral.david-ma.net (expected 200, hostInDomains: true) ==="
CODE=$(curl -s -o /tmp/diagnose2.json -w "%{http_code}" -H "Host: mistral.david-ma.net" "$BASE/api/diagnose")
echo "HTTP $CODE"
if [ "$CODE" = "200" ]; then
  echo "Body (hostInDomains, rawHeaders):"
  (command -v jq >/dev/null && jq '{ hostInDomains: .routeGuard.hostInDomains, rawHeaders: .rawHeaders }' /tmp/diagnose2.json) || cat /tmp/diagnose2.json
fi
echo ""

echo "=== 3. With X-Forwarded-Host (if Thalia trusts it) ==="
CODE=$(curl -s -o /tmp/diagnose3.json -w "%{http_code}" -H "Host: 127.0.0.1:$PORT" -H "X-Forwarded-Host: mistral.david-ma.net" "$BASE/api/diagnose")
echo "HTTP $CODE"
if [ "$CODE" = "200" ]; then
  echo "Body (hostInDomains, request.host, rawHeaders):"
  (command -v jq >/dev/null && jq '{ hostInDomains: .routeGuard.hostInDomains, requestHost: .request.host, rawHeaders: .rawHeaders }' /tmp/diagnose3.json) || cat /tmp/diagnose3.json
fi
echo ""

echo "=== 4. Bingo page with correct host (expect 200) ==="
CODE=$(curl -s -o /dev/null -w "%{http_code}" -H "Host: mistral.david-ma.net" "$BASE/bingo/14")
echo "HTTP $CODE for GET $BASE/bingo/14"
echo ""
echo "Done. See docs/nginx-proxy-debug.md for interpretation."
