import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {HomePopupService} from "../dist/home-popup/home-popup.service.js";

const branch="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const id1="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const id2="cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const image=id=>"catalog-media/"+branch+"/popup/"+id+"/dddddddd-dddd-4ddd-8ddd-dddddddddddd.webp";

function fixture(){
  const configs=new Map(),slides=new Map(),cleanup=[];
  const auth={principal:async()=>({id:"owner",role:"OWNER"})};
  const db={
    branch:{findUnique:async({where})=>where.id===branch?{id:branch}:null},
    homePopupConfig:{
      findUnique:async({where})=>configs.get(where.branchId)??null,
      findUniqueOrThrow:async({where})=>configs.get(where.branchId),
      create:async({data})=>{const row={...data,revision:0,updatedAt:new Date()};configs.set(data.branchId,row);return row;},
      updateMany:async({where,data})=>{const row=configs.get(where.branchId);
        if(!row||row.revision!==where.revision)return {count:0};
        const revision=typeof data.revision==="object"?row.revision+1:data.revision;
        configs.set(where.branchId,{...row,...data,revision});return {count:1};},
      upsert:async({where,create})=>{const row=configs.get(where.branchId);
        if(row){const next={...row,revision:row.revision+1};configs.set(where.branchId,next);return next;}
        const next={...create,revision:create.revision??0,enabled:false,repeatIntervalMinutes:360,
          slideDwellMs:4000,updatedAt:new Date()};configs.set(where.branchId,next);return next;},
    },
    homePopupSlide:{
      count:async({where})=>[...slides.values()].filter(row=>
        row.branchId===where.branchId&&row.enabled&&row.imageKey).length,
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
        if(data.imageKey!==undefined)next.imageKey=data.imageKey;slides.set(row.id,next);return {count:1};},
      update:async({where,data})=>{const row=slides.get(where.id);
        const next={...row,...data,revision:row.revision+1};slides.set(where.id,next);return next;},
      delete:async({where})=>slides.delete(where.id),
      findUniqueOrThrow:async({where})=>slides.get(where.id),
    },
    r2ImageCleanup:{upsert:async({where})=>cleanup.push(where.key)},
    $transaction:async arg=>typeof arg==="function"?arg(db):Promise.all(arg),
  };
  return {service:new HomePopupService({database:db},auth),auth,configs,slides,cleanup};
}

test("L05 popup is off by default and public response exposes only enabled images",async()=>{
  const {service,slides}=fixture();
  let payload=await service.publicGet(branch);
  assert.equal(payload.settings.enabled,false);
  assert.equal(payload.settings.repeatIntervalMinutes,360);
  slides.set(id1,{id:id1,branchId:branch,imageKey:image(id1),altText:"Ảnh một",enabled:true,
    sortOrder:0,revision:0,createdAt:new Date()});
  slides.set(id2,{id:id2,branchId:branch,imageKey:null,altText:"Ảnh nháp",enabled:true,
    sortOrder:1,revision:0,createdAt:new Date()});
  payload=await service.publicGet(branch);
  assert.equal(payload.slides.length,1);
  assert.equal(payload.slides[0].id,id1);
});

test("L05 popup cannot be globally enabled without at least one live image",async()=>{
  const {service,slides}=fixture();
  await assert.rejects(service.updateConfig("Bearer owner",branch,0,{
    enabled:true,repeatIntervalMinutes:60,slideDwellMs:3000,
  }),e=>e.getStatus()===409);
  slides.set(id1,{id:id1,branchId:branch,imageKey:image(id1),altText:"Ảnh live",enabled:true,
    sortOrder:0,revision:0,createdAt:new Date()});
  const saved=await service.updateConfig("Bearer owner",branch,0,{
    enabled:true,repeatIntervalMinutes:60,slideDwellMs:3000,
  });
  assert.equal(saved.enabled,true);
});

test("L05 popup config validates frequency and is OWNER/revision protected",async()=>{
  const {service,auth}=fixture();
  auth.principal=async()=>({id:"staff",role:"MANAGER"});
  await assert.rejects(service.adminGet("Bearer staff",branch),e=>e.getStatus()===403);
  auth.principal=async()=>({id:"owner",role:"OWNER"});
  await assert.rejects(service.updateConfig("Bearer owner",branch,0,{
    enabled:true,repeatIntervalMinutes:1,slideDwellMs:4000,
  }),e=>e.getStatus()===400);
  const saved=await service.updateConfig("Bearer owner",branch,0,{
    enabled:true,repeatIntervalMinutes:60,slideDwellMs:3000,
  });
  assert.equal(saved.enabled,true);
  const next=await service.updateConfig("Bearer owner",branch,0,{
    enabled:true,repeatIntervalMinutes:120,slideDwellMs:5000,
  });
  assert.equal(next.revision,1);
  await assert.rejects(service.updateConfig("Bearer owner",branch,0,{
    enabled:false,repeatIntervalMinutes:120,slideDwellMs:5000,
  }),e=>e.getStatus()===409);
});

test("L05 popup slide changes touch content revision and require image before publish",async()=>{
  const {service,configs,slides,cleanup}=fixture();
  const slide=await service.createSlide("Bearer owner",branch,{altText:"  Ảnh popup  ",sortOrder:0});
  assert.equal(slide.altText,"Ảnh popup");
  assert.equal(configs.get(branch).revision,1);
  await assert.rejects(service.updateSlide("Bearer owner",branch,slide.id,0,{enabled:true}),
    e=>e.getStatus()===409);
  slides.get(slide.id).imageKey=image(slide.id);
  const published=await service.updateSlide("Bearer owner",branch,slide.id,0,{enabled:true});
  assert.equal(published.enabled,true);
  assert.equal(configs.get(branch).revision,2);
  await assert.rejects(service.removeImage("Bearer owner",branch,slide.id),e=>e.getStatus()===409);
  slides.get(slide.id).enabled=false;
  await service.removeImage("Bearer owner",branch,slide.id);
  assert.deepEqual(cleanup,[image(slide.id)]);
  assert.equal(configs.get(branch).revision,3);
});

test("L05 popup migration is additive and constrained",()=>{
  const sql=readFileSync(new URL("../prisma/migrations/20261016170000_l05_home_popup/migration.sql",import.meta.url),"utf8");
  assert.match(sql,/CREATE TABLE "HomePopupConfig"/);
  assert.match(sql,/CREATE TABLE "HomePopupSlide"/);
  assert.match(sql,/BETWEEN 5 AND 10080/);
  assert.match(sql,/BETWEEN 2000 AND 10000/);
  assert.doesNotMatch(sql,/DROP TABLE|DELETE FROM|ALTER TABLE "Order"/);
});
