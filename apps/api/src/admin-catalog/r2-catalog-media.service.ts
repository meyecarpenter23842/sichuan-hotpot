import { BadRequestException, ConflictException, Injectable, NotFoundException,
 ServiceUnavailableException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { AuthService } from "../auth/auth.service";
import { PrismaService } from "../database/prisma.service";
import { signedR2Url, R2ProductImagesService } from "./r2-product-images.service";
export type MediaKind = "categories" | "groups" | "options";
const extensions: Record<string,string> = {"image/png":".png","image/jpeg":".jpg","image/webp":".webp"};
@Injectable()
export class R2CatalogMediaService {
 constructor(private readonly auth: AuthService,private readonly prisma: PrismaService,
 private readonly r2: R2ProductImagesService){}
 private async check(auth:string|undefined, branchId:string, kind:MediaKind,id:string){
  await this.auth.adminAccess(auth,branchId);
  const db=this.prisma.database;
  const found=kind==="categories"?await db.catalogCategory.findFirst({where:{id,branchId},select:{imageKey:true}})
   :kind==="groups"?await db.modifierGroup.findFirst({where:{id,branchId},select:{imageKey:true}})
   :await db.modifierOption.findFirst({where:{id,group:{branchId}},select:{imageKey:true}});
  if(!found)throw new NotFoundException("CATALOG_ITEM_NOT_FOUND");
  return found.imageKey;
 }
 async ticket(auth:string|undefined,branchId:string,kind:MediaKind,id:string,input:{contentType:string;byteSize:number}){
  await this.check(auth,branchId,kind,id);
  const ext=extensions[input.contentType];
  if(!ext||!Number.isSafeInteger(input.byteSize)||input.byteSize<1||input.byteSize>2097152)
   throw new BadRequestException("INVALID_IMAGE");
  const key="catalog-media/"+branchId+"/"+kind+"/"+id+"/"+randomUUID()+ext;
  return {key,uploadUrl:signedR2Url("PUT",key),contentType:input.contentType,maxBytes:2097152,expiresInSeconds:300};
 }
 async attach(auth:string|undefined,branchId:string,kind:MediaKind,id:string,key:string){
  await this.check(auth,branchId,kind,id);
  const prefix="catalog-media/"+branchId+"/"+kind+"/"+id+"/";
  if(!key.startsWith(prefix)||!/^[a-f0-9-]{36}\.(png|jpg|webp)$/.test(key.slice(prefix.length)))
   throw new BadRequestException("INVALID_IMAGE_KEY");
  let head:Response;
  try{head=await fetch(signedR2Url("HEAD",key),{method:"HEAD",signal:AbortSignal.timeout(8000)});}
  catch{throw new ServiceUnavailableException("R2_IMAGE_VERIFY_UNAVAILABLE");}
  if(!head.ok)throw new ConflictException("IMAGE_NOT_UPLOADED");
  const size=Number(head.headers.get("content-length"));
  const mime=(head.headers.get("content-type")??"").split(";")[0]!.toLowerCase();
  if(!Number.isSafeInteger(size)||size<1||size>2097152||!extensions[mime]||!key.endsWith(extensions[mime]))
   throw new BadRequestException("IMAGE_METADATA_MISMATCH");
  return this.replace(auth,branchId,kind,id,key);
 }
 async remove(auth:string|undefined,branchId:string,kind:MediaKind,id:string){
  return this.replace(auth,branchId,kind,id,null);
 }
 private async replace(auth:string|undefined,branchId:string,kind:MediaKind,id:string,key:string|null){
  await this.check(auth,branchId,kind,id);
  const result=await this.prisma.database.$transaction(async tx=>{
   const previous=kind==="categories"?await tx.catalogCategory.findFirst({where:{id,branchId},select:{imageKey:true}})
    :kind==="groups"?await tx.modifierGroup.findFirst({where:{id,branchId},select:{imageKey:true}})
    :await tx.modifierOption.findFirst({where:{id,group:{branchId}},select:{imageKey:true}});
   if(!previous)throw new NotFoundException("CATALOG_ITEM_NOT_FOUND");
   // An image required for publication cannot be detached while the item is on sale.
   if(key===null&&kind==="groups"){
     const active=await tx.modifierGroup.findUnique({where:{id},select:{isAvailable:true}});
     if(active?.isAvailable)throw new ConflictException("DISABLE_GROUP_BEFORE_IMAGE_REMOVAL");
   }
   if(key===null&&kind==="options"){
     const active=await tx.modifierOption.findUnique({where:{id},select:{isAvailable:true}});
     if(active?.isAvailable)throw new ConflictException("DISABLE_TOPPING_BEFORE_IMAGE_REMOVAL");
   }
   if(previous.imageKey===key)return {id,imageKey:key};
   const changed=kind==="categories"?await tx.catalogCategory.updateMany({
    where:{id,branchId,imageKey:previous.imageKey},data:{imageKey:key}})
    :kind==="groups"?await tx.modifierGroup.updateMany({
    where:{id,branchId,imageKey:previous.imageKey},data:{imageKey:key}})
    :await tx.modifierOption.updateMany({
    where:{id,group:{branchId},imageKey:previous.imageKey},data:{imageKey:key}});
   if(changed.count!==1)throw new ConflictException("IMAGE_CHANGED_RETRY");
   if(previous.imageKey?.startsWith("catalog-media/"))await tx.r2ImageCleanup.upsert({
    where:{key:previous.imageKey},create:{key:previous.imageKey},update:{},
   });
   return {id,imageKey:key};
  });
  await this.r2.cleanupPending();
  return result;
 }
}
