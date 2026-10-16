import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {HomeHeroService} from "../dist/home-hero/home-hero.service.js";

const branch="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const id1="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const id2="cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const img=id=>"catalog-media/"+branch+"/hero/"+id+"/dddddddd-dddd-4ddd-8ddd-dddddddddddd.webp";

function fixture(){
  const configs=new Map(),slides=new Map(),cleanup=[];
  const auth={principal:async()=>({id:"owner",role:"OWNER"})};
  const db={
    branch:{findUnique:async({where})=>where.id===branch?{id:branch}:null},
    homeHeroConfig:{
      findUnique:async({where})=>configs.get(where.branchId)??null,
      findUniqueOrThrow:async({where})=>configs.get(where.branchId),
      create:async({data})=>{const row={...data,revision:0,updatedAt:new Date()};configs.set(data.branchId,row);return row;},
      updateMany:async({where,data})=>{const row=configs.get(where.branchId);
        if(!row||row.revision!==where.revision)return {count:0};
        configs.set(where.branchId,{...row,...data,revision:row.revision+1});return {count:1};},
    },
    homeHeroSlide:{
      findFirst:async({where})=>{const row=slides.get(where.id);return row?.branchId===where.branchId?row:null;},
      findMany:async({where})=>[...slides.values()].filter(row=>{
        if(row.branchId!==where.branchId)return false;
        if("enabled" in where&&(!row.enabled||!row.imageKey))return false;
        return true;
      }).sort((a,b)=>a.sortOrder-b.sortOrder),
      create:async({data})=>{const id=data.sortOrder===0?id1:id2;
        const row={id,imageKey:null,revision:0,createdAt:new Date(),updatedAt:new Date(),...data};
        slides.set(id,row);return row;},
      updateMany:async({where,data})=>{const row=slides.get(where.id);
        if(!row||row.branchId!==where.branchId||row.revision!==where.revision)return {count:0};
        const next={...row,...data,revision:row.revision+1};
        if(data.imageKey!==undefined)next.imageKey=data.imageKey;
        slides.set(row.id,next);return {count:1};},
      update:async({where,data})=>{const row=slides.get(where.id);
        const next={...row,...data,revision:row.revision+1};slides.set(where.id,next);return next;},
      delete:async({where})=>slides.delete(where.id),
      findUniqueOrThrow:async({where})=>slides.get(where.id),
    },
    r2ImageCleanup:{upsert:async({where})=>{cleanup.push(where.key);}},
    $transaction:async arg=>typeof arg==="function"?arg(db):Promise.all(arg),
  };
  return {service:new HomeHeroService({database:db},auth),auth,configs,slides,cleanup};
}

test("L05 public payload defaults safely and only publishes enabled slides with images",async()=>{
  const {service,slides}=fixture();
  slides.set(id1,{id:id1,branchId:branch,imageKey:img(id1),altText:"Lẩu",title:null,subtitle:null,
    ctaTarget:"MENU",enabled:true,sortOrder:0,revision:0,createdAt:new Date()});
  slides.set(id2,{id:id2,branchId:branch,imageKey:null,altText:"Draft",enabled:true,sortOrder:1,
    revision:0,createdAt:new Date()});
  const payload=await service.publicGet(branch);
  assert.equal(payload.settings.autoplay,true);
  assert.equal(payload.settings.dwellMs,5000);
  assert.equal(payload.settings.transitionType,"fade");
  assert.equal(payload.slides.length,1);
  assert.equal(payload.slides[0].id,id1);
});

test("L05 config and slide writes are OWNER-scoped and revision protected",async()=>{
  const {service,auth}=fixture();
  auth.principal=async()=>({role:"MANAGER",id:"staff"});
  await assert.rejects(service.adminGet("Bearer manager",branch),e=>e.getStatus()===403);
  auth.principal=async()=>({role:"OWNER",id:"owner"});
  const config=await service.updateConfig("Bearer owner",branch,0,{
    autoplay:true,dwellMs:4200,transitionType:"wipe",transitionDurationMs:500,
  });
  assert.equal(config.transitionType,"wipe");
  const updated=await service.updateConfig("Bearer owner",branch,0,{
    autoplay:false,dwellMs:5000,transitionType:"fade",transitionDurationMs:450,
  });
  assert.equal(updated.revision,1);
  await assert.rejects(service.updateConfig("Bearer owner",branch,0,{
    autoplay:true,dwellMs:5000,transitionType:"slide",transitionDurationMs:450,
  }),e=>e.getStatus()===409);
});

test("L05 slide publication requires an image and image removal queues cleanup",async()=>{
  const {service,slides,cleanup}=fixture();
  const slide=await service.createSlide("Bearer owner",branch,{
    altText:" Banner lẩu ",title:"Lẩu Tứ Xuyên",subtitle:null,ctaTarget:"MENU",sortOrder:0,
  });
  assert.equal(slide.enabled,false);
  assert.equal(slide.altText,"Banner lẩu");
  await assert.rejects(service.updateSlide("Bearer owner",branch,slide.id,0,{enabled:true}),
    e=>e.getStatus()===409);
  slides.get(slide.id).imageKey=img(slide.id);
  const enabled=await service.updateSlide("Bearer owner",branch,slide.id,0,{enabled:true});
  assert.equal(enabled.enabled,true);
  await assert.rejects(service.removeImage("Bearer owner",branch,slide.id),e=>e.getStatus()===409);
  slides.get(slide.id).enabled=false;
  const revision=slides.get(slide.id).revision;
  await service.removeImage("Bearer owner",branch,slide.id);
  assert.equal(slides.get(slide.id).imageKey,null);
  assert.deepEqual(cleanup,[img(slide.id)]);
  assert.ok(slides.get(slide.id).revision>revision);
});

test("L05 migration is additive and constrains animation/CTA values",()=>{
  const sql=readFileSync(new URL("../prisma/migrations/20261016160000_l05_home_hero_slider/migration.sql",import.meta.url),"utf8");
  assert.match(sql,/CREATE TABLE "HomeHeroConfig"/);
  assert.match(sql,/CREATE TABLE "HomeHeroSlide"/);
  assert.match(sql,/BETWEEN 2000 AND 10000/);
  assert.match(sql,/IN \('fade','slide','wipe'\)/);
  assert.match(sql,/ctaTarget.*MENU/s);
  assert.doesNotMatch(sql,/DROP TABLE|DELETE FROM|ALTER TABLE "Order"/);
});
