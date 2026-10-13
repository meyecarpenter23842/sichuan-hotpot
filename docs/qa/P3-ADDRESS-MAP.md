# P3 saved-address pin selection

Web (iPhone PWA): Leaflet interactive map with tap/drag pin, OSM attributed
tiles by default, optional production-provider XYZ template via
EXPO_PUBLIC_MAP_TILE_URL and EXPO_PUBLIC_MAP_ATTRIBUTION. No bulk prefetch,
no offline OSM tiles. OSM's public tile service is best-effort and cannot
be treated as production SLA; configure a contract-backed provider before
high-volume releases.

Android: react-native-maps 1.20.1, Google Maps in Expo Go. Standalone
Android needs GOOGLE_MAPS_ANDROID_KEY (restricted to package/certificate),
enabled Maps SDK for Android and billing. No API key is committed.

Both share coordinates in a single form. GPS only after permission; tap/drag
sets decimal coordinates. Any change to phone/street/GPS/pin clears the
selected saved-address ID; checkout requires saving/picking a real
account-owned address. Manual latitude/longitude fields remain for denied
GPS, missing map tiles and assistive use.

QA status: CI lint/TypeScript/PWA browser builds after PR; Android Maps
render, Safari on iPhone and GPS prompt still NOT TESTED on real devices.
