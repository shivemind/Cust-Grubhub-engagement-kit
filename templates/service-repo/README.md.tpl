# {{PROJECT_TITLE}}

This repo was scaffolded from a Postman API Builder export and is designed around one service per repo and one dedicated Postman workspace.

## What Lives Here

- `{{SPEC_PATH}}` is the Git source of truth for the service contract.
- `api-manifest.json` defines the repo metadata, runtime URLs, and Postman naming.
- `.postman/resources.yaml` can pin the dedicated Postman workspace id for this repo.
- `.github/workflows/onboard-to-postman.yml` provisions or refreshes the Postman workspace on every push to `main`.
- `scripts/onboard-to-postman.js` uploads the spec to Spec Hub, refreshes the full API collection, and creates a smoke-safe collection for monitors and CI runs.

## Required Secrets

- `POSTMAN_API_KEY` or `POSTMAN_ACCESS_TOKEN`

## Optional Repo Overrides

- `DEFAULT_SERVICE_API_KEY` can be set as a repo variable or secret to override the manifest's runtime auth value.
- `POSTMAN_ENVIRONMENT_VALUES_JSON` can be set as a repo variable or secret to merge customer-specific IDs or runtime values into the generated Postman environments without changing `api-manifest.json`.
- `DEFAULT_BASE_URL`, `POSTMAN_WORKSPACE_ID`, `POSTMAN_MONITOR_CRON`, and `POSTMAN_MONITOR_TIMEZONE` can be set as repo variables when needed.

## Collections

- The full collection mirrors the API spec for exploration and manual testing.
- The smoke collection keeps only read-only requests that are safe to run in customer environments by default, and the monitor targets that collection.

## Default Workspace

The onboarding workflow will reuse or create this workspace:

- `{{WORKSPACE_NAME}}`

## Repo Source

- `{{REPO_FULL_NAME}}`
