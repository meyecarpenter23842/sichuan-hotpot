import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=x=>readFileSync(new URL(x,import.meta.url),"utf8");

test("L05 offer cards preserve photography with only one title line",()=>{
  const app=read("../App.tsx");
  assert.match(app,/homeOfferCardTitle} numberOfLines=\{1\}>\{offer\.title\}/);
  assert.doesNotMatch(app,/homeOfferCardSummary} numberOfLines/);
});

test("L05 Customer fetches branch popup and renders it outside scrolling content",()=>{
  const app=read("../App.tsx");
  const api=read("../src/api.ts");
  assert.match(api,/export interface HomePopupPayload/);
  assert.match(app,/apiRequest<HomePopupPayload>/);
  assert.ok(app.includes('encodeURIComponent(activeBranch)+"/popup"'));
  assert.match(app,/<HomePromoPopup branchId=\{branchId\} payload=\{homePopup\} active=\{screen==="home"\}/);
});

test("L05 popup frequency is branch/revision aware and does not reopen every refresh",()=>{
  const popup=read("../src/components/HomePromoPopup.tsx");
  assert.match(popup,/hotpot\.home-popup\.v1:/);
  assert.match(popup,/receipt\.revision!==revision/);
  assert.match(popup,/const elapsed=receipt&&receipt\.revision===revision\?Date\.now\(\)-receipt\.shownAt:repeatMs/);
  assert.match(popup,/elapsed>=repeatMs/);
  assert.match(popup,/memoryReceipt\.current/);
  assert.match(popup,/setEligibilityEpoch/);
  assert.match(popup,/repeatMs-elapsed/);
  assert.match(popup,/AsyncStorage\.setItem/);
});

test("L05 popup is centered, swipeable, timed and pauses offscreen",()=>{
  const popup=read("../src/components/HomePromoPopup.tsx");
  assert.match(popup,/testID="home-promo-popup"/);
  assert.match(popup,/justifyContent:"center"/);
  assert.match(popup,/PanResponder\.create/);
  assert.match(popup,/gesture|g\.dx<=-38/);
  assert.match(popup,/setTimeout\(\(\)=>goTo\(index\+1\)/);
  assert.match(popup,/AppState\.currentState==="active"/);
  assert.match(popup,/visibilitychange/);
  assert.match(popup,/Image\.prefetch/);
  assert.match(popup,/isReduceMotionEnabled/);
  assert.match(popup,/resizeMode="contain"/);
});
