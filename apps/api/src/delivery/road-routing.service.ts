import { Injectable, ServiceUnavailableException } from "@nestjs/common";

export interface RoutePoint { readonly latitude: number; readonly longitude: number; }
export interface RoutingProvider {
  drivingMeters(origin: RoutePoint, destination: RoutePoint): Promise<number>;
}

/**
 * Road distances are returned only by our self-hosted loopback OSRM graph
 * (OpenStreetMap driving/car profile). Never a straight-line approximation.
 * Backend-exclusive URL; neither the customer app nor an order may override it.
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

  private loopbackBase(): string {
    const configured = process.env.OSRM_BASE_URL?.trim() || "http://127.0.0.1:5000";
    let parsed: URL;
    try { parsed = new URL(configured); }
    catch { throw new ServiceUnavailableException("ROUTE_UNAVAILABLE"); }
    // Reject external hosts, credentials, query, fragments and alternate paths:
    // OSRM must never become an SSRF/proxy endpoint or depend on paid APIs.
    if (parsed.protocol !== "http:" || parsed.hostname !== "127.0.0.1"
      || parsed.username || parsed.password || parsed.pathname !== "/"
      || parsed.search || parsed.hash || !/^[0-9]{1,5}$/.test(parsed.port)
      || Number(parsed.port) < 1 || Number(parsed.port) > 65535) {
      throw new ServiceUnavailableException("ROUTE_UNAVAILABLE");
    }
    return "http://127.0.0.1:" + parsed.port;
  }

  private async fetchRoadDistance(origin: RoutePoint, destination: RoutePoint): Promise<number> {
    const base = this.loopbackBase();
    const coord = (p: RoutePoint) => p.longitude.toFixed(7) + "," + p.latitude.toFixed(7);
    const path = "/route/v1/driving/" + coord(origin) + ";" + coord(destination);
    const url = base + path + "?overview=false&steps=false&alternatives=false";
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await fetch(url, {
          method: "GET", signal: AbortSignal.timeout(2500),
          headers: { Accept: "application/json" },
        });
        if (response.status === 429 || response.status >= 500) {
          if (attempt === 0) continue;
          break;
        }
        if (!response.ok) break;
        const body: unknown = await response.json();
        if (!body || typeof body !== "object" || !("code" in body)
          || (body as { code: unknown }).code !== "Ok") break;
        const responseBody = body as { routes?: unknown; waypoints?: unknown };
        const routes = responseBody.routes;
        const first = Array.isArray(routes) ? routes[0] as { distance?: unknown } | undefined : undefined;
        const meters = first?.distance;
        // Snap-to-road distance must also be plausible. Otherwise a point
        // outside the loaded extract might silently snap to a distant road.
        const pins = responseBody.waypoints;
        if (!Array.isArray(pins) || pins.length !== 2 || !pins.every((p: unknown) => {
          if (!p || typeof p !== "object" || !("distance" in p)) return false;
          const offset = (p as { distance: unknown }).distance;
          return typeof offset === "number" && Number.isFinite(offset) && offset >= 0 && offset <= 750;
        })) break;
        if (typeof meters === "number" && Number.isFinite(meters)
          && meters > 0 && meters < 500_000) {
          // OSRM returns floating-point metres; round UP before integer-VND fee calculation.
          return Math.ceil(meters);
        }
        break;
      } catch {
        // No external fallback. Timeouts/transport failures retry once, then 503.
        if (attempt === 0) continue;
      }
    }
    throw new ServiceUnavailableException("ROUTE_UNAVAILABLE");
  }
}
