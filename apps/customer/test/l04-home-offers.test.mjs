import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=path=>readFileSync(new URL(path,import.meta.url),"utf8");
test("L04 Home uses branch-specific API offers rather than hardcoded pseudo discounts",()=>{
 const app=read("../App.tsx");
 const api=read("../src/api.ts");
 assert.match(app,/apiRequest<HomeOffer\[\]>/);
 assert.match(app,/"/catalog\/branches\/"+/);
 assert.match(app,/offers\.map\(offer=>/);
 assert.match(app,/setSelectedOffer\(offer\)/);
 assert.match(app,/visible=\{!!selectedOffer\}/);
 assert.match(app,/accessibilityLabel="Đóng popup ưu đãi"/);
 assert.match(app,/ctaTarget==="MENU"/);
 assert.doesNotMatch(app,/\{ kind: "hotpot", title: "Khám phá lẩu"/);
 assert.match(api,/export interface HomeOffer/);
});
