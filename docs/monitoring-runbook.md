# AgroLink monitoring runbook

## Current environment

AgroLink is currently running locally.

Production Railway healthchecks, external uptime monitoring,
resource alerts, and deployment alerts will be configured
when the app is ready for deployment.

## Local health endpoints

### Liveness

```text
GET https://localhost:3443/healthz