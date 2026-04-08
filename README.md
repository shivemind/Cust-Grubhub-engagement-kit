# Cust-Grubhub-engagement-kit

A food-delivery themed API service built to demonstrate **Postman v12 Enterprise** capabilities to GrubHub.

## Application Flow

```mermaid
flowchart TD
    subgraph spec [Source of Truth]
        A1["OpenAPI Spec (grubhub-partner-api.yaml)"]
    end

    subgraph postman [Postman v12 Workspace]
        B1[Spec Hub]
        B2[Generated Collection]
        B3[Environment]
    end

    subgraph api [Express API - localhost:3000]
        C1[Restaurants]
        C2[Menus]
        C3[Orders]
        C4[Delivery Tracking]
        C5[Health]
    end

    subgraph ci [GitHub Actions CI]
        D1[Postman CLI Tests]
        D2[OpenAPI Lint]
        D3[Spec Validation]
    end

    subgraph ui [Demo Web UI]
        E1[Teleprompter]
        E2[API Explorer]
        E3[Slides]
    end

    A1 -->|Git Sync v12| B1
    B1 --> B2
    B1 --> B3
    A1 -->|Push to main| ci
    D1 --> C1 & C2 & C3 & C4 & C5
    ui --> api
```

## Git Sync Workflow

```mermaid
sequenceDiagram
    participant Dev as Developer
    participant GH as GitHub
    participant PM as Postman v12
    participant CI as GitHub Actions

    Dev->>GH: Push spec changes to main
    GH->>PM: Git Sync updates Spec Hub
    PM->>PM: Regenerate collection from spec
    GH->>CI: Trigger CI pipeline
    CI->>CI: Start Express server
    CI->>CI: Run Postman CLI tests
    CI->>CI: Lint OpenAPI spec
    CI-->>Dev: Pass / Fail report
```

## Quick Start

```bash
npm install
npm start
```

The API and demo web UI are available at **http://localhost:3000**.

## Setup

```mermaid
flowchart LR
    A[npm install] --> B[npm start]
    B --> C["API + UI at localhost:3000"]
    C --> D[Configure Postman Git Sync]
    D --> E[Set GitHub Secrets for CI]
```

### Connecting Git Sync (Postman v12)

1. Create or open the Postman workspace you want to use for this repo
2. Import or generate the API assets from `spec/grubhub-partner-api.yaml`
3. Go to the **Source Control** tab in Postman
4. Click **Connect to Git Repository**
5. Select **GitHub** and authorize Postman if prompted
6. Choose this repository and set branch to `main`
7. Set the spec file path to `spec/grubhub-partner-api.yaml`
8. Click **Connect**

`.postman/resources.yaml` intentionally ships without a workspace ID so the repo does not point at any internal Postman workspace by default.

### GitHub Actions CI

Add these GitHub secrets/variables to enable CI:

| Type | Name | Value |
|---|---|---|
| Secret | `POSTMAN_API_KEY` | Your Postman API key |
| Variable | `POSTMAN_WORKSPACE_ID` | Workspace ID to use for the root repo onboarding workflow |
| Variable | `POSTMAN_COLLECTION_ID` | Optional collection UID to run in CI |
| Variable | `POSTMAN_ENVIRONMENT_ID` | Optional environment UID paired with `POSTMAN_COLLECTION_ID` |

### API Builder Export Workflow

This repo now includes `.github/workflows/export-api-builder-services.yml` for the repo-per-service flow:

1. Export a YAML spec from Postman API Builder using `source.api_id`, `source.schema_id`, and `source.schema_file_path`
2. Scaffold a dedicated GitHub repo for that service
3. Push the service YAML and onboarding files into the new repo
4. Let the target repo call `postman-cs/postman-api-onboarding-action@v0`, which chains `postman-cs/postman-bootstrap-action` and `postman-cs/postman-repo-sync-action`
5. Auto-discover the team's system environments through Bifrost, then link the generated Postman workspace environments to those system environments
6. Require the generated repo to link its dedicated Spec Hub workspace back to the repo through Bifrost so the API Catalog path is actually in place

Fill `config/api-builder-services.json` with the source API Builder IDs, schema file paths, target repo names, and the dedicated Postman workspace ID for each generated repo. The `postman` block can also carry Bifrost/API Catalog settings such as `integration_backend`, `require_api_catalog_link`, `require_system_env_association`, `governance_mapping`, `system_env_map`, `requester_email`, `workspace_admin_user_ids`, `team_id`, `workspace_team_id`, and `org_mode`, with optional service-level overrides under each service's own `postman` block. The source workflow now fails fast if the config tries to map multiple services to the same repo or workspace, and generated repo onboarding runs are serialized per repo so overlapping reruns cannot provision duplicate workspace assets. Generated repos keep the exported YAML in Git, then serve that checked-in spec from a temporary local HTTPS endpoint during CI so the shared Postman CS onboarding action can ingest it into Spec Hub without exposing a private repo raw URL. After the first successful onboarding run, the generated repo seeds repo variables and `.postman/resources.yaml` with the resolved Postman asset ids so later reruns stay pinned to the same workspace, spec, collections, environments, mock, monitor, team id, and system environment map. Generated repos default collection sync to `reuse` so the customer workspace stays on one baseline/smoke/contract set unless the repo explicitly opts into `refresh` or `version`. They also pass `integration-backend: bifrost` explicitly, auto-discover missing system environment ids from Bifrost using the team's access token, and fail the workflow if repo sync does not report a successful Bifrost workspace link or environment association for the generated workspace. A sample shape with placeholder values is included in `config/api-builder-services.example.json`.

For a standalone visual of this flow, see `PIPELINE_DIAGRAM.md`.

Required secrets for the export workflow:

| Type | Name | Value |
|---|---|---|
| Secret | `POSTMAN_API_KEY` | Postman API key used to export from API Builder and bootstrap Postman assets |
| Secret | `POSTMAN_ACCESS_TOKEN` | Postman access token required for Bifrost workspace linking, governance assignment, and environment association |
| Secret | `GH_REPO_ADMIN_TOKEN` | GitHub token that can create repos, set repo secrets, and push commits |

## API Endpoints

All endpoints are prefixed with `/api/v1` and require an `X-API-Key` header.

| Resource | Endpoints |
|----------|-----------|
| **Restaurants** | `GET /restaurants`, `GET /restaurants/:id`, `POST /restaurants`, `PUT /restaurants/:id`, `DELETE /restaurants/:id` |
| **Menus** | `GET /restaurants/:id/menu`, `POST /restaurants/:id/menu/items`, `PUT /menu/items/:id`, `DELETE /menu/items/:id` |
| **Orders** | `POST /orders`, `GET /orders/:id`, `GET /orders`, `PUT /orders/:id/status` |
| **Delivery** | `GET /deliveries/:orderId/tracking`, `PUT /deliveries/:orderId/assign`, `GET /deliveries/active` |
| **Health** | `GET /health` (no auth required) |

### Authentication

Include the header `X-API-Key: grubhub-demo-key-2026` with every request (except health).

## Demo Web UI

The UI at `http://localhost:3000` has three tabs:

- **Demo Script** — Teleprompter with auto-scroll for the presentation script
- **API Explorer** — Click-to-execute interface for all API endpoints
- **Slides** — GrubHub-branded presentation slides with keyboard navigation

## Project Structure

```
Cust-Grubhub-engagement-kit/
├── server.js                    # Express 5 entry point
├── spec/
│   └── grubhub-partner-api.yaml # OpenAPI 3.0 source of truth
├── api/
│   ├── routes/                  # restaurants, menus, orders, delivery
│   ├── middleware/apiKey.js      # X-API-Key auth
│   └── data/seed.js             # In-memory demo data
├── public/                      # Demo UI (HTML/CSS/JS)
├── scripts/
│   └── onboard-to-postman.js    # Workspace setup via Postman API
├── k8s/                         # Kubernetes deployment manifest
├── .github/workflows/           # CI pipeline
└── .postman/resources.yaml      # Optional local Postman workspace metadata
```
