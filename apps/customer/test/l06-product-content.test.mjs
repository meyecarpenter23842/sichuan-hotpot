import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const app=readFileSync(new URL("../App.tsx",import.meta.url),"utf8");
const api=readFileSync(new URL("../src/api.ts",import.meta.url),"utf8");

test("L06 customer contract contains optional product editorial content",()=>{
  assert.match(api,/description: string \| null/);
  assert.match(api,/ingredients: string \| null/);
  assert.match(api,/productNotes: string \| null/);
  assert.match(api,/allergenNotice: string \| null/);
});

test("L06 product detail renders editorial content before variants/modifiers",()=>{
  const content=app.indexOf("item.description || item.ingredients || item.productNotes || item.allergenNotice");
  const variants=app.indexOf("item.variants.length > 0");
  assert.ok(content>0&&variants>content,"product content must appear before configurable choices");
  assert.match(app,/Xem thành phần/);
  assert.match(app,/Ẩn thành phần/);
  assert.match(app,/numberOfLines=\{productInfoExpanded \? undefined : 4\}/);
  assert.match(app,/Thông tin dị ứng/);
  assert.match(app,/Thông tin do cửa hàng cung cấp/);
});

test("L06 detail state resets per product and plain Text prevents HTML execution",()=>{
  assert.match(app,/setProductInfoExpanded\(false\)/);
  assert.match(app,/accessibilityState=\{\{expanded: productInfoExpanded\}\}/);
  assert.doesNotMatch(app,/dangerouslySetInnerHTML|WebView/);
});
