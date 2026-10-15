import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { RoadRoutingService } = require("../dist/delivery/road-routing.service.js");
const { quoteDelivery } = require("../../../packages/shared/dist/delivery.js");
const a = { latitude: 10.772, longitude: 106.690 };
const b = { latitude: 10.775, longitude: 106.697 };
const policy = {
  versionId: "policy-osrm-1", acceptingOrders: true,
  baseMeters: 2000, baseFeeVnd: 10000,
  extraStepMeters: 1000, extraStepFeeVnd: 5000,
  maxRoadMeters: 8000, minSubtotalVnd: 80000, freeDeliveryAtSubtotalVnd: null,
};

async function mocked(provider, body) {
  const oldFetch = globalThis.fetch;
  const oldURL = process.env.OSRM_BASE_URL;
  process.env.OSRM_BASE_URL = "http://127.0.0.1:5000";
  const seen = [];
  globalThis.fetch = async (url, options) => {
    seen.push([String(url), options]);
    return provider ? provider(url, options) : {
      ok: true, status: 200,
      json: async () => body,
    };
  };
  try { return await (async () => ({
    result: await new RoadRoutingService().drivingMeters(a, b),
    seen,
  }))(); } finally {
    globalThis.fetch = oldFetch;
    if (oldURL === undefined) delete process.env.OSRM_BASE_URL;
    else process.env.OSRM_BASE_URL = oldURL;
  }
}
const good = distance => ({
  code: "Ok", routes: [{ distance }],
  waypoints: [{ distance: 15 }, { distance: 21 }],
});

test("OSRM real road metres, longitude-latitude order, GET only, ceil and fee policy", async () => {
  const { result, seen } = await mocked(null, good(2350.1));
  assert.equal(result, 2351);
  assert.equal(seen.length, 1);
  assert.equal(seen[0][0], "http://127.0.0.1:5000/route/v1/driving/106.6900000,10.7720000;106.6970000,10.7750000?overview=false&steps=false&alternatives=false");
  assert.equal(seen[0][1].method, "GET");
  assert.equal(quoteDelivery(100000, result, policy).feeVnd, 15000);
  assert.equal(quoteDelivery(100000, result, policy).routeDistanceMeters, 2351);
});

test("OSRM identical concurrent requests coalesce; cache returned road metres", async () => {
  const fetchBefore = globalThis.fetch;
  const oldURL = process.env.OSRM_BASE_URL;
  process.env.OSRM_BASE_URL = "http://127.0.0.1:5000";
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    await new Promise(resolve => setTimeout(resolve, 8));
    return { ok: true, status: 200, json: async () => good(4210.2) };
  };
  try {
    const routes = new RoadRoutingService();
    const measurements = await Promise.all([
      routes.drivingMeters(a, b), routes.drivingMeters(a, b),
      routes.drivingMeters(a, b),
    ]);
    assert.deepEqual(measurements, [4211, 4211, 4211]);
    assert.equal(await routes.drivingMeters(a, b), 4211);
    assert.equal(calls, 1);
    assert.equal(quoteDelivery(100000, measurements[0], policy).feeVnd, 25000);
  } finally {
    globalThis.fetch = fetchBefore;
    if (oldURL === undefined) delete process.env.OSRM_BASE_URL;
    else process.env.OSRM_BASE_URL = oldURL;
  }
});

test("NoRoute, far-away snap, zero/NaN, missing waypoints all fail closed", async () => {
  for (const response of [
    { code: "NoRoute", routes: [], waypoints: [] },
    { ...good(1000), waypoints: [{ distance: 751 }, { distance: 0 }] },
    { ...good(0) }, { ...good(-1) }, { ...good(Number.NaN) },
    { ...good(1500), waypoints: null }, { ...good(1000), routes: [] },
  ]) {
    const oldFetch = globalThis.fetch, original = process.env.OSRM_BASE_URL;
    process.env.OSRM_BASE_URL = "http://127.0.0.1:5000";
    globalThis.fetch = async () => ({
      ok: true, status: 200, json: async () => response,
    });
    try {
      await assert.rejects(new RoadRoutingService().drivingMeters(a, b),
        error => error.getStatus?.() === 503);
    } finally {
      globalThis.fetch = oldFetch;
      if (original === undefined) delete process.env.OSRM_BASE_URL;
      else process.env.OSRM_BASE_URL = original;
    }
  }
});

test("unavailable local OSRM / temporary 500 fails 503, never guesses flight distance", async () => {
  const old = globalThis.fetch, oldURL = process.env.OSRM_BASE_URL;
  process.env.OSRM_BASE_URL = "http://127.0.0.1:5000";
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw Error("ECONNREFUSED"); };
  try {
    await assert.rejects(new RoadRoutingService().drivingMeters(a, b),
      error => error.getStatus?.() === 503);
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = old;
    if (oldURL === undefined) delete process.env.OSRM_BASE_URL;
    else process.env.OSRM_BASE_URL = oldURL;
  }
});

test("OSRM configuration rejects internet URLs, DNS names, auth and redirects", async () => {
  const old = globalThis.fetch, oldURL = process.env.OSRM_BASE_URL;
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw Error("network must not be used"); };
  try {
    for (const value of [
      "https://127.0.0.1:5000", "http://localhost:5000",
      "http://169.254.169.254:80", "http://evil.example:5000",
      "http://127.0.0.1:5000/path", "http://127.0.0.1:5000/?x=1",
      "http://user:pass@127.0.0.1:5000", "invalid",
    ]) {
      process.env.OSRM_BASE_URL = value;
      await assert.rejects(new RoadRoutingService().drivingMeters(a, b),
        error => error.getStatus?.() === 503, value);
    }
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = old;
    if (oldURL === undefined) delete process.env.OSRM_BASE_URL;
    else process.env.OSRM_BASE_URL = oldURL;
  }
});

test("invalid GPS pin, out-of-range and excessive road metres rejected", async () => {
  const old = globalThis.fetch, oldURL = process.env.OSRM_BASE_URL;
  process.env.OSRM_BASE_URL = "http://127.0.0.1:5000";
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return { ok: true, status: 200, json: async () => good(8001) };
  };
  try {
    const svc = new RoadRoutingService();
    await assert.rejects(svc.drivingMeters({ latitude: 91, longitude: 106 }, b),
      error => error.getStatus?.() === 503);
    assert.equal(calls, 0);
    const out = await svc.drivingMeters(a, b);
    assert.equal(out, 8001);
    assert.throws(() => quoteDelivery(100000, out, policy), { code: "OUT_OF_RANGE" });
  } finally {
    globalThis.fetch = old;
    if (oldURL === undefined) delete process.env.OSRM_BASE_URL;
    else process.env.OSRM_BASE_URL = oldURL;
  }
});
