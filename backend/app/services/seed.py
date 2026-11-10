"""One-click demo data: seed, status and reset for the Northwind demo workspace.

The demo seed is the product's first impression: one transaction that creates a
realistic fintech workspace (users, project, documents with embeddings, a
knowledge graph with evidence, a handover awaiting review, an assistant
conversation and an audit trail). It is idempotent — re-running it adopts the
existing workspace instead of duplicating it.
"""
from __future__ import annotations

import hashlib
import re
import uuid

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import BACKEND_ROOT, get_settings
from app.core.security import hash_password
from app.db.base import utcnow
from app.db.models import (
    Conversation,
    Document,
    EvidenceChunk,
    Handover,
    HandoverApproval,
    HandoverFinding,
    HandoverSection,
    KnowledgeEvidence,
    KnowledgeItem,
    KnowledgeRelationship,
    Message,
    MessageCitation,
    Project,
    ProjectMember,
    User,
    Workspace,
    WorkspaceMember,
    document_grants,
)
from app.domain.enums import (
    AccessScope,
    DocumentKind,
    DocumentStatus,
    EvidenceStatus,
    FindingReviewState,
    HandoverStatus,
    MemberStatus,
    ProjectRole,
    ReviewState,
    WorkspaceRole,
)
from app.schemas.handover import HANDOVER_CATEGORIES
from app.services import audit
from app.services.embedding import embed_texts
from app.services.permissions import NotFoundError, PermissionError_, get_workspace_member

WORKSPACE_NAME = "Northwind Delivery"
WORKSPACE_DESC = "Fintech delivery org — sample workspace for the ProjectPulse demo."
PROJECT_NAME = "Payments Platform"
PROJECT_DESC = "Card acquiring, ledger and settlement services for the Northwind platform."
PROJECT_TAGS = ["payments", "go", "postgres", "on-call"]
DEMO_PASSWORD = "Handover!2026"
DEMO_OWNER_EMAIL = "admin@projectpulse.dev"
SEED_RUN = "demo_seed"
CHUNK_TARGET = 900

DEMO_DIR = BACKEND_ROOT / "demo_files"

DEMO_USERS: list[dict] = [
    {
        "key": "alex",
        "email": "alex@northwind.dev",
        "name": "Alex Morgan",
        "title": "Project Head",
        "ws_role": WorkspaceRole.LEAD,
        "project_role": ProjectRole.HEAD,
        "responsibility": "Project head",
    },
    {
        "key": "sarah",
        "email": "sarah@northwind.dev",
        "name": "Sarah Chen",
        "title": "Backend Lead",
        "ws_role": WorkspaceRole.MEMBER,
        "project_role": ProjectRole.LEAD,
        "responsibility": "Backend lead — auth & retry services",
    },
    {
        "key": "daniel",
        "email": "daniel@northwind.dev",
        "name": "Daniel Reed",
        "title": "Backend Developer",
        "ws_role": WorkspaceRole.MEMBER,
        "project_role": ProjectRole.MEMBER,
        "responsibility": "Backend developer — settlement APIs",
    },
    {
        "key": "maya",
        "email": "maya@northwind.dev",
        "name": "Maya Patel",
        "title": "Incoming Successor",
        "ws_role": WorkspaceRole.SUCCESSOR,
        "project_role": ProjectRole.SUCCESSOR,
        "responsibility": "Successor — taking over backend ownership",
    },
]

ARCHITECTURE_OVERVIEW = """# Payments Platform — Architecture Overview

The Northwind payments platform runs four production services on Kubernetes in eu-west-1: ledger-api, retry-worker, webhook-gateway and auth-bff. All services are written in Go 1.24 and store state in PostgreSQL 16; asynchronous work flows through Kafka topics payments.captured, payments.settled and ledger.entries.

## Request path

A card transaction enters through webhook-gateway, which validates the merchant signature and forwards the authorize request to ledger-api. ledger-api writes the double-entry rows in a single transaction and emits ledger.entries for the settlement consumer. auth-bff issues short-lived JWTs for internal callers and never touches card data.

## Async path

retry-worker consumes payments.captured with a bounded retry policy and pushes failed captures back onto the outbox after five attempts. Settlement runs nightly between 02:00 and 04:00 UTC; Daniel Reed owns the settlement consumer and the webhook-gateway deployment.

## Operational notes

PostgreSQL is the source of truth; Kafka is transport only, so a replayed topic never changes balances. Every service exposes /healthz and /metrics to the shared Prometheus scrape configuration owned by the platform team.
"""

AUTH_SERVICE_RUNBOOK = """# auth-bff Service Runbook

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
"""

PAYMENT_FLOW = """# Payment Flow — Capture, Authorize, Settle

Every card payment moves through three states: authorized, captured and settled. ledger-api persists each transition as a double-entry row, and webhook-gateway delivers merchant callbacks with at-least-once semantics.

## Capture and authorize

The authorize call holds funds for 72 hours; capture must arrive inside that window or the hold is released automatically. Timeouts are 800 ms for authorize, 1200 ms for capture and 5 s for settle.

## Retry policy

Retries are exponential with jitter and stop after five attempts per payment. Retries owned by Sarah Chen per decision 2026-01-14; retry-worker is the only service permitted to re-enqueue failed captures.

## Idempotency

Clients send an idempotency key (UUIDv7) on every capture; ledger-api rejects duplicates with the original response for 24 hours. Settlement batches are keyed by business date so a replayed batch cannot double-pay a merchant.
"""

TEAM_AND_OWNERSHIP = """# Team and Ownership

The payments platform is owned by five people, with Alex Morgan making the final call on scope, staffing and every handover sign-off.

## Daniel Reed

Daniel owns the settlement API and webhook-gateway, including their on-call rota and deployment pipelines. He is leaving Northwind on 2026-04-03 and spends March pairing with Maya Patel on both services.

## Sarah Chen

Sarah owns auth-bff and retry-worker, and she is the decision owner for retry policy. She also carries the primary pager for payments during EU hours.

## Alex Morgan

Alex decides priorities, approves architecture changes and signs off every handover. He joined the weekly settlement review in January 2026 and chairs the incident retros.

## Maya Patel

Maya joins as successor in April 2026 and inherits Daniel's services after the handover is approved. Her first two weeks are spent shadowing on-call before she carries the pager alone.
"""

INCIDENT_2026_03_15 = """# Incident 2026-03-15 — SEV2 Ledger Lag

A Kafka consumer lag on ledger.entries delayed settlement projections by 41 minutes on 2026-03-15. No payments were lost; merchant dashboards showed stale balances until 09:41 UTC.

## Timeline

- 08:47 UTC — alert payments.kafka.lag fires at 120k messages.
- 08:52 UTC — Daniel Reed confirms the settlement consumer is alive but throttled.
- 09:18 UTC — Sarah Chen raises the consumer max fetch to 500 records.
- 09:41 UTC — lag drains to zero and the alert clears.

## Root cause

The nightly settlement batch and a backfilled merchant export competed for the same partition, and the consumer had no autoscaling rule above 60k lag.

## Actions

Daniel Reed adds a lag-based autoscaler by 2026-03-22; Sarah Chen writes the runbook note. The retro is scheduled for 2026-03-20 with Alex Morgan facilitating. Merchant support was briefed at 10:15 UTC with the same timeline, and no customer refunds were required.
"""

API_GATEWAY_NOTES = """# API Gateway Notes

webhook-gateway fronts all inbound merchant traffic: TLS termination, signature checks and per-key rate limits. These notes come from the 2026-02-02 gateway review and are still marked draft.

## Rate limits

Default limits are 100 requests/second per merchant key with a burst of 200. Gateway rate-limit owner unclear (ops or payments?) — the SLO exists but nobody signs off when it changes.

## Ownership claims

The review notes record that retry-worker is owned by the Platform team, which contradicts the January decision in payment-flow.md. Nobody has reconciled the two documents yet.

## Follow-ups

Alex Morgan asked for a single ownership register after the February review. Until then, treat gateway rate-limit ownership as an open gap. Until ownership is settled, changes to the rate-limit configuration require Alex Morgan's approval, and the dashboard lives in the payments Grafana folder.
"""

OFFBOARDING_CHECKLIST = """# Offboarding Checklist — Daniel Reed

Daniel Reed departs on 2026-04-03. A handover is required before his access is revoked; Alex Morgan will not sign the offboarding ticket until the successor confirms receipt.

## Access revocation

- Revoke VPN and AWS keys on the departure date at 18:00 UTC.
- Remove Daniel from PagerDuty payments-primary the same evening.
- Transfer GitHub ownership of settlement-api and webhook-gateway to Maya Patel.

## Knowledge transfer

Two pairing sessions are booked for 2026-03-26 and 2026-03-30 covering settlement runs and gateway deployments. Sarah Chen covers retry-worker and auth-bff in the third session. Maya has had read access to the settlement runbooks since 2026-03-10.

## Sign-off

Successor sign-off by Maya Patel, manager sign-off by Alex Morgan. The payments vendor renewal date is not documented — finance owns that contract until someone records it. Revocation is verified by IT within two hours of the departure date.
"""

DEMO_FILES: list[dict] = [
    {"name": "architecture-overview.md", "content": ARCHITECTURE_OVERVIEW, "uploader": "alex", "scope": AccessScope.PROJECT},
    {"name": "auth-service-runbook.md", "content": AUTH_SERVICE_RUNBOOK, "uploader": "alex", "scope": AccessScope.PROJECT},
    {"name": "payment-flow.md", "content": PAYMENT_FLOW, "uploader": "daniel", "scope": AccessScope.PROJECT},
    {"name": "team-and-ownership.md", "content": TEAM_AND_OWNERSHIP, "uploader": "alex", "scope": AccessScope.PROJECT},
    {"name": "incident-2026-03-15.md", "content": INCIDENT_2026_03_15, "uploader": "alex", "scope": AccessScope.RESTRICTED},
    {"name": "api-gateway-notes.md", "content": API_GATEWAY_NOTES, "uploader": "alex", "scope": AccessScope.PROJECT},
    {"name": "offboarding-checklist.md", "content": OFFBOARDING_CHECKLIST, "uploader": "daniel", "scope": AccessScope.PROJECT},
]

QUOTE_RETRIES_SARAH = (
    "Retries owned by Sarah Chen per decision 2026-01-14; retry-worker is the only "
    "service permitted to re-enqueue failed captures."
)
QUOTE_RETRIES_PLATFORM = (
    "The review notes record that retry-worker is owned by the Platform team, which "
    "contradicts the January decision in payment-flow.md."
)
QUOTE_GO124 = (
    "All services are written in Go 1.24 and store state in PostgreSQL 16; "
    "asynchronous work flows through Kafka topics payments.captured, payments.settled "
    "and ledger.entries."
)
QUOTE_SETTLEMENT_WINDOW = (
    "Settlement runs nightly between 02:00 and 04:00 UTC; Daniel Reed owns the "
    "settlement consumer and the webhook-gateway deployment."
)
QUOTE_IDEMPOTENCY = (
    "Clients send an idempotency key (UUIDv7) on every capture; ledger-api rejects "
    "duplicates with the original response for 24 hours."
)
QUOTE_AUTH_OWNER = "Owner: Sarah Chen (Backend Lead). Secondary: Daniel Reed."
QUOTE_KEY_ROTATION = "Generate the new signing key in Vault under payments/auth-bff."
QUOTE_ONCALL = "Primary on-call: Sarah Chen, sarah@northwind.dev. Escalation: Alex Morgan."
QUOTE_DANIEL_OWNS = (
    "Daniel owns the settlement API and webhook-gateway, including their on-call "
    "rota and deployment pipelines."
)
QUOTE_DANIEL_DEPARTS = (
    "Daniel Reed departs on 2026-04-03. A handover is required before his access is "
    "revoked; Alex Morgan will not sign the offboarding ticket until the successor "
    "confirms receipt."
)
QUOTE_MAYA_INHERITS = (
    "Maya joins as successor in April 2026 and inherits Daniel's services after the "
    "handover is approved."
)
QUOTE_PAGER = "She also carries the primary pager for payments during EU hours."
QUOTE_SEV2 = (
    "A Kafka consumer lag on ledger.entries delayed settlement projections by 41 "
    "minutes on 2026-03-15."
)
QUOTE_LAG_CAUSE = (
    "The nightly settlement batch and a backfilled merchant export competed for the "
    "same partition, and the consumer had no autoscaling rule above 60k lag."
)
QUOTE_NO_RECONCILE = "Nobody has reconciled the two documents yet."
QUOTE_PAIRING = (
    "Two pairing sessions are booked for 2026-03-26 and 2026-03-30 covering "
    "settlement runs and gateway deployments."
)
QUOTE_GITHUB_TRANSFER = (
    "Transfer GitHub ownership of settlement-api and webhook-gateway to Maya Patel."
)
QUOTE_OUTBOX = (
    "retry-worker consumes payments.captured with a bounded retry policy and pushes "
    "failed captures back onto the outbox after five attempts."
)
QUOTE_REQUEST_PATH = (
    "A card transaction enters through webhook-gateway, which validates the merchant "
    "signature and forwards the authorize request to ledger-api."
)

KNOWLEDGE_SPECS: list[dict] = [
    {
        "key": "decision_retry_sarah",
        "type": "decision",
        "title": "Retries owned by Sarah Chen per January decision",
        "description": "payment-flow.md records the 2026-01-14 decision assigning capture-retry ownership to Sarah Chen.",
        "reasoning": None,
        "attributes": {
            "rationale": "The team that owns the ledger path must re-drive failed captures; five-attempt cap agreed with Alex Morgan.",
            "decided_by": "Sarah Chen",
            "date": "2026-01-14",
            "status": "active",
        },
        "evidence_status": EvidenceStatus.CONFLICTING,
        "review_state": ReviewState.PENDING,
        "evidence": [("payment-flow.md", QUOTE_RETRIES_SARAH), ("api-gateway-notes.md", QUOTE_RETRIES_PLATFORM)],
    },
    {
        "key": "decision_retry_platform",
        "type": "decision",
        "title": "Gateway review claims Platform team owns retry-worker",
        "description": "The 2026-02-02 gateway review notes state that retry-worker belongs to the Platform team.",
        "reasoning": None,
        "attributes": {
            "rationale": "Gateway review minutes list Platform as the retry-worker owner without referencing the January decision.",
            "decided_by": "Platform team (per gateway review)",
            "date": "2026-02-02",
            "status": "disputed",
        },
        "evidence_status": EvidenceStatus.CONFLICTING,
        "review_state": ReviewState.PENDING,
        "evidence": [("api-gateway-notes.md", QUOTE_RETRIES_PLATFORM)],
    },
    {
        "key": "decision_settlement_window",
        "type": "decision",
        "title": "Settlement batch window 02:00–04:00 UTC",
        "description": "Nightly settlement runs inside a two-hour window chosen to avoid the EU peak.",
        "reasoning": None,
        "attributes": {
            "rationale": "Batch window picked when peak ledger volume was measured at 40k payments/hour.",
            "decided_by": "Daniel Reed",
            "date": "2025-11-20",
            "status": "active",
        },
        "evidence_status": EvidenceStatus.SUPPORTED,
        "review_state": ReviewState.VERIFIED,
        "evidence": [("architecture-overview.md", QUOTE_SETTLEMENT_WINDOW)],
    },
    {
        "key": "decision_idempotency_keys",
        "type": "decision",
        "title": "Capture idempotency keys are client-supplied UUIDv7",
        "description": "Every capture request carries a UUIDv7 idempotency key replayable for 24 hours.",
        "reasoning": None,
        "attributes": {
            "rationale": "Time-ordered UUIDv7 keys keep duplicate lookups cheap in the ledger table.",
            "decided_by": "Alex Morgan",
            "date": "2025-12-04",
            "status": "active",
        },
        "evidence_status": EvidenceStatus.SUPPORTED,
        "review_state": ReviewState.VERIFIED,
        "evidence": [("payment-flow.md", QUOTE_IDEMPOTENCY)],
    },
    {
        "key": "task_confirm_retry_owner",
        "type": "task",
        "title": "Confirm retry-worker owner with Platform team",
        "description": "Get the Platform team to confirm or drop their retry-worker ownership claim before the handover is approved.",
        "reasoning": None,
        "attributes": {"owner": "Sarah Chen", "due_date": "2026-03-27", "status": "open", "priority": "high"},
        "evidence_status": EvidenceStatus.SUPPORTED,
        "review_state": ReviewState.PENDING,
        "evidence": [("api-gateway-notes.md", QUOTE_NO_RECONCILE)],
    },
    {
        "key": "task_auth_rotation",
        "type": "task",
        "title": "Rotate auth-bff signing keys before April",
        "description": "Complete a full signing-key rotation per the runbook ahead of the April freeze.",
        "reasoning": None,
        "attributes": {"owner": "Sarah Chen", "due_date": "2026-04-10", "status": "open", "priority": "medium"},
        "evidence_status": EvidenceStatus.SUPPORTED,
        "review_state": ReviewState.VERIFIED,
        "evidence": [("auth-service-runbook.md", QUOTE_KEY_ROTATION)],
    },
    {
        "key": "task_pairing_sessions",
        "type": "task",
        "title": "Run settlement pairing sessions with Maya",
        "description": "Two booked sessions transfer settlement and gateway knowledge to Maya Patel before Daniel leaves.",
        "reasoning": None,
        "attributes": {"owner": "Daniel Reed", "due_date": "2026-03-30", "status": "open", "priority": "high"},
        "evidence_status": EvidenceStatus.SUPPORTED,
        "review_state": ReviewState.PENDING,
        "evidence": [("offboarding-checklist.md", QUOTE_PAIRING)],
    },
    {
        "key": "task_gateway_migration",
        "type": "task",
        "title": "Migrate webhook-gateway to Go 1.24",
        "description": "webhook-gateway now runs on Go 1.24 alongside the rest of the platform services.",
        "reasoning": None,
        "attributes": {"owner": "Daniel Reed", "due_date": "2026-02-20", "status": "done", "priority": "low"},
        "evidence_status": EvidenceStatus.SUPPORTED,
        "review_state": ReviewState.VERIFIED,
        "evidence": [("architecture-overview.md", QUOTE_GO124)],
    },
    {
        "key": "risk_auth_bus_factor",
        "type": "risk",
        "title": "auth-bff has a single primary owner",
        "description": "Sarah Chen is primary owner of auth-bff with only Daniel Reed as secondary.",
        "reasoning": None,
        "attributes": {
            "severity": "high",
            "likelihood": "medium",
            "impact": "If Sarah is unavailable, no one else can approve auth-bff key changes.",
        },
        "evidence_status": EvidenceStatus.SUPPORTED,
        "review_state": ReviewState.VERIFIED,
        "evidence": [("auth-service-runbook.md", QUOTE_AUTH_OWNER)],
    },
    {
        "key": "risk_daniel_departure",
        "type": "risk",
        "title": "Daniel's departure creates a settlement bus factor",
        "description": "Daniel Reed leaves on 2026-04-03 holding the only deep knowledge of the settlement consumer.",
        "reasoning": None,
        "attributes": {
            "severity": "high",
            "likelihood": "high",
            "impact": "Settlement incidents after 2026-04-03 fall to Maya Patel during ramp-up.",
        },
        "evidence_status": EvidenceStatus.SUPPORTED,
        "review_state": ReviewState.VERIFIED,
        "evidence": [("team-and-ownership.md", "He is leaving Northwind on 2026-04-03 and spends March pairing with Maya Patel on both services.")],
    },
    {
        "key": "risk_kafka_lag",
        "type": "risk",
        "title": "Kafka consumer lag can stall settlement again",
        "description": "The 2026-03-15 SEV2 showed how quickly consumer lag stalls settlement projections.",
        "reasoning": "No recurrence has been logged since the March retro, so the risk is inferred from the missing autoscaler rather than from a new incident.",
        "attributes": {
            "severity": "medium",
            "likelihood": "low",
            "impact": "A repeat lag event would show stale merchant balances for up to an hour.",
        },
        "evidence_status": EvidenceStatus.INFERRED,
        "review_state": ReviewState.PENDING,
        "evidence": [("incident-2026-03-15.md", QUOTE_LAG_CAUSE)],
    },
    {
        "key": "dep_webhook_ledger",
        "type": "dependency",
        "title": "webhook-gateway depends on ledger-api",
        "description": "Merchant authorize calls are forwarded synchronously from webhook-gateway to ledger-api.",
        "reasoning": "Inferred from the request-path description; the project has no dependency register yet.",
        "attributes": {"system": "webhook-gateway", "direction": "sync", "depends_on": "ledger-api"},
        "evidence_status": EvidenceStatus.INFERRED,
        "review_state": ReviewState.PENDING,
        "evidence": [("architecture-overview.md", QUOTE_REQUEST_PATH)],
    },
    {
        "key": "dep_retry_kafka",
        "type": "dependency",
        "title": "retry-worker depends on Kafka payments topics",
        "description": "retry-worker consumes payments.captured asynchronously and republishes failed captures.",
        "reasoning": None,
        "attributes": {"system": "retry-worker", "direction": "async", "depends_on": "kafka:payments.captured"},
        "evidence_status": EvidenceStatus.SUPPORTED,
        "review_state": ReviewState.VERIFIED,
        "evidence": [("architecture-overview.md", QUOTE_OUTBOX)],
    },
    {
        "key": "person_daniel",
        "type": "person",
        "title": "Daniel Reed — Backend Developer",
        "description": "Departing backend developer for the payments platform; owns settlement API and webhook-gateway.",
        "reasoning": None,
        "attributes": {
            "name": "Daniel Reed",
            "title": "Backend Developer",
            "responsibilities": ["settlement API", "webhook-gateway", "payments on-call"],
            "departing": True,
        },
        "evidence_status": EvidenceStatus.SUPPORTED,
        "review_state": ReviewState.PENDING,
        "evidence": [("offboarding-checklist.md", QUOTE_DANIEL_DEPARTS)],
        "subject": "daniel",
    },
    {
        "key": "gap_rate_limit_owner",
        "type": "gap",
        "title": "Gateway rate-limit owner not documented",
        "description": "api-gateway-notes.md flags that nobody owns the gateway rate-limit SLO — neither ops nor payments.",
        "reasoning": None,
        "attributes": {"area": "api-gateway", "detail": "ops or payments?"},
        "evidence_status": EvidenceStatus.MISSING,
        "review_state": ReviewState.PENDING,
        "evidence": [],
        "source": "api-gateway-notes.md",
    },
    {
        "key": "gap_vendor_renewal",
        "type": "gap",
        "title": "Vendor renewal date not documented",
        "description": "No document records when the payments vendor contract renews.",
        "reasoning": None,
        "attributes": {"area": "vendor", "detail": "renewal date unknown"},
        "evidence_status": EvidenceStatus.MISSING,
        "review_state": ReviewState.PENDING,
        "evidence": [],
        "source": "offboarding-checklist.md",
    },
    {
        "key": "question_retry_ownership",
        "type": "question",
        "title": "Who owns retry-worker after 2026-04-03?",
        "description": "The source documents disagree about retry-worker ownership ahead of the April handover.",
        "reasoning": None,
        "attributes": {"status": "open", "raised_by": "Alex Morgan", "raised_on": "2026-03-16"},
        "evidence_status": EvidenceStatus.SUPPORTED,
        "review_state": ReviewState.VERIFIED,
        "evidence": [("api-gateway-notes.md", QUOTE_RETRIES_PLATFORM)],
    },
    {
        "key": "contact_sarah",
        "type": "contact",
        "title": "Sarah Chen — backend on-call contact",
        "description": "Primary backend on-call and escalation point for the payments platform.",
        "reasoning": None,
        "attributes": {
            "name": "Sarah Chen",
            "role": "Backend Lead",
            "email": "sarah@northwind.dev",
            "channel": "PagerDuty payments-primary",
        },
        "evidence_status": EvidenceStatus.SUPPORTED,
        "review_state": ReviewState.VERIFIED,
        "evidence": [("auth-service-runbook.md", QUOTE_ONCALL)],
    },
]

RELATION_SPECS: list[tuple] = [
    ("decision_retry_sarah", "decision_retry_platform", "related_to", "Ownership claims disagree", EvidenceStatus.CONFLICTING),
    ("decision_retry_sarah", "contact_sarah", "decided_by", "Retry policy attributed to Sarah Chen", EvidenceStatus.SUPPORTED),
    ("decision_settlement_window", "person_daniel", "decided_by", "Batch window proposed by Daniel Reed", EvidenceStatus.SUPPORTED),
    ("task_pairing_sessions", "person_daniel", "assigned_to", "Pairing sessions assigned to Daniel", EvidenceStatus.SUPPORTED),
    ("task_confirm_retry_owner", "contact_sarah", "assigned_to", "Owner confirmation assigned to Sarah", EvidenceStatus.SUPPORTED),
    ("contact_sarah", "task_auth_rotation", "owns", "Sarah owns the auth-bff key rotation", EvidenceStatus.SUPPORTED),
    ("person_daniel", "task_gateway_migration", "owns", "Daniel owns the gateway migration", EvidenceStatus.SUPPORTED),
    ("person_daniel", "dep_webhook_ledger", "owns", "Daniel owns webhook-gateway", EvidenceStatus.SUPPORTED),
    ("decision_retry_sarah", "task_confirm_retry_owner", "blocks", "Conflicting claims block confirmation", EvidenceStatus.SUPPORTED),
    ("task_gateway_migration", "decision_settlement_window", "supports", "Go 1.24 migration supports the batch window", EvidenceStatus.SUPPORTED),
    ("risk_daniel_departure", "task_pairing_sessions", "supports", "Departure risk motivates pairing", EvidenceStatus.SUPPORTED),
    ("gap_rate_limit_owner", "task_confirm_retry_owner", "related_to", "Ownership questions tracked together", EvidenceStatus.SUPPORTED),
    ("decision_retry_platform", "decision_retry_sarah", "supersedes", "Gateway notes claim later ownership", EvidenceStatus.INFERRED),
    ("dep_retry_kafka", "risk_kafka_lag", "related_to", "Retry pipeline exposed to Kafka lag", EvidenceStatus.SUPPORTED),
]

HANDOVER_TITLE = "Backend ownership transfer — Daniel Reed → Maya Patel"
HANDOVER_ROLE = "Backend Developer (payments platform)"

HANDOVER_SECTIONS: list[dict] = [
    {
        "key": "overview",
        "title": "Overview",
        "body": (
            "Daniel Reed departs Northwind on 2026-04-03 after leading backend work on the "
            "payments platform. Maya Patel joins as his successor and will inherit the "
            "settlement API and webhook-gateway. This handover collects everything Alex "
            "Morgan needs signed off before the departure date. One open question remains "
            "honest and unresolved: the source documents disagree about who owns retry-worker.\n\n"
            "- Departure: 2026-04-03\n"
            "- Successor: Maya Patel\n"
            "- Approver: Alex Morgan"
        ),
    },
    {
        "key": "responsibilities",
        "title": "Responsibilities",
        "body": (
            "Daniel owns the settlement API and webhook-gateway, including their on-call "
            "rota and deployment pipelines. Sarah Chen owns auth-bff and retry-worker and "
            "carries the primary pager during EU hours. The two split the payments on-call "
            "rotation weekly, with Alex Morgan as the escalation point. Maya takes over "
            "Daniel's two services in April 2026 and shadows the rota from 2026-03-26.\n\n"
            "- Daniel: settlement API, webhook-gateway\n"
            "- Sarah: auth-bff, retry-worker\n"
            "- Escalation: Alex Morgan"
        ),
    },
    {
        "key": "decisions",
        "title": "Decisions",
        "body": (
            "The retry policy decision of 2026-01-14 assigns retries to Sarah Chen, but the "
            "gateway review notes of 2026-02-02 claim retry-worker belongs to the Platform "
            "team. Those two statements conflict and nobody has reconciled them yet; this "
            "handover records the conflict rather than picking a winner. The settlement batch "
            "window of 02:00–04:00 UTC and the UUIDv7 idempotency key format are "
            "uncontested. Alex Morgan makes the final call before Daniel leaves.\n\n"
            "- Conflicting: retry-worker ownership\n"
            "- Settled: settlement window, idempotency keys"
        ),
    },
    {
        "key": "tasks",
        "title": "Tasks",
        "body": (
            "Three open tasks carry over: confirm the retry-worker owner, complete the "
            "auth-bff key rotation, and run the two pairing sessions with Maya Patel. The "
            "pairing sessions are booked for 2026-03-26 and 2026-03-30. The webhook-gateway "
            "Go 1.24 migration is done and needs no further work. Maya tracks all three open "
            "items in ProjectPulse during her first week.\n\n"
            "- Confirm retry-worker owner — Sarah Chen, due 2026-03-27\n"
            "- Auth-bff key rotation — Sarah Chen, due 2026-04-10\n"
            "- Pairing sessions — Daniel Reed, due 2026-03-30"
        ),
    },
    {
        "key": "risks",
        "title": "Risks",
        "body": (
            "The SEV2 of 2026-03-15 showed how quickly Kafka consumer lag can stall "
            "settlement projections for merchant dashboards. Losing Daniel on 2026-04-03 "
            "removes the only person who has debugged the settlement consumer under "
            "pressure. auth-bff currently has a single primary owner, which is a bus-factor "
            "risk if Sarah Chen is unavailable. The March retro actions must land before the "
            "departure.\n\n"
            "- SEV2 ledger lag: 41 minutes on 2026-03-15\n"
            "- Bus factor on auth-bff\n"
            "- Settlement consumer knowledge"
        ),
    },
    {
        "key": "systems",
        "title": "Systems",
        "body": (
            "The systems transferring to Maya are the settlement API and webhook-gateway. "
            "retry-worker and auth-bff stay with Sarah Chen, although the gateway notes "
            "dispute the retry-worker assignment. The gateway rate-limit owner is still an "
            "open gap — neither ops nor payments has claimed the SLO. Daniel keeps "
            "admin access until 2026-04-03 18:00 UTC.\n\n"
            "- Transfer: settlement API, webhook-gateway\n"
            "- Retained: auth-bff, retry-worker\n"
            "- Gap: gateway rate-limit owner"
        ),
    },
    {
        "key": "next_steps",
        "title": "Next steps",
        "body": (
            "Alex Morgan records the decision on retry-worker ownership before 2026-03-27 "
            "so the conflict does not travel with the handover. Sarah Chen confirms the "
            "retry-worker claim with the Platform team. Maya Patel completes both pairing "
            "sessions and signs the offboarding checklist. This handover moves to shared "
            "only after Alex approves it.\n\n"
            "- Review due: 2026-03-27\n"
            "- Departure: 2026-04-03\n"
            "- Sign-off: Alex Morgan, Maya Patel"
        ),
    },
]

HANDOVER_SUMMARY = (
    "Daniel Reed leaves Northwind on 2026-04-03, transferring the settlement API and "
    "webhook-gateway to Maya Patel. Three tasks and two ownership gaps remain open, "
    "including a conflict over whether Sarah Chen or the Platform team owns retry-worker. "
    "This handover needs Alex Morgan's approval before it can be shared with the successor."
)

HANDOVER_FINDINGS: list[dict] = [
    {
        "section_key": "overview",
        "label": "Daniel departs 2026-04-03",
        "content": "Daniel Reed's last day is 2026-04-03; Maya Patel takes over backend ownership.",
        "evidence_status": EvidenceStatus.SUPPORTED,
        "review_state": FindingReviewState.ACCEPTED,
        "item": "person_daniel",
        "evidence": [("team-and-ownership.md", "He is leaving Northwind on 2026-04-03 and spends March pairing with Maya Patel on both services.")],
    },
    {
        "section_key": "responsibilities",
        "label": "Settlement API owner",
        "content": "Daniel Reed owns the settlement API and its deployment pipeline.",
        "evidence_status": EvidenceStatus.SUPPORTED,
        "review_state": FindingReviewState.ACCEPTED,
        "item": None,
        "evidence": [("team-and-ownership.md", QUOTE_DANIEL_OWNS)],
    },
    {
        "section_key": "responsibilities",
        "label": "webhook-gateway owner",
        "content": "webhook-gateway transfers to Maya with GitHub ownership reassigned.",
        "evidence_status": EvidenceStatus.SUPPORTED,
        "review_state": FindingReviewState.PENDING,
        "item": "dep_webhook_ledger",
        "evidence": [("offboarding-checklist.md", QUOTE_GITHUB_TRANSFER)],
    },
    {
        "section_key": "decisions",
        "label": "Retry-worker ownership conflict",
        "content": "payment-flow.md assigns retries to Sarah Chen; api-gateway-notes.md claims the Platform team owns retry-worker.",
        "evidence_status": EvidenceStatus.CONFLICTING,
        "review_state": FindingReviewState.PENDING,
        "item": "decision_retry_sarah",
        "reviewer_note": "Two source documents disagree — reconcile before approval.",
        "evidence": [("payment-flow.md", QUOTE_RETRIES_SARAH), ("api-gateway-notes.md", QUOTE_RETRIES_PLATFORM)],
    },
    {
        "section_key": "tasks",
        "label": "Auth-bff key rotation open",
        "content": "The signing-key rotation is still open and owned by Sarah Chen.",
        "evidence_status": EvidenceStatus.SUPPORTED,
        "review_state": FindingReviewState.PENDING,
        "item": "task_auth_rotation",
        "evidence": [("auth-service-runbook.md", QUOTE_KEY_ROTATION)],
    },
    {
        "section_key": "risks",
        "label": "SEV2 ledger lag 2026-03-15",
        "content": "A Kafka consumer lag delayed settlement projections by 41 minutes.",
        "evidence_status": EvidenceStatus.SUPPORTED,
        "review_state": FindingReviewState.PENDING,
        "item": "risk_kafka_lag",
        "evidence": [("incident-2026-03-15.md", QUOTE_SEV2)],
    },
    {
        "section_key": "systems",
        "label": "Services transferring to Maya",
        "content": "Inferred from the pairing schedule: Maya is being ramped on the settlement API and webhook-gateway, though no document states the transfer is complete.",
        "evidence_status": EvidenceStatus.INFERRED,
        "review_state": FindingReviewState.PENDING,
        "item": None,
        "evidence": [("team-and-ownership.md", QUOTE_MAYA_INHERITS)],
    },
    {
        "section_key": "systems",
        "label": "Gateway rate-limit owner unclear",
        "content": "Nobody owns the gateway rate-limit SLO — ops and payments both point at each other.",
        "evidence_status": EvidenceStatus.MISSING,
        "review_state": FindingReviewState.PENDING,
        "item": "gap_rate_limit_owner",
        "evidence": [],
    },
    {
        "section_key": "next_steps",
        "label": "Sarah carries payments on-call",
        "content": "Sarah Chen keeps the primary payments pager through the transition.",
        "evidence_status": EvidenceStatus.SUPPORTED,
        "review_state": FindingReviewState.PENDING,
        "item": "contact_sarah",
        "evidence": [("team-and-ownership.md", QUOTE_PAGER)],
    },
]

ASSISTANT_ANSWER = (
    "Start with the settlement API: Daniel Reed owns it end to end and it runs the nightly "
    "batch between 02:00 and 04:00 UTC. Next, pick up webhook-gateway, since its deployments "
    "and on-call rota transfer together with the settlement API. Before you go further, "
    "confirm who really owns retry-worker — payment-flow.md says Sarah Chen per the "
    "2026-01-14 decision, while api-gateway-notes.md claims the Platform team. Also chase the "
    "open gap on gateway rate-limit ownership; nobody has claimed that SLO yet. Your handover "
    "deadline is Daniel's last day on 2026-04-03."
)


def _normalize_ws(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def _quote_hash(quote: str) -> str:
    return hashlib.sha1(quote.encode("utf-8")).hexdigest()[:40]


def _headings(text: str) -> list[tuple[int, str]]:
    found: list[tuple[int, str]] = []
    offset = 0
    for line in text.split("\n"):
        match = re.match(r"^#{1,6}\s+(.+)$", line.strip())
        if match:
            found.append((offset, match.group(1).strip()[:255]))
        offset += len(line) + 1
    return found


def _paragraph_blocks(text: str) -> list[tuple[int, int]]:
    spans: list[tuple[int, int]] = []
    start = 0
    for match in re.finditer(r"\n[ \t]*\n", text):
        if match.start() > start:
            spans.append((start, match.start()))
        start = match.end()
    if start < len(text):
        spans.append((start, len(text)))

    trimmed: list[tuple[int, int]] = []
    for lo, hi in spans:
        body = text[lo:hi]
        left = len(body) - len(body.lstrip())
        right = len(body) - len(body.rstrip())
        s, e = lo + left, hi - right
        if s < e and text[s:e].strip():
            trimmed.append((s, e))

    merged: list[tuple[int, int]] = []
    i = 0
    while i < len(trimmed):
        s, e = trimmed[i]
        lines = [ln for ln in text[s:e].split("\n") if ln.strip()]
        heading_only = bool(lines) and all(ln.lstrip().startswith("#") for ln in lines)
        if heading_only and i + 1 < len(trimmed):
            merged.append((s, trimmed[i + 1][1]))
            i += 2
        else:
            merged.append((s, e))
            i += 1
    return merged


def _hard_split(text: str, start: int, end: int) -> list[tuple[int, int]]:
    pieces: list[tuple[int, int]] = []
    while end - start > CHUNK_TARGET:
        window = text[start : start + CHUNK_TARGET]
        cut = max(window.rfind(" "), window.rfind("\n"))
        cut = cut + 1 if cut > 0 else CHUNK_TARGET
        pieces.append((start, start + cut))
        start += cut
    if start < end:
        pieces.append((start, end))
    return pieces


def _split(text: str) -> list[dict]:
    """Split markdown into section-aware chunks (~900 char target) with exact offsets."""
    blocks = _paragraph_blocks(text)
    raw_chunks: list[tuple[int, int]] = []
    current: tuple[int, int] | None = None
    for s, e in blocks:
        if current is None:
            current = (s, e)
            continue
        first_line = text[s:e].split("\n", 1)[0].lstrip()
        if first_line.startswith("#") or e - current[0] > CHUNK_TARGET:
            raw_chunks.append(current)
            current = (s, e)
        else:
            current = (current[0], e)
    if current is not None:
        raw_chunks.append(current)

    pieces: list[tuple[int, int]] = []
    for s, e in raw_chunks:
        pieces.extend(_hard_split(text, s, e))

    headings = _headings(text)
    chunks: list[dict] = []
    for s, e in pieces:
        section = None
        for hoff, title in headings:
            if hoff <= s:
                section = title
            else:
                break
        chunks.append(
            {
                "text": text[s:e],
                "section": section,
                "char_start": s,
                "char_end": e,
            }
        )
    return chunks


def _unique_slug(db: Session, name: str) -> str:
    base = "".join(c.lower() if c.isalnum() else "-" for c in name.strip())
    while "--" in base:
        base = base.replace("--", "-")
    base = base.strip("-") or "workspace"
    slug = base
    n = 2
    while db.scalar(select(Workspace.id).where(Workspace.slug == slug)) is not None:
        slug = f"{base}-{n}"
        n += 1
    return slug


def _get_or_create_user(db: Session, spec: dict) -> User:
    user = db.scalar(select(User).where(func.lower(User.email) == spec["email"]))
    if user is None:
        user = User(
            id=uuid.uuid4(),
            email=spec["email"],
            name=spec["name"],
            password_hash=hash_password(DEMO_PASSWORD),
            title=spec["title"],
            is_active=True,
        )
        db.add(user)
        db.flush()
        return user
    user.name = spec["name"]
    user.title = spec["title"]
    user.password_hash = hash_password(DEMO_PASSWORD)
    user.is_active = True
    db.flush()
    return user


class _ChunkIndex:
    """Locates exact evidence quotes inside the seeded document chunks."""

    def __init__(self) -> None:
        self._by_doc: dict[str, list[tuple[EvidenceChunk, str, Document]]] = {}

    def add(self, document: Document, chunk: EvidenceChunk) -> None:
        self._by_doc.setdefault(document.original_name, []).append(
            (chunk, _normalize_ws(chunk.text), document)
        )

    def find(self, doc_name: str, quote: str) -> tuple[EvidenceChunk, Document]:
        target = _normalize_ws(quote)
        for chunk, norm, document in self._by_doc.get(doc_name, []):
            if target in norm:
                return chunk, document
        raise LookupError(f"Quote not found in '{doc_name}': {quote[:80]}")


def _counts(db: Session, workspace_id: uuid.UUID) -> dict:
    pids = list(db.scalars(select(Project.id).where(Project.workspace_id == workspace_id)).all())

    def _count(stmt) -> int:
        return db.scalar(select(func.count()).select_from(stmt.subquery())) or 0

    handover_ids = select(Handover.id).where(Handover.project_id.in_(pids)) if pids else None
    conversation_ids = (
        select(Conversation.id).where(Conversation.project_id.in_(pids)) if pids else None
    )
    return {
        "users": _count(select(WorkspaceMember.id).where(WorkspaceMember.workspace_id == workspace_id)),
        "documents": _count(select(Document.id).where(Document.project_id.in_(pids))),
        "chunks": _count(select(EvidenceChunk.id).where(EvidenceChunk.project_id.in_(pids))),
        "knowledge": _count(select(KnowledgeItem.id).where(KnowledgeItem.project_id.in_(pids))),
        "relationships": _count(
            select(KnowledgeRelationship.id).where(KnowledgeRelationship.project_id.in_(pids))
        ),
        "handovers": _count(select(Handover.id).where(Handover.project_id.in_(pids))),
        "sections": _count(select(HandoverSection.id).where(HandoverSection.handover_id.in_(handover_ids)))
        if handover_ids is not None
        else 0,
        "findings": _count(select(HandoverFinding.id).where(HandoverFinding.handover_id.in_(handover_ids)))
        if handover_ids is not None
        else 0,
        "messages": _count(select(Message.id).where(Message.conversation_id.in_(conversation_ids)))
        if conversation_ids is not None
        else 0,
    }


def _zero_counts() -> dict:
    return {
        "users": 0,
        "documents": 0,
        "chunks": 0,
        "knowledge": 0,
        "relationships": 0,
        "handovers": 0,
        "sections": 0,
        "findings": 0,
        "messages": 0,
    }


def _logins(db: Session, project: Project | None) -> list[dict]:
    logins: list[dict] = []
    for spec in DEMO_USERS:
        role = spec["project_role"].value
        user = db.scalar(select(User).where(func.lower(User.email) == spec["email"]))
        if user is not None and project is not None:
            member = db.scalar(
                select(ProjectMember).where(
                    ProjectMember.project_id == project.id,
                    ProjectMember.user_id == user.id,
                )
            )
            if member is not None:
                role = member.role
        logins.append(
            {
                "email": spec["email"],
                "name": spec["name"],
                "project_role": role,
                "password": DEMO_PASSWORD,
            }
        )
    return logins


def _first_project(db: Session, workspace_id: uuid.UUID) -> Project | None:
    return db.scalar(
        select(Project).where(Project.workspace_id == workspace_id).order_by(Project.created_at)
    )


def _existing_result(db: Session, actor: User, workspace: Workspace) -> dict:
    project = _first_project(db, workspace.id)
    return {
        "seeded": True,
        "already": True,
        "workspace_id": str(workspace.id),
        "project_id": str(project.id) if project is not None else None,
        "logins": _logins(db, project),
        "counts": _counts(db, workspace.id),
    }


def _adopt(db: Session, actor: User, workspace: Workspace) -> dict:
    """Existing demo workspace: make sure the caller owns it, then report state."""
    member = get_workspace_member(db, actor.id, workspace.id)
    if member is None:
        db.add(
            WorkspaceMember(
                id=uuid.uuid4(),
                workspace_id=workspace.id,
                user_id=actor.id,
                role=WorkspaceRole.OWNER,
                status=MemberStatus.ACTIVE,
            )
        )
        audit.record(
            db,
            action=audit.A.WORKSPACE_MEMBER_ADD,
            actor_id=actor.id,
            actor_type="system",
            workspace_id=workspace.id,
            target_type="user",
            target_id=actor.id,
            summary=f"{actor.name} added as workspace owner",
        )
        db.commit()
    return _existing_result(db, actor, workspace)


async def seed_demo(db: Session, actor: User) -> dict:
    """Create the full Northwind demo workspace. Idempotent, one commit at the end."""
    existing = db.scalar(
        select(Workspace).where(Workspace.name == WORKSPACE_NAME).order_by(Workspace.created_at)
    )
    if existing is not None:
        return _adopt(db, actor, existing)

    try:
        return await _seed_fresh(db, actor)
    except IntegrityError:
        db.rollback()
        recovered = db.scalar(
            select(Workspace).where(Workspace.name == WORKSPACE_NAME).order_by(Workspace.created_at)
        )
        if recovered is None:
            raise
        return _adopt(db, actor, recovered)


async def _seed_fresh(db: Session, actor: User) -> dict:
    users: dict[str, User] = {"actor": actor}
    for spec in DEMO_USERS:
        users[spec["key"]] = _get_or_create_user(db, spec)
    db.flush()

    workspace = Workspace(
        id=uuid.uuid4(),
        name=WORKSPACE_NAME,
        description=WORKSPACE_DESC,
        owner_id=actor.id,
        slug=_unique_slug(db, WORKSPACE_NAME),
    )
    db.add(workspace)
    db.flush()
    audit.record(
        db,
        action=audit.A.WORKSPACE_CREATE,
        actor_id=actor.id,
        workspace_id=workspace.id,
        target_type="workspace",
        target_id=workspace.id,
        summary=f"Workspace '{WORKSPACE_NAME}' created",
        meta={"demo": True},
    )

    ws_members = [
        (actor, WorkspaceRole.OWNER),
        (users["alex"], WorkspaceRole.LEAD),
        (users["sarah"], WorkspaceRole.MEMBER),
        (users["daniel"], WorkspaceRole.MEMBER),
        (users["maya"], WorkspaceRole.SUCCESSOR),
    ]
    for user, role in ws_members:
        db.add(
            WorkspaceMember(
                id=uuid.uuid4(),
                workspace_id=workspace.id,
                user_id=user.id,
                role=role,
                status=MemberStatus.ACTIVE,
            )
        )
        audit.record(
            db,
            action=audit.A.WORKSPACE_MEMBER_ADD,
            actor_id=actor.id,
            actor_type="system",
            workspace_id=workspace.id,
            target_type="user",
            target_id=user.id,
            summary=f"{user.name} added to {WORKSPACE_NAME} as {role.value}",
        )
    db.flush()

    project = Project(
        id=uuid.uuid4(),
        workspace_id=workspace.id,
        name=PROJECT_NAME,
        description=PROJECT_DESC,
        owner_id=users["alex"].id,
        archived=False,
        tags=list(PROJECT_TAGS),
    )
    db.add(project)
    db.flush()
    audit.record(
        db,
        action=audit.A.PROJECT_CREATE,
        actor_id=users["alex"].id,
        workspace_id=workspace.id,
        project_id=project.id,
        target_type="project",
        target_id=project.id,
        summary=f"Project '{PROJECT_NAME}' created",
        meta={"tags": PROJECT_TAGS},
    )

    project_members = [
        (actor, ProjectRole.HEAD, "Workspace owner"),
        (users["alex"], ProjectRole.HEAD, "Project head"),
        (users["sarah"], ProjectRole.LEAD, "Backend lead — auth & retry services"),
        (users["daniel"], ProjectRole.MEMBER, "Backend developer — settlement APIs"),
        (users["maya"], ProjectRole.SUCCESSOR, "Successor — taking over backend ownership"),
    ]
    for user, role, responsibility in project_members:
        db.add(
            ProjectMember(
                id=uuid.uuid4(),
                project_id=project.id,
                user_id=user.id,
                role=role,
                status=MemberStatus.ACTIVE,
                responsibility=responsibility,
            )
        )
    db.flush()

    DEMO_DIR.mkdir(parents=True, exist_ok=True)
    storage_dir = get_settings().storage_path / str(project.id)
    storage_dir.mkdir(parents=True, exist_ok=True)

    index = _ChunkIndex()
    documents: dict[str, Document] = {}
    all_chunks: list[EvidenceChunk] = []
    texts: list[str] = []
    now = utcnow()

    for spec in DEMO_FILES:
        content = spec["content"]
        data = content.encode("utf-8")
        (DEMO_DIR / spec["name"]).write_bytes(data)

        stored_name = uuid.uuid4().hex + ".md"
        (storage_dir / stored_name).write_bytes(data)

        document = Document(
            id=uuid.uuid4(),
            project_id=project.id,
            uploaded_by=users[spec["uploader"]].id,
            filename=stored_name,
            original_name=spec["name"],
            kind=DocumentKind.MARKDOWN,
            size_bytes=len(data),
            content_hash=hashlib.sha256(data).hexdigest(),
            storage_path=f"{project.id}/{stored_name}",
            mime_type="text/markdown",
            status=DocumentStatus.COMPLETED,
            access_scope=spec["scope"],
            page_count=None,
            char_count=len(content),
            chunk_count=0,
            extracted_count=0,
            processed_at=now,
        )
        db.add(document)
        db.flush()
        documents[spec["name"]] = document

        drafts = _split(content)
        for seq, draft in enumerate(drafts):
            chunk = EvidenceChunk(
                id=uuid.uuid4(),
                project_id=project.id,
                document_id=document.id,
                seq=seq,
                text=draft["text"],
                page_number=None,
                section=draft["section"],
                char_start=draft["char_start"],
                char_end=draft["char_end"],
                source_type="document",
                access_scope=spec["scope"],
                meta={"filename": spec["name"]},
            )
            db.add(chunk)
            all_chunks.append(chunk)
            texts.append(draft["text"])
            index.add(document, chunk)

        document.chunk_count = len(drafts)

    vectors = await embed_texts(texts)
    if len(vectors) != len(all_chunks):
        raise RuntimeError("Embedding count does not match chunk count.")
    for chunk, vector in zip(all_chunks, vectors):
        chunk.embedding = vector
    db.flush()

    incident = documents["incident-2026-03-15.md"]
    db.execute(
        document_grants.insert().values(
            document_id=incident.id,
            user_id=users["sarah"].id,
            granted_by=actor.id,
        )
    )

    items: dict[str, KnowledgeItem] = {}
    for spec in KNOWLEDGE_SPECS:
        source_name = spec.get("source")
        if source_name is None and spec.get("evidence"):
            source_name = spec["evidence"][0][0]
        source_id = documents[source_name].id if source_name else None
        subject_id = None
        if spec.get("subject"):
            subject_id = users[spec["subject"]].id
        item = KnowledgeItem(
            id=uuid.uuid4(),
            project_id=project.id,
            type=spec["type"],
            title=spec["title"],
            description=spec["description"],
            reasoning=spec.get("reasoning"),
            attributes=spec["attributes"],
            evidence_status=spec["evidence_status"],
            review_state=spec["review_state"],
            access_scope=AccessScope.PROJECT,
            subject_user_id=subject_id,
            source_document_id=source_id,
            extraction_run=SEED_RUN,
            is_sample=True,
            reviewed_by=users["alex"].id if spec["review_state"] == ReviewState.VERIFIED else None,
            reviewed_at=now if spec["review_state"] == ReviewState.VERIFIED else None,
        )
        db.add(item)
        items[spec["key"]] = item
    db.flush()

    for spec in KNOWLEDGE_SPECS:
        item = items[spec["key"]]
        for doc_name, quote in spec["evidence"]:
            chunk, document = index.find(doc_name, quote)
            normalized = _normalize_ws(quote)
            db.add(
                KnowledgeEvidence(
                    id=uuid.uuid4(),
                    item_id=item.id,
                    chunk_id=chunk.id,
                    document_id=document.id,
                    quote=normalized,
                    quote_hash=_quote_hash(normalized),
                    page_number=None,
                    section=chunk.section,
                    confidence=item.evidence_status,
                )
            )

    extracted: dict[uuid.UUID, int] = {}
    for item in items.values():
        if item.source_document_id is not None:
            extracted[item.source_document_id] = extracted.get(item.source_document_id, 0) + 1
    for document_id, count in extracted.items():
        db.get(Document, document_id).extracted_count = count

    for src_key, dst_key, rel_type, label, status in RELATION_SPECS:
        db.add(
            KnowledgeRelationship(
                id=uuid.uuid4(),
                project_id=project.id,
                src_item_id=items[src_key].id,
                dst_item_id=items[dst_key].id,
                rel_type=rel_type,
                label=label,
                evidence_status=status,
                is_sample=True,
            )
        )
    db.flush()

    pending_items = sum(
        1 for spec in KNOWLEDGE_SPECS if spec["review_state"] == ReviewState.PENDING
    )
    open_tasks = sum(
        1
        for spec in KNOWLEDGE_SPECS
        if spec["type"] == "task" and spec["attributes"].get("status") == "open"
    )
    decisions = sum(1 for spec in KNOWLEDGE_SPECS if spec["type"] == "decision")
    gaps = sum(1 for spec in KNOWLEDGE_SPECS if spec["type"] == "gap")
    document_count = len(DEMO_FILES)

    handover = Handover(
        id=uuid.uuid4(),
        project_id=project.id,
        created_by=users["alex"].id,
        departing_user_id=users["daniel"].id,
        successor_user_id=users["maya"].id,
        role_transferred=HANDOVER_ROLE,
        title=HANDOVER_TITLE,
        status=HandoverStatus.NEEDS_REVIEW,
        version=1,
        scope={"categories": list(HANDOVER_CATEGORIES)},
        impact={
            "departing_user_id": str(users["daniel"].id),
            "open_tasks": open_tasks,
            "decisions": decisions,
            "owned_systems": 2,
            "documents_uploaded": document_count,
            "unresolved_items": pending_items,
            "gaps": gaps,
            "items": [
                {
                    "label": spec["title"][:120],
                    "type": spec["type"],
                    "status": spec["evidence_status"].value,
                }
                for spec in KNOWLEDGE_SPECS
            ],
        },
        generation_meta={"seed": True, "source": SEED_RUN},
        summary=HANDOVER_SUMMARY,
        approved_by=None,
        approved_at=None,
        shared_at=None,
    )
    db.add(handover)
    db.flush()

    for position, spec in enumerate(HANDOVER_SECTIONS):
        db.add(
            HandoverSection(
                id=uuid.uuid4(),
                handover_id=handover.id,
                key=spec["key"],
                title=spec["title"],
                body=spec["body"],
                position=position,
                meta={"seed": True},
            )
        )

    for position, spec in enumerate(HANDOVER_FINDINGS):
        evidence_refs = []
        for ev_position, (doc_name, quote) in enumerate(spec["evidence"]):
            chunk, document = index.find(doc_name, quote)
            evidence_refs.append(
                {
                    "document_id": str(document.id),
                    "document_name": document.original_name,
                    "chunk_id": str(chunk.id),
                    "quote": _normalize_ws(quote),
                    "page_number": None,
                    "section": chunk.section,
                    "label": spec["label"],
                    "position": ev_position,
                }
            )
        db.add(
            HandoverFinding(
                id=uuid.uuid4(),
                handover_id=handover.id,
                section_key=spec["section_key"],
                item_id=items[spec["item"]].id if spec.get("item") else None,
                label=spec["label"],
                content=spec["content"],
                evidence_status=spec["evidence_status"],
                review_state=spec["review_state"],
                evidence=evidence_refs,
                reviewer_note=spec.get("reviewer_note"),
                position=position,
            )
        )

    db.add(
        HandoverApproval(
            id=uuid.uuid4(),
            handover_id=handover.id,
            actor_id=users["alex"].id,
            action="submitted",
            note="Ready for review before Daniel's departure.",
        )
    )
    audit.record(
        db,
        action=audit.A.HANDOVER_SUBMIT,
        actor_id=users["alex"].id,
        workspace_id=workspace.id,
        project_id=project.id,
        target_type="handover",
        target_id=handover.id,
        summary=f"Submitted '{HANDOVER_TITLE}' for review",
        meta={"status": HandoverStatus.NEEDS_REVIEW},
    )

    conversation = Conversation(
        id=uuid.uuid4(),
        project_id=project.id,
        user_id=users["maya"].id,
        title="Getting ready for handover",
    )
    db.add(conversation)
    db.flush()

    user_message = Message(
        id=uuid.uuid4(),
        conversation_id=conversation.id,
        role="user",
        content="What do I take over from Daniel first?",
        meta={},
    )
    db.add(user_message)
    assistant_message = Message(
        id=uuid.uuid4(),
        conversation_id=conversation.id,
        role="assistant",
        content=ASSISTANT_ANSWER,
        meta={"demo": True},
    )
    db.add(assistant_message)
    db.flush()

    citation_chunk, citation_doc = index.find("team-and-ownership.md", QUOTE_DANIEL_OWNS)
    db.add(
        MessageCitation(
            id=uuid.uuid4(),
            message_id=assistant_message.id,
            chunk_id=citation_chunk.id,
            document_id=citation_doc.id,
            item_id=None,
            label="team-and-ownership.md",
            quote=_normalize_ws(QUOTE_DANIEL_OWNS),
            page_number=None,
            position=0,
        )
    )

    counts = _counts(db, workspace.id)
    audit.record(
        db,
        action=audit.A.DEMO_SEED,
        actor_id=actor.id,
        actor_type="system",
        workspace_id=workspace.id,
        project_id=project.id,
        target_type="workspace",
        target_id=workspace.id,
        summary=f"Seeded demo workspace '{WORKSPACE_NAME}'",
        meta=dict(counts),
    )

    db.commit()

    return {
        "seeded": True,
        "already": False,
        "workspace_id": str(workspace.id),
        "project_id": str(project.id),
        "logins": _logins(db, project),
        "counts": counts,
    }


def demo_status(db: Session, actor: User) -> dict:
    """Report whether the demo workspace exists and what it contains."""
    workspace = db.scalar(
        select(Workspace).where(Workspace.name == WORKSPACE_NAME).order_by(Workspace.created_at)
    )
    if workspace is None:
        return {
            "seeded": False,
            "workspace_id": None,
            "project_id": None,
            "logins": [],
            "counts": _zero_counts(),
        }
    project = _first_project(db, workspace.id)
    return {
        "seeded": True,
        "workspace_id": str(workspace.id),
        "project_id": str(project.id) if project is not None else None,
        "logins": _logins(db, project),
        "counts": _counts(db, workspace.id),
    }


def demo_accounts(db: Session) -> dict:
    """Public demo directory: fixed role accounts + whether data is loaded.

    No authentication required — these credentials are published on the login
    page by design (hackathon demo).
    """
    workspace = db.scalar(
        select(Workspace).where(Workspace.name == WORKSPACE_NAME).order_by(Workspace.created_at)
    )
    project = _first_project(db, workspace.id) if workspace is not None else None
    logins = _logins(db, project)
    if workspace is not None and project is not None:
        owner = db.scalar(
            select(User).where(func.lower(User.email) == DEMO_OWNER_EMAIL)
        )
        owner_member = (
            get_workspace_member(db, owner.id, workspace.id) if owner is not None else None
        )
        if owner is not None and owner_member is not None and owner_member.role == WorkspaceRole.OWNER:
            logins.insert(
                0,
                {
                    "email": owner.email,
                    "name": owner.name,
                    "project_role": ProjectRole.HEAD.value,
                    "password": DEMO_PASSWORD,
                },
            )
    return {
        "seeded": workspace is not None,
        "workspace_id": str(workspace.id) if workspace is not None else None,
        "project_id": str(project.id) if project is not None else None,
        "logins": logins,
    }


async def reset_demo(db: Session, actor: User, workspace_id: uuid.UUID) -> dict:
    """Delete the demo workspace. Refuses anything that is not the demo workspace."""
    workspace = db.get(Workspace, workspace_id)
    if workspace is None:
        raise NotFoundError("Workspace not found.")
    member = get_workspace_member(db, actor.id, workspace.id)
    if member is None or member.role != WorkspaceRole.OWNER:
        raise PermissionError_("Only the workspace owner can reset demo data.")
    if workspace.name != WORKSPACE_NAME:
        raise ValueError("Only the demo workspace can be reset.")

    deleted_counts = _counts(db, workspace.id)
    audit.record(
        db,
        action=audit.A.DEMO_RESET,
        actor_id=actor.id,
        actor_type="system",
        workspace_id=None,
        project_id=None,
        target_type="workspace",
        target_id=workspace.id,
        summary=f"Reset demo workspace '{workspace.name}'",
        meta={"deleted_counts": deleted_counts},
    )
    db.delete(workspace)
    db.commit()
    return {"ok": True, "deleted": deleted_counts}


__all__ = [
    "DEMO_DIR",
    "DEMO_OWNER_EMAIL",
    "DEMO_PASSWORD",
    "WORKSPACE_NAME",
    "demo_accounts",
    "demo_status",
    "reset_demo",
    "seed_demo",
]
