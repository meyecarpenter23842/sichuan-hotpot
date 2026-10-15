import React, { useEffect, useMemo, useRef, useState } from "react";
import { Image, PanResponder, Pressable, StyleSheet, Text, View } from "react-native";
import type { LayoutChangeEvent } from "react-native";
import type { AddressPinProps } from "./address-pin-types";
import { validPin } from "./address-pin-types";

// Platform-native OpenStreetMap raster tiles. No paid map SDK/API key,
// WebView or paid map services. A fixed pin anchors the delivery location.
const TILE = 256;
const HEIGHT = 248;
const minZoom = 5, maxZoom = 18;
const fallback = { latitude: 16, longitude: 106 };
type Pin = { latitude: number; longitude: number };
function limitLat(value: number): number {
  return Math.max(-85.05112878, Math.min(85.05112878, value));
}
function world(pin: Pin, zoom: number) {
  const dim = TILE * 2 ** zoom;
  const radians = limitLat(pin.latitude) * Math.PI / 180;
  return {
    x: (pin.longitude + 180) / 360 * dim,
    y: (1 - Math.log(Math.tan(radians) + 1 / Math.cos(radians)) / Math.PI) / 2 * dim,
  };
}
function coord(x: number, y: number, zoom: number): Pin {
  const dim = TILE * 2 ** zoom;
  const wrapped = ((x % dim) + dim) % dim;
  const bounded = Math.max(0, Math.min(dim, y));
  return {
    longitude: wrapped / dim * 360 - 180,
    latitude: Math.atan(Math.sinh(Math.PI * (1 - 2 * bounded / dim))) * 180 / Math.PI,
  };
}
export function AddressPinMap({ latitude, longitude, onChange }: AddressPinProps) {
  const hasPin = validPin(latitude, longitude);
  const [pin, setPin] = useState<Pin>(hasPin
    ? { latitude: Number(latitude), longitude: Number(longitude) } : fallback);
  const [zoom, setZoom] = useState(hasPin ? 17 : 6);
  const [width, setWidth] = useState(320);
  const [drag, setDrag] = useState({ dx: 0, dy: 0 });
  const [tilesFailed, setTilesFailed] = useState(false);
  const lastInternal = useRef<string | null>(null);
  const state = useRef({ pin, zoom, width, onChange });
  state.current = { pin, zoom, width, onChange };

  useEffect(() => {
    if (!validPin(latitude, longitude)) return;
    const next = { latitude: Number(latitude), longitude: Number(longitude) };
    setPin(next);
    const internallyChosen = lastInternal.current === latitude + "," + longitude;
    lastInternal.current = null;
    if (!internallyChosen) setZoom(17);
  }, [latitude, longitude]);

  const choose = (newPin: Pin) => {
    if (!Number.isFinite(newPin.latitude) || !Number.isFinite(newPin.longitude)) return;
    setPin(newPin);
    const latText = newPin.latitude.toFixed(7), lngText = newPin.longitude.toFixed(7);
    lastInternal.current = latText + "," + lngText;
    state.current.onChange(latText, lngText);
  };
  const gesture = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderMove: (_event, pan) => setDrag({ dx: pan.dx, dy: pan.dy }),
    onPanResponderRelease: (event, pan) => {
      const { pin: center, width: viewWidth, zoom: z } = state.current;
      const xy = world(center, z);
      // Drag map under fixed pin. Tapping the map moves the pin to that point.
      const tap = Math.abs(pan.dx) < 5 && Math.abs(pan.dy) < 5;
      const dx = tap ? (event.nativeEvent.locationX - viewWidth / 2) : -pan.dx;
      const dy = tap ? (event.nativeEvent.locationY - HEIGHT / 2) : -pan.dy;
      choose(coord(xy.x + dx, xy.y + dy, z));
      setDrag({ dx: 0, dy: 0 });
    },
    onPanResponderTerminate: () => setDrag({ dx: 0, dy: 0 }),
  // Ref always contains fresh callback, position and zoom.
  }), []);

  const center = world(pin, zoom);
  const x0 = Math.floor((center.x - width / 2 - TILE - drag.dx) / TILE);
  const x1 = Math.ceil((center.x + width / 2 + TILE - drag.dx) / TILE);
  const y0 = Math.floor((center.y - HEIGHT / 2 - TILE - drag.dy) / TILE);
  const y1 = Math.ceil((center.y + HEIGHT / 2 + TILE - drag.dy) / TILE);
  const count = 2 ** zoom;
  const tileViews: React.ReactElement[] = [];
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      if (y < 0 || y >= count) continue;
      const tileX = ((x % count) + count) % count;
      tileViews.push(
        <View pointerEvents="none" key={zoom + ":" + x + ":" + y}
          style={{ position: "absolute", width: TILE, height: TILE,
            left: x * TILE - center.x + width / 2 + drag.dx,
            top: y * TILE - center.y + HEIGHT / 2 + drag.dy }}>
          <Image source={{ uri: `https://tile.openstreetmap.org/${zoom}/${tileX}/${y}.png`, cache: "force-cache" }}
            onError={() => setTilesFailed(true)}
            onLoad={() => setTilesFailed(false)}
            style={{ width: TILE, height: TILE }} />
        </View>,
      );
    }
  }
  return (
    <View style={styles.wrapper}>
      <View style={styles.map} onLayout={(e: LayoutChangeEvent) =>
        setWidth(Math.max(1, e.nativeEvent.layout.width))}>
        <View style={StyleSheet.absoluteFill} {...gesture.panHandlers}>
          {tileViews}
        </View>
        <View pointerEvents="none" style={styles.pin}><Text style={styles.pinIcon}>📍</Text></View>
        <View style={styles.zoom}>
          <Pressable accessibilityRole="button" accessibilityLabel="Phóng to bản đồ"
            style={styles.zoomButton} onPress={() => setZoom(v => Math.min(maxZoom, v + 1))}>
            <Text style={styles.zoomText}>+</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Thu nhỏ bản đồ"
            style={styles.zoomButton} onPress={() => setZoom(v => Math.max(minZoom, v - 1))}>
            <Text style={styles.zoomText}>−</Text>
          </Pressable>
        </View>
        <View pointerEvents="none" style={styles.attribution}>
          <Text style={styles.attributionText}>© OpenStreetMap contributors</Text>
        </View>
      </View>
      <Text style={styles.helper}>Chạm hoặc kéo bản đồ để đặt ghim vào đúng vị trí giao hàng.</Text>
      {tilesFailed && <Text style={styles.error}>Không tải được nền bản đồ. Có thể nhập tọa độ thủ công.</Text>}
    </View>
  );
}
const styles = StyleSheet.create({
  wrapper: { gap: 5 },
  map: { width: "100%", height: HEIGHT, borderRadius: 10, overflow: "hidden", backgroundColor: "#EEF0F2" },
  pin: { position: "absolute", left: "50%", top: "50%", marginLeft: -15, marginTop: -37 },
  pinIcon: { fontSize: 32 },
  zoom: { position: "absolute", right: 8, top: 8, gap: 7 },
  zoomButton: { height: 42, width: 42, borderRadius: 8, justifyContent: "center", alignItems: "center",
    backgroundColor: "#FFFFFF", borderColor: "#D0D5DD", borderWidth: 1 },
  zoomText: { fontSize: 24, color: "#333333" },
  attribution: { position: "absolute", bottom: 2, right: 3, backgroundColor: "#FFFFFFDA", paddingHorizontal: 3 },
  attributionText: { fontSize: 9, color: "#334155" },
  helper: { color: "#667085", fontSize: 12 },
  error: { color: "#B3262D", fontSize: 12 },
});
