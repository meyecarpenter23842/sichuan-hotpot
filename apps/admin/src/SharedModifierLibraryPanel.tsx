import React, { useState } from "react";
import { Image, KeyboardAvoidingView, Modal, Platform, Pressable,
 ScrollView, StyleSheet, Text, View } from "react-native";
import { imageUrl, request, type AdminCatalog, type CatalogGroup,
 type CatalogOption, type CatalogProduct } from "./api";
import { Action, Field, Notice } from "./ui";
import { StatusSwitch } from "./StatusSwitch";
import { c, font } from "./theme";

type Edit = {kind:"group"|"option"; id?:string; groupId?:string; name:string;
 price:string; min:string; max:string; order:string; usedBy:number};
const money=(n:number)=>n.toLocaleString("vi-VN")+"đ";
function Photo({ imageKey, label }: {imageKey:string|null|undefined;label:string}) {
 const uri=imageUrl(imageKey??null);
 return uri?<Image source={{uri}} accessibilityLabel={label} style={s.photo}/>
  :<View style={s.placeholder}><Text style={s.placeholderText}>Ảnh</Text></View>;
}
export function SharedModifierLibraryPanel({catalog,token,root,reload,onPickImage,onRemoveImage,onAssign}:{
 catalog:AdminCatalog;token:string;root:string;reload:()=>Promise<void>;
 onPickImage:(kind:"categories"|"groups"|"options",id:string)=>void;
 onRemoveImage:(kind:"categories"|"groups"|"options",id:string)=>void;
 onAssign:(product:CatalogProduct)=>void;
}) {
 const [expanded,setExpanded]=useState<string|null>(null);
 const [editing,setEditing]=useState<Edit|null>(null);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState("");
 const [notice,setNotice]=useState("");
 const [query,setQuery]=useState("");
 const [confirmImpact,setConfirmImpact]=useState(false);
 const [pendingToggle,setPendingToggle]=useState<{kind:"group"|"option";id:string;enabled:boolean;usedBy:number}|null>(null);
 const products=catalog.categories.flatMap(cat=>cat.products);
 const groups=catalog.modifierLibrary??[];
 const visible=groups.filter(g=>(g.name+" "+g.options.map(o=>o.name).join(" "))
   .toLocaleLowerCase("vi").includes(query.trim().toLocaleLowerCase("vi")));
 function begin(kind:"group"|"option", group?:CatalogGroup, option?:CatalogOption){
   const n=group?.usedByProductIds?.length??0;
   setEditing({kind,id:kind==="group"?group?.id:option?.id,
     groupId:group?.id,name:kind==="group"?group?.name??"":option?.name??"",
     price:String(option?.priceDeltaVnd??0),min:String(group?.minSelect??0),
     max:String(group?.maxSelect??1),order:String(group?.sortOrder??0),usedBy:n});
   setError("");setConfirmImpact(false);
 }
 async function call(path:string,method:"POST"|"PATCH",payload:unknown){
   if(busy)return;
   setBusy(true);setError("");setNotice("");
   try{await request(root+path,token,method,payload);await reload();setEditing(null);
    setNotice("Đã cập nhật thư viện topping. Các món gắn nhóm sẽ dùng giá hiện tại.");}
   catch(e){setError(e instanceof Error?e.message:"Không thể lưu nhóm/topping.");}
   finally{setBusy(false);}
 }
 function save(){
  if(!editing||busy)return;
  const {kind,name,id,groupId}=editing;
  if(!name.trim()||name.trim().length>160){setError("Nhập tên tối đa 160 ký tự.");return;}
  if(editing.usedBy>1&&!confirmImpact){setError("Hãy xác nhận thay đổi áp dụng cho nhiều món.");return;}
  if(kind==="group"){
   const min=Number(editing.min),max=Number(editing.max),sortOrder=Number(editing.order);
   if(![min,max,sortOrder].every(Number.isSafeInteger)||min<0||max<1||max>30||min>max){
    setError("Số lượng tùy chọn phải hợp lệ (0–30).");return;
   }
   void call(id?"/library/groups/"+id:"/library/groups",id?"PATCH":"POST",
    {name:name.trim(),minSelect:min,maxSelect:max,sortOrder});
  }else{
   const priceDeltaVnd=Number(editing.price);
   if(!Number.isSafeInteger(priceDeltaVnd)||priceDeltaVnd<0||priceDeltaVnd>100000000){
     setError("Giá topping phải là số nguyên VND.");return;
   }
   void call(id?"/library/options/"+id:"/library/groups/"+groupId+"/options",
    id?"PATCH":"POST",{name:name.trim(),priceDeltaVnd});
  }
 }
 async function toggle(kind:"group"|"option",id:string,enabled:boolean,linked:number){
  if(busy)return;
  if(linked>1){setPendingToggle({kind,id,enabled,usedBy:linked});return;}
  await call(kind==="group"?"/library/groups/"+id:"/library/options/"+id,
    "PATCH",{isAvailable:enabled});
 }
 return <View style={s.root}>
  <View style={s.heading}>
   <View style={s.flex}><Text style={s.title}>Thư viện nhóm tùy chọn</Text>
     <Text style={s.hint}>Tạo một lần · Gắn nhiều món · Ảnh riêng cho nhóm và topping</Text></View>
   <Action label="＋ Nhóm" secondary onPress={()=>begin("group")}/>
  </View>
  <Field label="Tìm nhóm hoặc topping" value={query} onChangeText={setQuery}
    placeholder="Tìm theo tên..." />
  {!!notice&&<Notice text={notice}/>}
  {!!error&&!editing&&<Notice text={error} error/>}
  {visible.length===0&&<Text style={s.hint}>Chưa có nhóm phù hợp. Thêm nhóm để bắt đầu.</Text>}
  {visible.map(group=>{
   const open=expanded===group.id;
   return <View key={group.id} style={s.group}>
    <View style={s.line}>
     <Pressable style={s.main} accessibilityRole="button" accessibilityLabel={"Mở nhóm "+group.name}
       accessibilityState={{expanded:open}} onPress={()=>setExpanded(open?null:group.id)}>
       <Photo imageKey={group.imageKey} label={"Ảnh nhóm "+group.name}/>
       <View style={s.flex}>
         <Text style={s.name} numberOfLines={2}>{group.name}</Text>
         <Text style={s.hint}>{group.options.length} topping · Dùng ở {group.usedByProductIds?.length??0} món</Text>
       </View>
       <Text style={s.arrow}>{open?"⌃":"⌄"}</Text>
     </Pressable>
     <Pressable accessibilityRole="button" accessibilityLabel={"Sửa nhóm "+group.name}
       style={s.iconAction} onPress={()=>begin("group",group)}><Text style={s.edit}>✎</Text></Pressable>
    </View>
    {open&&<View style={s.expanded}>
      <View style={s.actions}>
       <Action label="Ảnh nhóm" secondary onPress={()=>onPickImage("groups",group.id)}/>
       {!!group.imageKey&&<Action label="Gỡ ảnh nhóm" secondary onPress={()=>onRemoveImage("groups",group.id)}/>}
       <Action label="＋ Topping" secondary onPress={()=>begin("option",group)}/>
      </View>
      <StatusSwitch label={"Hiển thị nhóm "+group.name} value={group.isAvailable}
        busy={busy} onValueChange={value=>void toggle("group",group.id,value,group.usedByProductIds?.length??0)}/>
      {!group.imageKey&&<Text style={s.hint}>Nhóm mới cần gắn ảnh trước khi bật bán.</Text>}
      {group.options.map(option=><View key={option.id} style={s.line}>
        <Photo imageKey={option.imageKey} label={"Ảnh topping "+option.name}/>
        <Pressable accessibilityRole="button" accessibilityLabel={"Sửa topping "+option.name}
          style={s.flex} onPress={()=>begin("option",group,option)}>
          <Text style={s.name} numberOfLines={2}>{option.name}</Text>
          <Text style={s.hint}>+{money(option.priceDeltaVnd)}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={"Ảnh topping "+option.name}
          style={s.iconAction} onPress={()=>onPickImage("options",option.id)}>
          <Text style={s.edit}>▧</Text></Pressable>
        {!!option.imageKey&&<Pressable accessibilityRole="button" accessibilityLabel={"Gỡ ảnh topping "+option.name}
          style={s.iconAction} onPress={()=>onRemoveImage("options",option.id)}><Text style={s.edit}>×</Text></Pressable>}
        <StatusSwitch value={option.isAvailable} busy={busy}
          label={"Bán topping "+option.name}
          onValueChange={value=>void toggle("option",option.id,value,group.usedByProductIds?.length??0)}/>
      </View>)}
    </View>}
   </View>;
  })}
  <Text style={s.title}>Gắn nhóm vào món</Text>
  <Text style={s.hint}>Chọn món để gắn/bỏ gắn nhóm đã tạo, không phải nhập lại topping.</Text>
  {products.map(product=><Pressable key={product.id} accessibilityRole="button"
    accessibilityLabel={"Gắn nhóm cho "+product.name} onPress={()=>onAssign(product)} style={s.line}>
    <Text style={s.productName} numberOfLines={2}>{product.name}</Text>
    <Text style={s.edit}>{product.modifierGroups.length} nhóm ›</Text>
  </Pressable>)}
  <Modal visible={pendingToggle!==null} transparent animationType="fade"
    onRequestClose={()=>setPendingToggle(null)}>
    <View style={s.backdrop}><View style={s.modal}>
      <Text style={s.title}>Xác nhận thay đổi nhiều món</Text>
      <Text style={s.hint}>Thay đổi này áp dụng cùng lúc cho {pendingToggle?.usedBy} món.
        Khách có thể cần chọn lại topping khi đặt hàng; đơn cũ được giữ nguyên.</Text>
      <View style={s.actions}>
        <Action label="Hủy" secondary onPress={()=>setPendingToggle(null)}/>
        <Action label="Xác nhận" disabled={busy} onPress={()=>{
          const decision=pendingToggle;setPendingToggle(null);
          if(decision)void call(decision.kind==="group"?"/library/groups/"+decision.id
            :"/library/options/"+decision.id,"PATCH",{isAvailable:decision.enabled});
        }}/>
      </View>
    </View></View>
  </Modal>
  <Modal visible={editing!==null} transparent animationType="slide"
    onRequestClose={()=>{if(!busy)setEditing(null);}}>
    <KeyboardAvoidingView style={s.backdrop} behavior={Platform.OS==="ios"?"padding":undefined}>
      <View style={s.modal}>
       <View style={s.heading}>
         <Text style={s.title}>{editing?.id?"Sửa":"Thêm"} {editing?.kind==="group"?"nhóm topping":"topping"}</Text>
         <Pressable accessibilityRole="button" accessibilityLabel="Đóng chỉnh sửa topping"
           style={s.iconAction} onPress={()=>setEditing(null)}><Text style={s.edit}>✕</Text></Pressable>
       </View>
       {editing&&<ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.form}>
         <Field label="Tên hiển thị" value={editing.name}
           onChangeText={name=>setEditing(old=>old?{...old,name}:old)}/>
         {editing.kind==="group"?<>
           <Field label="Chọn tối thiểu" numeric value={editing.min}
             onChangeText={min=>setEditing(old=>old?{...old,min}:old)}/>
           <Field label="Chọn tối đa" numeric value={editing.max}
             onChangeText={max=>setEditing(old=>old?{...old,max}:old)}/>
           <Field label="Thứ tự" numeric value={editing.order}
             onChangeText={order=>setEditing(old=>old?{...old,order}:old)}/>
         </>:<Field label="Giá topping (VND)" numeric value={editing.price}
           onChangeText={price=>setEditing(old=>old?{...old,price}:old)}/>}
         <Text style={s.hint}>Lưu nháp trước, sau đó gắn ảnh R2 và bật bán. Thay đổi thư viện áp dụng cho các món đã gắn; đơn cũ giữ giá chụp lúc đặt.</Text>
         {editing.usedBy>1&&<Pressable accessibilityRole="checkbox"
           accessibilityState={{checked:confirmImpact}} style={s.line}
           onPress={()=>setConfirmImpact(old=>!old)}>
           <Text style={s.edit}>{confirmImpact?"☑":"☐"}</Text>
           <Text style={s.flex}>Tôi xác nhận thay đổi áp dụng cho {editing.usedBy} món</Text>
         </Pressable>}
         {!!error&&<Notice text={error} error/>}
         <View style={s.actions}><Action label="Hủy" secondary onPress={()=>setEditing(null)}/>
           <Action label={busy?"Đang lưu...":"Lưu"} disabled={busy} onPress={save}/></View>
       </ScrollView>}
      </View>
    </KeyboardAvoidingView>
  </Modal>
 </View>;
}
export function ProductGroupAssignmentModal({catalog,product,token,root,reload,onClose}:{
 catalog:AdminCatalog;product:CatalogProduct|null;token:string;root:string;
 reload:()=>Promise<void>;onClose:()=>void;
}) {
 const [draft,setDraft]=useState<string[]>([]);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState("");
 const [search,setSearch]=useState("");
 React.useEffect(()=>{
   setDraft(product?.modifierGroups.map(g=>g.id)??[]);setError("");setSearch("");
 },[product?.id]);
 async function save(){
  if(!product||busy)return;
  setBusy(true);setError("");
  try{
   await request(root+"/products/"+product.id+"/group-assignments",token,"PUT",
    {groupIds:draft,revision:catalog.catalogRevision});
   await reload();onClose();
  }catch(e){setError(e instanceof Error?e.message:"Lưu nhóm thất bại.");}
  finally{setBusy(false);}
 }
 return <Modal visible={!!product} transparent animationType="slide" onRequestClose={onClose}>
  <View style={s.backdrop}><View style={s.modal}>
   <View style={s.heading}>
    <Text style={s.title}>Gắn nhóm · {product?.name}</Text>
    <Pressable accessibilityRole="button" accessibilityLabel="Đóng chọn nhóm"
      style={s.iconAction} onPress={onClose}><Text style={s.edit}>✕</Text></Pressable>
   </View>
   <Field label="Tìm nhóm" value={search} onChangeText={setSearch}
     placeholder="Nhập tên nhóm đã tạo..." />
   <ScrollView style={{minHeight:0}} keyboardShouldPersistTaps="handled">
    {(catalog.modifierLibrary??[]).filter(g=>g.name.toLocaleLowerCase("vi")
      .includes(search.trim().toLocaleLowerCase("vi"))).map(g=>
      <Pressable key={g.id} accessibilityRole="checkbox"
       accessibilityState={{checked:draft.includes(g.id)}} style={s.line}
       onPress={()=>setDraft(old=>old.includes(g.id)?old.filter(x=>x!==g.id):[...old,g.id])}>
       <Photo imageKey={g.imageKey} label={"Ảnh nhóm "+g.name}/>
       <Text style={s.flex} numberOfLines={2}>{g.name} · {g.options.length} topping</Text>
       <Text style={s.edit}>{draft.includes(g.id)?"☑":"☐"}</Text>
      </Pressable>)}
   </ScrollView>
   {!!error&&<Notice text={error} error/>}
   <View style={s.actions}><Action label="Hủy" secondary onPress={onClose}/>
     <Action label={busy?"Đang lưu...":"Lưu nhóm gắn"} disabled={busy} onPress={()=>void save()}/></View>
  </View></View>
 </Modal>;
}
const s=StyleSheet.create({
 root:{gap:10},heading:{minHeight:44,flexDirection:"row",alignItems:"center",gap:10},
 flex:{flex:1,minWidth:0},title:{fontSize:font.section,fontWeight:"800",color:c.ink},
 hint:{fontSize:font.note,color:c.secondary,lineHeight:18},
 group:{borderBottomWidth:1,borderBottomColor:c.line},line:{minHeight:50,
   flexDirection:"row",alignItems:"center",gap:8,borderBottomWidth:1,borderBottomColor:"#EEF0F2"},
 main:{flex:1,flexDirection:"row",alignItems:"center",gap:9,minHeight:52},
 photo:{width:40,height:40,borderRadius:8},placeholder:{width:40,height:40,borderRadius:8,
 backgroundColor:"#F2F3F5",justifyContent:"center",alignItems:"center"},
 placeholderText:{fontSize:10,color:c.secondary},name:{fontSize:font.body,
 color:c.ink,fontWeight:"700"},arrow:{fontSize:20,color:c.red},iconAction:{minWidth:44,
 minHeight:44,justifyContent:"center",alignItems:"center"},edit:{fontSize:14,color:c.red,
 fontWeight:"700"},expanded:{gap:8,paddingBottom:8,paddingLeft:8},
 actions:{flexDirection:"row",gap:8,flexWrap:"wrap",justifyContent:"flex-end"},
 productName:{flex:1,color:c.ink,fontSize:font.body},
 backdrop:{flex:1,backgroundColor:"rgba(9,17,27,0.55)",justifyContent:"center",padding:14},
 modal:{backgroundColor:c.white,borderRadius:16,width:"100%",maxWidth:540,
 alignSelf:"center",maxHeight:"90%",padding:14,gap:10},
 form:{gap:12,paddingBottom:18},
});
