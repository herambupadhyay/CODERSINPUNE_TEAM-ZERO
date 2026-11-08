# Payment Flow — Capture, Authorize, Settle

Every card payment moves through three states: authorized, captured and settled. ledger-api persists each transition as a double-entry row, and webhook-gateway delivers merchant callbacks with at-least-once semantics.

## Capture and authorize

The authorize call holds funds for 72 hours; capture must arrive inside that window or the hold is released automatically. Timeouts are 800 ms for authorize, 1200 ms for capture and 5 s for settle.

## Retry policy

Retries are exponential with jitter and stop after five attempts per payment. Retries owned by Sarah Chen per decision 2026-01-14; retry-worker is the only service permitted to re-enqueue failed captures.

## Idempotency

Clients send an idempotency key (UUIDv7) on every capture; ledger-api rejects duplicates with the original response for 24 hours. Settlement batches are keyed by business date so a replayed batch cannot double-pay a merchant.
