# P3 order tracking and delivery error UX

- Server only exposes an explicit allowlist of non-sensitive business error codes
  for 422 delivery/QR errors. Unexpected exceptions and validation payloads
  remain redacted; no stack, server path or secrets reach clients.
- Customer shows Vietnamese explanations for store-closed, below-minimum,
  outside-road-range, no route and QR not configured.
- OrdersScreen reads fresh own data from API every 20 seconds while the
  tab is visible/app active, plus on foreground and browser visibility resume.
  Stale detail responses are ignored if customer switches order during fetch.
  Unmount cleans both interval and visibility subscriptions. Manual refresh
  remains available and no push event is treated as an authoritative order state.
- This does not implement Admin status transitions (separate P4 scope).
- CI validates lint/typecheck, tests and browser export. Android emulator and
  iPhone Safari live reconnection tests: NOT TESTED.
