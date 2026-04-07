name: Onboard {{PROJECT_NAME}} To Postman

on:
  push:
    branches: [main]
    paths:
      - api-manifest.json
      - specs/**
      - scripts/onboard-to-postman.js
      - .github/workflows/onboard-to-postman.yml
  workflow_dispatch:

permissions:
  contents: read

jobs:
  onboard:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Onboard To Postman
        run: node scripts/onboard-to-postman.js
        env:
          POSTMAN_API_KEY: ${{ secrets.POSTMAN_API_KEY }}
          POSTMAN_ACCESS_TOKEN: ${{ secrets.POSTMAN_ACCESS_TOKEN }}
          POSTMAN_WORKSPACE_ID: ${{ vars.POSTMAN_WORKSPACE_ID }}
          DEFAULT_SERVICE_API_KEY: ${{ vars.DEFAULT_SERVICE_API_KEY }}
          DEFAULT_SERVICE_API_KEY_SECRET: ${{ secrets.DEFAULT_SERVICE_API_KEY }}
          DEFAULT_BASE_URL: ${{ vars.DEFAULT_BASE_URL }}
          POSTMAN_ENVIRONMENT_VALUES_JSON: ${{ vars.POSTMAN_ENVIRONMENT_VALUES_JSON }}
          POSTMAN_ENVIRONMENT_VALUES_JSON_SECRET: ${{ secrets.POSTMAN_ENVIRONMENT_VALUES_JSON }}
          POSTMAN_MONITOR_CRON: ${{ vars.POSTMAN_MONITOR_CRON }}
          POSTMAN_MONITOR_TIMEZONE: ${{ vars.POSTMAN_MONITOR_TIMEZONE }}
