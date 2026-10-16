import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ModifierLibraryService } from "../dist/admin-catalog/modifier-library.service.js";
import { R2CatalogMediaService } from "../dist/admin-catalog/r2-catalog-media.service.js";
const branchId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const productId="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const groupId="cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const auth={adminAccess:async()=>{}};
function mockLibrary({allowed=true,revision=7}={}){
 const calls=[];
 const db={
  branch:{findUnique:async()=>({id:branchId}),updateMany:async()=>({count:revision===7?1:0})},
  product:{findFirst:async()=>({id:productId})},
  modifierGroup:{findMany:async()=>allowed?[{id:groupId}]:[]},
  productModifierGroupAssignment:{
   deleteMany:async args=>{calls.push(["unlink",args]);return {count:0}},
   createMany:async args=>{calls.push(["link",args]);return {count:1}},
  },
  $transaction:async cb=>cb(db),
 };
 return {library:new ModifierLibraryService({database:db},auth),calls};
}
test("L03: group can attach to products in branch, replacing active associations atomically",async()=>{
 const {library,calls}=mockLibrary();
 const outcome=await library.attach("token",branchId,productId,[groupId],7);
 assert.deepEqual(outcome,{productId,groupIds:[groupId],revision:8});
 assert.equal(calls.length,2);
 assert.equal(calls[1][1].data[0].groupId,groupId);
 const {library:other}=mockLibrary();
 await assert.rejects(other.attach("token",branchId,productId,[groupId,groupId],7),x=>x.getStatus()===400);
});
test("L03: cross-branch ID cannot be attached, and optimistic revision rejects races",async()=>{
 const {library, calls}=mockLibrary({allowed:false});
 await assert.rejects(library.attach("token",branchId,productId,[groupId],7),x=>x.getStatus()===403);
 assert.deepEqual(calls,[]);
 const {library:stale}=mockLibrary({revision:8});
 await assert.rejects(stale.attach("token",branchId,productId,[groupId],7),x=>x.getStatus()===409);
});
test("L03: new library groups start inactive and require image before publication",async()=>{
 let created;
 const db={
  branch:{findUnique:async()=>({id:branchId})},
  modifierGroup:{
    create:async p=>{created=p.data;return p.data},
    findFirst:async()=>({id:groupId,branchId,name:"Topping",minSelect:0,maxSelect:1,
      sortOrder:0,imageKey:null,options:[],assignments:[]}),
  },
 };
 const service=new ModifierLibraryService({database:db},auth);
 await service.create("token",branchId,{name:"Rau",minSelect:0,maxSelect:1,sortOrder:0});
 assert.equal(created.isAvailable,false);
 await assert.rejects(service.update("token",branchId,groupId,{isAvailable:true}),x=>x.getStatus()===409);
});
test("L03: optional group and free topping are valid business objects",async()=>{
 const created=[];
 const db={
  branch:{findUnique:async()=>({id:branchId})},
  modifierGroup:{
   create:async ({data})=>{created.push(data);return {id:groupId,...data}},
   findFirst:async()=>({id:groupId,branchId,imageKey:null,options:[],assignments:[]}),
  },
  modifierOption:{create:async ({data})=>{created.push(data);return data}},
 };
 const service=new ModifierLibraryService({database:db},auth);
 const group=await service.create("token",branchId,{
  name:"Độ cay",minSelect:0,maxSelect:1,sortOrder:0,
 });
 assert.equal(group.minSelect,0,"nonmandatory groups require zero selections");
 const free=await service.addOption("token",branchId,groupId,{
  name:"Không cay",priceDeltaVnd:0,
 });
 assert.equal(free.priceDeltaVnd,0,"zero VND is valid; do not conflate it with missing image");
 assert.equal(free.isAvailable,false,"new free topping still requires an image before publishing");
 assert.equal(created.length,2);
});
test("L03: R2 media keys cannot escape requested entity or branch",async()=>{
 const db={catalogCategory:{findFirst:async()=>({imageKey:null})}};
 const service=new R2CatalogMediaService(auth,{database:db},{cleanupPending:async()=>{}});
 await assert.rejects(service.attach("token",branchId,"categories",productId,
   "catalog-media/other/categories/"+productId+"/file.png"),x=>x.getStatus()===400);
});
test("L03: bulk group assignment updates several products in one transaction",async()=>{
 const secondProductId="dddddddd-dddd-4ddd-8ddd-dddddddddddd";
 const calls=[];
 let allowAll=true,revision=7;
 const db={
   branch:{findUnique:async()=>({id:branchId}),
     updateMany:async()=>({count:revision===7?1:0})},
   modifierGroup:{findFirst:async()=>({id:groupId,sortOrder:3})},
   product:{findMany:async()=>allowAll?[{id:productId},{id:secondProductId}]:[{id:productId}]},
   productModifierGroupAssignment:{
     deleteMany:async args=>{calls.push(["remove",args]);return {count:0}},
     createMany:async args=>{calls.push(["create",args]);return {count:args.data.length}},
   },
   $transaction:async fn=>fn(db),
 };
 const svc=new ModifierLibraryService({database:db},auth);
 const result=await svc.setGroupProducts("token",branchId,groupId,
   [productId,secondProductId],7);
 assert.deepEqual(result,{groupId,productIds:[productId,secondProductId],revision:8});
 assert.equal(calls.length,2);
 assert.deepEqual(calls[0],["remove",{where:{groupId}}]);
 assert.deepEqual(calls[1][1].data,[
   {productId,groupId,sortOrder:3},{productId:secondProductId,groupId,sortOrder:3},
 ]);
 calls.length=0;allowAll=false;
 await assert.rejects(svc.setGroupProducts("token",branchId,groupId,
   [productId,secondProductId],7),error=>error.getStatus()===403);
 assert.equal(calls.length,0,"foreign-branch product must not mutate links");
 allowAll=true;revision=8;
 await assert.rejects(svc.setGroupProducts("token",branchId,groupId,
   [productId,secondProductId],7),error=>error.getStatus()===409);
 assert.equal(calls.length,0,"stale catalog revision must not mutate links");
});
test("L03 regression: one-tap assignment persists atomically and is idempotent",async()=>{
 const links=new Set();let revisions=0;let removed=0;let created=0;
 const tx={
  product:{findFirst:async()=>({id:productId})},
  modifierGroup:{findFirst:async()=>({id:groupId,sortOrder:2})},
  productModifierGroupAssignment:{
   upsert:async()=>{links.add(productId+"-"+groupId);created++},
   deleteMany:async()=>{links.delete(productId+"-"+groupId);removed++},
   findUnique:async()=>links.size?{productId}:null,
  },
  branch:{update:async()=>{revisions++;return {id:branchId}}},
 };
 const db={
  branch:{findUnique:async()=>({id:branchId})},
  $transaction:async fn=>fn(tx),
 };
 const service=new ModifierLibraryService({database:db},auth);
 for (const step of [true,true,false,false,true]) {
  const result=await service.setProductGroupMembership("token",branchId,productId,groupId,step);
  assert.deepEqual(result,{productId,groupId,attached:step});
  assert.equal(links.has(productId+"-"+groupId),step);
 }
 assert.equal(links.size,1,"repeat tap must not create duplicate associations");
 assert.equal(revisions,5);
 assert.equal(created,3);
 assert.equal(removed,2);
});
test("L03 regression: reject cross-branch product/group and false confirmation",async()=>{
 let writes=0;let foreignProduct=true,foreignGroup=false;
 const tx={
  product:{findFirst:async()=>foreignProduct?null:{id:productId}},
  modifierGroup:{findFirst:async()=>foreignGroup?null:{id:groupId,sortOrder:0}},
  productModifierGroupAssignment:{
   upsert:async()=>{writes++},
   findUnique:async()=>null,
  },
  branch:{update:async()=>{writes++}},
 };
 const db={branch:{findUnique:async()=>({id:branchId})},$transaction:async fn=>fn(tx)};
 const service=new ModifierLibraryService({database:db},auth);
 await assert.rejects(service.setProductGroupMembership("token",branchId,productId,groupId,true),
   err=>err.getStatus()===404);
 foreignProduct=false;foreignGroup=true;
 await assert.rejects(service.setProductGroupMembership("token",branchId,productId,groupId,true),
   err=>err.getStatus()===404);
 assert.equal(writes,0,"cannot mutate cross-branch associations");
 foreignGroup=false;
 await assert.rejects(service.setProductGroupMembership("token",branchId,productId,groupId,true),
   err=>err.getStatus()===409);
 assert.equal(writes,1,"unverified membership must roll back in actual transaction");
});
test("L03: additive migration backfills links without changing original option IDs or order snapshots",()=>{
 const sql=readFileSync(new URL("../prisma/migrations/20261015150000_l03_reusable_modifiers/migration.sql",import.meta.url),"utf8");
 assert.match(sql,/INSERT INTO "ProductModifierGroupAssignment"/);
 assert.match(sql,/SELECT "productId", id, "sortOrder" FROM "ModifierGroup"/);
 assert.match(sql,/ALTER COLUMN "productId" DROP NOT NULL/);
 assert.doesNotMatch(sql,/DROP TABLE "(?:ModifierGroup|ModifierOption|OrderItem)"/);
});
