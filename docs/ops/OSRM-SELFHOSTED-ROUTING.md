# OpenStreetMap + private OSRM routing: safe deployment plan

**Decision:** No Google Routes API, no Google API key and no API-per-request routing charge. GPS is provided by the device via Expo Location. Customer Web/PWA uses Leaflet + OpenStreetMap tiles; Android Native uses a React Native draggable/tappable raster OSM tile view (no `react-native-maps` import). Quotes and orders use **self-hosted car-route metres from OSRM**, not great-circle distance.

## Measured live VPS capacity — 2026-10-15 (READ ONLY)

[Owner-only resource audit run #38735089585](https://github.com/meyecarpenter23842/sichuan-hotpot/actions/runs/38735089585):

| Metric | Measured |
| --- | --- |
| CPU / CPU architecture | 2 vCPU, x86_64 |
| Total RAM / available RAM | **954 MiB / 416 MiB** |
| Disk free under `/opt/sichuan-hotpot` | 37,336 MiB |
| NestJS API / PostgreSQL | Both ACTIVE |
| Docker / containerd | NOT_ACTIVE |
| OSRM loopback 5000 | FREE |
| Safe full-country preprocessing | **BLOCKED** |

**HARD BLOCK:** This VPS is *not* approved for OSRM alongside its running database and API. Do not enable Docker or try to preprocess even a city extract here without more memory. The provided deployment gate refuses starts with total RAM below **3 GiB** or available RAM below **2 GiB**, and refuses preprocessing when available RAM is below 2 GiB. Recommended upgrade **at least 4 GiB RAM**, keeping API/PostgreSQL headroom; alternatively use a separate small VPS for OSRM, with a private network and an explicitly reviewed backend connection change. No production OSRM deployment is authorized by this PR.

## Data and profile

- **Initial extract**: [BBBike Saigon PBF](https://download.bbbike.org/osm/bbbike/Saigon/Saigon.osm.pbf), about 14 MB on 2026-10-15. Not the >300 MB Vietnam-wide Geofabrik extract.
- OSM/BBBike data uses ODbL. Retain "© OpenStreetMap contributors" attribution in map UIs and evaluate ODbL share-alike obligations if distributing adapted databases.
- Preprocess for **driving (car.lua)** using **Contraction Hierarchies (CH)**; one consistent algorithm for x86_64 and ARM64. This computes connected **road graph distance** and accounts for one-ways, road restrictions etc. Accuracy depends on completeness/freshness of OSM; no live traffic calculation.
- **Limited coverage:** Saigon city extract does not guarantee all outer districts, suburbs, future branches or cross-border routes. OSRM returns NoRoute or an out-of-coverage/oversnapped waypoint; backend explicitly refuses a quote instead of extrapolating or using bird-flight distance. Reassess the extract from each branch's delivery radius and expand data when approved.
- Refresh graph from an up-to-date PBF in a separate, measured maintenance window, with rollback. No automatic dataset refresh or hidden Google fallback.

## Backend integration contract

- `RoadRoutingService` requests `GET /route/v1/driving/{longitude,latitude};{longitude,latitude}?overview=false&steps=false&alternatives=false` from `http://127.0.0.1:5000` by default.
- Optional `OSRM_BASE_URL` is **loopback-only HTTP**, validated to prevent SSRF. OSRM port is bound **only** to `127.0.0.1`, not public Nginx/Internet. Neither app sends its own URL, distance or fee.
- Accept only `code=Ok`, a positive finite numeric `routes[0].distance`, and two snapped waypoints each within **750 metres** of requested pins. Round route metres **up** to integer; invalid/outage/NoRoute/remote snap raises `ROUTE_UNAVAILABLE` (HTTP 503).
- Shared `quoteDelivery` then applies the *existing* persisted `DeliveryPolicyVersion`, min subtotal, base km, steps, max km and free-delivery threshold, using integer VND. If route exceeds configured maximum, `OUT_OF_RANGE` (422); 0đ shipping only if expressly enabled by store policy.
- Checkout still re-quotes from backend, stores route metres and original fee/policy version, ensures idempotency and leaves prior orders unchanged.
- GPS, existing customer address CRUD, COD/QR and branch controls are unchanged.

## Deployment when VPS capacity is sufficient (NOT performed)

**Prerequisites:** owner explicitly requests a production OSRM rollout; independently verify updated VPS memory/CPU/disk via `/audit-hotpot-osrm-capacity` on Issue #3; ensure `OSRM_CAPACITY=PASS`, appropriate Docker installation is reviewed, and an OSM extract covers the actual branch delivery zone. Confirm network and package supply-chain policy before installing Docker.

1. Stage the reviewed files from the exact green `main` commit (via secure deployment mechanism); do not add OSRM files inside the API release archive.
2. Create a dedicated `/opt/sichuan-hotpot/osrm` directory. For a safe city-size extract only, run `infra/osrm/prepare-saigon-graph.sh --approved-city-preprocess`. It enforces RAM/disk headroom, caps CPU/RAM for processing, downloads **only** the selected bounded city extract via HTTPS, runs `osrm-extract` with car.lua and `osrm-contract`. Alternatively preprocess off-host and verify the dataset/hash before transferring to avoid contention.
3. Manually invoke `infra/osrm/start-approved.sh --approved-start`. It first runs the hard `preflight.sh` gate, starts **only** the OSRM sidecar from `infra/osrm/compose.yml` (read-only data, 768 MiB RAM cap, 0.75 CPU quota, dropped Linux capabilities, loopback port), and tests a route. A failed route stops only OSRM.
4. Verify `/health/live` and `/health/ready`, PostgreSQL, and `127.0.0.1:5000` reachable exclusively on VPS. Verify real route geometry/distance to a store-approved sample pin, and compare fee against admin policy. **Do not run production orders for tests without owner permission.**
5. Only after API/code CI green and safe OSRM sample PASS may a separately owner-approved API release be triggered. Never treat PR merge as deploy; no DB migration needed to switch providers.
6. Capture tests at 320/360/390/428 mobile, Android native OSM GPS/pin, iPhone PWA pin, invalid GPS, outside coverage, provider timeout, failed road quote, min spend, over-max distance, closed store and concurrent checkout.
7. Roll back OSRM with `docker compose -f infra/osrm/compose.yml down` only; API/DB stay untouched. Server must fail closed on new quotes if OSRM is down.

**No Google key is required.** The old protected workflow `/configure-hotpot-services` is now for **R2 upload credentials only**, independent of routing. R2 image ticket 503 remains a separate outstanding production incident until valid R2 credentials exist.
