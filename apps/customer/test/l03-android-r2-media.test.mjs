import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
const read = file => readFileSync(new URL(file, import.meta.url), "utf8");
test("L03: retryable media has explicit error, retry and Android foreground recovery", () => {
  const s = read("../src/components/RecoverableImage.tsx");
  assert.match(s, /onError=\{\(\) => setPhase\("error"\)\}/);
  assert.match(s, /onPress=\{retry\}/);
  assert.match(s, /AppState.addEventListener\("change"/);
  assert.match(s, /currentPhase.current === "error"/);
  assert.match(s, /cache: attempt \? "reload" : "default"/);
});
test("L03: native login, catalog, QR and promo images expose image recovery", () => {
  assert.match(read("../src/screens/AuthScreen.tsx"), /RecoverableImage uri=\{heroUrl\}/);
  assert.match(read("../App.tsx"), /RecoverableImage uri=\{uri\}/);
  assert.match(read("../App.tsx"), /RecoverableImage uri=\{safeProductImageUrl\(offer.imageKey\)!\}/);
  assert.match(read("../src/screens/OrdersScreen.tsx"), /RecoverableImage uri=\{detail.payment.qr.imageUrl\}/);
  for (const p of ["HomeHeroCarousel.tsx", "HomePromoPopup.tsx"]) {
    const s = read("../src/components/" + p);
    assert.match(s, /RecoverableImage uri=\{uri\}/);
    assert.doesNotMatch(s, /!failed.includes\(slide.id\)/);
  }
});

test("L03: image failures never swallow Home offer card activation", () => {
  const s=read("../src/components/RecoverableImage.tsx");
  const app=read("../App.tsx");
  assert.match(s, /pointerEvents=\{passThrough \? "none" : "auto"\}/);
  assert.match(app, /RecoverableImage uri=\{safeProductImageUrl\(offer.imageKey\)!\} passThrough/);
});
