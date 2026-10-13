import { Injectable, ServiceUnavailableException } from "@nestjs/common";

export interface RoutePoint { readonly latitude: number; readonly longitude: number; }
export interface RoutingProvider {
  drivingMeters(origin: RoutePoint, destination: RoutePoint): Promise<number>;
}

/**
 * Only the server talks to Google Routes. No browser API key, geodesic fallback,
 * or untrusted URL. Fail closed if the provider is not configured or errors.
 */
@Injectable()
export class RoadRoutingService implements RoutingProvider {
  private readonly cache = new Map<string, { distance: number; expires: number }>();
  private readonly inflight = new Map<string, Promise<number>>();
  private static readonly TTL_MS = 120_000;
  private static readonly MAX_CACHE = 500;

  async drivingMeters(origin: RoutePoint, destination: RoutePoint): Promise<number> {
    for (const point of [origin, destination]) {
      if (!Number.isFinite(point.latitude) || !Number.isFinite(point.longitude)
        || point.latitude < -90 || point.latitude > 90
        || point.longitude < -180 || point.longitude > 180) {
        throw new ServiceUnavailableException("ROUTE_UNAVAILABLE");
      }
    }
    const key = [origin, destination]
      .map(p => p.latitude.toFixed(7) + "," + p.longitude.toFixed(7)).join(">");
    const cached = this.cache.get(key);
    if (cached && cached.expires > Date.now()) return cached.distance;
    const pending = this.inflight.get(key);
    if (pending) return pending;
    const task = this.fetchRoadDistance(origin, destination).then(distance => {
      if (this.cache.size >= RoadRoutingService.MAX_CACHE) this.cache.clear();
      this.cache.set(key, { distance, expires: Date.now() + RoadRoutingService.TTL_MS });
      return distance;
    });
    this.inflight.set(key, task);
    try { return await task; } finally { this.inflight.delete(key); }
  }

  private async fetchRoadDistance(origin: RoutePoint, destination: RoutePoint): Promise<number> {
    const key = process.env.GOOGLE_ROUTES_API_KEY?.trim();
    if (!key) throw new ServiceUnavailableException("ROUTE_UNAVAILABLE");
    const waypoint = (point: RoutePoint) => ({
      location: { latLng: { latitude: point.latitude, longitude: point.longitude } },
    });
    const payload = JSON.stringify({
      origin: waypoint(origin), destination: waypoint(destination),
      travelMode: "DRIVE", routingPreference: "TRAFFIC_UNAWARE",
    });
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": key,
            "X-Goog-FieldMask": "routes.distanceMeters",
          },
          body: payload,
          signal: AbortSignal.timeout(4000),
        });
        if (response.status === 429 || response.status >= 500) {
          if (attempt === 0) continue;
          break;
        }
        if (!response.ok) break;
        const body: unknown = await response.json();
        const routes = body && typeof body === "object" && "routes" in body
          ? (body as { routes?: unknown }).routes : null;
        const first = Array.isArray(routes) ? routes[0] as { distanceMeters?: unknown } | undefined : null;
        const meters = first?.distanceMeters;
        if (typeof meters === "number" && Number.isSafeInteger(meters) && meters > 0) return meters;
        break;
      } catch {
        // Network/timeout faults are retried at most once. No API key or response logging.
        if (attempt === 0) continue;
      }
    }
    throw new ServiceUnavailableException("ROUTE_UNAVAILABLE");
  }
}
