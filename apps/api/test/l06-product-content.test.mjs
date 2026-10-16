import assert from "node:assert/strict";
import {test} from "node:test";
import {createRequire} from "node:module";
import {readFileSync} from "node:fs";
const require=createRequire(import.meta.url);
const {AdminCatalogService}=require("../dist/admin-catalog/admin-catalog.service.js");
const {CatalogService}=require("../dist/catalog/catalog.service.js");

const branchId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const categoryId="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const productId="cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function adminFixture(role="OWNER"){
  const writes=[];
  const db={
    branch:{findUnique:async()=>({id:branchId})},
    catalogCategory:{findFirst:async data=>{writes.push(["category",data]);return {id:categoryId};}},
    product:{
      findFirst:async data=>{writes.push(["product-check",data]);return {id:productId};},
      create:async data=>{writes.push(["create",data]);return data.data;},
      update:async data=>{writes.push(["update",data]);return data.data;},
    },
  };
  const auth={adminAccess:async()=>{
    if(!["OWNER","MANAGER"].includes(role)){
      const e=new Error("forbidden");e.getStatus=()=>403;throw e;
    }
  }};
  return {service:new AdminCatalogService({database:db},auth),writes};
}

test("L06 Admin trims/normalizes customer-facing product content and persists empty as null",async()=>{
  const {service,writes}=adminFixture();
  const created=await service.createProduct("Bearer owner",branchId,{
    categoryId,name:"  Mì Tứ Xuyên  ",priceVnd:79000,isAvailable:true,
    description:"  Cay tê\r\n  thơm dầu ớt  ",
    ingredients:"Mì\r\nBò\n\n\nCải thìa",
    productNotes:"  Dùng ngon khi còn nóng.  ",
    allergenNotice:" Có chứa sản phẩm từ lúa mì. ",
  });
  assert.equal(created.name,"Mì Tứ Xuyên");
  assert.equal(created.description,"Cay tê\n  thơm dầu ớt");
  assert.equal(created.ingredients,"Mì\nBò\n\nCải thìa");
  assert.equal(created.productNotes,"Dùng ngon khi còn nóng.");
  assert.equal(created.allergenNotice,"Có chứa sản phẩm từ lúa mì.");
  await service.updateProduct("Bearer owner",branchId,productId,{
    description:"",ingredients:null,productNotes:"   ",allergenNotice:null,
  });
  assert.deepEqual(writes.find(x=>x[0]==="update")[1].data,{
    description:null,ingredients:null,productNotes:null,allergenNotice:null,
  });
});

test("L06 rejects over-limit/control product text and unauthorized staff",async()=>{
  const {service}=adminFixture();
  await assert.rejects(service.createProduct("Bearer owner",branchId,{
    categoryId,name:"Món",priceVnd:1,isAvailable:true,description:"x".repeat(1201),
  }),e=>e.getStatus?.()===400);
  await assert.rejects(service.updateProduct("Bearer owner",branchId,productId,{
    productNotes:"Nội dung\u0000ẩn",
  }),e=>e.getStatus?.()===400);
  await assert.rejects(adminFixture("KITCHEN").service.updateProduct(
    "Bearer kitchen",branchId,productId,{description:"Không được sửa"}),/forbidden/);
});

test("L06 public catalog selects only explicit customer-facing content fields",async()=>{
  let captured;
  const branch={id:branchId,code:"main",name:"Hotpot",isActive:true,categories:[]};
  const service=new CatalogService({database:{branch:{findFirst:async query=>{
    captured=query;return branch;
  }}}});
  await service.menu(branchId);
  const product=captured.select.categories.select.products.select;
  for(const field of ["description","ingredients","productNotes","allergenNotice"])
    assert.equal(product[field],true);
  assert.equal("internalNotes" in product,false);
});

test("L06 migration is additive and keeps existing products/orders valid",()=>{
  const sql=readFileSync(new URL("../prisma/migrations/20261016190000_l06_product_content/migration.sql",import.meta.url),"utf8");
  assert.match(sql,/ALTER TABLE "Product"/);
  assert.match(sql,/ADD COLUMN "description" VARCHAR\(1200\)/);
  assert.match(sql,/ADD COLUMN "ingredients" VARCHAR\(1200\)/);
  assert.match(sql,/ADD COLUMN "productNotes" VARCHAR\(800\)/);
  assert.match(sql,/ADD COLUMN "allergenNotice" VARCHAR\(800\)/);
  assert.doesNotMatch(sql,/NOT NULL|DROP|DELETE FROM|ALTER TABLE "Order"/);
});
