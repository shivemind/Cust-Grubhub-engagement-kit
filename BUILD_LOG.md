# Build Log: Cust-GRUBHUB-v12-demo

## Context
- AE / CSE: Daniel Shively (CSE)
- Customer technical lead: GrubHub — engineering / API platform team
- Sprint dates: TBD

## Hypothesis
- If we build a food-delivery-themed demo API with full Postman v12 integration (Git sync, governance, CLI tests), we will prove that Postman Enterprise can streamline GrubHub's API lifecycle from spec to production.

## Success Criteria
- OpenAPI spec drives Postman Spec Hub, collections, and CI pipeline end-to-end
- GitHub Actions run Postman CLI tests (API validation, OpenAPI lint) on every push
- Git sync (Postman v12) keeps workspace collections in sync with repo
- Demo UI (teleprompter + API explorer + slides) enables smooth live presentations

## Environment Baseline
- SCM: GitHub (postman-cs/Cust-GRUBHUB-v12-demo)
- CI/CD: GitHub Actions (.github/workflows/postman-tests.yml)
- Gateway: N/A (demo API runs standalone)
- Cloud: Node.js/Express, optional Kubernetes deployment (k8s/grubhub-deployment.yaml)
- Dev Portal: N/A
- Current Postman usage: Workspace with collection, environment, and spec linked via Git sync
- v11/v12: Postman v12 — Git sync, Spec Hub, Postman CLI

## What We Built
- Express 5 REST API: GrubHub Partner Restaurant API (restaurants, menus, orders, delivery, health)
- OpenAPI 3.0 spec (spec/grubhub-partner-api.yaml) as source of truth
- API key authentication middleware (X-API-Key header)
- In-memory seed data (Chicago-themed sample restaurants, menus, orders)
- Demo web UI with three tabs: teleprompter (demo script), API explorer (live HTTP calls), branded slides
- GitHub Actions CI: Postman CLI API tests + OpenAPI lint/validate
- Postman onboarding script (scripts/onboard-to-postman.js) for workspace setup via Postman API
- Kubernetes deployment manifest for in-cluster hosting
- Postman workspace config (.postman/resources.yaml) for Git-connected workflows

## Value Unlocked
- End-to-end demo of Postman v12 Git sync workflow for GrubHub audience
- Shows spec-first API development with automated governance
- Self-contained demo (API + UI + spec + CI) runs anywhere with npm start

## Reusable Pattern
- Branded demo API template (Express + OpenAPI + Postman CLI CI)
- Teleprompter + API explorer demo UI for live presentations
- Postman onboarding script for automated workspace/collection/env setup
- Kubernetes deployment pattern for demo APIs

## Product Gaps / Risks
- Demo data is in-memory only (resets on restart)
- API key is hardcoded default for demo purposes (grubhub-demo-key-2026)
- K8s deployment clones repo in init container (not a production pattern)

## Next Step
- Present Postman v12 Git sync demo to GrubHub engineering
- Identify pilot API for real Git sync + governance integration
- Evaluate Postman CLI adoption for GrubHub's existing CI/CD pipelines
