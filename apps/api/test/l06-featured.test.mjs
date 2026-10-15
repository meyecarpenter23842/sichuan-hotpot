import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { AdminCatalogService } = require("../dist/admin-catalog/admin-catalog.service.js");
function fixture() {
  const ids = ["a","b"]; let revision=1;
  const values = [{id:"a",sortOrder:0,isFeatured:false},{id:"b",sortOrder:1,isFeatured:false}];
  const db = {
    branch: {
      findUnique: async () => ({ id: "branch" }),
      updateMany: async x => {
        if(x.where.catalogRevision !== revision) return { count: 0 };
        revision++; return { count: 1 };
      },
    },
    product: {
      findMany: async () => ids.map(id => ({id})),
      updateMany: async x => {
        for(const product of values)
          if(!x.where.id?.in || x.where.id.in.includes(product.id))
            Object.assign(product,x.data);
        return {count:values.length};
      },
      update: async x => Object.assign(values.find(item=>item.id===x.where.id),x.data),
    },
    $transaction: async fn => fn(db),
  };
  const auth = { adminAccess: async () => true };
  return { service: new AdminCatalogService({ database: db },auth),values };
}
test("L06 feature selection validates scope/duplicates and rejects stale revision",async()=>{
  const {service,values}=fixture();
  await assert.rejects(service.setFeaturedProducts("Bearer yes","branch",["a","a"],1),
    e=>e.getStatus?.()===409);
  await assert.rejects(service.setFeaturedProducts("Bearer yes","branch",["outside"],1),
    e=>e.getStatus?.()===409);
  await service.setFeaturedProducts("Bearer yes","branch",["b"],1);
  assert.deepEqual(values.map(v=>v.isFeatured),[false,true]);
  await assert.rejects(service.setFeaturedProducts("Bearer yes","branch",["a"],1),
    e=>e.getStatus?.()===409);
});
test("L06 order requires whole branch and serial version",async()=>{
  const {service,values}=fixture();
  await assert.rejects(service.reorderProducts("Bearer yes","branch",["a","a"],1),
    e=>e.getStatus?.()===409);
  await assert.rejects(service.reorderProducts("Bearer yes","branch",["a"],1),
    e=>e.getStatus?.()===409);
  await service.reorderProducts("Bearer yes","branch",["b","a"],1);
  assert.deepEqual(values.map(v=>v.sortOrder),[1,0]);
  await assert.rejects(service.reorderProducts("Bearer yes","branch",["a","b"],1),
    e=>e.getStatus?.()===409);
});
