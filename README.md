# GrubHub Partner API — Postman v12 Demo

A food-delivery themed API service built to demonstrate Postman v12 Enterprise capabilities to GrubHub.

## Quick Start

```bash
npm install
npm start
```

The API and demo web UI are available at **http://localhost:3000**.

## What's Included

| Component | Description |
|---|---|
| **Express API** | REST endpoints for restaurants, menus, orders, and delivery tracking |
| **OpenAPI Spec** | Full YAML specification at `spec/grubhub-partner-api.yaml` |
| **Demo Web UI** | Teleprompter, API explorer, and presentation slides |
| **GitHub Actions** | CI pipeline running Postman CLI tests and governance checks |

## API Endpoints

All endpoints are prefixed with `/api/v1` and require an `X-API-Key` header.

### Restaurants
- `GET /api/v1/restaurants` — List partner restaurants
- `GET /api/v1/restaurants/:id` — Get restaurant details
- `POST /api/v1/restaurants` — Register new restaurant
- `PUT /api/v1/restaurants/:id` — Update restaurant
- `DELETE /api/v1/restaurants/:id` — Remove restaurant

### Menus
- `GET /api/v1/restaurants/:restaurantId/menu` — Get full menu
- `POST /api/v1/restaurants/:restaurantId/menu/items` — Add menu item
- `PUT /api/v1/menu/items/:itemId` — Update menu item
- `DELETE /api/v1/menu/items/:itemId` — Remove menu item

### Orders
- `POST /api/v1/orders` — Place an order
- `GET /api/v1/orders/:id` — Get order details
- `GET /api/v1/orders` — List orders (filterable by status, restaurant)
- `PUT /api/v1/orders/:id/status` — Update order status

### Delivery
- `GET /api/v1/deliveries/:orderId/tracking` — Live delivery tracking
- `PUT /api/v1/deliveries/:orderId/assign` — Assign a driver
- `GET /api/v1/deliveries/active` — List active deliveries

### Health
- `GET /api/v1/health` — Service health check

## Authentication

Include the header `X-API-Key: grubhub-demo-key-2026` with every request.
The health endpoint does not require authentication.

## Postman Workspace

| Asset | ID |
|---|---|
| Workspace | `549c9382-ffb6-4f79-b7b7-2354db906862` |
| Collection | `21b66ff0-513a-45ba-834f-9f759c1e36e5` |
| Environment | `7f0494fc-28d6-4cdf-9abb-ab7823eafeb3` |

The OpenAPI spec at `spec/grubhub-partner-api.yaml` is the source of truth.
Collections and environments in Postman are derived from this spec.

## Connecting Git Sync (Postman v12)

To enable Git sync so that pushes to `main` flow into the Postman workspace:

1. Open the **GrubHub V12 Demo** workspace in Postman
2. Click the collection **GrubHub Partner Restaurant API**
3. Go to the **Source Control** tab (branch icon in the right sidebar)
4. Click **Connect to Git Repository**
5. Select **GitHub** and authorize Postman if prompted
6. Choose repository: `danielshively-source/grubhub-v12-demo`
7. Set branch to `main`
8. Set the spec file path to `spec/grubhub-partner-api.yaml`
9. Click **Connect**

Once connected, any push to `main` will automatically sync the spec and collection into the Postman workspace.

## GitHub Actions CI/CD

The repo includes a CI pipeline at `.github/workflows/postman-tests.yml` that runs on every push to `main`:

- **API Tests**: Starts the server, checks health, runs Postman CLI collection tests
- **Governance**: Lints the OpenAPI spec and validates its structure

To enable Postman CLI integration in CI, add these GitHub secrets/variables:

| Type | Name | Value |
|---|---|---|
| Secret | `POSTMAN_API_KEY` | Your Postman API key |
| Variable | `POSTMAN_COLLECTION_ID` | `21b66ff0-513a-45ba-834f-9f759c1e36e5` |
| Variable | `POSTMAN_ENVIRONMENT_ID` | `7f0494fc-28d6-4cdf-9abb-ab7823eafeb3` |

## Demo Web UI

The UI at `http://localhost:3000` has three tabs:

- **Demo Script** — Teleprompter with auto-scroll for the presentation script
- **API Explorer** — Click-to-execute interface for all API endpoints
- **Slides** — Three GrubHub-branded presentation slides with keyboard navigation
