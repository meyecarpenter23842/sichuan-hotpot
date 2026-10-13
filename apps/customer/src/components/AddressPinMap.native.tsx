import React, { useEffect, useRef } from "react";
import { StyleSheet, Text, View } from "react-native";
import MapView, { Marker } from "react-native-maps";
import type { Region } from "react-native-maps";
import type { AddressPinProps } from "./address-pin-types";
import { validPin } from "./address-pin-types";

const overview: Region = {
  latitude: 16, longitude: 106, latitudeDelta: 7, longitudeDelta: 7,
};
export function AddressPinMap({ latitude, longitude, onChange }: AddressPinProps) {
  const map = useRef<MapView>(null);
  const hasPin = validPin(latitude, longitude);
  const pin = { latitude: Number(latitude), longitude: Number(longitude) };
  useEffect(() => {
    if (hasPin) map.current?.animateToRegion({
      latitude: pin.latitude, longitude: pin.longitude,
      latitudeDelta: 0.006, longitudeDelta: 0.006,
    }, 350);
  }, [hasPin, pin.latitude, pin.longitude]);
  const change = (lat: number, lng: number) => {
    if (Number.isFinite(lat) && Number.isFinite(lng))
      onChange(lat.toFixed(7), lng.toFixed(7));
  };
  return (
    <View style={styles.wrapper}>
      <MapView ref={map} style={styles.map}
        initialRegion={hasPin ? {
          latitude: pin.latitude, longitude: pin.longitude,
          latitudeDelta: 0.006, longitudeDelta: 0.006,
        } : overview}
        onPress={e => change(e.nativeEvent.coordinate.latitude, e.nativeEvent.coordinate.longitude)}>
        {hasPin && <Marker coordinate={pin} draggable title="Vị trí giao hàng"
          onDragEnd={e => change(e.nativeEvent.coordinate.latitude, e.nativeEvent.coordinate.longitude)} />}
      </MapView>
      <Text style={styles.helper}>Chạm bản đồ hoặc kéo ghim đến đúng vị trí giao hàng.</Text>
    </View>
  );
}
const styles = StyleSheet.create({
  wrapper: { gap: 5 },
  map: { width: "100%", height: 248, borderRadius: 10 },
  helper: { color: "#667085", fontSize: 12 },
});
