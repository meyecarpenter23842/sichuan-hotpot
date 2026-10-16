import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=x=>readFileSync(new URL(x,import.meta.url),"utf8");

test("Home hero schedules every dwell instead of stopping after first transition",()=>{
  const hero=read("../src/components/HomeHeroCarousel.tsx");
  assert.match(hero,/if\(!active\|\|!visible\|\|!settings\.autoplay\|\|slides\.length<2\)return;/);
  assert.doesNotMatch(hero,/settings\.autoplay\|\|slides\.length<2\|\|transitionLock\.current/);
  assert.match(hero,/setTimeout\(\(\)=>goTo\(index\+1\),settings\.dwellMs\)/);
});

test("Home hero dots no longer reserve a blank strip below the banner",()=>{
  const hero=read("../src/components/HomeHeroCarousel.tsx");
  const app=read("../App.tsx");
  assert.match(hero,/dotsOverlay:\{position:"absolute"/);
  assert.doesNotMatch(hero,/dotsSlot:/);
  assert.match(app,/homeHeroRegion: \{ backgroundColor: "#4A0C0A" \}/);
});

test("Menu removes redundant title and hides single-branch pill",()=>{
  const app=read("../App.tsx");
  assert.doesNotMatch(app,/<Text style=\{styles\.pageTitle\}>Thực đơn<\/Text>/);
  assert.match(app,/branches\.length > 1 && \(/);
  assert.match(app,/styles\.menuTopSection/);
  assert.match(app,/label="Tìm món ăn, trà sữa"/);
});
