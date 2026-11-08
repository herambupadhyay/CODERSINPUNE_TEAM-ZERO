# auth-bff Service Runbook

Owner: Sarah Chen (Backend Lead). Secondary: Daniel Reed. The auth-bff fronts the identity provider for every internal API call, mints 15-minute JWTs and refreshes them through Redis.

## Rotation steps

1. Generate the new signing key in Vault under payments/auth-bff.
2. Deploy the key to all three auth-bff pods with a canary rollout.
3. Verify old-key tokens still validate for 24 hours, then disable the old key.
4. Update this runbook and post the change in #payments-oncall.

## Incidents

On 2026-02-09 a stale key caused 11 minutes of 401s; Sarah Chen rolled back inside the change window. Escalate to Alex Morgan only if two rotations fail in the same week. The Redis failover on 2026-01-27 was a no-op because auth-bff retries token refreshes twice before failing.

## Contacts

Primary on-call: Sarah Chen, sarah@northwind.dev. Escalation: Alex Morgan. The pager rotation lives in PagerDuty under payments-primary. Security questions go to the #payments-security channel.
