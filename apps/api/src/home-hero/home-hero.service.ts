import {
  BadRequestException, ConflictException, ForbiddenException, Injectable,
  NotFoundException, ServiceUnavailableException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { AuthService } from "../auth/auth.service";
import { PrismaService } from "../database/prisma.service";
import { signedR2Url } from "../admin-catalog/r2-product-images.service";

export type HeroTransitionType="fade"|"slide"|"wipe";
export interface HeroConfigChanges {
  autoplay:boolean;dwellMs:number;transitionType:HeroTransitionType;transitionDurationMs:number;
}
export interface HeroSlideChanges {
  altText?:string;title?:string|null;subtitle?:string|null;ctaTarget?:"MENU"|null;enabled?:boolean;
}
const MAX_IMAGE_BYTES=2*1024*1024;
const contentTypes:Record<string,string>={
  "image/png":".png","image/jpeg":".jpg","image/webp":".webp",
};
const imagePrefix=(branchId:string,id:string)=>"catalog-media/"+branchId+"/hero/"+id+"/";
const defaultConfig=(branchId:string)=>({
  branchId,autoplay:true,dwellMs:5000,transitionType:"fade" as HeroTransitionType,
  transitionDurationMs:450,revision:0,updatedAt:null,
});
function tidy(value:string,field:string,max:number){
  const clean=value.trim();
  if(!clean||clean.length>max)throw new BadRequestException("INVALID_HERO_"+field);
  return clean;
}
function optionalText(value:string|null|undefined,max:number){
  if(value===undefined)return undefined;
  if(value===null)return null;
  const clean=value.trim();
  if(clean.length>max)throw new BadRequestException("INVALID_HERO_TEXT");
  return clean||null;
}
function validateConfig(input:HeroConfigChanges){
  if(!Number.isInteger(input.dwellMs)||input.dwellMs<2000||input.dwellMs>10000||
    !Number.isInteger(input.transitionDurationMs)||input.transitionDurationMs<250||
    input.transitionDurationMs>1000||!["fade","slide","wipe"].includes(input.transitionType))
    throw new BadRequestException("INVALID_HERO_CONFIG");
}

@Injectable()
export class HomeHeroService {
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
    const row=await this.db.homeHeroSlide.findFirst({where:{id,branchId}});
    if(!row)throw new NotFoundException("HERO_SLIDE_NOT_FOUND");
    return row;
  }
  private async payload(branchId:string,admin:boolean){
    const [settings,slides]=await Promise.all([
      this.db.homeHeroConfig.findUnique({where:{branchId}}),
      this.db.homeHeroSlide.findMany({
        where:admin?{branchId}:{branchId,enabled:true,imageKey:{not:null}},
        orderBy:[{sortOrder:"asc"},{createdAt:"asc"},{id:"asc"}],
        ...(admin?{}:{select:{id:true,imageKey:true,altText:true,title:true,subtitle:true,
          ctaTarget:true,sortOrder:true}}),
      }),
    ]);
    return {settings:settings??defaultConfig(branchId),slides};
  }
  async publicGet(branchId:string){
    await this.branch(branchId);
    return this.payload(branchId,false);
  }
  async adminGet(auth:string|undefined,branchId:string){
    await this.owner(auth,branchId);
    return this.payload(branchId,true);
  }
  async updateConfig(auth:string|undefined,branchId:string,revision:number,input:HeroConfigChanges){
    await this.owner(auth,branchId);validateConfig(input);
    const current=await this.db.homeHeroConfig.findUnique({where:{branchId}});
    if(!current){
      if(revision!==0)throw new ConflictException("HERO_CONFIG_CHANGED_RELOAD");
      try{
        return await this.db.homeHeroConfig.create({data:{branchId,...input}});
      }catch{throw new ConflictException("HERO_CONFIG_CHANGED_RELOAD");}
    }
    if(current.revision!==revision)throw new ConflictException("HERO_CONFIG_CHANGED_RELOAD");
    const changed=await this.db.homeHeroConfig.updateMany({
      where:{branchId,revision},data:{...input,revision:{increment:1}},
    });
    if(changed.count!==1)throw new ConflictException("HERO_CONFIG_CHANGED_RELOAD");
    return this.db.homeHeroConfig.findUniqueOrThrow({where:{branchId}});
  }
  async createSlide(auth:string|undefined,branchId:string,input:{
    altText:string;title?:string|null;subtitle?:string|null;ctaTarget?:"MENU"|null;sortOrder:number;
  }){
    await this.owner(auth,branchId);
    return this.db.homeHeroSlide.create({data:{
      branchId,altText:tidy(input.altText,"ALT",200),
      title:optionalText(input.title,160),subtitle:optionalText(input.subtitle,280),
      ctaTarget:input.ctaTarget??null,sortOrder:input.sortOrder,enabled:false,
    }});
  }
  async updateSlide(auth:string|undefined,branchId:string,id:string,revision:number,input:HeroSlideChanges){
    await this.owner(auth,branchId);
    const current=await this.slide(branchId,id);
    if(current.revision!==revision)throw new ConflictException("HERO_SLIDE_CHANGED_RELOAD");
    if(input.enabled===true&&!current.imageKey)throw new ConflictException("HERO_IMAGE_REQUIRED");
    const data={
      ...(input.altText===undefined?{}:{altText:tidy(input.altText,"ALT",200)}),
      ...(input.title===undefined?{}:{title:optionalText(input.title,160)}),
      ...(input.subtitle===undefined?{}:{subtitle:optionalText(input.subtitle,280)}),
      ...(input.ctaTarget===undefined?{}:{ctaTarget:input.ctaTarget}),
      ...(input.enabled===undefined?{}:{enabled:input.enabled}),
      revision:{increment:1},
    };
    const changed=await this.db.homeHeroSlide.updateMany({where:{id,branchId,revision},data});
    if(changed.count!==1)throw new ConflictException("HERO_SLIDE_CHANGED_RELOAD");
    return this.slide(branchId,id);
  }
  async reorder(auth:string|undefined,branchId:string,ids:string[]){
    await this.owner(auth,branchId);
    const all=await this.db.homeHeroSlide.findMany({where:{branchId},select:{id:true}});
    if(all.length!==ids.length||new Set(ids).size!==ids.length||
      ids.some(id=>!all.some(row=>row.id===id)))
      throw new BadRequestException("INVALID_HERO_ORDER");
    await this.db.$transaction(ids.map((id,index)=>this.db.homeHeroSlide.update({
      where:{id},data:{sortOrder:index,revision:{increment:1}},
    })));
    return this.payload(branchId,true);
  }
  async removeSlide(auth:string|undefined,branchId:string,id:string){
    await this.owner(auth,branchId);
    await this.db.$transaction(async tx=>{
      const current=await tx.homeHeroSlide.findFirst({where:{id,branchId}});
      if(!current)throw new NotFoundException("HERO_SLIDE_NOT_FOUND");
      await tx.homeHeroSlide.delete({where:{id}});
      if(current.imageKey)await tx.r2ImageCleanup.upsert({
        where:{key:current.imageKey},create:{key:current.imageKey},update:{},
      });
    });
    return {deleted:true};
  }
  async ticket(auth:string|undefined,branchId:string,id:string,input:{contentType:string;byteSize:number}){
    await this.owner(auth,branchId);await this.slide(branchId,id);
    const ext=contentTypes[input.contentType];
    if(!ext||!Number.isSafeInteger(input.byteSize)||input.byteSize<1||input.byteSize>MAX_IMAGE_BYTES)
      throw new BadRequestException("INVALID_HERO_IMAGE");
    const key=imagePrefix(branchId,id)+randomUUID()+ext;
    return {key,contentType:input.contentType,uploadUrl:signedR2Url("PUT",key),
      maxBytes:MAX_IMAGE_BYTES,expiresInSeconds:300};
  }
  async attach(auth:string|undefined,branchId:string,id:string,key:string){
    await this.owner(auth,branchId);await this.slide(branchId,id);
    const start=imagePrefix(branchId,id);
    if(!key.startsWith(start)||!/^[a-f0-9-]{36}\.(png|jpg|webp)$/.test(key.slice(start.length)))
      throw new BadRequestException("INVALID_HERO_IMAGE_KEY");
    let response:Response;
    try{
      response=await fetch(signedR2Url("HEAD",key),{method:"HEAD",signal:AbortSignal.timeout(8000)});
    }catch{throw new ServiceUnavailableException("R2_IMAGE_VERIFY_UNAVAILABLE");}
    if(!response.ok)throw new ConflictException("IMAGE_NOT_UPLOADED");
    const bytes=Number(response.headers.get("content-length"));
    const mime=(response.headers.get("content-type")??"").split(";")[0]!.toLowerCase();
    if(!Number.isSafeInteger(bytes)||bytes<1||bytes>MAX_IMAGE_BYTES||
      !contentTypes[mime]||!key.endsWith(contentTypes[mime]))
      throw new BadRequestException("IMAGE_METADATA_MISMATCH");
    return this.setImage(branchId,id,key);
  }
  async removeImage(auth:string|undefined,branchId:string,id:string){
    await this.owner(auth,branchId);
    return this.setImage(branchId,id,null);
  }
  private async setImage(branchId:string,id:string,key:string|null){
    return this.db.$transaction(async tx=>{
      const current=await tx.homeHeroSlide.findFirst({where:{id,branchId}});
      if(!current)throw new NotFoundException("HERO_SLIDE_NOT_FOUND");
      if(key===null&&current.enabled)
        throw new ConflictException("DISABLE_HERO_SLIDE_BEFORE_REMOVING_IMAGE");
      if(current.imageKey===key)return current;
      const changed=await tx.homeHeroSlide.updateMany({
        where:{id,branchId,revision:current.revision},
        data:{imageKey:key,revision:{increment:1}},
      });
      if(changed.count!==1)throw new ConflictException("HERO_SLIDE_CHANGED_RELOAD");
      if(current.imageKey)await tx.r2ImageCleanup.upsert({
        where:{key:current.imageKey},create:{key:current.imageKey},update:{},
      });
      return tx.homeHeroSlide.findUniqueOrThrow({where:{id}});
    });
  }
}
