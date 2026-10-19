import React,{useEffect,useRef,useState} from "react";
import { Animated,Image,Platform,Pressable,StyleSheet,Text,View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system/legacy";
import { imageUrl,request } from "./api";
import { Action,Field,Notice } from "./ui";
import { StatusSwitch } from "./StatusSwitch";
import { prepareProductImage } from "./prepare-product-image";
import { c } from "./theme";

type HeroTransition="fade"|"slide"|"wipe";
interface HeroSettings {
  branchId:string;autoplay:boolean;dwellMs:number;transitionType:HeroTransition;
  transitionDurationMs:number;revision:number;updatedAt:string|null;
}
interface HeroSlide {
  id:string;imageKey:string|null;altText:string;title:string|null;subtitle:string|null;
  ctaTarget:"MENU"|null;enabled:boolean;sortOrder:number;revision:number;
}
interface HeroPayload {settings:HeroSettings;slides:HeroSlide[]}
interface SlideEditor {
  id:string|null;revision:number;altText:string;title:string;subtitle:string;cta:boolean;
}
const blankEditor=():SlideEditor=>({id:null,revision:0,altText:"",title:"",subtitle:"",cta:false});
const editorFrom=(slide:HeroSlide):SlideEditor=>({id:slide.id,revision:slide.revision,
  altText:slide.altText,title:slide.title??"",subtitle:slide.subtitle??"",cta:slide.ctaTarget==="MENU"});

export function HomeHeroPanel({token,branchId,onDirtyChange}:{
  token:string;branchId:string;onDirtyChange:(value:boolean)=>void;
}){
  const root="/admin/branches/"+branchId+"/hero";
  const [payload,setPayload]=useState<HeroPayload|null>(null);
  const [autoplay,setAutoplay]=useState(true);
  const [dwellSeconds,setDwellSeconds]=useState("5");
  const [transition,setTransition]=useState<HeroTransition>("fade");
  const [transitionMs,setTransitionMs]=useState("450");
  const [configDirty,setConfigDirty]=useState(false);
  const [editor,setEditor]=useState<SlideEditor|null>(null);
  const [slideDirty,setSlideDirty]=useState(false);
  const [busy,setBusy]=useState(false);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");
  const [notice,setNotice]=useState("");
  const [deleteArmed,setDeleteArmed]=useState(false);
  const preview=useRef(new Animated.Value(0)).current;
  const [previewIndex,setPreviewIndex]=useState(0);

  const syncConfig=(data:HeroPayload)=>{
    setAutoplay(data.settings.autoplay);
    setDwellSeconds(String(data.settings.dwellMs/1000));
    setTransition(data.settings.transitionType);
    setTransitionMs(String(data.settings.transitionDurationMs));
    setConfigDirty(false);
  };
  const refresh=async(sync:boolean)=>{
    const next=await request<HeroPayload>(root,token);
    setPayload(next);
    if(sync)syncConfig(next);
    setEditor(old=>{
      if(!old?.id)return old;
      const current=next.slides.find(slide=>slide.id===old.id);
      return current&&!slideDirty?editorFrom(current):old;
    });
    return next;
  };
  useEffect(()=>{
    let active=true;setLoading(true);setError("");setNotice("");
    void request<HeroPayload>(root,token).then(next=>{
      if(!active)return;setPayload(next);syncConfig(next);setEditor(null);setSlideDirty(false);
    }).catch(e=>{if(active)setError(e instanceof Error?e.message:"Không tải được banner.");})
      .finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[root,token]);
  useEffect(()=>{onDirtyChange(configDirty||slideDirty);},[configDirty,slideDirty,onDirtyChange]);

  const run=async(action:()=>Promise<void>,success:string)=>{
    if(busy)return;setBusy(true);setError("");setNotice("");
    try{await action();setNotice(success);}
    catch(e){setError(e instanceof Error?e.message:"Có lỗi xảy ra. Vui lòng thử lại.");}
    finally{setBusy(false);}
  };
  const changeConfig=(change:()=>void)=>{change();setConfigDirty(true);};
  const saveConfig=()=>void run(async()=>{
    if(!payload)return;
    const seconds=Number(dwellSeconds),duration=Number(transitionMs);
    if(!Number.isFinite(seconds)||seconds<2||seconds>10)
      throw Error("Thời gian mỗi ảnh phải từ 2 đến 10 giây.");
    if(!Number.isInteger(duration)||duration<250||duration>1000)
      throw Error("Thời gian chuyển cảnh phải từ 250 đến 1000 ms.");
    await request(root+"/config",token,"PUT",{
      revision:payload.settings.revision,autoplay,dwellMs:Math.round(seconds*1000),
      transitionType:transition,transitionDurationMs:duration,
    });
    await refresh(true);
  },"Đã lưu cấu hình banner trang chủ.");

  const saveSlide=()=>void run(async()=>{
    if(!editor||!payload)return;
    const data={altText:editor.altText.trim(),title:editor.title.trim()||null,
      subtitle:editor.subtitle.trim()||null,ctaTarget:editor.cta?"MENU":null};
    if(!data.altText)throw Error("Nhập mô tả ảnh để hỗ trợ người dùng và khi ảnh lỗi.");
    if(editor.id){
      const saved=await request<HeroSlide>(root+"/slides/"+editor.id,token,"PATCH",
        {...data,revision:editor.revision});
      setEditor(editorFrom(saved));
    }else{
      const created=await request<HeroSlide>(root+"/slides",token,"POST",
        {...data,sortOrder:payload.slides.length});
      setEditor(editorFrom(created));
    }
    setSlideDirty(false);
    await refresh(false);
  },"Đã lưu nội dung slide.");

  const toggle=(slide:HeroSlide,value:boolean)=>{
    if(configDirty||slideDirty){setError("Lưu thay đổi đang sửa trước khi bật/tắt slide.");return;}
    void run(async()=>{
      if(value&&!slide.imageKey)throw Error("Thêm ảnh R2 trước khi bật slide.");
      await request(root+"/slides/"+slide.id,token,"PATCH",{revision:slide.revision,enabled:value});
      await refresh(false);
    },"Đã cập nhật trạng thái slide.");
  };
  const move=(index:number,delta:number)=>void run(async()=>{
    if(!payload||configDirty||slideDirty)throw Error("Lưu thay đổi đang sửa trước khi đổi thứ tự.");
    const next=[...payload.slides],other=index+delta;
    if(other<0||other>=next.length)return;
    [next[index],next[other]]=[next[other]!,next[index]!];
    const updated=await request<HeroPayload>(root+"/slides/order",token,"PUT",{ids:next.map(x=>x.id)});
    setPayload(updated);
  },"Đã lưu thứ tự banner.");

  async function upload(id:string,blob:Blob|{uri:string;size:number;mime:string},mime:string){
    const size="size" in blob?blob.size:0;
    const endpoint=root+"/slides/"+id+"/image";
    const ticket=await request<{key:string;uploadUrl:string;contentType:string}>(
      endpoint+"/ticket",token,"POST",{contentType:mime,byteSize:size});
    if("uri" in blob){
      const sent=await FileSystem.uploadAsync(ticket.uploadUrl,blob.uri,{
        httpMethod:"PUT",uploadType:FileSystem.FileSystemUploadType.BINARY_CONTENT,
        headers:{"Content-Type":ticket.contentType}});
      if(sent.status<200||sent.status>=300)throw Error("R2 từ chối ảnh. Kiểm tra kết nối.");
    }else{
      const sent=await fetch(ticket.uploadUrl,{method:"PUT",
        headers:{"Content-Type":ticket.contentType},body:blob});
      if(!sent.ok)throw Error("R2 từ chối ảnh. Kiểm tra CORS bucket media.");
    }
    await request(endpoint+"/attach",token,"POST",{key:ticket.key});
  }
  const pickImage=()=>{
    const id=editor?.id;
    if(!id){setError("Lưu slide trước rồi mới gắn ảnh.");return;}
    if(slideDirty){setError("Lưu nội dung slide trước khi thay ảnh.");return;}
    if(Platform.OS==="web"){
      const input=document.createElement("input");input.type="file";input.accept="image/png,image/jpeg,image/webp";
      input.onchange=()=>{const file=input.files?.[0];if(!file)return;
        void run(async()=>{const prepared=await prepareProductImage(file);
          await upload(id,prepared.blob,prepared.contentType);const next=await refresh(false);
          const current=next.slides.find(x=>x.id===id);if(current)setEditor(editorFrom(current));
        },"Đã tải ảnh banner lên.");};
      input.click();return;
    }
    void (async()=>{
      const result=await ImagePicker.launchImageLibraryAsync({mediaTypes:["images"],allowsEditing:true,quality:0.72});
      const asset=result.assets?.[0];if(result.canceled||!asset)return;
      const mime=(asset.mimeType??"image/jpeg").toLowerCase();
      if(!["image/png","image/jpeg","image/webp"].includes(mime)){setError("Ảnh phải là JPG, PNG hoặc WebP.");return;}
      const info=await FileSystem.getInfoAsync(asset.uri);const size=info.exists?info.size:undefined;
      if(!size||size>2097152){setError("Ảnh phải nhỏ hơn 2 MB.");return;}
      await run(async()=>{await upload(id,{uri:asset.uri,size,mime},mime);const next=await refresh(false);
        const current=next.slides.find(x=>x.id===id);if(current)setEditor(editorFrom(current));
      },"Đã tải ảnh banner lên.");
    })().catch(e=>setError(e instanceof Error?e.message:"Không chọn được ảnh."));
  };
  const removeImage=()=>{const id=editor?.id;if(!id)return;void run(async()=>{
    await request(root+"/slides/"+id+"/image",token,"DELETE");
    const next=await refresh(false);const current=next.slides.find(x=>x.id===id);
    if(current)setEditor(editorFrom(current));
  },"Đã gỡ ảnh banner.");};
  const deleteSlide=()=>{const id=editor?.id;if(!id)return;
    if(!deleteArmed){setDeleteArmed(true);setNotice("Chạm Xác nhận xóa để xóa slide.");return;}
    void run(async()=>{await request(root+"/slides/"+id,token,"DELETE");setEditor(null);
      setSlideDirty(false);setDeleteArmed(false);await refresh(false);
    },"Đã xóa slide; ảnh cũ được đưa vào hàng chờ dọn an toàn.");
  };

  const previewSlides=(payload?.slides??[]).filter(x=>imageUrl(x.imageKey));
  const playPreview=()=>{
    if(previewSlides.length<2){setNotice("Cần ít nhất 2 slide có ảnh để xem chuyển động.");return;}
    setPreviewIndex(old=>(old+1)%previewSlides.length);preview.stopAnimation();preview.setValue(0);
    Animated.timing(preview,{toValue:1,duration:Number(transitionMs)||450,useNativeDriver:true}).start();
  };
  const previewCurrent=previewSlides[previewIndex%Math.max(1,previewSlides.length)];
  const previewNext=previewSlides[(previewIndex+1)%Math.max(1,previewSlides.length)];
  const overlayStyle=transition==="fade"?{opacity:preview}
    :transition==="slide"?{transform:[{translateX:preview.interpolate({inputRange:[0,1],outputRange:[220,0]})}]}
    :{opacity:preview,transform:[{scaleX:preview}]};

  return <View style={s.page}>
    <Text style={s.hint}>Chọn ảnh, thời gian đổi và kiểu chuyển động hiển thị trên trang chủ.</Text>
    {!!error&&<Notice text={error} error/>}{!!notice&&<Notice text={notice}/>}
    {loading?<Text style={s.hint}>Đang tải cấu hình banner…</Text>:null}
    {payload&&<View style={s.config}>
      <View style={s.rowBetween}>
        <View style={s.copy}><Text style={s.name}>Tự động chuyển ảnh</Text>
          <Text style={s.hint}>Khách vẫn có thể vuốt để xem ảnh khác.</Text></View>
        <StatusSwitch label="Tự động chuyển ảnh" value={autoplay} busy={busy}
          onValueChange={value=>changeConfig(()=>setAutoplay(value))}/>
      </View>
      <Field label="Thời gian mỗi ảnh (2–10 giây)" value={dwellSeconds} numeric
        onChangeText={value=>changeConfig(()=>setDwellSeconds(value))}/>
      <Text style={s.name}>Hiệu ứng chuyển</Text>
      <View style={s.effects}>
        {([["fade","Mờ dần"],["slide","Trượt"],["wipe","Gạt ngang"]] as const).map(([value,label])=>
          <Pressable key={value} accessibilityRole="button" accessibilityState={{selected:transition===value}}
            style={[s.effect,transition===value&&s.effectActive]}
            onPress={()=>changeConfig(()=>setTransition(value))}>
            <Text style={[s.effectText,transition===value&&s.effectTextActive]}>{label}</Text>
          </Pressable>)}
      </View>
      <Field label="Thời gian chuyển cảnh (250–1000 ms)" value={transitionMs} numeric
        onChangeText={value=>changeConfig(()=>setTransitionMs(value))}/>
      <View style={s.previewBox}>
        {previewCurrent&&<Image source={{uri:imageUrl(previewCurrent.imageKey)!}} style={StyleSheet.absoluteFillObject}/>}
        {previewNext&&<Animated.View style={[StyleSheet.absoluteFillObject,overlayStyle]}>
          <Image source={{uri:imageUrl(previewNext.imageKey)!}} style={StyleSheet.absoluteFillObject}/>
        </Animated.View>}
        {!previewCurrent&&<Text style={s.previewEmpty}>Thêm ảnh để xem trước banner</Text>}
      </View>
      <View style={s.actions}><Action secondary label="Xem thử chuyển động" onPress={playPreview} disabled={busy}/>
        <Action label={busy?"Đang lưu…":"Lưu cấu hình"} onPress={saveConfig} disabled={busy||!configDirty}/></View>
    </View>}
    {payload&&!editor&&<View style={s.list}>
      <Action label="＋ Thêm slide" disabled={busy} onPress={()=>{setEditor(blankEditor());
        setSlideDirty(false);setDeleteArmed(false);setError("");setNotice("");}}/>
      {payload.slides.length===0&&<Text style={s.hint}>Chưa có slide. App khách sẽ giữ ảnh hero dự phòng đã duyệt.</Text>}
      {payload.slides.map((slide,index)=><View key={slide.id} style={s.item}>
        {imageUrl(slide.imageKey)?<Image source={{uri:imageUrl(slide.imageKey)!}} style={s.thumb}/>
          :<View style={s.thumbEmpty}><Text style={s.thumbEmptyText}>Ảnh</Text></View>}
        <View style={s.copy}><Text style={s.name} numberOfLines={1}>{slide.title||slide.altText}</Text>
          <Text style={s.hint}>{slide.enabled?"Đang bật":"Bản nháp / đã tắt"}</Text>
          <View style={s.tools}>
            <Pressable style={s.tool} accessibilityRole="button" accessibilityLabel={"Sửa "+slide.altText}
              onPress={()=>{setEditor(editorFrom(slide));setSlideDirty(false);setDeleteArmed(false);}}>
              <Text style={s.link}>Sửa / ảnh</Text></Pressable>
            <Pressable style={s.tool} accessibilityRole="button" accessibilityLabel="Đưa slide lên"
              disabled={busy||index===0} onPress={()=>move(index,-1)}><Text style={s.link}>↑</Text></Pressable>
            <Pressable style={s.tool} accessibilityRole="button" accessibilityLabel="Đưa slide xuống"
              disabled={busy||index===payload.slides.length-1} onPress={()=>move(index,1)}><Text style={s.link}>↓</Text></Pressable>
          </View>
        </View>
        <StatusSwitch label={"Hiển thị "+slide.altText} value={slide.enabled} busy={busy}
          disabled={!slide.enabled&&!slide.imageKey} hint={!slide.imageKey?"Thêm ảnh trước":undefined}
          onValueChange={value=>toggle(slide,value)}/>
      </View>)}
    </View>}
    {payload&&editor&&<View style={s.editor}>
      <Pressable accessibilityRole="button" style={s.back} onPress={()=>{
        if(slideDirty){setNotice("Hãy lưu slide hoặc đóng popup và chọn bỏ thay đổi.");return;}
        setEditor(null);setDeleteArmed(false);}}><Text style={s.link}>← Danh sách slide</Text></Pressable>
      <Field label="Mô tả ảnh (bắt buộc)" value={editor.altText}
        placeholder="Ví dụ: Lẩu Tứ Xuyên cay tê và trà sữa"
        onChangeText={altText=>{setEditor({...editor,altText});setSlideDirty(true);}}/>
      <Field label="Tiêu đề trên banner (không bắt buộc)" value={editor.title}
        onChangeText={title=>{setEditor({...editor,title});setSlideDirty(true);}}/>
      <Field label="Mô tả ngắn (không bắt buộc)" value={editor.subtitle}
        onChangeText={subtitle=>{setEditor({...editor,subtitle});setSlideDirty(true);}}/>
      <Pressable accessibilityRole="checkbox" accessibilityState={{checked:editor.cta}}
        style={s.check} onPress={()=>{setEditor({...editor,cta:!editor.cta});setSlideDirty(true);}}>
        <Text style={s.name}>{editor.cta?"☑":"☐"} Nút mở Thực đơn</Text>
      </Pressable>
      <Action label={busy?"Đang lưu…":"Lưu slide"} disabled={busy} onPress={saveSlide}/>
      {editor.id&&(()=>{
        const current=payload.slides.find(x=>x.id===editor.id);if(!current)return null;
        return <View style={s.media}>
          <Text style={s.name}>Ảnh banner</Text>
          {imageUrl(current.imageKey)&&<Image resizeMode="cover" source={{uri:imageUrl(current.imageKey)!}} style={s.heroImage}/>}
          <Action secondary label={busy?"Đang tải…":"Chọn hoặc thay ảnh"} disabled={busy||slideDirty} onPress={pickImage}/>
          {current.imageKey&&!current.enabled&&<Action secondary label="Gỡ ảnh" disabled={busy||slideDirty} onPress={removeImage}/>}
          <StatusSwitch label="Hiển thị slide" value={current.enabled} busy={busy}
            disabled={!current.imageKey||slideDirty} hint={slideDirty?"Lưu nội dung trước khi bật":undefined}
            onValueChange={value=>toggle(current,value)}/>
          <Action dangerous label={deleteArmed?"Xác nhận xóa slide":"Xóa slide"} disabled={busy} onPress={deleteSlide}/>
        </View>;
      })()}
    </View>}
  </View>;
}

const s=StyleSheet.create({
  page:{gap:12,paddingBottom:14},hint:{fontSize:12,lineHeight:18,color:c.secondary},
  config:{gap:10,paddingBottom:13,borderBottomWidth:1,borderColor:c.line},
  rowBetween:{flexDirection:"row",alignItems:"center",justifyContent:"space-between",gap:12},
  copy:{flex:1,gap:3},name:{fontSize:14,fontWeight:"700",color:c.ink},
  effects:{flexDirection:"row",gap:7,flexWrap:"wrap"},
  effect:{minHeight:44,paddingHorizontal:13,justifyContent:"center",borderWidth:1,
    borderColor:c.line,borderRadius:10,backgroundColor:c.white},
  effectActive:{borderColor:c.red,backgroundColor:c.soft},
  effectText:{fontSize:13,fontWeight:"700",color:c.secondary},effectTextActive:{color:c.red},
  previewBox:{height:126,borderRadius:12,overflow:"hidden",backgroundColor:c.pale,
    alignItems:"center",justifyContent:"center"},
  previewEmpty:{fontSize:12,color:c.secondary},actions:{gap:8},
  list:{gap:10},item:{flexDirection:"row",alignItems:"center",gap:9,paddingVertical:9,
    borderBottomWidth:1,borderColor:c.line},thumb:{width:76,height:48,borderRadius:8,backgroundColor:c.pale},
  thumbEmpty:{width:76,height:48,borderRadius:8,backgroundColor:c.pale,alignItems:"center",justifyContent:"center"},
  thumbEmptyText:{fontSize:11,color:c.secondary},tools:{flexDirection:"row",gap:10},
  tool:{minWidth:44,minHeight:44,justifyContent:"center"},link:{fontSize:13,fontWeight:"800",color:c.red},
  editor:{gap:11},back:{minHeight:44,justifyContent:"center"},check:{minHeight:44,justifyContent:"center"},
  media:{gap:10,paddingTop:12,borderTopWidth:1,borderColor:c.line},
  heroImage:{width:"100%",height:154,borderRadius:12,backgroundColor:c.pale},
});
