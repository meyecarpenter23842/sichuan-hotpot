import React,{useEffect,useState} from "react";
import { Image,Platform,Pressable,StyleSheet,Text,View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system/legacy";
import { imageUrl,request } from "./api";
import { Action,Field,Notice } from "./ui";
import { StatusSwitch } from "./StatusSwitch";
import { prepareProductImage } from "./prepare-product-image";
import { c } from "./theme";

interface PopupSettings {
  branchId:string;enabled:boolean;repeatIntervalMinutes:number;slideDwellMs:number;
  revision:number;updatedAt:string|null;
}
interface PopupSlide {
  id:string;imageKey:string|null;altText:string;enabled:boolean;sortOrder:number;revision:number;
}
interface PopupPayload {settings:PopupSettings;slides:PopupSlide[]}

const frequencyPresets=[
  [30,"30 phút"],[60,"1 giờ"],[180,"3 giờ"],[360,"6 giờ"],
  [720,"12 giờ"],[1440,"1 ngày"],[10080,"7 ngày"],
] as const;

function filenameAlt(name:string,index:number){
  const clean=name.replace(/\.[^.]+$/,"").replace(/[_-]+/g," ").trim().slice(0,180);
  return clean||("Ảnh popup "+(index+1));
}

export function HomePopupPanel({token,branchId,onDirtyChange}:{
  token:string;branchId:string;onDirtyChange:(value:boolean)=>void;
}){
  const root="/admin/branches/"+branchId+"/popup";
  const [payload,setPayload]=useState<PopupPayload|null>(null);
  const [enabled,setEnabled]=useState(false);
  const [repeatMinutes,setRepeatMinutes]=useState("360");
  const [dwellSeconds,setDwellSeconds]=useState("4");
  const [configDirty,setConfigDirty]=useState(false);
  const [busy,setBusy]=useState(false);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");
  const [notice,setNotice]=useState("");
  const [editingId,setEditingId]=useState<string|null>(null);
  const [editingAlt,setEditingAlt]=useState("");
  const [deleteArmed,setDeleteArmed]=useState<string|null>(null);

  const sync=(data:PopupPayload)=>{
    setPayload(data);setEnabled(data.settings.enabled);
    setRepeatMinutes(String(data.settings.repeatIntervalMinutes));
    setDwellSeconds(String(data.settings.slideDwellMs/1000));
    setConfigDirty(false);onDirtyChange(false);
  };
  const refresh=async(syncConfig=false)=>{
    const next=await request<PopupPayload>(root,token);
    if(syncConfig)sync(next);else setPayload(next);
    return next;
  };
  useEffect(()=>{
    let active=true;setLoading(true);setError("");setNotice("");
    void request<PopupPayload>(root,token).then(next=>{if(active)sync(next);})
      .catch(e=>{if(active)setError(e instanceof Error?e.message:"Không tải được popup trang chủ.");})
      .finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[root,token]);

  const run=async(action:()=>Promise<void>,success:string)=>{
    if(busy)return;setBusy(true);setError("");setNotice("");
    try{await action();setNotice(success);}
    catch(e){setError(e instanceof Error?e.message:"Có lỗi xảy ra. Vui lòng thử lại.");}
    finally{setBusy(false);}
  };
  const markConfig=()=>{setConfigDirty(true);onDirtyChange(true);};
  const saveConfig=()=>void run(async()=>{
    if(!payload)return;
    const repeat=Number(repeatMinutes),dwell=Number(dwellSeconds);
    if(!Number.isInteger(repeat)||repeat<5||repeat>10080)
      throw Error("Tần suất popup phải từ 5 phút đến 7 ngày.");
    if(!Number.isFinite(dwell)||dwell<2||dwell>10)
      throw Error("Mỗi ảnh phải hiển thị từ 2 đến 10 giây.");
    await request(root+"/config",token,"PUT",{
      revision:payload.settings.revision,enabled,repeatIntervalMinutes:repeat,
      slideDwellMs:Math.round(dwell*1000),
    });
    await refresh(true);
  },"Đã lưu cấu hình popup trang chủ.");

  async function upload(slideId:string,blob:Blob|{uri:string;size:number;mime:string},mime:string){
    const size="size" in blob?blob.size:0;
    const endpoint=root+"/slides/"+slideId+"/image";
    const ticket=await request<{key:string;uploadUrl:string;contentType:string}>(
      endpoint+"/ticket",token,"POST",{contentType:mime,byteSize:size});
    if("uri" in blob){
      const sent=await FileSystem.uploadAsync(ticket.uploadUrl,blob.uri,{
        httpMethod:"PUT",uploadType:FileSystem.FileSystemUploadType.BINARY_CONTENT,
        headers:{"Content-Type":ticket.contentType}});
      if(sent.status<200||sent.status>=300)throw Error("R2 từ chối một ảnh popup.");
    }else{
      const sent=await fetch(ticket.uploadUrl,{method:"PUT",
        headers:{"Content-Type":ticket.contentType},body:blob});
      if(!sent.ok)throw Error("R2 từ chối một ảnh popup. Kiểm tra CORS bucket media.");
    }
    await request(endpoint+"/attach",token,"POST",{key:ticket.key});
  }
  async function createAndUpload(blob:Blob|{uri:string;size:number;mime:string},mime:string,alt:string){
    const current=await request<PopupPayload>(root,token);
    const slide=await request<PopupSlide>(root+"/slides",token,"POST",{
      altText:alt,sortOrder:current.slides.length,
    });
    await upload(slide.id,blob,mime);
  }
  const pickMany=()=>{
    if(Platform.OS==="web"){
      const input=document.createElement("input");input.type="file";input.multiple=true;
      input.accept="image/png,image/jpeg,image/webp";
      input.onchange=()=>{
        const files=Array.from(input.files??[]);if(files.length===0)return;
        void run(async()=>{
          for(let i=0;i<files.length;i++){
            const file=files[i]!;
            const prepared=await prepareProductImage(file);
            await createAndUpload(prepared.blob,prepared.contentType,filenameAlt(file.name,i));
          }
          await refresh(false);
        },files.length+" ảnh popup đã được tải lên R2. Bật từng ảnh khi sẵn sàng.");
      };
      input.click();return;
    }
    void (async()=>{
      const result=await ImagePicker.launchImageLibraryAsync({
        mediaTypes:["images"],allowsMultipleSelection:true,quality:0.72,
      });
      if(result.canceled||!result.assets?.length)return;
      await run(async()=>{
        for(let i=0;i<result.assets.length;i++){
          const asset=result.assets[i]!;
          const mime=(asset.mimeType??"image/jpeg").toLowerCase();
          if(!["image/png","image/jpeg","image/webp"].includes(mime))
            throw Error("Ảnh popup phải là JPG, PNG hoặc WebP.");
          const info=await FileSystem.getInfoAsync(asset.uri);
          const size=info.exists?info.size:undefined;
          if(!size||size>2097152)throw Error("Mỗi ảnh popup phải nhỏ hơn 2 MB.");
          await createAndUpload({uri:asset.uri,size,mime},mime,
            filenameAlt(asset.fileName??"",i));
        }
        await refresh(false);
      },result.assets.length+" ảnh popup đã được tải lên R2.");
    })().catch(e=>setError(e instanceof Error?e.message:"Không chọn được ảnh popup."));
  };

  const toggle=(slide:PopupSlide,value:boolean)=>void run(async()=>{
    if(value&&!slide.imageKey)throw Error("Thêm ảnh R2 trước khi bật slide popup.");
    await request(root+"/slides/"+slide.id,token,"PATCH",{revision:slide.revision,enabled:value});
    await refresh(false);
  },"Đã cập nhật trạng thái ảnh popup.");
  const move=(index:number,delta:number)=>void run(async()=>{
    if(!payload)return;
    const next=[...payload.slides],other=index+delta;if(other<0||other>=next.length)return;
    [next[index],next[other]]=[next[other]!,next[index]!];
    const updated=await request<PopupPayload>(root+"/slides/order",token,"PUT",{ids:next.map(x=>x.id)});
    setPayload(updated);
  },"Đã lưu thứ tự ảnh popup.");
  const saveAlt=(slide:PopupSlide)=>void run(async()=>{
    const alt=editingAlt.trim();if(!alt)throw Error("Mô tả ảnh không được để trống.");
    await request(root+"/slides/"+slide.id,token,"PATCH",{revision:slide.revision,altText:alt});
    setEditingId(null);setEditingAlt("");await refresh(false);
  },"Đã lưu mô tả ảnh.");
  const remove=(slide:PopupSlide)=>{
    if(deleteArmed!==slide.id){setDeleteArmed(slide.id);setNotice("Chạm Xác nhận xóa lần nữa để xóa ảnh popup.");return;}
    void run(async()=>{await request(root+"/slides/"+slide.id,token,"DELETE");
      setDeleteArmed(null);await refresh(false);
    },"Đã xóa ảnh popup; file cũ được đưa vào hàng chờ dọn an toàn.");
  };

  const live=(payload?.slides??[]).filter(x=>x.enabled&&imageUrl(x.imageKey));
  return <View style={s.page}>
    <Text style={s.hint}>Popup nằm giữa màn hình khách. Ảnh tự lướt ngang và khách vẫn có thể vuốt bằng tay.</Text>
    {!!error&&<Notice text={error} error/>}{!!notice&&<Notice text={notice}/>}
    {loading&&<Text style={s.hint}>Đang tải cấu hình popup…</Text>}
    {payload&&<View style={s.config}>
      <View style={s.rowBetween}>
        <View style={s.copy}><Text style={s.name}>Bật popup trang chủ</Text>
          <Text style={s.hint}>{live.length>0?"Có "+live.length+" ảnh đang sẵn sàng.":"Chưa có ảnh đang bật."}</Text></View>
        <StatusSwitch label="Bật popup trang chủ" value={enabled} busy={busy}
          onValueChange={value=>{setEnabled(value);markConfig();}}/>
      </View>
      <Text style={s.name}>Popup hiện lại sau</Text>
      <View style={s.presets}>
        {frequencyPresets.map(([minutes,label])=><Pressable key={minutes}
          accessibilityRole="button" accessibilityState={{selected:Number(repeatMinutes)===minutes}}
          style={[s.preset,Number(repeatMinutes)===minutes&&s.presetActive]}
          onPress={()=>{setRepeatMinutes(String(minutes));markConfig();}}>
          <Text style={[s.presetText,Number(repeatMinutes)===minutes&&s.presetTextActive]}>{label}</Text>
        </Pressable>)}
      </View>
      <Field label="Tần suất tùy chỉnh (phút, 5–10080)" numeric value={repeatMinutes}
        onChangeText={value=>{setRepeatMinutes(value);markConfig();}}/>
      <Field label="Mỗi ảnh hiển thị bao lâu (giây, 2–10)" decimal value={dwellSeconds}
        onChangeText={value=>{setDwellSeconds(value);markConfig();}}/>
      <View style={s.preview}>
        {live[0]&&imageUrl(live[0].imageKey)
          ?<Image source={{uri:imageUrl(live[0].imageKey)!}} resizeMode="cover" style={StyleSheet.absoluteFillObject}/>
          :<Text style={s.previewEmpty}>Ảnh popup sẽ hiển thị tại đây</Text>}
        <View style={s.previewClose}><Text style={s.previewCloseText}>×</Text></View>
      </View>
      <Action label={busy?"Đang lưu…":"Lưu cấu hình popup"} disabled={busy||!configDirty} onPress={saveConfig}/>
    </View>}
    {payload&&<View style={s.list}>
      <Action secondary label={busy?"Đang tải ảnh…":"＋ Chọn nhiều ảnh R2"} disabled={busy} onPress={pickMany}/>
      <Text style={s.hint}>Có thể chọn nhiều ảnh cùng lúc. Ảnh mới mặc định tắt để anh kiểm tra trước khi công khai.</Text>
      {payload.slides.length===0&&<Text style={s.empty}>Chưa có ảnh popup.</Text>}
      {payload.slides.map((slide,index)=><View key={slide.id} style={s.item}>
        {imageUrl(slide.imageKey)?<Image source={{uri:imageUrl(slide.imageKey)!}} style={s.thumb}/>
          :<View style={s.thumbEmpty}><Text style={s.hint}>Ảnh</Text></View>}
        <View style={s.copy}>
          {editingId===slide.id?<View style={s.altEditor}>
            <Field label="Mô tả ảnh" value={editingAlt} onChangeText={setEditingAlt}/>
            <View style={s.editActions}><Action secondary label="Hủy" onPress={()=>setEditingId(null)}/>
              <Action label="Lưu" onPress={()=>saveAlt(slide)} disabled={busy}/></View>
          </View>:<>
            <Text style={s.name} numberOfLines={1}>{slide.altText}</Text>
            <Text style={s.hint}>{slide.enabled?"Đang bật":"Đang tắt"} · vị trí {index+1}</Text>
            <View style={s.tools}>
              <Pressable style={s.tool} accessibilityRole="button" accessibilityLabel="Sửa mô tả ảnh popup"
                onPress={()=>{setEditingId(slide.id);setEditingAlt(slide.altText);}}>
                <Text style={s.link}>Sửa tên</Text></Pressable>
              <Pressable style={s.tool} accessibilityRole="button" accessibilityLabel="Đưa ảnh popup lên"
                disabled={busy||index===0} onPress={()=>move(index,-1)}><Text style={s.link}>↑</Text></Pressable>
              <Pressable style={s.tool} accessibilityRole="button" accessibilityLabel="Đưa ảnh popup xuống"
                disabled={busy||index===payload.slides.length-1} onPress={()=>move(index,1)}><Text style={s.link}>↓</Text></Pressable>
              <Pressable style={s.tool} accessibilityRole="button" accessibilityLabel="Xóa ảnh popup"
                disabled={busy} onPress={()=>remove(slide)}>
                <Text style={s.deleteLink}>{deleteArmed===slide.id?"Xác nhận xóa":"Xóa"}</Text></Pressable>
            </View>
          </>}
        </View>
        <StatusSwitch label={"Hiển thị "+slide.altText} value={slide.enabled} busy={busy}
          disabled={!slide.enabled&&!slide.imageKey} hint={!slide.imageKey?"Ảnh chưa tải xong":undefined}
          onValueChange={value=>toggle(slide,value)}/>
      </View>)}
    </View>}
  </View>;
}

const s=StyleSheet.create({
  page:{gap:12,paddingBottom:15},config:{gap:11,paddingBottom:13,borderBottomWidth:1,borderColor:c.line},
  hint:{fontSize:12,lineHeight:18,color:c.secondary},name:{fontSize:14,fontWeight:"700",color:c.ink},
  rowBetween:{flexDirection:"row",alignItems:"center",justifyContent:"space-between",gap:12},
  copy:{flex:1,gap:3},presets:{flexDirection:"row",flexWrap:"wrap",gap:7},
  preset:{minHeight:40,paddingHorizontal:11,alignItems:"center",justifyContent:"center",
    borderWidth:1,borderColor:c.line,borderRadius:20,backgroundColor:c.white},
  presetActive:{borderColor:c.red,backgroundColor:c.soft},
  presetText:{fontSize:12,fontWeight:"700",color:c.secondary},presetTextActive:{color:c.red},
  preview:{height:170,borderRadius:14,overflow:"hidden",backgroundColor:c.pale,
    alignItems:"center",justifyContent:"center"},
  previewEmpty:{fontSize:12,color:c.secondary},
  previewClose:{position:"absolute",right:9,top:9,width:34,height:34,borderRadius:17,
    alignItems:"center",justifyContent:"center",backgroundColor:"rgba(0,0,0,.62)"},
  previewCloseText:{fontSize:23,lineHeight:27,color:"#FFFFFF"},
  list:{gap:9},empty:{fontSize:13,color:c.secondary,textAlign:"center",paddingVertical:12},
  item:{flexDirection:"row",alignItems:"center",gap:9,paddingVertical:9,borderBottomWidth:1,borderColor:c.line},
  thumb:{width:76,height:54,borderRadius:9,backgroundColor:c.pale},
  thumbEmpty:{width:76,height:54,borderRadius:9,backgroundColor:c.pale,alignItems:"center",justifyContent:"center"},
  tools:{flexDirection:"row",flexWrap:"wrap",gap:8},tool:{minHeight:40,minWidth:40,justifyContent:"center"},
  link:{fontSize:12,fontWeight:"800",color:c.red},deleteLink:{fontSize:12,fontWeight:"800",color:"#B42318"},
  altEditor:{gap:8},editActions:{flexDirection:"row",gap:8,justifyContent:"flex-end"},
});
