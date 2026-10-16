import React,{useCallback,useEffect,useState} from "react";
import { Image,Platform,Pressable,StyleSheet,Text,View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system/legacy";
import { request,imageUrl } from "./api";
import { Action,Field,Notice } from "./ui";
import { StatusSwitch } from "./StatusSwitch";
import { prepareProductImage } from "./prepare-product-image";
import { c } from "./theme";

export interface HomeOffer {
  id:string;title:string;summary:string;body:string;imageKey:string|null;
  sortOrder:number;enabled:boolean;startAt:string|null;endAt:string|null;
  ctaTarget:"MENU"|null;revision:number;
}
type Editor = {
  id:string|null;revision:number;title:string;summary:string;body:string;
  start:string;end:string;cta:boolean;
};
const empty=():Editor=>({id:null,revision:0,title:"",summary:"",body:"",
  start:"",end:"",cta:false});
/** Calendar fields are local Vietnam time; the API/database always receive UTC. */
export function vnLocalToUtc(input:string):string|null {
  if(!input.trim())return null;
  const match=/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})$/.exec(input.trim());
  if(!match)throw Error("Thời gian theo định dạng YYYY-MM-DD HH:mm (giờ Việt Nam).");
  const [,year,month,day,hour,minute]=match.map(Number);
  const utc=Date.UTC(year,month-1,day,hour-7,minute,0);
  const check=new Date(utc+7*3600000);
  if(check.getUTCFullYear()!==year||check.getUTCMonth()+1!==month||
    check.getUTCDate()!==day||check.getUTCHours()!==hour||check.getUTCMinutes()!==minute)
    throw Error("Ngày giờ không hợp lệ.");
  return new Date(utc).toISOString();
}
export function utcToVnLocal(iso:string|null):string{
  if(!iso)return "";
  return new Date(Date.parse(iso)+7*3600000).toISOString().slice(0,16).replace("T"," ");
}
function fromOffer(offer:HomeOffer):Editor {
 return {id:offer.id,revision:offer.revision,title:offer.title,
  summary:offer.summary,body:offer.body,start:utcToVnLocal(offer.startAt),
  end:utcToVnLocal(offer.endAt),cta:offer.ctaTarget==="MENU"};
}

export function HomeOffersPanel({token,branchId,onDirtyChange}:{
 token:string;branchId:string;onDirtyChange:(value:boolean)=>void;
}) {
 const [offers,setOffers]=useState<HomeOffer[]>([]);
 const [editor,setEditor]=useState<Editor|null>(null);
 const [busy,setBusy]=useState(false);
 const [loading,setLoading]=useState(true);
 const [error,setError]=useState("");
 const [notice,setNotice]=useState("");
 const [unsaved,setUnsaved]=useState(false);
 const [discardArmed,setDiscardArmed]=useState(false);
 const root="/admin/branches/"+branchId+"/offers";
 const load=useCallback(async()=>{
   const list=await request<HomeOffer[]>(root,token);
   setOffers(list);
   setEditor(old=>{
     if(!old?.id)return old;
     const current=list.find(item=>item.id===old.id);
     return current?{...old,revision:current.revision}:old;
   });
 },[root,token]);
 useEffect(()=>{
   let active=true;
   setLoading(true);setError("");setEditor(null);
   void request<HomeOffer[]>(root,token).then(items=>{
     if(active)setOffers(items);
   }).catch(e=>{if(active)setError(e instanceof Error?e.message:"Không tải được ưu đãi.");})
     .finally(()=>{if(active)setLoading(false);});
   return ()=>{active=false;};
 },[root,token]);
 const change=(values:Partial<Editor>)=>{
   setEditor(old=>old?{...old,...values}:old);setUnsaved(true);
   setDiscardArmed(false);onDirtyChange(true);
 };
 const run=async(action:()=>Promise<void>,success:string)=>{
   if(busy)return;
   setBusy(true);setError("");setNotice("");
   try{await action();await load();setNotice(success);}
   catch(e){setError(e instanceof Error?e.message:"Có lỗi xảy ra. Vui lòng thử lại.");}
   finally{setBusy(false);}
 };
 const save=()=>{
   if(!editor)return;
   void run(async()=>{
     const startAt=vnLocalToUtc(editor.start),endAt=vnLocalToUtc(editor.end);
     if(startAt&&endAt&&startAt>=endAt)throw Error("Thời điểm kết thúc phải sau bắt đầu.");
     const data={title:editor.title.trim(),summary:editor.summary.trim(),
       body:editor.body.trim(),startAt,endAt,ctaTarget:editor.cta?"MENU":null};
     if(!data.title||!data.summary||!data.body)
       throw Error("Nhập tên, mô tả ngắn và nội dung chương trình.");
     if(editor.id){
       const saved=await request<HomeOffer>(root+"/"+editor.id,token,"PATCH",{
         ...data,revision:editor.revision});
       setEditor(fromOffer(saved));
     }else{
       const created=await request<HomeOffer>(root,token,"POST",{
         ...data,sortOrder:offers.length,enabled:false});
       setEditor(fromOffer(created));
     }
     setUnsaved(false);onDirtyChange(false);
   },"Đã lưu nội dung ưu đãi lên máy chủ. Thêm ảnh và bật hiển thị khi sẵn sàng.");
 };
 const toggle=(offer:HomeOffer,value:boolean)=>void run(async()=>{
   if(value&&!offer.imageKey)throw Error("Hãy thêm ảnh trước khi bật ưu đãi.");
   const saved=await request<HomeOffer>(root+"/"+offer.id,token,"PATCH",
     {revision:offer.revision,enabled:value});
   setEditor(old=>old?.id===saved.id?fromOffer(saved):old);
 },"Đã cập nhật trạng thái ưu đãi.");
 const changeOrder=(index:number,delta:number)=>void run(async()=>{
   const next=[...offers],other=index+delta;
   if(other<0||other>=next.length)return;
   [next[index],next[other]]=[next[other]!,next[index]!];
   await request(root+"/order",token,"PUT",{ids:next.map(offer=>offer.id)});
 },"Đã lưu thứ tự hiển thị.");
 const deleteOffer=(offer:HomeOffer)=>void run(async()=>{
   // Two-tap confirmation avoids a browser-native confirm/modal over the settings modal.
   if(editor?.id!==offer.id)throw Error("Chọn Sửa ưu đãi cần xóa trước.");
   await request(root+"/"+offer.id,token,"DELETE");
   setEditor(null);setDeleteArmed(false);setUnsaved(false);onDirtyChange(false);
 },"Đã xóa ưu đãi, ảnh cũ được đưa vào hàng chờ dọn an toàn.");
 const [deleteArmed,setDeleteArmed]=useState(false);
 async function doUpload(id:string,blob:Blob|{uri:string;size:number;mime:string},mime:string){
   const length="size" in blob?blob.size:0;
   const endpoint=root+"/"+id+"/image";
   const ticket=await request<{key:string;uploadUrl:string;contentType:string}>(
     endpoint+"/ticket",token,"POST",{contentType:mime,byteSize:length});
   if("uri" in blob){
     const sent=await FileSystem.uploadAsync(ticket.uploadUrl,blob.uri,{
       httpMethod:"PUT",uploadType:FileSystem.FileSystemUploadType.BINARY_CONTENT,
       headers:{"Content-Type":ticket.contentType}});
     if(sent.status<200||sent.status>=300)throw Error("R2 từ chối ảnh, hãy kiểm tra kết nối.");
   }else{
     const sent=await fetch(ticket.uploadUrl,{
       method:"PUT",headers:{"Content-Type":ticket.contentType},body:blob});
     if(!sent.ok)throw Error("R2 từ chối ảnh. Kiểm tra CORS bucket media.");
   }
   await request(endpoint+"/attach",token,"POST",{key:ticket.key});
 }
 const pickImage=()=>{
   const id=editor?.id;
   if(!id){setError("Lưu nội dung trước rồi mới gắn ảnh ưu đãi.");return;}
   if(Platform.OS==="web"){
     const input=document.createElement("input");input.type="file";input.accept="image/png,image/jpeg,image/webp";
     input.onchange=()=>{
       const file=input.files?.[0];if(!file)return;
       void run(async()=>{
         const prepared=await prepareProductImage(file);
         await doUpload(id,prepared.blob,prepared.contentType);
       },"Đã tải ảnh ưu đãi lên R2 và xác nhận lưu thành công.");
     };input.click();return;
   }
   void (async()=>{
     const result=await ImagePicker.launchImageLibraryAsync({
       mediaTypes:["images"],allowsEditing:true,quality:0.6});
     const asset=result.assets?.[0];if(result.canceled||!asset)return;
     const mime=(asset.mimeType??"image/jpeg").toLowerCase();
     if(!["image/png","image/jpeg","image/webp"].includes(mime)){
       setError("Ảnh phải là JPG, PNG hoặc WebP.");return;}
     const info=await FileSystem.getInfoAsync(asset.uri);
     const size=info.exists?info.size:undefined;
     if(!size||size>2097152){setError("Ảnh Android phải nhỏ hơn 2 MB.");return;}
     await run(()=>doUpload(id,{uri:asset.uri,size,mime},mime),
       "Đã tải ảnh ưu đãi lên R2.");
   })().catch(e=>setError(e instanceof Error?e.message:"Không chọn được ảnh."));
 };
 const current=editor?.id?offers.find(item=>item.id===editor.id):null;
 return <View style={s.page}>
   <Text style={s.hint}>Chương trình chỉ mang tính thông tin. Không tự trừ tiền trong giỏ.</Text>
   {!!error&&<Notice text={error} error/>}
   {!!notice&&<Notice text={notice}/>}
   {loading?<Text style={s.hint}>Đang tải ưu đãi…</Text>:null}
   {!editor?<View style={s.list}>
     <Action label="＋ Tạo ưu đãi" disabled={busy} onPress={()=>{
       setEditor(empty());setError("");setNotice("");setDeleteArmed(false);
       setDiscardArmed(false);setUnsaved(false);
     }}/>
     {!loading&&offers.length===0&&<Text style={s.hint}>
       Chưa có chương trình nào. Tạo ưu đãi đầu tiên để xuất hiện trên trang chủ khách.</Text>}
     {offers.map((offer,index)=><View key={offer.id} style={s.item}>
       {imageUrl(offer.imageKey)&&<Image source={{uri:imageUrl(offer.imageKey)!}} style={s.thumb}/>}
       <View style={{flex:1,gap:3}}>
         <Text style={s.name} numberOfLines={2}>{offer.title}</Text>
         <Text style={s.hint} numberOfLines={1}>{offer.enabled?"Đang bật":"Bản nháp / đã tắt"}</Text>
         <View style={s.tools}>
           <Pressable accessibilityRole="button" accessibilityLabel={"Sửa "+offer.title}
             style={s.tool} onPress={()=>{setEditor(fromOffer(offer));setDeleteArmed(false);
               setDiscardArmed(false);setUnsaved(false);setError("");}}>
             <Text style={s.link}>Sửa / ảnh</Text>
           </Pressable>
           <Pressable accessibilityRole="button" accessibilityLabel={"Đưa "+offer.title+" lên"}
             style={s.tool} disabled={index===0||busy} onPress={()=>changeOrder(index,-1)}>
             <Text style={s.link}>↑</Text>
           </Pressable>
           <Pressable accessibilityRole="button" accessibilityLabel={"Đưa "+offer.title+" xuống"}
             style={s.tool} disabled={index===offers.length-1||busy} onPress={()=>changeOrder(index,1)}>
             <Text style={s.link}>↓</Text>
           </Pressable>
         </View>
       </View>
       <StatusSwitch label={"Hiển thị "+offer.title} value={offer.enabled} busy={busy}
         disabled={!offer.enabled&&!offer.imageKey} hint={!offer.imageKey?"Thêm ảnh trước khi bật":undefined}
         onValueChange={value=>toggle(offer,value)}/>
     </View>)}
   </View>:<View style={s.edit}>
     <Pressable accessibilityRole="button" style={s.back} onPress={()=>{
       if(unsaved&&!discardArmed){setDiscardArmed(true);
         setNotice("Có thay đổi chưa lưu. Chạm Quay lại lần nữa để bỏ.");return;}
       setEditor(null);setDeleteArmed(false);setDiscardArmed(false);
       setUnsaved(false);onDirtyChange(false);}}>
       <Text style={s.link}>← Danh sách ưu đãi</Text>
     </Pressable>
     <Field label="Tên chương trình" value={editor.title}
       placeholder="Ví dụ: Quà tặng cuối tuần" onChangeText={title=>change({title})}/>
     <Field label="Mô tả ngắn" value={editor.summary}
       placeholder="Giới thiệu cho khách trên trang chủ" onChangeText={summary=>change({summary})}/>
     <Field label="Nội dung ưu đãi" multiline value={editor.body}
       placeholder="Quy định và nội dung chương trình..." onChangeText={body=>change({body})}/>
     <Field label="Bắt đầu (giờ VN: YYYY-MM-DD HH:mm, để trống = ngay)" value={editor.start}
       placeholder="2026-10-18 08:00" onChangeText={start=>change({start})}/>
     <Field label="Kết thúc (giờ VN: YYYY-MM-DD HH:mm, để trống = không giới hạn)" value={editor.end}
       placeholder="2026-10-20 22:00" onChangeText={end=>change({end})}/>
     <Pressable accessibilityRole="checkbox" accessibilityState={{checked:editor.cta}}
       onPress={()=>change({cta:!editor.cta})} style={s.check}>
       <Text style={s.name}>{editor.cta?"☑":"☐"} Nút Xem thực đơn trong popup</Text>
     </Pressable>
     <Action label={busy?"Đang lưu…":"Lưu nội dung"} onPress={save} disabled={busy}/>
     {editor.id&&<View style={s.media}>
       <Text style={s.name}>Ảnh ưu đãi riêng</Text>
       {current?.imageKey&&imageUrl(current.imageKey)&&
         <Image source={{uri:imageUrl(current.imageKey)!}} resizeMode="cover"
           style={s.preview}/>}
       <Action secondary label={busy?"Đang tải ảnh…":"Chọn / thay ảnh R2"}
         onPress={pickImage} disabled={busy}/>
       {current?.imageKey&&!current.enabled&&<Action secondary label="Gỡ ảnh"
         disabled={busy} onPress={()=>void run(()=>request(root+"/"+editor.id+"/image",
           token,"DELETE").then(()=>undefined),"Đã gỡ ảnh.")}/>}
       <Text style={s.hint}>Ảnh tối đa 2MB; ưu đãi chỉ công khai sau khi bật hiển thị.</Text>
       <View style={s.offerPreview}>
         <Text style={s.hint}>XEM TRƯỚC NỘI DUNG POPUP</Text>
         <Text style={s.name}>{editor.title||"Tên chương trình"}</Text>
         <Text style={s.link}>{editor.summary||"Mô tả ngắn"}</Text>
         <Text style={s.hint}>{editor.body||"Nội dung chi tiết ưu đãi"}</Text>
       </View>
       <StatusSwitch label="Hiển thị ưu đãi" value={current?.enabled??false} busy={busy}
         disabled={!current?.imageKey} onValueChange={value=>{
           if(current)toggle(current,value);
         }}/>
       {current&&<Action dangerous label={deleteArmed?"Xác nhận xóa ưu đãi":"Xóa ưu đãi"}
         disabled={busy} onPress={()=>{
           if(!deleteArmed){setDeleteArmed(true);setNotice("Chạm Xác nhận xóa để xóa ưu đãi.");return;}
           deleteOffer(current);
         }}/>}
     </View>}
   </View>}
 </View>;
}
const s=StyleSheet.create({
 page:{gap:12,paddingBottom:15},list:{gap:11},hint:{fontSize:12,color:c.secondary,lineHeight:18},
 item:{flexDirection:"row",alignItems:"center",gap:9,paddingVertical:10,
   borderBottomWidth:1,borderColor:c.line},thumb:{width:58,height:58,borderRadius:10},
 name:{fontSize:14,fontWeight:"700",color:c.ink},tools:{flexDirection:"row",gap:10,flexWrap:"wrap"},
 tool:{minHeight:44,minWidth:44,justifyContent:"center"},link:{color:c.red,fontWeight:"800",fontSize:13},
 edit:{gap:12},back:{minHeight:44,justifyContent:"center"},check:{minHeight:48,
   justifyContent:"center"},media:{gap:11,paddingTop:13,borderTopWidth:1,borderColor:c.line},
 preview:{width:"100%",height:164,borderRadius:12,backgroundColor:c.pale},
 offerPreview:{gap:9,padding:13,borderRadius:11,borderWidth:1,borderColor:c.line,backgroundColor:c.white},
});
