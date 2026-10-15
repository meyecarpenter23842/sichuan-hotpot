import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pngjs from "pngjs";
const { PNG } = pngjs;
test("logo source is the approved raster, not the legacy icon",()=>{
  const img=PNG.sync.read(readFileSync(resolve("assets/brand-approved-20261015.png")));
  assert.equal(img.width,1254); assert.equal(img.height,1254);
  for(const app of ["customer","admin"]){
    const path=resolve("apps",app);
    const generator=readFileSync(resolve(path,"scripts/generate-icons.mjs"),"utf8");
    const config=JSON.parse(readFileSync(resolve(path,"app.json"),"utf8"));
    assert.match(generator,/brand-approved-20261015.png/);
    assert.doesNotMatch(generator,/const disc = radius/);
    assert.match(generator,/icon-512-v20261015.png/);
    assert.equal(config.expo.android.adaptiveIcon.backgroundColor,"#FFFFFF");
  }
});
