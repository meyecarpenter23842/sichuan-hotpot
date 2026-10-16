import {
  BadRequestException, ConflictException, ForbiddenException, Injectable,
  NotFoundException, ServiceUnavailableException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { HomeOffer } from "@prisma/client";
import { AuthService } from "../auth/auth.service";
import { PrismaService } from "../database/prisma.service";
import { signedR2Url } from "../admin-catalog/r2-product-images.service";

const contentTypes:Record<string,string> = {
  "image/png":".png","image/jpeg":".jpg","image/webp":".webp",
};
const MAX_IMAGE_BYTES=2*1024*1024;
const prefix=(branchId:string,id:string)=>"catalog-media/"+branchId+"/offers/"+id+"/";
export interface OfferChanges {
  title?:string;summary?:string;body?:string;
  sortOrder?:number;enabled?:boolean;
  startAt?:string|null;endAt?:string|null;ctaTarget?:"MENU"|null;
}

export function offerInterval(start:Date|null,end:Date|null) {
  if(start&&end&&start>=end)throw new BadRequestException("OFFER_INVALID_TIME_RANGE");
}
export function offerActive(offer:Pick<HomeOffer,"enabled"|"imageKey"|"startAt"|"endAt">,
 now:Date=new Date()):boolean{
  return offer.enabled&&!!offer.imageKey&&(!offer.startAt||offer.startAt<=now)
    &&(!offer.endAt||offer.endAt>now);
}
function date(value:string|null|undefined,fallback:Date|null):Date|null {
  if(value===undefined)return fallback;
  if(value===null)return null;
  const dt=new Date(value);
  if(!Number.isFinite(dt.getTime())||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(value))
    throw new BadRequestException("OFFER_INVALID_UTC_TIME");
  return dt;
}
function tidy(value:string,field:string,max:number) {
  const result=value.trim();
  if(!result||result.length>max)throw new BadRequestException("INVALID_"+field);
  return result;
}

@Injectable()
export class HomeOffersService{
  constructor(private readonly prisma:PrismaService,private readonly auth:AuthService){}
  private get db(){return this.prisma.database;}
  private async branch(branchId:string){
    if(!await this.db.branch.findUnique({where:{id:branchId},select:{id:true}}))
      throw new NotFoundException("BRANCH_NOT_FOUND");
  }
  private async owner(auth:string|undefined,branchId:string){
    const principal=await this.auth.principal(auth);
    if(principal.role!=="OWNER")throw new ForbiddenException("OWNER_REQUIRED");
    await this.branch(branchId);
  }
  private async item(branchId:string,id:string){
    const row=await this.db.homeOffer.findFirst({where:{id,branchId}});
    if(!row)throw new NotFoundException("OFFER_NOT_FOUND");
    return row;
  }
  async adminList(auth:string|undefined,branchId:string){
    await this.owner(auth,branchId);
    return this.db.homeOffer.findMany({where:{branchId},
      orderBy:[{sortOrder:"asc"},{createdAt:"asc"},{id:"asc"}]});
  }
  async publicList(branchId:string,now:Date=new Date()){
    await this.branch(branchId);
    return this.db.homeOffer.findMany({
      where:{branchId,enabled:true,imageKey:{not:null},AND:[
        {OR:[{startAt:null},{startAt:{lte:now}}]},
        {OR:[{endAt:null},{endAt:{gt:now}}]},
      ]},select:{id:true,title:true,summary:true,body:true,imageKey:true,
        ctaTarget:true,startAt:true,endAt:true,sortOrder:true},
      orderBy:[{sortOrder:"asc"},{createdAt:"asc"},{id:"asc"}],
    });
  }
  async create(auth:string|undefined,branchId:string,input:Required<Pick<OfferChanges,
    "title"|"summary"|"body"|"sortOrder">>&OfferChanges){
    await this.owner(auth,branchId);
    const start=date(input.startAt,null),end=date(input.endAt,null);
    offerInterval(start,end);
    return this.db.homeOffer.create({data:{
      branchId,title:tidy(input.title,"TITLE",160),
      summary:tidy(input.summary,"SUMMARY",360),body:tidy(input.body,"BODY",4000),
      sortOrder:input.sortOrder,enabled:false,startAt:start,endAt:end,
      ctaTarget:input.ctaTarget??null,
    }});
  }
  async update(auth:string|undefined,branchId:string,id:string,revision:number,input:OfferChanges){
    await this.owner(auth,branchId);
    const current=await this.item(branchId,id);
    if(current.revision!==revision)throw new ConflictException("OFFER_CHANGED_RELOAD");
    const start=date(input.startAt,current.startAt),end=date(input.endAt,current.endAt);
    offerInterval(start,end);
    if(input.enabled===true&&!current.imageKey)throw new ConflictException("OFFER_IMAGE_REQUIRED");
    const data={
      ...(input.title===undefined?{}:{title:tidy(input.title,"TITLE",160)}),
      ...(input.summary===undefined?{}:{summary:tidy(input.summary,"SUMMARY",360)}),
      ...(input.body===undefined?{}:{body:tidy(input.body,"BODY",4000)}),
      ...(input.sortOrder===undefined?{}:{sortOrder:input.sortOrder}),
      ...(input.enabled===undefined?{}:{enabled:input.enabled}),
      ...(input.startAt===undefined?{}:{startAt:start}),
      ...(input.endAt===undefined?{}:{endAt:end}),
      ...(input.ctaTarget===undefined?{}:{ctaTarget:input.ctaTarget}),
      revision:{increment:1},
    };
    const changed=await this.db.homeOffer.updateMany({
      where:{id,branchId,revision},data,
    });
    if(changed.count!==1)throw new ConflictException("OFFER_CHANGED_RELOAD");
    return this.item(branchId,id);
  }
  async reorder(auth:string|undefined,branchId:string,ids:string[]){
    await this.owner(auth,branchId);
    const all=await this.db.homeOffer.findMany({where:{branchId},select:{id:true}});
    if(all.length!==ids.length||new Set(ids).size!==ids.length||
      ids.some(id=>!all.some(row=>row.id===id)))throw new BadRequestException("INVALID_OFFER_ORDER");
    await this.db.$transaction(ids.map((id,index)=>this.db.homeOffer.update({
      where:{id},data:{sortOrder:index,revision:{increment:1}},
    })));
    return this.adminList(auth,branchId);
  }
  async remove(auth:string|undefined,branchId:string,id:string){
    await this.owner(auth,branchId);
    await this.db.$transaction(async tx=>{
      const offer=await tx.homeOffer.findFirst({where:{id,branchId}});
      if(!offer)throw new NotFoundException("OFFER_NOT_FOUND");
      await tx.homeOffer.delete({where:{id}});
      if(offer.imageKey)await tx.r2ImageCleanup.upsert({
        where:{key:offer.imageKey},create:{key:offer.imageKey},update:{},
      });
    });
    return {deleted:true};
  }
  async ticket(auth:string|undefined,branchId:string,id:string,
    input:{contentType:string;byteSize:number}){
    await this.owner(auth,branchId);await this.item(branchId,id);
    const ext=contentTypes[input.contentType];
    if(!ext||!Number.isSafeInteger(input.byteSize)||input.byteSize<1
      ||input.byteSize>MAX_IMAGE_BYTES)throw new BadRequestException("INVALID_OFFER_IMAGE");
    const key=prefix(branchId,id)+randomUUID()+ext;
    return {key,contentType:input.contentType,uploadUrl:signedR2Url("PUT",key),
      maxBytes:MAX_IMAGE_BYTES,expiresInSeconds:300};
  }
  async attach(auth:string|undefined,branchId:string,id:string,key:string){
    await this.owner(auth,branchId);await this.item(branchId,id);
    const start=prefix(branchId,id);
    if(!key.startsWith(start)||
      !/^[a-f0-9-]{36}\.(png|jpg|webp)$/.test(key.slice(start.length)))
      throw new BadRequestException("INVALID_OFFER_IMAGE_KEY");
    let response:Response;
    try{response=await fetch(signedR2Url("HEAD",key),
      {method:"HEAD",signal:AbortSignal.timeout(8000)});}
    catch{throw new ServiceUnavailableException("R2_IMAGE_VERIFY_UNAVAILABLE");}
    if(!response.ok)throw new ConflictException("IMAGE_NOT_UPLOADED");
    const bytes=Number(response.headers.get("content-length"));
    const mime=(response.headers.get("content-type")??"").split(";")[0]!.toLowerCase();
    if(!Number.isSafeInteger(bytes)||bytes<1||bytes>MAX_IMAGE_BYTES||
      !contentTypes[mime]||!key.endsWith(contentTypes[mime]))
      throw new BadRequestException("IMAGE_METADATA_MISMATCH");
    return this.setImage(branchId,id,key);
  }
  async removeImage(auth:string|undefined,branchId:string,id:string){
    await this.owner(auth,branchId);return this.setImage(branchId,id,null);
  }
  private async setImage(branchId:string,id:string,key:string|null){
    return this.db.$transaction(async tx=>{
      const offer=await tx.homeOffer.findFirst({where:{id,branchId}});
      if(!offer)throw new NotFoundException("OFFER_NOT_FOUND");
      if(key===null&&offer.enabled)throw new ConflictException("DISABLE_OFFER_BEFORE_REMOVING_IMAGE");
      if(offer.imageKey===key)return offer;
      const changed=await tx.homeOffer.updateMany({
        where:{id,branchId,revision:offer.revision},
        data:{imageKey:key,revision:{increment:1}},
      });
      if(changed.count!==1)throw new ConflictException("OFFER_CHANGED_RELOAD");
      if(offer.imageKey)await tx.r2ImageCleanup.upsert({
        where:{key:offer.imageKey},create:{key:offer.imageKey},update:{},
      });
      return tx.homeOffer.findUniqueOrThrow({where:{id}});
    });
  }
}
