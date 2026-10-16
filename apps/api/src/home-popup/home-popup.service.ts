import {
  BadRequestException,ConflictException,ForbiddenException,Injectable,
  NotFoundException,ServiceUnavailableException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { AuthService } from "../auth/auth.service";
import { PrismaService } from "../database/prisma.service";
import { signedR2Url } from "../admin-catalog/r2-product-images.service";

export interface PopupConfigChanges {
  enabled:boolean;repeatIntervalMinutes:number;slideDwellMs:number;
}
export interface PopupSlideChanges { altText?:string;enabled?:boolean; }

const MAX_IMAGE_BYTES=2*1024*1024;
const contentTypes:Record<string,string>={
  "image/png":".png","image/jpeg":".jpg","image/webp":".webp",
};
const imagePrefix=(branchId:string,id:string)=>"catalog-media/"+branchId+"/popup/"+id+"/";
const defaultConfig=(branchId:string)=>({
  branchId,enabled:false,repeatIntervalMinutes:360,slideDwellMs:4000,
  revision:0,updatedAt:null,
});
function cleanAlt(value:string){
  const clean=value.trim();
  if(!clean||clean.length>200)throw new BadRequestException("INVALID_POPUP_ALT");
  return clean;
}
function validateConfig(input:PopupConfigChanges){
  if(!Number.isInteger(input.repeatIntervalMinutes)||input.repeatIntervalMinutes<5||
    input.repeatIntervalMinutes>10080||!Number.isInteger(input.slideDwellMs)||
    input.slideDwellMs<2000||input.slideDwellMs>10000)
    throw new BadRequestException("INVALID_POPUP_CONFIG");
}

@Injectable()
export class HomePopupService {
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
  private async slide(branchId:string,id:string){
    const row=await this.db.homePopupSlide.findFirst({where:{id,branchId}});
    if(!row)throw new NotFoundException("POPUP_SLIDE_NOT_FOUND");
    return row;
  }
  private async touch(tx:Prisma.TransactionClient,branchId:string){
    await tx.homePopupConfig.upsert({
      where:{branchId},
      create:{branchId,revision:1},
      update:{revision:{increment:1}},
    });
  }
  private async payload(branchId:string,admin:boolean){
    const [settings,slides]=await Promise.all([
      this.db.homePopupConfig.findUnique({where:{branchId}}),
      this.db.homePopupSlide.findMany({
        where:admin?{branchId}:{branchId,enabled:true,imageKey:{not:null}},
        orderBy:[{sortOrder:"asc"},{createdAt:"asc"},{id:"asc"}],
        ...(admin?{}:{select:{id:true,imageKey:true,altText:true,sortOrder:true}}),
      }),
    ]);
    return {settings:settings??defaultConfig(branchId),slides};
  }
  async publicGet(branchId:string){await this.branch(branchId);return this.payload(branchId,false);}
  async adminGet(auth:string|undefined,branchId:string){
    await this.owner(auth,branchId);return this.payload(branchId,true);
  }
  async updateConfig(auth:string|undefined,branchId:string,revision:number,input:PopupConfigChanges){
    await this.owner(auth,branchId);validateConfig(input);
    const current=await this.db.homePopupConfig.findUnique({where:{branchId}});
    if(!current){
      if(revision!==0)throw new ConflictException("POPUP_CONFIG_CHANGED_RELOAD");
      try{return await this.db.homePopupConfig.create({data:{branchId,...input}});}
      catch{throw new ConflictException("POPUP_CONFIG_CHANGED_RELOAD");}
    }
    if(current.revision!==revision)throw new ConflictException("POPUP_CONFIG_CHANGED_RELOAD");
    const changed=await this.db.homePopupConfig.updateMany({
      where:{branchId,revision},data:{...input,revision:{increment:1}},
    });
    if(changed.count!==1)throw new ConflictException("POPUP_CONFIG_CHANGED_RELOAD");
    return this.db.homePopupConfig.findUniqueOrThrow({where:{branchId}});
  }
  async createSlide(auth:string|undefined,branchId:string,input:{altText:string;sortOrder:number}){
    await this.owner(auth,branchId);
    return this.db.$transaction(async tx=>{
      const row=await tx.homePopupSlide.create({data:{
        branchId,altText:cleanAlt(input.altText),sortOrder:input.sortOrder,enabled:false,
      }});
      await this.touch(tx,branchId);return row;
    });
  }
  async updateSlide(auth:string|undefined,branchId:string,id:string,revision:number,input:PopupSlideChanges){
    await this.owner(auth,branchId);
    const current=await this.slide(branchId,id);
    if(current.revision!==revision)throw new ConflictException("POPUP_SLIDE_CHANGED_RELOAD");
    if(input.enabled===true&&!current.imageKey)throw new ConflictException("POPUP_IMAGE_REQUIRED");
    return this.db.$transaction(async tx=>{
      const changed=await tx.homePopupSlide.updateMany({
        where:{id,branchId,revision},
        data:{
          ...(input.altText===undefined?{}:{altText:cleanAlt(input.altText)}),
          ...(input.enabled===undefined?{}:{enabled:input.enabled}),
          revision:{increment:1},
        },
      });
      if(changed.count!==1)throw new ConflictException("POPUP_SLIDE_CHANGED_RELOAD");
      await this.touch(tx,branchId);
      return tx.homePopupSlide.findUniqueOrThrow({where:{id}});
    });
  }
  async reorder(auth:string|undefined,branchId:string,ids:string[]){
    await this.owner(auth,branchId);
    const all=await this.db.homePopupSlide.findMany({where:{branchId},select:{id:true}});
    if(all.length!==ids.length||new Set(ids).size!==ids.length||
      ids.some(id=>!all.some(row=>row.id===id)))throw new BadRequestException("INVALID_POPUP_ORDER");
    return this.db.$transaction(async tx=>{
      for(let index=0;index<ids.length;index++){
        await tx.homePopupSlide.update({where:{id:ids[index]!},
          data:{sortOrder:index,revision:{increment:1}}});
      }
      await this.touch(tx,branchId);
      const settings=await tx.homePopupConfig.findUnique({where:{branchId}});
      const slides=await tx.homePopupSlide.findMany({where:{branchId},
        orderBy:[{sortOrder:"asc"},{createdAt:"asc"},{id:"asc"}]});
      return {settings:settings??defaultConfig(branchId),slides};
    });
  }
  async removeSlide(auth:string|undefined,branchId:string,id:string){
    await this.owner(auth,branchId);
    await this.db.$transaction(async tx=>{
      const current=await tx.homePopupSlide.findFirst({where:{id,branchId}});
      if(!current)throw new NotFoundException("POPUP_SLIDE_NOT_FOUND");
      await tx.homePopupSlide.delete({where:{id}});
      if(current.imageKey)await tx.r2ImageCleanup.upsert({
        where:{key:current.imageKey},create:{key:current.imageKey},update:{},
      });
      await this.touch(tx,branchId);
    });
    return {deleted:true};
  }
  async ticket(auth:string|undefined,branchId:string,id:string,input:{contentType:string;byteSize:number}){
    await this.owner(auth,branchId);await this.slide(branchId,id);
    const ext=contentTypes[input.contentType];
    if(!ext||!Number.isSafeInteger(input.byteSize)||input.byteSize<1||input.byteSize>MAX_IMAGE_BYTES)
      throw new BadRequestException("INVALID_POPUP_IMAGE");
    const key=imagePrefix(branchId,id)+randomUUID()+ext;
    return {key,contentType:input.contentType,uploadUrl:signedR2Url("PUT",key),
      maxBytes:MAX_IMAGE_BYTES,expiresInSeconds:300};
  }
  async attach(auth:string|undefined,branchId:string,id:string,key:string){
    await this.owner(auth,branchId);await this.slide(branchId,id);
    const start=imagePrefix(branchId,id);
    if(!key.startsWith(start)||!/^[a-f0-9-]{36}\.(png|jpg|webp)$/.test(key.slice(start.length)))
      throw new BadRequestException("INVALID_POPUP_IMAGE_KEY");
    let response:Response;
    try{response=await fetch(signedR2Url("HEAD",key),{method:"HEAD",signal:AbortSignal.timeout(8000)});}
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
      const current=await tx.homePopupSlide.findFirst({where:{id,branchId}});
      if(!current)throw new NotFoundException("POPUP_SLIDE_NOT_FOUND");
      if(key===null&&current.enabled)
        throw new ConflictException("DISABLE_POPUP_SLIDE_BEFORE_REMOVING_IMAGE");
      if(current.imageKey===key)return current;
      const changed=await tx.homePopupSlide.updateMany({
        where:{id,branchId,revision:current.revision},
        data:{imageKey:key,revision:{increment:1}},
      });
      if(changed.count!==1)throw new ConflictException("POPUP_SLIDE_CHANGED_RELOAD");
      if(current.imageKey)await tx.r2ImageCleanup.upsert({
        where:{key:current.imageKey},create:{key:current.imageKey},update:{},
      });
      await this.touch(tx,branchId);
      return tx.homePopupSlide.findUniqueOrThrow({where:{id}});
    });
  }
}
