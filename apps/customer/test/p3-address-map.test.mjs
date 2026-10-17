import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const address = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
const web = readFileSync(new URL("../src/components/AddressPinMap.web.tsx", import.meta.url), "utf8");
const native = readFileSync(new URL("../src/components/AddressPinMap.native.tsx", import.meta.url), "utf8");
const customerPackage = readFileSync(new URL("../package.json", import.meta.url), "utf8");
const appConfig = readFileSync(new URL("../app.json", import.meta.url), "utf8");
const workspaceLock = readFileSync(new URL("../../../package-lock.json", import.meta.url), "utf8");
test("PWA and Android use real draggable pins with manual coordinate fallback", () => {
  assert.match(web, /L\.tileLayer/);
  assert.match(web, /map\.on\("click"/);
  assert.match(web, /mapPin\.on\("dragend"/);
  assert.match(native, /tile.openstreetmap.org/);
  assert.match(native, /PanResponder.create/);
  assert.match(native, /Chạm hoặc kéo bản đồ/);
  assert.doesNotMatch(native, /react-native-maps|Google Maps SDK/);
  assert.match(address, /<AddressPinMap latitude=\{address\.latitude\}/);
  assert.match(address, /Vĩ độ \(latitude\)/);
  assert.match(address, /Kinh độ \(longitude\)/);
});

test("Android OSM build cannot silently pull Google Maps SDK back in", () => {
  assert.doesNotMatch(customerPackage, /react-native-maps/);
  assert.doesNotMatch(workspaceLock, /node_modules\/react-native-maps/);
  assert.doesNotMatch(appConfig, /com\.google\.android\.geo\.API_KEY|googleMaps|mapsApiKey/i);
  assert.match(native, /tile\.openstreetmap\.org/);
  assert.doesNotMatch(native, /react-native-maps|Google Maps SDK/);
});

test("native tile failures are tracked per tile instead of being cleared by an unrelated tile load", () => {
  assert.match(native, /const tileId = zoom \+ ":" \+ x \+ ":" \+ y/);
  assert.match(native, /old\.includes\(tileId\) \? old : \[\.\.\.old, tileId\]/);
  assert.match(native, /old\.filter\(id => id !== tileId\)/);
  assert.match(native, /setFailedTiles\(\[\]\)/);
});

test("draft address modal preserves existing selection on cancel, selects only after save", () => {
  assert.match(address, /addressBeforeModal\.current = address/);
  assert.match(address, /if \(addressBeforeModal\.current\) setAddress\(addressBeforeModal\.current\)/);
  assert.match(address, /setSelectedAddressId\(saved\.id\)/);
  assert.match(address, /setAddressModalOpen\(false\)/);
});


test("Android GPS lookup cannot stay busy forever when emulator has no location", () => {
  assert.match(address, /Location\.hasServicesEnabledAsync\(\)/);
  assert.match(address, /Location\.watchPositionAsync/);
  assert.match(address, /accuracy: Location\.Accuracy\.Highest/);
  assert.match(address, /setTimeout\(\(\) => \{\s*finish\(\(\) => reject\(new Error\("GPS_TIMEOUT"\)\)\);\s*\}, 12000\)/s);
  assert.match(address, /Location\.getLastKnownPositionAsync/);
  assert.match(address, /setAddressBusy\(false\)/);
  assert.match(address, /đặt vị trí cho emulator/);
});

test("Android OSM tile requests identify the app to avoid public-tile blocking", () => {
  assert.match(native, /"User-Agent": "SichuanHotpot\/0\.2\.0 \(https:\/\/bepsi\.click\)"/);
  assert.match(native, /headers: OSM_TILE_HEADERS/);
  assert.match(native, /GPS và nhập tọa độ vẫn dùng được/);
});
