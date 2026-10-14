import React, { useMemo, useState } from "react";
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

type Kind = "category" | "product" | "variant" | "group" | "option";
type Values = {
  name: string; categoryId: string; price: string; sortOrder: string;
  minSelect: string; maxSelect: string; isAvailable: boolean;
};
type Editor = { kind: Kind; id?: string; parentId?: string; values: Values };
const empty: Values = {
  name: "", categoryId: "", price: "0", sortOrder: "0",
  minSelect: "0", maxSelect: "1", isAvailable: true,
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
  const [stockOnly, setStockOnly] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const root = "/admin/branches/" + catalog.id + "/catalog";

  const counts = useMemo(() => {
    const products = catalog.categories.flatMap(category => category.products);
    return { all: products.length, off: products.filter(product => !product.isAvailable).length };
  }, [catalog]);
  const categories = useMemo(() =>
    catalog.categories.map(category => ({
      ...category, products: category.products.filter(product =>
        (!stockOnly || !product.isAvailable)
        && product.name.toLocaleLowerCase("vi").includes(filter.toLocaleLowerCase("vi").trim())),
    })).filter(category => category.products.length > 0 || (!stockOnly && !filter.trim())),
    [catalog, filter, stockOnly]);

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
      },
    });
    setError("");
    setConfirmDelete(false);
    setExpandedId(null);
  }
  function change<K extends keyof Values>(key: K, value: Values[K]) {
    setEditor(old => old ? { ...old, values: { ...old.values, [key]: value } } : old);
  }

  async function mutate(path: string, method: "POST" | "PATCH" | "DELETE", body?: unknown) {
    if (busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await request(root + path, token, method, body);
      await reload();
      setEditor(null);
      setConfirmDelete(false);
      setNotice("Đã cập nhật dữ liệu cửa hàng.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không lưu được thay đổi.");
    } finally { setBusy(false); }
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
          data = { categoryId: v.categoryId, name, priceVnd: int(v.price, 100000000),
            isAvailable: v.isAvailable };
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
  async function flipProduct(product: CatalogProduct) {
    await mutate("/products/" + product.id, "PATCH", { isAvailable: !product.isAvailable });
  }
  async function flipOption(kind: "variant" | "option", value: CatalogVariant | CatalogOption) {
    await mutate("/" + (kind === "variant" ? "variants" : "options") + "/" + value.id,
      "PATCH", { isAvailable: !value.isAvailable });
  }

  function pickImage(productId: string) {
    if (Platform.OS !== "web") {
      setError("Chọn ảnh hiện hỗ trợ trên Admin PWA; chức năng chọn ảnh Android cần được tích hợp riêng.");
      return;
    }
    const input = document.createElement("input");
    input.type = "file"; input.accept = "image/png,image/jpeg,image/webp";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file || busy) return;
      if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)
          || file.size < 1 || file.size > 2097152) {
        setError("Ảnh phải là PNG/JPEG/WebP, tối đa 2MB.");
        return;
      }
      setBusy(true); setError("");
      try {
        const ticket = await request<{ key: string; uploadUrl: string; contentType: string }>(
          root + "/products/" + productId + "/images/ticket", token, "POST",
          { contentType: file.type, byteSize: file.size });
        // Direct PUT only to an R2 short-lived signed URL. Never exposes bucket credentials.
        const sent = await fetch(ticket.uploadUrl, { method: "PUT",
          headers: { "Content-Type": ticket.contentType }, body: file });
        if (!sent.ok) throw Error("Tải ảnh lên R2 thất bại. Kiểm tra cấu hình CORS của bucket.");
        await request(root + "/products/" + productId + "/images/attach", token, "POST",
          { key: ticket.key });
        await reload();
        setNotice("Đã thay ảnh món.");
      } catch (e) { setError(e instanceof Error ? e.message : "Không tải được ảnh."); }
      finally { setBusy(false); }
    };
    input.click();
  }

  return <View style={st.container}>
    <View style={st.heading}>
      <View style={st.headingText}>
        <Text style={st.title}>Thực đơn</Text>
        <Text style={st.sub}>{counts.all} món · {counts.off} tạm hết</Text>
      </View>
      <Action label="＋ Danh mục" secondary onPress={() => open("category")} />
    </View>
    <Field label="Tìm món" value={filter} onChangeText={setFilter}
      placeholder="Tên lẩu, trà sữa, combo..." />
    <View style={st.pills}>
      <Pill label="Tất cả" active={!stockOnly} onPress={() => setStockOnly(false)} />
      <Pill label="Tạm hết" active={stockOnly} onPress={() => setStockOnly(true)} />
    </View>
    {!!notice && <Notice text={notice} />}
    {!!error && !editor && <Notice text={error} error />}
    {categories.length === 0 && <Notice text="Không có món phù hợp trong chi nhánh này." />}
    {categories.map(category => (
      <View key={category.id} style={st.categoryBlock}>
        <View style={st.categoryHeading}>
          <View style={st.categoryTitle}>
            <Text style={st.categoryName}>{category.name}</Text>
            <Text style={st.sub}>{category.products.length} món</Text>
          </View>
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
                  <Text style={st.productName} numberOfLines={2}>{product.name}</Text>
                  <Text style={st.price}>{toPrice(product.priceVnd)}</Text>
                </View>
              </Pressable>
              <Pressable accessibilityRole="button"
                accessibilityLabel={(product.isAvailable ? "Tạm hết " : "Bật bán ") + product.name}
                accessibilityState={{ disabled: busy }}
                onPress={() => void flipProduct(product)}
                disabled={busy} style={[st.stock, product.isAvailable ? st.stockOn : st.stockOff]}>
                <Text style={[st.stockLabel, product.isAvailable ? st.stockTextOn : st.stockTextOff]}>
                  {product.isAvailable ? "Đang bán" : "Hết hàng"}
                </Text>
              </Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel={"Sửa món " + product.name}
                style={st.miniEdit} onPress={() => open("product", product.id, undefined, product)}>
                <Icon name="edit" size={19} color={c.red} />
              </Pressable>
            </View>
            {expanded && <Modal visible animationType="slide" transparent
              onRequestClose={() => setExpandedId(null)}>
              <View style={st.backdrop}>
                <View style={st.modal}>
                  <View style={st.modalHeading}>
                    <View style={st.modalName}>
                      <Text style={st.title} numberOfLines={2}>{product.name}</Text>
                      <Text style={st.sub}>Khẩu phần · Topping · Hình ảnh</Text>
                    </View>
                    <Pressable accessibilityRole="button" accessibilityLabel="Đóng chi tiết món"
                      style={st.close} onPress={() => setExpandedId(null)}>
                      <Icon name="close" size={19} color={c.secondary} />
                    </Pressable>
                  </View>
                  <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled"
                    showsVerticalScrollIndicator={false} contentContainerStyle={st.modalBody}>
                    <View style={st.details}>
                    {!!error && <Notice text={error} error />}
              <View style={st.detailHead}>
                <Text style={st.detailHeading}>Khẩu phần / size</Text>
                <Action label="＋ Size" secondary onPress={() => open("variant", undefined, product.id)} />
              </View>
              {product.variants.length === 0 && <Text style={st.emptyNote}>Chưa có size riêng.</Text>}
              {product.variants.map(variant => <View key={variant.id} style={st.optionRow}>
                <Text style={st.optionName}>{variant.name} · +{toPrice(variant.priceDeltaVnd)}</Text>
                <Pressable accessibilityRole="button" disabled={busy}
                  accessibilityLabel={(variant.isAvailable ? "Ẩn " : "Hiện ") + variant.name}
                  style={st.optionAction} onPress={() => void flipOption("variant", variant)}>
                  <Text style={st.miniEditText}>{variant.isAvailable ? "Ẩn" : "Hiện"}</Text>
                </Pressable>
                <Pressable accessibilityRole="button" style={st.optionAction}
                  accessibilityLabel={"Sửa size " + variant.name}
                  onPress={() => open("variant", variant.id, product.id, variant)}>
                  <Icon name="edit" size={17} color={c.red} />
                </Pressable>
              </View>)}
              <View style={st.detailHead}>
                <Text style={st.detailHeading}>Topping / tùy chọn</Text>
                <Action label="＋ Nhóm" secondary onPress={() => open("group", undefined, product.id)} />
              </View>
              {product.modifierGroups.length === 0 && <Text style={st.emptyNote}>Chưa có nhóm tùy chọn.</Text>}
              {product.modifierGroups.map(group => <View key={group.id} style={st.group}>
                <View style={st.detailHead}>
                  <Text style={st.groupName}>{group.name} ({group.minSelect}–{group.maxSelect})</Text>
                  <Action label="Sửa nhóm" secondary onPress={() =>
                    open("group", group.id, product.id, group)} />
                  <Action label="＋ Chọn" secondary onPress={() =>
                    open("option", undefined, group.id)} />
                </View>
                {group.options.map(option => <View key={option.id} style={st.optionRow}>
                  <Text style={st.optionName}>{option.name} · +{toPrice(option.priceDeltaVnd)}</Text>
                  <Pressable accessibilityRole="button" disabled={busy}
                    accessibilityLabel={(option.isAvailable ? "Ẩn " : "Hiện ") + option.name}
                    style={st.optionAction} onPress={() => void flipOption("option", option)}>
                    <Text style={st.miniEditText}>{option.isAvailable ? "Ẩn" : "Hiện"}</Text>
                  </Pressable>
                  <Pressable accessibilityRole="button"
                    accessibilityLabel={"Sửa tùy chọn " + option.name}
                    style={st.optionAction} onPress={() => open("option", option.id, group.id, option)}>
                    <Icon name="edit" size={17} color={c.red} />
                  </Pressable>
                </View>)}
              </View>)}
              {Platform.OS === "web" && <Action label="Tải ảnh món lên R2" secondary
                disabled={busy} onPress={() => pickImage(product.id)} />}
              {!!product.imageKey && <Action label="Gỡ ảnh món" secondary
                disabled={busy} onPress={() => void mutate(
                  "/products/" + product.id + "/images", "DELETE")} />}
                    </View>
                  </ScrollView>
                </View>
              </View>
            </Modal>}
          </View>;
        })}
      </View>
    ))}
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
              <Text style={st.smallLabel}>Danh mục</Text>
              <View style={st.pills}>
                {catalog.categories.map(cat =>
                  <Pill key={cat.id} label={cat.name}
                    active={cat.id === editor.values.categoryId}
                    onPress={() => change("categoryId", cat.id)} />)}
              </View>
            </>}
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
            {["product", "variant", "option"].includes(editor.kind) &&
              <View style={st.toggleRow}>
                <Text style={st.smallLabel}>Tình trạng</Text>
                <Pill label={editor.values.isAvailable ? "Đang bán" : "Tạm hết"}
                  active={editor.values.isAvailable}
                  onPress={() => change("isAvailable", !editor.values.isAvailable)} />
              </View>}
            {!!error && <Notice text={error} error />}
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
  </View>;
}
const st = StyleSheet.create({
  container: { gap: 12, paddingHorizontal: 14, paddingTop: 14, paddingBottom: 30 },
  heading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  headingText: { flex: 1, gap: 3 }, title: { fontSize: font.title, fontWeight: "800", color: c.ink },
  sub: { color: c.secondary, fontSize: font.caption },
  pills: { flexDirection: "row", flexWrap: "wrap", gap: 7, paddingVertical: 2 },
  categoryBlock: { borderTopWidth: 1, borderTopColor: c.line, marginHorizontal: -14,
    backgroundColor: c.white },
  categoryHeading: { flexDirection: "row", alignItems: "center", paddingHorizontal: 14,
    paddingVertical: 9, gap: 7 },
  categoryTitle: { flex: 1, minWidth: 0, gap: 2 },
  categoryAction: { minHeight: 44, minWidth: 44, alignItems: "center", justifyContent: "center" },
  categoryName: { color: c.ink, fontWeight: "800", fontSize: font.section },
  productWrap: { borderTopWidth: 1, borderTopColor: c.line },
  productRow: { flexDirection: "row", alignItems: "center", gap: 5,
    paddingVertical: 9, paddingHorizontal: 12, minHeight: 65 },
  productMain: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 9 },
  thumbnail: { width: 44, height: 44, borderRadius: 7, backgroundColor: c.pale },
  thumbnailFallback: { width: 44, height: 44, borderRadius: 7, backgroundColor: c.pale,
    alignItems: "center", justifyContent: "center" },
  thumbnailText: { fontSize: font.caption, color: c.secondary },
  productCopy: { flex: 1, minWidth: 0, gap: 5 },
  productName: { color: c.ink, fontSize: font.body, fontWeight: "700" },
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
  modalBody: { padding: 15, gap: 12, paddingBottom: 35 },
  modalActions: { flexDirection: "row", flexWrap: "wrap", gap: 8, justifyContent: "flex-end" },
  smallLabel: { color: c.ink, fontSize: font.note, fontWeight: "700" },
  toggleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
});
