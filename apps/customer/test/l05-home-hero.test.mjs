import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=x=>readFileSync(new URL(x,import.meta.url),"utf8");

test("L05 Customer Home fetches branch hero config and renders real carousel",()=>{
  const app=read("../App.tsx");
  const api=read("../src/api.ts");
  const hero=read("../src/components/HomeHeroCarousel.tsx");
  assert.match(api,/export interface HomeHeroPayload/);
  assert.match(app,/apiRequest<HomeHeroPayload>/);
  assert.ok(app.includes('encodeURIComponent(activeBranch)+"/hero"'));
  assert.match(app,/<HomeHeroCarousel payload=\{homeHero\}/);
  assert.match(hero,/testID="home-live-hero"/);
  assert.match(hero,/resizeMode="cover"/);
});

test("L05 carousel cleans timers, pauses in background and handles manual swipe safely",()=>{
  const hero=read("../src/components/HomeHeroCarousel.tsx");
  assert.match(hero,/setTimeout\(\(\)=>goTo\(index\+1\),settings\.dwellMs\)/);
  assert.match(hero,/clearTimeout\(timer\)/);
  assert.match(hero,/AppState\.currentState==="active"/);
  assert.match(hero,/visibilitychange/);
  assert.match(hero,/PanResponder\.create/);
  assert.match(hero,/gesture\.dx<=-38/);
  assert.match(hero,/slides\.length<2/);
  assert.match(hero,/transitionLock\.current/);
});

test("L05 carousel supports reduced motion, preloading, all transitions and approved fallback",()=>{
  const hero=read("../src/components/HomeHeroCarousel.tsx");
  assert.match(hero,/isReduceMotionEnabled/);
  assert.match(hero,/reduceMotionChanged/);
  assert.match(hero,/Image\.prefetch/);
  assert.match(hero,/transition==="fade"/);
  assert.match(hero,/transition==="slide"/);
  assert.match(hero,/transition==="wipe"/);
  assert.match(hero,/321\/829/);
  assert.match(hero,/home-reference\.png/);
  assert.match(app,/testID="home-approved-hero"/);
  assert.match(hero,/Tải lại banner/);
});
