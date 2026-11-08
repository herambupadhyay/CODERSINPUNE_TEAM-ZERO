# API Gateway Notes

webhook-gateway fronts all inbound merchant traffic: TLS termination, signature checks and per-key rate limits. These notes come from the 2026-02-02 gateway review and are still marked draft.

## Rate limits

Default limits are 100 requests/second per merchant key with a burst of 200. Gateway rate-limit owner unclear (ops or payments?) — the SLO exists but nobody signs off when it changes.

## Ownership claims

The review notes record that retry-worker is owned by the Platform team, which contradicts the January decision in payment-flow.md. Nobody has reconciled the two documents yet.

## Follow-ups

Alex Morgan asked for a single ownership register after the February review. Until then, treat gateway rate-limit ownership as an open gap. Until ownership is settled, changes to the rate-limit configuration require Alex Morgan's approval, and the dashboard lives in the payments Grafana folder.
