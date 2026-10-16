import { test } from "node:test";
import assert from "node:assert/strict";
import pngjs from "pngjs";
import { cleanLogo, renderIcon } from "../scripts/generate-icons.mjs";
const { PNG } = pngjs;
test("icon cleanup removes outer white only and preserves white central art", () => {
  const p = new PNG({ width: 96, height: 96 });
  for (let i = 0; i < p.data.length; i += 4) {
    p.data[i] = 255; p.data[i + 1] = 255; p.data[i + 2] = 255; p.data[i + 3] = 255;
  }
  for (let y = 30; y < 66; y++) for (let x = 30; x < 66; x++) {
    const i = (y * 96 + x) * 4;
    p.data[i] = 179; p.data[i + 1] = 38; p.data[i + 2] = 45;
  }
  // Interior white detail surrounded by red must remain visible.
  p.data[(48 * 96 + 48) * 4] = 255;
  p.data[(48 * 96 + 48) * 4 + 1] = 255;
  p.data[(48 * 96 + 48) * 4 + 2] = 255;
  const cleaned = cleanLogo(PNG.sync.write(p));
  assert.deepEqual(cleaned.bbox, { x: 30, y: 30, width: 36, height: 36 });
  assert.equal(cleaned.data[3], 0);
  assert.equal(cleaned.data[(48 * 96 + 48) * 4 + 3], 255);
  const icon = PNG.sync.read(renderIcon(cleaned, 192, false));
  assert.equal(icon.width, 192);
  assert.equal(icon.height, 192);
  const adaptive = PNG.sync.read(renderIcon(cleaned, 192, true));
  assert.equal(adaptive.data[3], 0);
  assert.equal(icon.data[3], 0, "PWA icon must not repaint a square white background");
});

test("brand art on black is transparent only at the outer background",()=>{
  const p=new PNG({width:96,height:96});
  for(let i=0;i<p.data.length;i+=4){
    p.data[i]=0;p.data[i+1]=0;p.data[i+2]=0;p.data[i+3]=255;
  }
  for(let y=30;y<66;y++)for(let x=30;x<66;x++){
    const pos=(y*96+x)*4;
    p.data[pos]=194;p.data[pos+1]=33;p.data[pos+2]=44;
  }
  const interior=(48*96+48)*4;
  p.data[interior]=0;p.data[interior+1]=0;p.data[interior+2]=0;
  const cleaned=cleanLogo(PNG.sync.write(p));
  assert.equal(cleaned.data[3],0,"outside black square is transparent");
  assert.deepEqual(cleaned.bbox,{x:30,y:30,width:36,height:36});
  assert.equal(cleaned.data[interior+3],255,"pot's internal black details remain");
});
