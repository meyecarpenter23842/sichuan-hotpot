import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Image, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView,
  StyleSheet, Text, View,
} from "react-native";
import { Action, Field, Notice, Pill } from "./ui";
import {
  imageUrl, request, type AdminCatalog, type CatalogCategory,
  type CatalogGroup, type CatalogOption, type CatalogProduct, type CatalogVariant,
} from "./api";
import { c, font } from "./theme";
import { Icon } from "./Icon";
import { prepareProductImage } from "./prepare-product-image";
import { SharedModifierLibraryPanel, ProductGroupAssignmentModal } from "./SharedModifierLibraryPanel";
import { StatusSwitch } from "./StatusSwitch";
import { ComboEditorModal } from "./ComboEditorModal";
import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system/legacy";

type Kind = "category" | "product" | "variant" | "group" | "option";
type Values = {
  name: string; categoryId: string; price: string; sortOrder: string;
  minSelect: string; maxSelect: string; isAvailable: boolean;
  description: string; ingredients: string; productNotes: string; allergenNotice: string;
  productKind: "STANDARD" | "COMBO";
};
type Editor = { kind: Kind; id?: string; parentId?: string; values: Values };
const empty: Values = {
  name: "", categoryId: "", price: "0", sortOrder: "0",
  minSelect: "0", maxSelect: "1", isAvailable: true,
  description: "", ingredients: "", productNotes: "", allergenNotice: "",
  productKind: "STANDARD",
};
const title: Record<Kind, string> = {
  category: "danh mục", product: "món", variant: "khẩu phần",
  group: "nhóm tùy chọn", option: "tùy chọn",
};
function toPrice(n: number): string { return n.toLocaleString("vi-VN") + "đ"; }
function int(value: string, max: number): number {
  if (!/^\d+$/.test(value.trim())) throw new Error("Vui lòng nhập số nguyên không âm.");
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n > max) throw new Error("Giá trị vượt giới hạn cho phép.");
  return n;
}

export function CatalogPanel({ catalog, token, reload }: {
  catalog: AdminCatalog; token: string; reload: () => Promise<void>;
}) {
  const [filter, setFilter] = useState("");
  const [tab, setTab] = useState<"products" | "featured" | "modifiers">("products");
  const [featuredDraft, setFeaturedDraft] = useState<string[] | null>(null);
  const [sortDraft, setSortDraft] = useState<string[] | null>(null);
  const [pickerSearch, setPickerSearch] = useState("");
  const busyRef = useRef(false);
  const [stockOnly, setStockOnly] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [assignProductId, setAssignProductId] = useState<string | null>(null);
  const [comboProductId, setComboProductId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [toast, setToast] = useState<{ id: number; text: string; error: boolean } | null>(null);
  const toastId = useRef(0);
  const announce = (text: string, error = false) =>
    setToast({ id: ++toastId.current, text, error });
  useEffect(() => {
    if (!catalog.isActive) {
      announce("Chi nhánh chưa mở. Kích hoạt tại Thiết lập → Hoạt động để khách nhìn thấy món.", true);
    }
  }, [catalog.id, catalog.isActive]);
  useEffect(() => { if (error && !editor) announce(error, true); }, [error, editor]);
  useEffect(() => { if (notice) announce(notice); }, [notice]);
  useEffect(() => {
    if (!toast) return;
    const timeout = setTimeout(() =>
      setToast(current => current?.id === toast.id ? null : current), 4200);
    return () => clearTimeout(timeout);
  }, [toast]);
  const root = "/admin/branches/" + catalog.id + "/catalog";

  const counts = useMemo(() => {
    const products = catalog.categories.flatMap(category => category.products);
    return { all: products.length, off: products.filter(product => !product.isAvailable).length };
  }, [catalog]);
  const allProducts = useMemo(() => catalog.categories.flatMap(category => category.products), [catalog]);
  const orderedProducts = useMemo(() => [...allProducts].sort((a, b) =>
    a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "vi") || a.id.localeCompare(b.id)),
    [allProducts]);
  const featuredCount = allProducts.filter(product => product.isFeatured).length;
  const categories = useMemo(() =>
    catalog.categories.map(category => ({
      ...category, products: category.products.filter(product =>
        (!stockOnly || !product.isAvailable)
        && product.name.toLocaleLowerCase("vi").includes(filter.toLocaleLowerCase("vi").trim())),
    })).filter(category => category.products.length > 0 || (!stockOnly && !filter.trim())),
    [catalog, filter, stockOnly]);
  const featuredCategories = useMemo(() => catalog.categories.map(category => ({
    ...category, products: category.products.filter(product =>
      product.isFeatured && product.name.toLocaleLowerCase("vi")
        .includes(filter.toLocaleLowerCase("vi").trim())),
  })).filter(category => category.products.length > 0), [catalog, filter]);

  function open(kind: Kind, id?: string, parentId?: string,
    source?: CatalogCategory | CatalogProduct | CatalogGroup | CatalogVariant | CatalogOption) {
    const obj = source as (CatalogCategory & CatalogProduct & CatalogGroup & CatalogOption) | undefined;
    setEditor({
      kind, id, parentId,
      values: {
        ...empty,
        name: obj?.name ?? "",
        categoryId: kind === "product"
          ? (obj?.categoryId ?? parentId ?? catalog.categories[0]?.id ?? "") : "",
        price: String(obj?.priceVnd ?? obj?.priceDeltaVnd ?? 0),
        sortOrder: String(obj?.sortOrder ?? 0),
        minSelect: String(obj?.minSelect ?? 0),
        maxSelect: String(obj?.maxSelect ?? 1),
        isAvailable: obj?.isAvailable ?? true,
        description: obj?.description ?? "",
        ingredients: obj?.ingredients ?? "",
        productNotes: obj?.productNotes ?? "",
        allergenNotice: obj?.allergenNotice ?? "",
        productKind: obj?.kind ?? "STANDARD",
      },
    });
    setError("");
    setNotice("");
    setConfirmDelete(false);
    setExpandedId(null);
    setAssignProductId(null);
  }
  function change<K extends keyof Values>(key: K, value: Values[K]) {
    setEditor(old => old ? { ...old, values: { ...old.values, [key]: value } } : old);
  }

  async function mutate(path: string, method: "POST" | "PATCH" | "DELETE", body?: unknown) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true); setError(""); setNotice("");
    try {
      await request(root + path, token, method, body);
      await reload();
      setEditor(null);
      setConfirmDelete(false);
      setNotice("Đã cập nhật dữ liệu cửa hàng.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không lưu được thay đổi.");
    } finally { busyRef.current = false; setBusy(false); }
  }
  function save() {
    if (!editor || busy) return;
    const { values: v, kind, id, parentId } = editor;
    const name = v.name.trim();
    if (!name || name.length > 200) { setError("Nhập tên hợp lệ (tối đa 200 ký tự)."); return; }
    try {
      let data: object, path: string;
      switch (kind) {
        case "category":
          data = { name, sortOrder: int(v.sortOrder, 1000) };
          path = id ? "/categories/" + id : "/categories";
          break;
        case "product":
          if (!v.categoryId) throw Error("Vui lòng chọn danh mục.");
          data = {
            categoryId: v.categoryId, name, priceVnd: int(v.price, 100000000),
            description: v.description.trim() || null,
            ingredients: v.ingredients.trim() || null,
            productNotes: v.productNotes.trim() || null,
            allergenNotice: v.allergenNotice.trim() || null,
            kind: v.productKind,
            isAvailable: v.productKind === "COMBO" && !id ? false : v.isAvailable,
          };
          path = id ? "/products/" + id : "/products";
          break;
        case "variant":
          data = { name, priceDeltaVnd: int(v.price, 100000000),
            isAvailable: v.isAvailable };
          path = id ? "/variants/" + id : "/products/" + parentId + "/variants";
          break;
        case "group":
          data = { name, minSelect: int(v.minSelect, 30),
            maxSelect: int(v.maxSelect, 30), sortOrder: int(v.sortOrder, 1000) };
          if ((data as { minSelect: number; maxSelect: number }).minSelect
              > (data as { minSelect: number; maxSelect: number }).maxSelect) {
            throw Error("Số chọn tối thiểu không được lớn hơn tối đa.");
          }
          path = id ? "/groups/" + id : "/products/" + parentId + "/groups";
          break;
        case "option":
          data = { name, priceDeltaVnd: int(v.price, 100000000),
            isAvailable: v.isAvailable };
          path = id ? "/options/" + id : "/groups/" + parentId + "/options";
          break;
      }
      void mutate(path, id ? "PATCH" : "POST", data);
    } catch (e) { setError(e instanceof Error ? e.message : "Dữ liệu không hợp lệ."); }
  }
  function remove() {
    if (!editor?.id) return;
    const section = { category: "categories", product: "products", variant: "variants",
      group: "groups", option: "options" }[editor.kind];
    void mutate("/" + section + "/" + editor.id, "DELETE");
  }
  async function flipProduct(product: CatalogProduct, next: boolean) {
    if (next === product.isAvailable) return;
    await mutate("/products/" + product.id, "PATCH", { isAvailable: next });
  }
  function validateGroupAvailability(optionId: string, next: boolean): boolean {
    if (next) return true;
    for (const product of catalog.categories.flatMap(category => category.products)) {
      const group = product.modifierGroups.find(item =>
        item.options.some(option => option.id === optionId));
      if (!group) continue;
      const remaining = group.options.filter(option =>
        option.id !== optionId && option.isAvailable).length;
      if (remaining < group.minSelect) {
        setError("Nhóm “" + group.name + "” yêu cầu ít nhất " + group.minSelect +
          " lựa chọn đang bán. Hãy chỉnh số chọn tối thiểu trước khi tắt.");
        return false;
      }
      break;
    }
    return true;
  }
  async function flipOption(kind: "variant" | "option",
    value: CatalogVariant | CatalogOption, next: boolean) {
    if (next === value.isAvailable) return;
    if (kind === "option" && !validateGroupAvailability(value.id, next)) return;
    await mutate("/" + (kind === "variant" ? "variants" : "options") + "/" + value.id,
      "PATCH", { isAvailable: next });
  }

  async function saveSelection(kind: "featured" | "order", ids: string[]) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true); setError("");
    try {
      await request(root + "/products/" + kind, token, "PUT",
        { ids, revision: catalog.catalogRevision });
      await reload();
      setFeaturedDraft(null); setSortDraft(null);
      setNotice(kind === "featured" ? "Đã lưu món gợi ý." : "Đã lưu thứ tự món.");
    } catch (error) {
      setError(error instanceof Error ? error.message : "Không lưu được. Tải lại rồi thử.");
    } finally { busyRef.current = false; setBusy(false); }
  }
  function shiftOrder(index: number, by: number) {
    setSortDraft(old => {
      if (!old || index + by < 0 || index + by >= old.length) return old;
      if (!allProducts.some(product => product.id === old[index]) ||
          !allProducts.some(product => product.id === old[index + by])) return old;
      const next = [...old];
      [next[index], next[index + by]] = [next[index + by]!, next[index]!];
      return next;
    });
  }

  function pickImage(productId: string) {
    if (busy) return;
    if (Platform.OS !== "web") {
      void (async () => {
        const chosen = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ["images"], allowsEditing: true, quality: 0.6,
        });
        if (chosen.canceled || !chosen.assets[0]) return;
        const asset = chosen.assets[0];
        const mime = (asset.mimeType ?? "image/jpeg").toLowerCase();
        if (!["image/jpeg", "image/png", "image/webp"].includes(mime)) {
          setError("Ảnh phải là JPG, PNG hoặc WebP."); return;
        }
        const info = await FileSystem.getInfoAsync(asset.uri);
        const byteSize = info.exists ? info.size : undefined;
        if (!byteSize || byteSize > 2097152) {
          setError("Ảnh trên máy phải nhỏ hơn 2MB."); return;
        }
        setBusy(true); setError(""); setNotice("");
        try {
          const ticket = await request<{key:string;uploadUrl:string;contentType:string}>(
            root + "/products/" + productId + "/images/ticket", token, "POST",
            {contentType:mime,byteSize});
          const uploaded = await FileSystem.uploadAsync(ticket.uploadUrl,asset.uri,{
            httpMethod:"PUT",uploadType:FileSystem.FileSystemUploadType.BINARY_CONTENT,
            headers:{"Content-Type":ticket.contentType},
          });
          if (uploaded.status < 200 || uploaded.status >= 300) throw Error("R2 từ chối ảnh.");
          await request(root + "/products/" + productId + "/images/attach", token, "POST",
            {key:ticket.key});
          await reload();
          setNotice("Đã lưu ảnh món vào cửa hàng.");
        } catch (e) {setError(e instanceof Error ? e.message : "Không tải được ảnh món.");}
        finally {setBusy(false);}
      })().catch(e => setError(e instanceof Error ? e.message : "Không mở được thư viện ảnh."));
      return;
    }
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file || busy) return;
      setBusy(true);
      setError("");
      setNotice("");
      try {
        const prepared = await prepareProductImage(file);
        const ticket = await request<{ key: string; uploadUrl: string; contentType: string }>(
          root + "/products/" + productId + "/images/ticket", token, "POST",
          { contentType: prepared.contentType, byteSize: prepared.blob.size });
        // Only send the compressed binary directly to the scoped, expiring R2 URL.
        const sent = await fetch(ticket.uploadUrl, {
          method: "PUT", headers: { "Content-Type": ticket.contentType }, body: prepared.blob,
        });
        if (!sent.ok) {
          throw Error("R2 từ chối ảnh (" + sent.status + "). Kiểm tra CORS và quyền ghi bucket.");
        }
        await request(root + "/products/" + productId + "/images/attach", token, "POST",
          { key: ticket.key });
        await reload();
        setNotice("Đã cập nhật ảnh món. Ảnh được tối ưu còn " +
          Math.max(1, Math.round(prepared.blob.size / 1024)) + " KB.");
      } catch (e) {
        setError(e instanceof TypeError
          ? "Không kết nối trực tiếp được R2. Kiểm tra kết nối và quyền CORS từ Admin."
          : e instanceof Error && (e.message.includes("R2_UPLOAD_NOT_CONFIGURED")
              || e.message.includes("503"))
            ? "Máy chủ API chưa sẵn sàng cấp quyền tải ảnh R2 (503). Cần kiểm tra cấu hình R2 trên VPS; CORS bucket không phải nguyên nhân của lỗi cấp vé."
            : e instanceof Error ? e.message : "Không tải được ảnh lên R2.");
      } finally {
        setBusy(false);
        input.value = "";
      }
    };
    input.click();
  }

  async function removeProductImage(productId: string) {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError(""); setNotice("");
    try {
      await request(root + "/products/" + productId + "/images", token, "DELETE");
      await reload();
      setNotice("Đã gỡ ảnh món / combo.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không gỡ được ảnh món / combo.");
    } finally { busyRef.current = false; setBusy(false); }
  }

  async function removeCatalogMedia(kind:"categories"|"groups"|"options",itemId:string) {
    if(busyRef.current)return;
    busyRef.current=true;setBusy(true);setError("");setNotice("");
    try{
      await request(root+"/media/"+kind+"/"+itemId,token,"DELETE");
      await reload();setNotice("Đã gỡ ảnh. Mục đã bán sẽ cần ảnh khi bật lại.");
    }catch(e){setError(e instanceof Error?e.message:"Không gỡ được ảnh.");}
    finally{busyRef.current=false;setBusy(false);}
  }

  async function uploadCatalogMedia(
    kind:"categories"|"groups"|"options", itemId:string, blob:Blob, contentType:string,
    onResult?: (message:string, error:boolean)=>void,
    onStart?:()=>void,
  ) {
    if (busyRef.current) return;
    busyRef.current=true;setBusy(true);setError("");setNotice("");
    try {
      if(!["image/jpeg","image/png","image/webp"].includes(contentType) ||
        blob.size<1 || blob.size>2097152) {
        throw Error("Ảnh phải là JPEG/PNG/WebP và sau tối ưu không quá 2MB.");
      }
      onStart?.();
      const endpoint=root+"/media/"+kind+"/"+itemId;
      const ticket=await request<{key:string;uploadUrl:string;contentType:string}>(
        endpoint+"/ticket",token,"POST",{contentType,byteSize:blob.size});
      const response=await fetch(ticket.uploadUrl,{
        method:"PUT",headers:{"Content-Type":ticket.contentType},body:blob});
      if(!response.ok)throw Error("R2 từ chối ảnh. Hãy kiểm tra mạng hoặc CORS bucket media.");
      await request(endpoint+"/attach",token,"POST",{key:ticket.key});
      await reload();
      const message="Đã lưu ảnh "+(kind==="categories"?"danh mục":kind==="groups"?"nhóm":"topping")+".";
      setNotice(message); onResult?.(message,false);
    }catch(e){
      const message=e instanceof Error?e.message:"Không thể tải ảnh R2.";
      setError(message); onResult?.(message,true);
    }finally{busyRef.current=false;setBusy(false);}
  }
  function pickCatalogMedia(kind:"categories"|"groups"|"options",itemId:string,
    onResult?: (message:string,error:boolean)=>void, onStart?:()=>void) {
    if(busyRef.current)return;
    if(Platform.OS!=="web"){
      // Native Android gallery selector. No arbitrary path/key can reach the backend.
      void (async()=>{
        const chosen=await ImagePicker.launchImageLibraryAsync({
          mediaTypes:["images"],allowsEditing:true,quality:0.6,
        });
        if(chosen.canceled||!chosen.assets[0])return;
        const asset=chosen.assets[0];
        const mime=(asset.mimeType??"image/jpeg").toLowerCase();
        if(!["image/png","image/jpeg","image/webp"].includes(mime)){
          setError("Ảnh được chọn không hỗ trợ. Hãy chọn PNG hoặc JPEG.");return;
        }
        const info=await FileSystem.getInfoAsync(asset.uri);
        const byteSize=info.exists?info.size:undefined;
        if(!byteSize||byteSize>2097152){
          setError("Ảnh trên thiết bị phải nhỏ hơn 2MB. Hãy chọn ảnh khác.");return;
        }
        if(busyRef.current)return;
        onStart?.();
        busyRef.current=true;setBusy(true);setError("");setNotice("");
        try{
          const endpoint=root+"/media/"+kind+"/"+itemId;
          const ticket=await request<{key:string;uploadUrl:string;contentType:string}>(
            endpoint+"/ticket",token,"POST",{contentType:mime,byteSize});
          const sent=await FileSystem.uploadAsync(ticket.uploadUrl,asset.uri,{
            httpMethod:"PUT",uploadType:FileSystem.FileSystemUploadType.BINARY_CONTENT,
            headers:{"Content-Type":ticket.contentType},
          });
          if(sent.status<200||sent.status>=300)throw Error("R2 từ chối ảnh. Kiểm tra kết nối.");
          await request(endpoint+"/attach",token,"POST",{key:ticket.key});
          await reload();setNotice("Đã lưu ảnh từ thư viện Android.");
          onResult?.("Đã lưu ảnh từ thư viện Android.",false);
        }finally{busyRef.current=false;setBusy(false);}
      })().catch(e=>{const message=e instanceof Error?e.message:"Không thể chọn ảnh trên Android.";
        setError(message);onResult?.(message,true);});
      return;
    }
    const input=document.createElement("input");
    input.type="file";input.accept="image/png,image/jpeg,image/webp";
    input.onchange=()=>{
      const file=input.files?.[0];if(!file)return;
      void prepareProductImage(file)
        .then(prepared=>uploadCatalogMedia(kind,itemId,prepared.blob,prepared.contentType,onResult,onStart))
        .catch(e=>{const message=e instanceof Error?e.message:"Không thể tối ưu ảnh.";
          setError(message);onResult?.(message,true);});
    };
    input.click();
  }

  return <View style={st.container}>
    <View style={st.heading}>
      <View style={st.headingText}>
        <Text style={st.title}>Thực đơn</Text>
        <Text style={st.sub}>{counts.all} món · {featuredCount} gợi ý · {counts.off} tạm hết</Text>
      </View>
      <View style={{ flexDirection: "row", gap: 5 }}>
        {tab === "products" && <Action label="＋ Danh mục" secondary onPress={() => open("category")} />}
        {tab === "featured" && <Action label="＋ Gợi ý" secondary onPress={() => {
          setPickerSearch(""); setError("");
          setFeaturedDraft(allProducts.filter(product => product.isFeatured).map(product => product.id));
        }} />}
        {tab !== "modifiers" && <Action label="↕ Thứ tự" secondary onPress={() => {
          setError(""); setSortDraft(orderedProducts.map(product => product.id));
        }} />}
      </View>
    </View>
    <View style={st.menuTabs} accessibilityRole="tablist">
      <Pressable accessibilityRole="tab" accessibilityState={{ selected: tab === "products" }}
        accessibilityLabel="Món" style={[st.menuTab, tab === "products" && st.menuTabActive]}
        onPress={() => { setTab("products"); setExpandedId(null); setError(""); setToast(null); }}>
        <Text style={[st.menuTabText, tab === "products" && st.menuTabTextActive]}>Món</Text>
      </Pressable>
      <Pressable accessibilityRole="tab" accessibilityState={{ selected: tab === "featured" }}
        accessibilityLabel="Món gợi ý" style={[st.menuTab, tab === "featured" && st.menuTabActive]}
        onPress={() => { setTab("featured"); setExpandedId(null); setError(""); setToast(null); }}>
        <Text style={[st.menuTabText, tab === "featured" && st.menuTabTextActive]}>Món gợi ý</Text>
      </Pressable>
      <Pressable accessibilityRole="tab" accessibilityState={{ selected: tab === "modifiers" }}
        accessibilityLabel="Nhóm tùy chọn"
        style={[st.menuTab, tab === "modifiers" && st.menuTabActive]}
        onPress={() => { setTab("modifiers"); setExpandedId(null); setError(""); setToast(null); }}>
        <Text style={[st.menuTabText, tab === "modifiers" && st.menuTabTextActive]}>Nhóm tùy chọn</Text>
      </Pressable>
    </View>
    <View style={st.body}>
      <ScrollView testID="catalog-body-scroll" style={st.contentScroll} contentContainerStyle={st.content}
        keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
    {(tab === "products" || tab === "featured") && <>
    <Field label="Tìm món" value={filter} onChangeText={setFilter}
      placeholder="Tên lẩu, trà sữa, combo..." />
    {tab === "products" && <View style={st.pills}>
      <Pill label="Tất cả" active={!stockOnly} onPress={() => setStockOnly(false)} />
      <Pill label="Tạm hết" active={stockOnly} onPress={() => setStockOnly(true)} />
    </View>}
    {(tab === "featured" ? featuredCategories : categories).length === 0 &&
      <Notice text={tab === "featured" ? "Chưa có món gợi ý. Nhấn ＋ Gợi ý để chọn món." :
        "Không có món phù hợp trong chi nhánh này."} />}
    {(tab === "featured" ? featuredCategories : categories).map(category => (
      <View key={category.id} style={st.categoryBlock}>
        <View style={st.categoryHeading}>
          <View style={st.categoryTitle}>
            <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
              {imageUrl(category.imageKey ?? null)
                ? <Image source={{ uri: imageUrl(category.imageKey ?? null)! }}
                    style={{ width: 36, height: 36, borderRadius: 8 }} />
                : <View style={{ width: 36, height: 36, borderRadius: 8,
                    backgroundColor: "#F1F2F4", alignItems: "center", justifyContent: "center" }}>
                    <Text style={{ fontSize: 10, color: c.secondary }}>Ảnh</Text></View>}
              <View style={{flex:1}}><Text style={st.categoryName}>{category.name}</Text>
                {category.isPublished === false && <Text style={st.sub}>Chưa công bố · gắn ảnh để hiển thị trên app khách</Text>}
              </View>
            </View>
            <Text style={st.sub}>{category.products.length} món</Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel={"Chọn ảnh danh mục " + category.name}
            style={st.categoryAction} onPress={() => pickCatalogMedia("categories", category.id)}>
            <Icon name="catalog" size={19} color={c.red} />
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={"Sửa danh mục " + category.name}
            style={st.categoryAction} onPress={() => open("category", category.id, undefined, category)}>
            <Icon name="edit" size={19} color={c.secondary} />
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="＋ Món"
            style={st.categoryAction} onPress={() => open("product", undefined, category.id)}>
            <Icon name="plus" size={21} color={c.red} />
          </Pressable>
        </View>
        {category.products.map(product => {
          const expanded = expandedId === product.id;
          const uri = imageUrl(product.imageKey);
          return <View key={product.id} style={st.productWrap}>
            <View style={st.productRow}>
              <Pressable accessibilityRole="button"
                accessibilityLabel={"Xem chi tiết " + product.name}
                accessibilityState={{ expanded }} onPress={() => setExpandedId(expanded ? null : product.id)}
                style={st.productMain}>
                {uri ? <Image source={{ uri }} style={st.thumbnail} /> :
                  <View style={st.thumbnailFallback}><Text style={st.thumbnailText}>Ảnh</Text></View>}
                <View style={st.productCopy}>
                  <View style={st.productNameRow}>
                    <Text style={st.productName} numberOfLines={2}>{product.name}</Text>
                    {product.kind === "COMBO" && <Text style={st.comboBadge}>COMBO</Text>}
                  </View>
                  <Text style={st.price}>{toPrice(product.priceVnd)} · Đã bán {product.soldCount}</Text>
                </View>
              </Pressable>
              <StatusSwitch value={product.isAvailable} busy={busy}
                label={"Bán món " + product.name}
                onValueChange={next => void flipProduct(product, next)} />
              <Pressable accessibilityRole="button" accessibilityLabel={"Sửa món " + product.name}
                style={st.miniEdit} onPress={() => open("product", product.id, undefined, product)}>
                <Icon name="edit" size={19} color={c.red} />
              </Pressable>
            </View>
            {expanded && assignProductId === null && <Modal visible animationType="slide" transparent
              onRequestClose={() => { if (!busy) { setExpandedId(null); setError(""); } }}>
              <View style={st.backdrop}>
                <View style={st.modal}>
                  <View style={st.modalHeading}>
                    <View style={st.modalName}>
                      <Text style={st.title} numberOfLines={2}>{product.name}</Text>
                      <Text style={st.sub}>{product.kind === "COMBO"
                        ? "Thành phần combo · Khẩu phần · Topping · Hình ảnh"
                        : "Khẩu phần · Topping · Hình ảnh"}</Text>
                    </View>
                    <Pressable accessibilityRole="button" accessibilityLabel="Đóng chi tiết món"
                      style={st.close} disabled={busy}
                      onPress={() => { if (!busy) { setExpandedId(null); setError(""); } }}>
                      <Icon name="close" size={19} color={c.secondary} />
                    </Pressable>
                  </View>
                  {!!notice && <Notice text={notice} />}
                  {!!error && <Notice text={error} error />}
                  {busy && <Text style={st.emptyNote}>Đang lưu / tải ảnh, vui lòng đợi...</Text>}
                  <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled"
                    showsVerticalScrollIndicator={false} contentContainerStyle={st.modalBody}>
                    <View style={st.details}>
              {product.kind === "COMBO" && <>
                <View style={st.detailHead}>
                  <View style={{ flex: 1 }}>
                    <Text style={st.detailHeading}>Thành phần combo</Text>
                    <Text style={st.emptyNote}>
                      {product.comboFixedItems.length} cố định · {product.comboGroups.length} nhóm lựa chọn
                    </Text>
                  </View>
                  <Action label="Thiết lập combo" secondary onPress={() => {
                    setExpandedId(null); setError(""); setNotice(""); setComboProductId(product.id);
                  }} />
                </View>
                {product.comboFixedItems.length === 0 && product.comboGroups.length === 0 &&
                  <Notice text="Combo chưa có thành phần nên đang được giữ ở trạng thái tạm hết." />}
                {product.comboFixedItems.map(item =>
                  <Text key={item.id} style={st.emptyNote}>
                    • {item.quantity} × {item.childProduct.name}
                    {item.variant ? " · " + item.variant.name : ""}
                    {item.childProduct.isAvailable && (item.variant == null || item.variant.isAvailable)
                      ? "" : " · đang hết"}
                  </Text>)}
                {product.comboGroups.map(group =>
                  <Text key={group.id} style={st.emptyNote}>
                    • {group.name}: chọn {group.minSelect}–{group.maxSelect} · {group.options.length} món
                  </Text>)}
              </>}
              <View style={st.detailHead}>
                <Text style={st.detailHeading}>Khẩu phần / size</Text>
                <Action label="＋ Size" secondary onPress={() => open("variant", undefined, product.id)} />
              </View>
              {product.variants.length === 0 && <Text style={st.emptyNote}>Chưa có size riêng.</Text>}
              {product.variants.map(variant => <View key={variant.id} style={st.optionRow}>
                <Text style={st.optionName}>{variant.name} · +{toPrice(variant.priceDeltaVnd)}</Text>
                <StatusSwitch value={variant.isAvailable} busy={busy}
                  label={"Bán size " + variant.name}
                  onValueChange={next => void flipOption("variant", variant, next)} />
                <Pressable accessibilityRole="button" style={st.optionAction}
                  accessibilityLabel={"Sửa size " + variant.name}
                  onPress={() => open("variant", variant.id, product.id, variant)}>
                  <Icon name="edit" size={17} color={c.red} />
                </Pressable>
              </View>)}
              <View style={st.detailHead}>
                <Text style={st.detailHeading}>Topping / tùy chọn</Text>
                <Action label="＋ Gắn nhóm đã có" secondary
                  onPress={() => {setExpandedId(null);setError("");setNotice("");setAssignProductId(product.id);}} />
              </View>
              {product.modifierGroups.length === 0 && <Text style={st.emptyNote}>Chưa có nhóm tùy chọn.</Text>}
              {product.modifierGroups.map(group => <View key={group.id} style={st.group}>
                <Text style={st.groupName}>{group.name} · {group.options.length} topping</Text>
                <Text style={st.emptyNote}>{group.isAvailable ? "Đang bán" : "Chưa bật bán"} · Quản lý tại thư viện chung</Text>
              </View>)}
              {product.modifierGroups.length > 0 && <Action label="Quản lý thư viện nhóm" secondary
                onPress={() => {setExpandedId(null);setTab("modifiers");setError("");setNotice("");}} />}
              <Action label="Chọn / thay ảnh món" secondary
                disabled={busy} onPress={() => pickImage(product.id)} />
              {!!product.imageKey && <Action label="Gỡ ảnh món" secondary
                disabled={busy} onPress={() => void removeProductImage(product.id)} />}
                    </View>
                  </ScrollView>
                </View>
              </View>
            </Modal>}
          </View>;
        })}
      </View>
    ))}
    </>}
    {tab === "modifiers" && <SharedModifierLibraryPanel catalog={catalog} token={token}
      root={root} reload={reload} onPickImage={pickCatalogMedia} onRemoveImage={(kind,id)=>void removeCatalogMedia(kind,id)}
      onFeedback={(message,failed)=>announce(message,failed)}
      onAssign={product => {setExpandedId(null);setEditor(null);setAssignProductId(product.id);}} />}
      </ScrollView>
      {toast && <View style={st.toastLayer} pointerEvents="box-none">
        <View style={[st.toast, toast.error && st.toastError]} accessibilityRole="alert" pointerEvents="box-none">
          <Icon name={toast.error ? "power" : "check"} color={toast.error ? c.red : "#167442"} size={18} />
          <Text style={st.toastText} numberOfLines={3}>{toast.text}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Đóng thông báo"
            style={st.toastClose} onPress={() => setToast(null)}>
            <Text style={st.toastCloseText}>×</Text>
          </Pressable>
        </View>
      </View>}
    </View>
    <ProductGroupAssignmentModal catalog={catalog}
      product={allProducts.find(p => p.id === assignProductId) ?? null}
      token={token} root={root} reload={reload} onClose={() => setAssignProductId(null)}
      onFeedback={(message,failed)=>announce(message,failed)} />
    <ComboEditorModal catalog={catalog}
      product={allProducts.find(p => p.id === comboProductId) ?? null}
      token={token} root={root} reload={reload} onClose={() => setComboProductId(null)}
      onFeedback={(message,failed)=>announce(message,failed)}
      onPickImage={pickImage} onRemoveImage={productId => void removeProductImage(productId)}
      mediaBusy={busy} />
    <Modal visible={editor !== null} animationType="slide" transparent
      onRequestClose={() => { if (!busy) setEditor(null); }}>
      <KeyboardAvoidingView style={st.backdrop} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={st.modal}>
          <View style={st.modalHeading}>
            <Text style={st.title}>{editor?.id ? "Sửa" : "Thêm"} {editor ? title[editor.kind] : ""}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Đóng chỉnh sửa"
              disabled={busy} style={st.close} onPress={() => setEditor(null)}>
              <Text style={st.closeText}>×</Text>
            </Pressable>
          </View>
          {editor && <ScrollView keyboardShouldPersistTaps="handled"
            contentContainerStyle={st.modalBody} showsVerticalScrollIndicator={false}>
            <Field label="Tên" value={editor.values.name}
              onChangeText={text => change("name", text)} placeholder="Tên hiển thị cho khách" />
            {editor.kind === "product" && <>
              <Text style={st.smallLabel}>Loại sản phẩm</Text>
              {editor.id ? <Text style={st.sub}>
                {editor.values.productKind === "COMBO" ? "Combo" : "Món thường"} · loại được cố định sau khi tạo
              </Text> : <View style={st.pills}>
                <Pill label="Món thường" active={editor.values.productKind === "STANDARD"}
                  onPress={() => change("productKind", "STANDARD")} />
                <Pill label="Combo" active={editor.values.productKind === "COMBO"}
                  onPress={() => setEditor(current => !current ? current : ({
                    ...current, values: {
                      ...current.values, productKind: "COMBO", isAvailable: false,
                    },
                  }))} />
              </View>}
              {editor.values.productKind === "COMBO" && !editor.id &&
                <Notice text="Combo mới sẽ lưu ở trạng thái tạm hết. Sau khi lưu, mở chi tiết món → Thiết lập combo rồi bật bán." />}
              <Text style={st.smallLabel}>Danh mục</Text>
              <View style={st.pills}>
                {catalog.categories.map(cat =>
                  <Pill key={cat.id} label={cat.name}
                    active={cat.id === editor.values.categoryId}
                    onPress={() => change("categoryId", cat.id)} />)}
              </View>
            </>}
            {editor.kind === "product" && <View style={st.contentFields}>
              <Text style={st.contentHeading}>Nội dung khách sẽ thấy</Text>
              <Field label="Mô tả món" multiline maxLength={1200}
                value={editor.values.description} onChangeText={text => change("description", text)}
                placeholder="Đặc điểm, hương vị, cách dùng..."
                helper={editor.values.description.length + "/1200 · Có thể để trống"} />
              <Field label="Thành phần" multiline maxLength={1200}
                value={editor.values.ingredients} onChangeText={text => change("ingredients", text)}
                placeholder="Ví dụ: bò, nấm, cải thìa..."
                helper={editor.values.ingredients.length + "/1200 · Khách mở bằng “Xem thành phần”"} />
              <Field label="Lưu ý" multiline maxLength={800}
                value={editor.values.productNotes} onChangeText={text => change("productNotes", text)}
                placeholder="Lưu ý phục vụ hoặc sử dụng món..."
                helper={editor.values.productNotes.length + "/800 · Đây là nội dung hiển thị khách"} />
              <Field label="Thông tin dị ứng" multiline maxLength={800}
                value={editor.values.allergenNotice} onChangeText={text => change("allergenNotice", text)}
                placeholder="Chỉ nhập thông tin cửa hàng đã xác nhận"
                helper={editor.values.allergenNotice.length + "/800 · Không dùng để cam kết an toàn dị ứng"} />
              {(editor.values.description.trim() || editor.values.ingredients.trim() ||
                editor.values.productNotes.trim() || editor.values.allergenNotice.trim()) &&
                <View style={st.contentPreview}>
                  <Text style={st.previewLabel}>Xem trước vị trí hiển thị</Text>
                  <Text style={st.previewName}>{editor.values.name.trim() || "Tên món"}</Text>
                  {!!editor.values.description.trim() &&
                    <Text style={st.previewText} numberOfLines={3}>{editor.values.description.trim()}</Text>}
                  {!!editor.values.ingredients.trim() &&
                    <Text style={st.previewLink}>Xem thành phần ›</Text>}
                  {!!editor.values.productNotes.trim() &&
                    <Text style={st.previewText} numberOfLines={2}>Lưu ý: {editor.values.productNotes.trim()}</Text>}
                  {!!editor.values.allergenNotice.trim() &&
                    <Text style={st.previewWarning} numberOfLines={2}>Dị ứng: {editor.values.allergenNotice.trim()}</Text>}
                </View>}
            </View>}
            {["product", "variant", "option"].includes(editor.kind) &&
              <Field label={editor.kind === "product" ? "Giá bán (VND)" : "Phụ thu (VND)"}
                numeric value={editor.values.price} onChangeText={text => change("price", text)} />}
            {["category", "group"].includes(editor.kind) &&
              <Field label="Thứ tự" numeric value={editor.values.sortOrder}
                onChangeText={text => change("sortOrder", text)} />}
            {editor.kind === "group" && <>
              <Field label="Chọn tối thiểu" numeric value={editor.values.minSelect}
                onChangeText={text => change("minSelect", text)} />
              <Field label="Chọn tối đa" numeric value={editor.values.maxSelect}
                onChangeText={text => change("maxSelect", text)} />
            </>}
            {["product", "variant", "option"].includes(editor.kind)
              && !(editor.kind === "product" && editor.values.productKind === "COMBO" && !editor.id)
              && <View style={st.toggleRow}>
                <Text style={st.smallLabel}>Tình trạng</Text>
                <StatusSwitch value={editor.values.isAvailable} busy={busy}
                  label="Cho phép bán" onValueChange={next => change("isAvailable", next)} />
              </View>}
            {!!error && <Notice text={error} error />}
            {!!notice && <Notice text={notice} />}
            {busy && <Text style={st.emptyNote}>Đang lưu / tải ảnh, vui lòng đợi...</Text>}
            {editor.id && ["category","group","option"].includes(editor.kind) && <>
               <Action label="＋ Gắn / thay ảnh" secondary disabled={busy}
                 onPress={() => pickCatalogMedia(editor.kind === "category" ? "categories"
                   : editor.kind === "group" ? "groups" : "options", editor.id!)} />
               <Action label="Gỡ ảnh" secondary disabled={busy}
                 onPress={() => void removeCatalogMedia(editor.kind === "category" ? "categories"
                   : editor.kind === "group" ? "groups" : "options", editor.id!)} />
               <Text style={st.sub}>Ảnh mới được lưu độc lập với tên và giá. Mục mới lưu nháp trước để có mã tải ảnh.</Text>
             </>}
            {confirmDelete && <Notice text="Xác nhận xóa? Món đã có lịch sử đơn không thể xóa; hãy chuyển sang tạm hết." error />}
            <View style={st.modalActions}>
              {editor.id && <Action label={confirmDelete ? "Xác nhận xóa" : "Xóa"}
                dangerous disabled={busy} onPress={() => confirmDelete ? remove() : setConfirmDelete(true)} />}
              <Action label="Hủy" secondary disabled={busy} onPress={() => setEditor(null)} />
              <Action label={busy ? "Đang lưu..." : "Lưu thay đổi"}
                disabled={busy} onPress={save} />
            </View>
          </ScrollView>}
        </View>
      </KeyboardAvoidingView>
    </Modal>

      <Modal visible={featuredDraft !== null} transparent animationType="fade"
        onRequestClose={() => { if (!busy) setFeaturedDraft(null); }}>
        <View style={st.backdrop}>
          <View style={st.modal}>
            <View style={st.modalHeading}>
              <View style={st.modalName}>
                <Text style={st.title}>Chọn món gợi ý</Text>
                <Text style={st.sub}>Món tạm hết vẫn có thể gợi ý nhưng khách không đặt được.</Text>
              </View>
              <Pressable accessibilityRole="button" accessibilityLabel="Đóng chọn món gợi ý"
                style={st.close} disabled={busy} onPress={() => setFeaturedDraft(null)}>
                <Icon name="close" size={19} color={c.secondary} />
              </Pressable>
            </View>
            <View style={{ paddingHorizontal: 12, paddingTop: 8 }}>
              <Field label="Tìm món" value={pickerSearch} onChangeText={setPickerSearch}
                placeholder="Tìm theo tên món..." />
              {!!error && <Notice text={error} error />}
            </View>
            <ScrollView keyboardShouldPersistTaps="handled" style={{ minHeight: 0 }}
              contentContainerStyle={st.modalBody}>
              {allProducts.filter(item => item.name.toLocaleLowerCase("vi")
                .includes(pickerSearch.toLocaleLowerCase("vi").trim())).map(item =>
                <View key={item.id} style={st.optionRow}>
                  <Text style={st.optionName} numberOfLines={2}>
                    {item.name} · {toPrice(item.priceVnd)}
                  </Text>
                  <StatusSwitch value={featuredDraft?.includes(item.id) ?? false} busy={busy}
                    label={"Gợi ý món " + item.name} onValueChange={value =>
                      setFeaturedDraft(old => !old ? old : value
                        ? [...old, item.id] : old.filter(id => id !== item.id))} />
                </View>)}
              {allProducts.length === 0 && <Text style={st.emptyNote}>Chưa có món nào để chọn.</Text>}
            </ScrollView>
            <View style={[st.modalActions, { padding: 12 }]}>
              <Action label="Hủy" secondary disabled={busy} onPress={() => setFeaturedDraft(null)} />
              <Action label={busy ? "Đang lưu..." : "Lưu món gợi ý"}
                disabled={busy} onPress={() => void saveSelection("featured", featuredDraft ?? [])} />
            </View>
          </View>
        </View>
      </Modal>
      <Modal visible={sortDraft !== null} transparent animationType="fade"
        onRequestClose={() => { if (!busy) setSortDraft(null); }}>
        <View style={st.backdrop}>
          <View style={st.modal}>
            <View style={st.modalHeading}>
              <View style={st.modalName}>
                <Text style={st.title}>Sắp xếp thứ tự món</Text>
                <Text style={st.sub}>Dùng mũi tên để đổi vị trí món, kể cả gợi ý từ danh mục khác.</Text>
              </View>
              <Pressable accessibilityRole="button" accessibilityLabel="Đóng sắp xếp"
                style={st.close} disabled={busy} onPress={() => setSortDraft(null)}>
                <Icon name="close" size={19} color={c.secondary} />
              </Pressable>
            </View>
            {!!error && <View style={{ paddingHorizontal: 12 }}><Notice text={error} error /></View>}
            <ScrollView style={{ minHeight: 0 }} contentContainerStyle={st.modalBody}>
              {sortDraft?.map((id, index) => {
                const product = allProducts.find(item => item.id === id);
                if (!product) return null;
                const category = catalog.categories.find(cat => cat.id === product.categoryId);
                return <View key={id} style={st.optionRow}>
                  <Text style={st.optionName} numberOfLines={2}>{product.name}{category ? " · " + category.name : ""}</Text>
                  <Pressable accessibilityRole="button" accessibilityLabel={"Đưa " + product.name + " lên"}
                    disabled={busy || index === 0}
                    style={st.optionAction} onPress={() => shiftOrder(index, -1)}>
                    <Text style={st.miniEditText}>↑</Text>
                  </Pressable>
                  <Pressable accessibilityRole="button" accessibilityLabel={"Đưa " + product.name + " xuống"}
                    disabled={busy || index === sortDraft.length - 1}
                    style={st.optionAction} onPress={() => shiftOrder(index, 1)}>
                    <Text style={st.miniEditText}>↓</Text>
                  </Pressable>
                </View>;
              })}
            </ScrollView>
            <View style={[st.modalActions, { padding: 12 }]}>
              <Action label="Hủy" secondary disabled={busy} onPress={() => setSortDraft(null)} />
              <Action label={busy ? "Đang lưu..." : "Lưu thứ tự"}
                disabled={busy} onPress={() => void saveSelection("order", sortDraft ?? [])} />
            </View>
          </View>
        </View>
      </Modal>
  </View>;
}
const st = StyleSheet.create({
  container: { flex: 1, minHeight: 0, paddingHorizontal: 12, paddingTop: 8 },
  body: { flex: 1, minHeight: 0 },
  contentScroll: { flex: 1, minHeight: 0 },
  content: { gap: 9, paddingTop: 9, paddingBottom: 24 },
  toastLayer: { position: "absolute", top: 7, left: 0, right: 0,
    zIndex: 12, elevation: 12 },
  toast: { minHeight: 44, borderRadius: 10, flexDirection: "row",
    gap: 8, alignItems: "center", paddingLeft: 12, paddingRight: 5,
    borderWidth: 1, borderColor: "#C7E3D1", backgroundColor: "#F1FAF4",
    shadowColor: "#211616", shadowOpacity: 0.15, shadowRadius: 6, elevation: 8 },
  toastError: { borderColor: "#F3C9CD", backgroundColor: "#FFF2F2" },
  toastText: { flex: 1, color: c.ink, fontSize: font.note, lineHeight: 17 },
  toastClose: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  toastCloseText: { color: c.secondary, fontSize: 20 },
  heading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, height: 44, flexShrink: 0 },
  headingText: { flex: 1, gap: 3 }, title: { fontSize: font.title, fontWeight: "800", color: c.ink },
  sub: { color: c.secondary, fontSize: font.caption },
  pills: { flexDirection: "row", flexWrap: "wrap", gap: 7, paddingVertical: 2 },
  menuTabs: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: c.line,
    gap: 15, minHeight: 46, backgroundColor: c.white },
  menuTab: { minHeight: 44, paddingHorizontal: 5, justifyContent: "center",
    borderBottomWidth: 2, borderBottomColor: "transparent" },
  menuTabActive: { borderBottomColor: c.red },
  menuTabText: { color: c.secondary, fontWeight: "700", fontSize: font.body },
  menuTabTextActive: { color: c.red },
  categoryBlock: { borderTopWidth: 1, borderTopColor: c.line, marginHorizontal: -12,
    backgroundColor: c.white },
  categoryHeading: { flexDirection: "row", alignItems: "center", paddingHorizontal: 12,
    paddingVertical: 5, gap: 6 },
  categoryTitle: { flex: 1, minWidth: 0, gap: 2 },
  categoryAction: { minHeight: 44, minWidth: 44, alignItems: "center", justifyContent: "center" },
  categoryName: { color: c.ink, fontWeight: "800", fontSize: font.section },
  productWrap: { borderTopWidth: 1, borderTopColor: c.line },
  productRow: { flexDirection: "row", alignItems: "center", gap: 5,
    paddingVertical: 6, paddingHorizontal: 10, minHeight: 58 },
  productMain: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 9 },
  thumbnail: { width: 44, height: 44, borderRadius: 7, backgroundColor: c.pale },
  thumbnailFallback: { width: 44, height: 44, borderRadius: 7, backgroundColor: c.pale,
    alignItems: "center", justifyContent: "center" },
  thumbnailText: { fontSize: font.caption, color: c.secondary },
  productCopy: { flex: 1, minWidth: 0, gap: 3 },
  productNameRow: { flexDirection: "row", alignItems: "center", gap: 6, minWidth: 0 },
  comboBadge: { color: c.red, backgroundColor: "#FDE8EA", fontSize: 9, fontWeight: "900",
    borderRadius: 7, paddingHorizontal: 6, paddingVertical: 3, overflow: "hidden" },
  productName: { color: c.ink, fontSize: font.body, fontWeight: "700", flexShrink: 1 },
  price: { color: c.red, fontSize: font.note, fontWeight: "700" },
  stock: { borderRadius: 6, minHeight: 32, justifyContent: "center",
    paddingHorizontal: 7, borderWidth: 1 },
  stockOn: { backgroundColor: "#ECFAF4", borderColor: "#D1EEE1" },
  stockOff: { backgroundColor: c.soft, borderColor: "#F1CCCF" },
  stockLabel: { fontSize: 10, fontWeight: "700" },
  stockTextOn: { color: c.green }, stockTextOff: { color: c.red },
  miniEdit: { minHeight: 44, minWidth: 38, justifyContent: "center", alignItems: "center" },
  miniEditText: { fontSize: font.note, color: c.red, fontWeight: "700" },
  details: { gap: 9 },
  detailHead: { flexDirection: "row", flexWrap: "wrap", alignItems: "center",
    gap: 7, justifyContent: "space-between", paddingVertical: 5 },
  detailHeading: { flex: 1, color: c.ink, fontSize: font.note, fontWeight: "800" },
  emptyNote: { color: c.secondary, fontSize: font.note, paddingVertical: 6 },
  optionRow: { flexDirection: "row", alignItems: "center", minHeight: 38,
    borderBottomWidth: 1, borderBottomColor: c.line, gap: 8 },
  optionName: { flex: 1, fontSize: font.note, color: c.ink },
  optionAction: { minHeight: 44, minWidth: 35, justifyContent: "center", alignItems: "center" },
  group: { borderTopWidth: 1, borderTopColor: c.line, paddingTop: 9, gap: 4 },
  groupName: { flex: 1, fontSize: font.note, color: c.ink, fontWeight: "700" },
  backdrop: { flex: 1, backgroundColor: "rgba(14,20,29,0.48)",
    justifyContent: "center", padding: 13 },
  modal: { backgroundColor: c.white, borderRadius: 16, maxHeight: "93%",
    width: "100%", maxWidth: 550, alignSelf: "center", overflow: "hidden" },
  modalName: { flex: 1, minWidth: 0, gap: 4 },
  modalHeading: { flexDirection: "row", alignItems: "center",
    justifyContent: "space-between", paddingHorizontal: 15, borderBottomWidth: 1,
    borderBottomColor: c.line, minHeight: 53 },
  close: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  closeText: { fontSize: 20, color: c.secondary },
  modalBody: { padding: 12, gap: 9, paddingBottom: 22 },
  modalActions: { flexDirection: "row", flexWrap: "wrap", gap: 8, justifyContent: "flex-end" },
  smallLabel: { color: c.ink, fontSize: font.note, fontWeight: "700" },
  contentFields: { gap: 9, paddingTop: 4 },
  contentHeading: { color: c.ink, fontSize: font.body, fontWeight: "800" },
  contentPreview: { gap: 4, borderTopWidth: 1, borderTopColor: c.line, paddingTop: 9 },
  previewLabel: { color: c.secondary, fontSize: 11, fontWeight: "700" },
  previewName: { color: c.ink, fontSize: font.body, fontWeight: "800" },
  previewText: { color: c.secondary, fontSize: font.note, lineHeight: 18 },
  previewLink: { color: c.red, fontSize: font.note, fontWeight: "800" },
  previewWarning: { color: "#9B2C2C", fontSize: font.note, lineHeight: 18 },
  toggleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
});
