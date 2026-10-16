import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {HomeOffersService,offerActive,offerInterval} from "../dist/home-offers/home-offers.service.js";
const branch="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const id="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const other="cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const now=new Date("2026-10-16T05:00:00.000Z");
const imageKey="catalog-media/"+branch+"/offers/"+id+"/"+other+".webp";
function fixture() {
  const offers=new Map();
  const calls=[];
  const auth={principal:async()=>({id:"owner-1",role:"OWNER"})};
  const db={
    branch:{findUnique:async({where})=>where.id===branch?{id:branch}:null},
    homeOffer:{
      findMany:async({where})=>{
        calls.push(where);
        const rows=[...offers.values()].filter(o=>o.branchId===where.branchId);
        if(!("enabled" in where))return rows;
        return rows.filter(o=>offerActive(o,now)).map(({id,title,summary,body,imageKey,
          ctaTarget,startAt,endAt,sortOrder})=>({
          id,title,summary,body,imageKey,ctaTarget,startAt,endAt,sortOrder,
        }));
      },
      findFirst:async({where})=>offers.get(where.id)?.branchId===where.branchId
        ?offers.get(where.id):null,
      create:async({data})=>{
        const row={id,revision:0,imageKey:null,createdAt:now,
          updatedAt:now,...data};
        offers.set(id,row);return row;
      },
      updateMany:async({where,data})=>{
        const row=offers.get(where.id);
        if(!row||row.branchId!==where.branchId||row.revision!==where.revision)
          return {count:0};
        offers.set(row.id,{...row,...data,
          revision:row.revision+1,
          imageKey:data.imageKey===undefined?row.imageKey:data.imageKey});
        return {count:1};
      },
      delete:async({where})=>offers.delete(where.id),
      findUniqueOrThrow:async({where})=>offers.get(where.id),
    },
    r2ImageCleanup:{upsert:async({where})=>{calls.push(["cleanup",where.key]);}},
    $transaction:async arg=>typeof arg==="function"?arg(db):Promise.all(arg),
  };
  return {service:new HomeOffersService({database:db},auth),db,offers,auth,calls};
}
test("L04 time bounds, disable/image gate and content input sanitization",async()=>{
  const {service,offers}=fixture();
  assert.throws(()=>offerInterval(now,new Date(now.getTime()-1000)),e=>e.getStatus()===400);
  const draft=await service.create("Bearer owner",branch,{
    title:" Ưu đãi hôm nay ",summary:" Quà tặng ",body:" Không tự trừ giá ",
    sortOrder:0,startAt:"2026-10-16T00:00:00.000Z",endAt:"2026-10-17T00:00:00.000Z",
  });
  assert.equal(draft.enabled,false);
  assert.equal(draft.title,"Ưu đãi hôm nay");
  await assert.rejects(service.update("Bearer owner",branch,id,0,{enabled:true}),
    e=>e.getStatus()===409,"no image means no publication");
  offers.get(id).imageKey=imageKey;
  const published=await service.update("Bearer owner",branch,id,0,{enabled:true});
  assert.equal(published.revision,1);
  assert.equal(published.enabled,true);
  await assert.rejects(service.update("Bearer owner",branch,id,0,{title:"Racing edit"}),
    e=>e.getStatus()===409);
});
test("L04 guests see only branch-scoped active and scheduled offers, not drafts or expired offers",async()=>{
 const {service,offers}=fixture();
 offers.set(id,{id,branchId:branch,enabled:true,imageKey,startAt:null,endAt:null,
  title:"Active",summary:"Ok",body:"Content",ctaTarget:null,sortOrder:0});
 offers.set("future",{id:"future",branchId:branch,enabled:true,imageKey,
  startAt:new Date("2026-10-17T00:00:00Z"),endAt:null});
 offers.set("expired",{id:"expired",branchId:branch,enabled:true,imageKey,
  startAt:null,endAt:new Date("2026-10-16T04:59:59Z")});
 offers.set("private",{id:"private",branchId:other,enabled:true,imageKey,startAt:null,endAt:null});
 const returned=await service.publicList(branch,now);
 assert.equal(returned.length,1);
 assert.equal(returned[0].title,"Active");
 assert.deepEqual(returned[0].imageKey,imageKey);
 assert.equal(offerActive({enabled:true,imageKey,startAt:now,endAt:now},now),false);
 await assert.rejects(service.publicList(other),e=>e.getStatus()===404);
});
test("L04 OWNER only, branch isolation and valid image key scope",async()=>{
 const {service,offers,auth}=fixture();
 offers.set(id,{id,branchId:branch,imageKey:null,revision:0,enabled:false,
  startAt:null,endAt:null});
 auth.principal=async()=>({role:"MANAGER",id:"staff"});
 await assert.rejects(service.adminList("Bearer manager",branch),e=>e.getStatus()===403);
 auth.principal=async()=>({role:"OWNER",id:"owner"});
 await assert.rejects(service.update("Bearer owner",other,id,0,{title:"Wrong branch"}),
   e=>e.getStatus()===404);
 await assert.rejects(service.attach("Bearer owner",branch,id,
  "catalog-media/"+other+"/offers/"+id+"/"+other+".webp"),e=>e.getStatus()===400);
 await assert.rejects(service.ticket("Bearer owner",branch,id,{
   contentType:"application/javascript",byteSize:12}),e=>e.getStatus()===400);
});
test("L04 replaced/delete media enqueues safe cleanup, not direct deletion",async()=>{
 const {service,offers,calls}=fixture();
 offers.set(id,{id,branchId:branch,imageKey,revision:0,enabled:false,
  startAt:null,endAt:null});
 await service.removeImage("Bearer owner",branch,id);
 assert.equal(offers.get(id).imageKey,null);
 assert.deepEqual(calls.at(-1),["cleanup",imageKey]);
});
test("L04 additive migration and no accidental fake discounts",()=>{
 const sql=readFileSync(new URL("../prisma/migrations/20261016130000_l04_home_offers/migration.sql",import.meta.url),"utf8");
 assert.match(sql,/CREATE TABLE "HomeOffer"/);
 assert.match(sql,/CHECK \("startAt" IS NULL OR/);
 assert.doesNotMatch(sql,/DELETE FROM|DROP TABLE|ALTER TABLE "Order"/);
 const service=readFileSync(new URL("../src/home-offers/home-offers.service.ts",import.meta.url),"utf8");
 assert.doesNotMatch(service,/priceVnd|discountVnd|applyDiscount/);
});
