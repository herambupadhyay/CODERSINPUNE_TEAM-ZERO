# Payments Platform — Architecture Overview

The Northwind payments platform runs four production services on Kubernetes in eu-west-1: ledger-api, retry-worker, webhook-gateway and auth-bff. All services are written in Go 1.24 and store state in PostgreSQL 16; asynchronous work flows through Kafka topics payments.captured, payments.settled and ledger.entries.

## Request path

A card transaction enters through webhook-gateway, which validates the merchant signature and forwards the authorize request to ledger-api. ledger-api writes the double-entry rows in a single transaction and emits ledger.entries for the settlement consumer. auth-bff issues short-lived JWTs for internal callers and never touches card data.

## Async path

retry-worker consumes payments.captured with a bounded retry policy and pushes failed captures back onto the outbox after five attempts. Settlement runs nightly between 02:00 and 04:00 UTC; Daniel Reed owns the settlement consumer and the webhook-gateway deployment.

## Operational notes

PostgreSQL is the source of truth; Kafka is transport only, so a replayed topic never changes balances. Every service exposes /healthz and /metrics to the shared Prometheus scrape configuration owned by the platform team.
