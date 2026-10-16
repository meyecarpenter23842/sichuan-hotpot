import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
const require=createRequire(import.meta.url);
const {AdminCatalogService}=require("../dist/admin-catalog/admin-catalog.service.js");
const {CatalogService}=require("../dist/catalog/catalog.service.js");
const {R2CatalogMediaService}=require("../dist/admin-catalog/r2-catalog-media.service.js");
const branchId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const categoryId="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const auth={adminAccess:async()=>{}};
test("L03: new category stays private until image upload, old category defaults remain published",async()=>{
 let payload;
 const db={
   branch:{findUnique:async()=>({id:branchId})},
   catalogCategory:{create:async args=>{payload=args.data;return args.data}},
 };
 const service=new AdminCatalogService({database:db},auth);
 const created=await service.createCategory("Bearer test",branchId,{name:" Rau lẩu ",sortOrder:0});
 assert.equal(created.isPublished,false);
 assert.equal(created.name,"Rau lẩu");
 const migration=readFileSync(new URL("../prisma/migrations/20261016010000_l03_category_image_publication/migration.sql",import.meta.url),"utf8");
 assert.match(migration,/DEFAULT TRUE/);
 assert.doesNotMatch(migration,/DELETE FROM|DROP TABLE|DROP COLUMN/);
});
test("L03: only published categories appear in customer catalog",async()=>{
 let query;
 const db={branch:{findFirst:async args=>{
    query=args;return {id:branchId,name:"Test",code:"T",isActive:true,categories:[]};
 }}};
 const svc=new CatalogService({database:db});
 await svc.menu(branchId);
 assert.deepEqual(query.select.categories.where,{isPublished:true});
});
test("L03: attaching verified category image publishes, removing image hides it",async()=>{
 let key=null, published=false;
 const db={
   catalogCategory:{
    findFirst:async()=>({imageKey:key}),
    updateMany:async args=>{
       assert.equal(args.where.imageKey,key);
       key=args.data.imageKey;published=args.data.isPublished;
       return {count:1};
    },
   },
   $transaction:async fn=>fn(db),
 };
 const svc=new R2CatalogMediaService(auth,{database:db},{cleanupPending:async()=>{}});
 const photo="catalog-media/"+branchId+"/categories/"+categoryId+"/aabbccdd-eeee-4444-8888-99aabbccddee.webp";
 await svc.replace("Bearer test",branchId,"categories",categoryId,photo);
 assert.equal(key,photo);
 assert.equal(published,true);
 // Old key is queued for safe cleanup only after DB reference replacement.
 db.r2ImageCleanup={upsert:async()=>({})};
 await svc.replace("Bearer test",branchId,"categories",categoryId,null);
 assert.equal(key,null);
 assert.equal(published,false);
});
