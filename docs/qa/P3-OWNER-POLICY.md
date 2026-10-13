# P3.2 — versioned OWNER delivery policy (backend only)

New API routes, authenticated by a valid first-party JWT:
- GET /admin/branches/:branchId/delivery-policy — current policy or null
- POST /admin/branches/:branchId/delivery-policy — create an immutable new version

POST input (integer VND and meters, no floats):
{"acceptingOrders":true,"baseMeters":2000,"baseFeeVnd":10000,
"extraStepMeters":1000,"extraStepFeeVnd":5000,"maxRoadMeters":8000,
"minSubtotalVnd":80000,"freeDeliveryAtSubtotalVnd":null}

Only global OWNER is allowed. MANAGER and customers receive 403.
The backend verifies every policy amount and range. A SERIALIZABLE DB
transaction creates the next version, preserving historical versions used
by existing order snapshots. Conflicting concurrent edits return 409
instead of overwriting another version. This does not modify production
data or trigger a release.

Status: API unit tests covered by CI after PR creation. Admin app UI and
end-to-end owner live policy workflow are NOT TESTED and belong to P4.
