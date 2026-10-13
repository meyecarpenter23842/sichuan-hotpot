import React, { useEffect, useRef, useState } from "react";
import type * as Leaflet from "leaflet";
import "leaflet/dist/leaflet.css";
import type { AddressPinProps } from "./address-pin-types";
import { validPin } from "./address-pin-types";

/**
 * iPhone PWA map: tap or drag the pin. OSM is a small-traffic fallback;
 * tile provider is externally configurable for a production SLA.
 */
const tiles = process.env.EXPO_PUBLIC_MAP_TILE_URL
  || "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const attribution = process.env.EXPO_PUBLIC_MAP_ATTRIBUTION
  || '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const center = { latitude: 16, longitude: 106 };
const makePin = (L: typeof Leaflet) => L.divIcon({
  html: '<span aria-hidden="true" style="font-size:30px;text-shadow:0 2px 2px #fff">📍</span>',
  className: "hotpot-delivery-pin", iconSize: [32, 42], iconAnchor: [16, 36],
});
export function AddressPinMap({ latitude, longitude, onChange }: AddressPinProps) {
  const element = useRef<HTMLDivElement>(null);
  const instance = useRef<Leaflet.Map | null>(null);
  const marker = useRef<Leaflet.Marker | null>(null);
  const cb = useRef(onChange);
  const [mapError, setMapError] = useState("");
  cb.current = onChange;

  useEffect(() => {
    let disposed = false;
    let mountedMap: Leaflet.Map | null = null;
    async function install() {
      try {
        const L = await import("leaflet");
        if (!element.current || disposed) return;
        const valid = validPin(latitude, longitude);
        const lat = valid ? Number(latitude) : center.latitude;
        const lng = valid ? Number(longitude) : center.longitude;
        const map = L.map(element.current, { zoomControl: true, scrollWheelZoom: false })
          .setView([lat, lng], valid ? 17 : 6);
        mountedMap = map;
        instance.current = map;
        const tilesLayer = L.tileLayer(tiles, {
          maxZoom: 19, attribution, updateWhenIdle: true, keepBuffer: 0,
        }).addTo(map);
        tilesLayer.on("tileerror", () => setMapError("Không tải được nền bản đồ. Có thể nhập tọa độ thủ công."));
        const mapPin = L.marker([lat, lng], { draggable: true, icon: makePin(L) });
        if (valid) mapPin.addTo(map);
        marker.current = mapPin;
        const update = (newLat: number, newLng: number) => {
          if (!Number.isFinite(newLat) || !Number.isFinite(newLng)) return;
          mapPin.setLatLng([newLat, newLng]).addTo(map);
          cb.current(newLat.toFixed(7), newLng.toFixed(7));
        };
        map.on("click", event => update(event.latlng.lat, event.latlng.lng));
        mapPin.on("dragend", () => {
          const pos = mapPin.getLatLng();
          update(pos.lat, pos.lng);
        });
        window.requestAnimationFrame(() => { if (!disposed) map.invalidateSize(); });
      } catch {
        if (!disposed) setMapError("Bản đồ không tải được. Nhập tọa độ thủ công bên dưới.");
      }
    }
    void install();
    return () => {
      disposed = true;
      if (mountedMap) mountedMap.remove();
      instance.current = null;
      marker.current = null;
    };
    // First mount only; external GPS updates are handled by the next effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!validPin(latitude, longitude) || !instance.current || !marker.current) return;
    const lat = Number(latitude), lng = Number(longitude);
    marker.current.setLatLng([lat, lng]).addTo(instance.current);
    const center = instance.current.getCenter();
    if (Math.abs(center.lat - lat) > 0.003 || Math.abs(center.lng - lng) > 0.003) {
      instance.current.setView([lat, lng], 17);
    }
  }, [latitude, longitude]);

  return (
    <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 5 }}>
      <div ref={element} aria-label="Bản đồ ghim địa chỉ giao hàng" role="application"
        style={{ width: "100%", height: 248, borderRadius: 10, zIndex: 0, backgroundColor: "#F8F9FB" }} />
      <span style={{ color: "#667085", fontSize: 12 }}>Chạm bản đồ để đặt ghim, hoặc kéo ghim tới đúng số nhà.</span>
      {!!mapError && <span role="alert" style={{ color: "#B3262D", fontSize: 12 }}>{mapError}</span>}
    </div>
  );
}
