import React, { useMemo, useState } from "react";
import {
  KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet,
  Text, View,
} from "react-native";
import {
  request, type AdminCatalog, type CatalogProduct,
} from "./api";
import { Action, Field, Notice } from "./ui";
import { c, font } from "./theme";
import { Icon } from "./Icon";

type FixedDraft = { key: string; productId: string; quantity: number };
type OptionDraft = {
  key: string; productId: string; quantity: number; priceDelta: string;
};
type GroupDraft = {
  key: string; name: string; minSelect: string; maxSelect: string; options: OptionDraft[];
};
type PickerTarget = { kind: "fixed" } | { kind: "option"; groupIndex: number };

const key = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
function integer(value: string, max: number): number {
  if (!/^\d+$/.test(value.trim())) throw Error("Vui lòng nhập số nguyên không âm.");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > max) throw Error("Giá trị vượt giới hạn.");
  return parsed;
}

export function ComboEditorModal({ catalog, product, token, root, onClose, reload, onFeedback }: {
  catalog: AdminCatalog; product: CatalogProduct | null; token: string; root: string;
  onClose: () => void; reload: () => Promise<void>;
  onFeedback: (message: string, failed?: boolean) => void;
}) {
  const [fixed, setFixed] = useState<FixedDraft[]>(() => product?.comboFixedItems.map(item => ({
    key: item.id, productId: item.childProduct.id, quantity: item.quantity,
  })) ?? []);
  const [groups, setGroups] = useState<GroupDraft[]>(() => product?.comboGroups.map(group => ({
    key: group.id, name: group.name, minSelect: String(group.minSelect),
    maxSelect: String(group.maxSelect),
    options: group.options.map(option => ({
      key: option.id, productId: option.childProduct.id, quantity: option.quantity,
      priceDelta: String(option.priceDeltaVnd),
    })),
  })) ?? []);
  const [picker, setPicker] = useState<PickerTarget | null>(null);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const products = useMemo(() => catalog.categories.flatMap(category => category.products), [catalog]);
  const standardProducts = useMemo(() => products.filter(item =>
    item.kind === "STANDARD" && item.id !== product?.id), [products, product?.id]);
  const byId = useMemo(() => new Map(products.map(item => [item.id, item])), [products]);

  if (!product) return null;

  const pickedIds = picker?.kind === "fixed"
    ? new Set(fixed.map(item => item.productId))
    : picker?.kind === "option"
      ? new Set(groups[picker.groupIndex]?.options.map(item => item.productId) ?? [])
      : new Set<string>();
  const candidates = standardProducts.filter(item => !pickedIds.has(item.id)
    && item.name.toLocaleLowerCase("vi").includes(search.trim().toLocaleLowerCase("vi")));

  function changeFixed(index: number, delta: number) {
    setFixed(rows => rows.map((row, current) => current === index
      ? { ...row, quantity: Math.max(1, Math.min(99, row.quantity + delta)) } : row));
  }
  function changeOption(groupIndex: number, optionIndex: number, change: Partial<OptionDraft>) {
    setGroups(rows => rows.map((group, gi) => gi !== groupIndex ? group : {
      ...group,
      options: group.options.map((option, oi) => oi === optionIndex ? { ...option, ...change } : option),
    }));
  }
  function choose(item: CatalogProduct) {
    if (!picker) return;
    if (picker.kind === "fixed") {
      setFixed(rows => [...rows, { key: key(), productId: item.id, quantity: 1 }]);
    } else {
      setGroups(rows => rows.map((group, index) => index !== picker.groupIndex ? group : ({
        ...group, options: [...group.options, {
          key: key(), productId: item.id, quantity: 1, priceDelta: "0",
        }],
      })));
    }
    setPicker(null); setSearch("");
  }

  async function save() {
    if (busy) return;
    setError("");
    try {
      if (fixed.length === 0 && groups.length === 0) {
        throw Error("Combo phải có ít nhất một thành phần hoặc một nhóm lựa chọn.");
      }
      const payload = {
        fixedItems: fixed.map((row, index) => ({
          productId: row.productId, quantity: row.quantity, sortOrder: index,
        })),
        groups: groups.map((group, groupIndex) => {
          const name = group.name.trim();
          if (!name) throw Error("Mỗi nhóm lựa chọn cần có tên.");
          if (group.options.length === 0) throw Error("Nhóm “" + name + "” chưa có món để chọn.");
          const minSelect = integer(group.minSelect, 30);
          const maxSelect = integer(group.maxSelect, 30);
          if (maxSelect < 1 || minSelect > maxSelect) {
            throw Error("Nhóm “" + name + "” có số chọn tối thiểu/tối đa chưa hợp lệ.");
          }
          return {
            name, minSelect, maxSelect, sortOrder: groupIndex,
            options: group.options.map((option, optionIndex) => ({
              productId: option.productId, quantity: option.quantity,
              priceDeltaVnd: integer(option.priceDelta, 100000000), sortOrder: optionIndex,
            })),
          };
        }),
      };
      setBusy(true);
      await request(root + "/products/" + product.id + "/combo", token, "PUT", payload);
      await reload();
      onFeedback("Đã lưu cấu hình combo. Có thể bật bán khi các món thành phần đang sẵn sàng.");
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không lưu được combo.");
    } finally { setBusy(false); }
  }

  return <>
    <Modal visible transparent animationType="slide" onRequestClose={() => { if (!busy) onClose(); }}>
      <KeyboardAvoidingView style={st.backdrop} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={st.modal}>
          <View style={st.heading}>
            <View style={st.headingCopy}>
              <Text style={st.title}>Thiết lập combo</Text>
              <Text style={st.sub} numberOfLines={2}>{product.name} · Giá gốc {product.priceVnd.toLocaleString("vi-VN")}đ</Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="Đóng thiết lập combo"
              style={st.close} disabled={busy} onPress={onClose}>
              <Icon name="close" size={19} color={c.secondary} />
            </Pressable>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={st.body}
            showsVerticalScrollIndicator={false}>
            <Text style={st.help}>Combo chỉ dùng món thường trong cùng chi nhánh. Giá combo là giá gốc cộng phụ thu của lựa chọn; máy chủ sẽ kiểm tra lại khi đặt.</Text>
            {!!error && <Notice text={error} error />}

            <View style={st.sectionHead}>
              <View style={st.sectionCopy}>
                <Text style={st.sectionTitle}>Thành phần cố định</Text>
                <Text style={st.sub}>Luôn có trong mỗi combo</Text>
              </View>
              <Action label="＋ Thêm món" secondary disabled={busy}
                onPress={() => { setSearch(""); setPicker({ kind: "fixed" }); }} />
            </View>
            {fixed.length === 0 && <Text style={st.empty}>Chưa có thành phần cố định.</Text>}
            {fixed.map((row, index) => {
              const item = byId.get(row.productId);
              return <View key={row.key} style={st.row}>
                <View style={st.rowCopy}>
                  <Text style={st.rowName}>{item?.name ?? "Món đã bị thay đổi"}</Text>
                  <Text style={[st.sub, !item?.isAvailable && st.warning]}>
                    {item?.isAvailable ? "Đang bán" : "Đang tạm hết"}
                  </Text>
                </View>
                <View style={st.stepper}>
                  <Pressable accessibilityRole="button" accessibilityLabel="Giảm số lượng"
                    style={st.step} disabled={row.quantity <= 1}
                    onPress={() => changeFixed(index, -1)}><Text style={st.stepText}>−</Text></Pressable>
                  <Text style={st.qty}>{row.quantity}</Text>
                  <Pressable accessibilityRole="button" accessibilityLabel="Tăng số lượng"
                    style={st.step} disabled={row.quantity >= 99}
                    onPress={() => changeFixed(index, 1)}><Text style={st.stepText}>＋</Text></Pressable>
                </View>
                <Pressable accessibilityRole="button" accessibilityLabel={"Xóa " + (item?.name ?? "món")}
                  style={st.remove} onPress={() => setFixed(rows => rows.filter((_, i) => i !== index))}>
                  <Text style={st.removeText}>Xóa</Text>
                </Pressable>
              </View>;
            })}

            <View style={st.sectionHead}>
              <View style={st.sectionCopy}>
                <Text style={st.sectionTitle}>Nhóm khách lựa chọn</Text>
                <Text style={st.sub}>Ví dụ: chọn 2 topping, chọn 2 nước</Text>
              </View>
              <Action label="＋ Nhóm" secondary disabled={busy} onPress={() =>
                setGroups(rows => [...rows, {
                  key: key(), name: "", minSelect: "1", maxSelect: "1", options: [],
                }])} />
            </View>
            {groups.length === 0 && <Text style={st.empty}>Chưa có nhóm lựa chọn.</Text>}
            {groups.map((group, groupIndex) => <View key={group.key} style={st.group}>
              <View style={st.groupTitleRow}>
                <Text style={st.groupNumber}>Nhóm {groupIndex + 1}</Text>
                <Pressable accessibilityRole="button" accessibilityLabel="Xóa nhóm"
                  style={st.remove} onPress={() =>
                    setGroups(rows => rows.filter((_, i) => i !== groupIndex))}>
                  <Text style={st.removeText}>Xóa nhóm</Text>
                </Pressable>
              </View>
              <Field label="Tên nhóm" value={group.name}
                onChangeText={name => setGroups(rows => rows.map((row, i) =>
                  i === groupIndex ? { ...row, name } : row))}
                placeholder="Ví dụ: Chọn topping" />
              <View style={st.limitRow}>
                <View style={st.limitField}><Field label="Tối thiểu" numeric value={group.minSelect}
                  onChangeText={minSelect => setGroups(rows => rows.map((row, i) =>
                    i === groupIndex ? { ...row, minSelect } : row))} /></View>
                <View style={st.limitField}><Field label="Tối đa" numeric value={group.maxSelect}
                  onChangeText={maxSelect => setGroups(rows => rows.map((row, i) =>
                    i === groupIndex ? { ...row, maxSelect } : row))} /></View>
              </View>
              {group.options.map((option, optionIndex) => {
                const item = byId.get(option.productId);
                return <View key={option.key} style={st.option}>
                  <View style={st.rowCopy}>
                    <Text style={st.rowName}>{item?.name ?? "Món đã bị thay đổi"}</Text>
                    <Text style={[st.sub, !item?.isAvailable && st.warning]}>
                      {item?.isAvailable ? "Đang bán" : "Đang tạm hết"}
                    </Text>
                  </View>
                  <View style={st.stepper}>
                    <Pressable accessibilityRole="button" accessibilityLabel="Giảm phần trong lựa chọn"
                      style={st.step} disabled={option.quantity <= 1}
                      onPress={() => changeOption(groupIndex, optionIndex, {
                        quantity: Math.max(1, option.quantity - 1),
                      })}><Text style={st.stepText}>−</Text></Pressable>
                    <Text style={st.qty}>{option.quantity}</Text>
                    <Pressable accessibilityRole="button" accessibilityLabel="Tăng phần trong lựa chọn"
                      style={st.step} disabled={option.quantity >= 99}
                      onPress={() => changeOption(groupIndex, optionIndex, {
                        quantity: Math.min(99, option.quantity + 1),
                      })}><Text style={st.stepText}>＋</Text></Pressable>
                  </View>
                  <View style={st.delta}>
                    <Field label="Phụ thu" numeric value={option.priceDelta}
                      onChangeText={priceDelta => changeOption(groupIndex, optionIndex, { priceDelta })} />
                  </View>
                  <Pressable accessibilityRole="button" accessibilityLabel={"Xóa " + (item?.name ?? "món")}
                    style={st.remove} onPress={() => setGroups(rows => rows.map((row, i) =>
                      i !== groupIndex ? row : {
                        ...row, options: row.options.filter((_, oi) => oi !== optionIndex),
                      }))}><Text style={st.removeText}>Xóa</Text></Pressable>
                </View>;
              })}
              <Action label="＋ Thêm món vào nhóm" secondary onPress={() => {
                setSearch(""); setPicker({ kind: "option", groupIndex });
              }} />
            </View>)}
          </ScrollView>
          <View style={st.actions}>
            <Action label="Hủy" secondary disabled={busy} onPress={onClose} />
            <Action label={busy ? "Đang lưu…" : "Lưu cấu hình combo"} disabled={busy} onPress={() => void save()} />
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>

    <Modal visible={picker !== null} transparent animationType="fade"
      onRequestClose={() => { setPicker(null); setSearch(""); }}>
      <View style={st.backdrop}>
        <View style={st.picker}>
          <View style={st.heading}>
            <Text style={st.title}>Chọn món thường</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Đóng danh sách món"
              style={st.close} onPress={() => { setPicker(null); setSearch(""); }}>
              <Icon name="close" size={19} color={c.secondary} />
            </Pressable>
          </View>
          <View style={st.search}><Field label="Tìm món" value={search}
            onChangeText={setSearch} placeholder="Tên món, topping, nước..." /></View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={st.pickerBody}>
            {candidates.map(item => <Pressable key={item.id} accessibilityRole="button"
              accessibilityLabel={"Chọn " + item.name} style={st.pickRow} onPress={() => choose(item)}>
              <View style={st.rowCopy}>
                <Text style={st.rowName}>{item.name}</Text>
                <Text style={st.sub}>{item.priceVnd.toLocaleString("vi-VN")}đ · {item.isAvailable ? "Đang bán" : "Tạm hết"}</Text>
              </View>
              <Text style={st.pickGlyph}>＋</Text>
            </Pressable>)}
            {candidates.length === 0 && <Text style={st.empty}>Không có món thường phù hợp.</Text>}
          </ScrollView>
        </View>
      </View>
    </Modal>
  </>;
}

const st = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(12,18,28,.45)", justifyContent: "flex-end" },
  modal: { maxHeight: "94%", backgroundColor: c.white, borderTopLeftRadius: 20,
    borderTopRightRadius: 20, overflow: "hidden" },
  picker: { maxHeight: "78%", backgroundColor: c.white, borderRadius: 18,
    marginHorizontal: 12, marginBottom: 20, overflow: "hidden" },
  heading: { minHeight: 64, flexDirection: "row", alignItems: "center", gap: 10,
    paddingHorizontal: 16, borderBottomWidth: 1, borderColor: c.line },
  headingCopy: { flex: 1, minWidth: 0 },
  title: { flex: 1, color: c.ink, fontSize: 18, fontWeight: "900" },
  close: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  body: { padding: 14, paddingBottom: 28, gap: 12 },
  help: { color: c.secondary, fontSize: font.note, lineHeight: 19,
    backgroundColor: "#FFF8EC", borderRadius: 10, padding: 10 },
  sectionHead: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 },
  sectionCopy: { flex: 1, minWidth: 0 },
  sectionTitle: { color: c.ink, fontSize: 15, fontWeight: "900" },
  sub: { color: c.secondary, fontSize: font.note, lineHeight: 17 },
  warning: { color: c.red, fontWeight: "700" },
  empty: { color: c.secondary, fontSize: font.note, paddingVertical: 8 },
  row: { minHeight: 64, flexDirection: "row", alignItems: "center", gap: 8,
    borderBottomWidth: 1, borderBottomColor: c.line, paddingVertical: 6 },
  rowCopy: { flex: 1, minWidth: 0, gap: 2 },
  rowName: { color: c.ink, fontSize: 13, fontWeight: "800" },
  stepper: { flexDirection: "row", alignItems: "center" },
  step: { width: 44, height: 44, alignItems: "center", justifyContent: "center",
    borderRadius: 10, backgroundColor: "#F5F1ED" },
  stepText: { color: c.red, fontWeight: "900", fontSize: 18 },
  qty: { minWidth: 28, textAlign: "center", color: c.ink, fontWeight: "800" },
  remove: { minHeight: 44, justifyContent: "center", paddingHorizontal: 6 },
  removeText: { color: c.red, fontSize: 12, fontWeight: "800" },
  group: { gap: 9, borderTopWidth: 1, borderTopColor: c.line, paddingTop: 12 },
  groupTitleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  groupNumber: { color: c.ink, fontSize: 13, fontWeight: "900" },
  limitRow: { flexDirection: "row", gap: 8 },
  limitField: { flex: 1 },
  option: { gap: 6, borderBottomWidth: 1, borderBottomColor: c.line, paddingBottom: 9 },
  delta: { maxWidth: 180 },
  actions: { flexDirection: "row", gap: 8, padding: 12, borderTopWidth: 1,
    borderTopColor: c.line, backgroundColor: c.white },
  search: { paddingHorizontal: 14, paddingTop: 10 },
  pickerBody: { paddingHorizontal: 14, paddingBottom: 24 },
  pickRow: { minHeight: 58, flexDirection: "row", alignItems: "center", gap: 8,
    borderBottomWidth: 1, borderBottomColor: c.line },
  pickGlyph: { color: c.red, fontWeight: "900", fontSize: 22, paddingHorizontal: 10 },
});
