import React, { useMemo, useState } from "react";
import { Image, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { CartLine, Product } from "./menu-api";
import { money, productImage } from "./menu-api";
import { emptySelection, isSelectionValid, lineFromSelection, toggleMultiple, usableComboOptions } from "./menu-cart";

const ink = "#332322", accent = "#902C34", pale = "#F7F0EB", border = "#E7DDD7";
export function ProductSheet({ product, onClose, onAdd }: {
  product: Product; onClose: () => void; onAdd: (line: CartLine) => void;
}) {
  const [choice, setChoice] = useState(emptySelection);
  const [error, setError] = useState("");
  const image = productImage(product.imageKey);
  const message = useMemo(() => isSelectionValid(product, choice), [product, choice]);
  const choose = (bucket: "modifiers" | "combo", groupId: string, id: string, max: number) =>
    setChoice(prev => ({ ...prev, [bucket]: { ...prev[bucket],
      [groupId]: toggleMultiple(prev[bucket][groupId] ?? [], id, max) } }));
  const save = () => {
    if (message) { setError(message); return; }
    try {
      const line = lineFromSelection(product, choice, String(Date.now()) + Math.random().toString(36));
      onAdd(line);
    } catch (e) { setError(e instanceof Error ? e.message : "Món chưa hợp lệ."); }
  };
  return <Modal visible transparent animationType="slide" onRequestClose={onClose}>
    <SafeAreaView style={st.backdrop} edges={["top", "bottom"]}>
      <View style={st.sheet}>
        <View style={st.hero}>
          {image ? <Image source={{ uri: image }} style={st.photo} resizeMode="cover" /> :
            <View style={st.photoEmpty}><Text style={st.photoHint}>LẨU TỨ XUYÊN</Text></View>}
          <Pressable accessibilityRole="button" accessibilityLabel="Đóng chọn món"
            style={st.floatingClose} onPress={onClose}><Text style={st.closeText}>✕</Text></Pressable>
        </View>
        <View style={st.top}>
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={st.title} numberOfLines={2}>{product.name}</Text>
            <Text style={st.price}>{money(product.priceVnd)} <Text style={st.hint}>giá gốc</Text></Text>
          </View>
        </View>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={st.body}>
          {!!product.description && <Text style={st.description}>{product.description}</Text>}
          {product.variants.some(v => v.isAvailable) && <View style={st.section}>
            <Text style={st.sectionName}>Chọn size</Text>
            <View style={st.wrap}>
              <Chip text="Tiêu chuẩn" checked={!choice.variantId}
                onPress={() => setChoice(p => ({ ...p, variantId: null }))} />
              {product.variants.filter(v => v.isAvailable).map(v =>
                <Chip key={v.id} text={v.name + (v.priceDeltaVnd ? " +" + money(v.priceDeltaVnd) : "")}
                  checked={choice.variantId === v.id}
                  onPress={() => setChoice(p => ({ ...p, variantId: v.id }))}/>)}
            </View>
          </View>}
          {product.modifierGroups.map(g => <View key={g.id} style={st.section}>
            <View style={st.sectionTitle}>
              <Text style={st.sectionName}>{g.name}</Text>
              <Text style={st.hint}>{g.minSelect > 0 ? "Bắt buộc" : "Tùy chọn"} · {g.minSelect}–{g.maxSelect}</Text>
            </View>
            <View style={st.wrap}>
              {g.options.filter(o => o.isAvailable).map(o => <Chip key={o.id}
                text={o.name + (o.priceDeltaVnd ? " +" + money(o.priceDeltaVnd) : "")}
                checked={(choice.modifiers[g.id] ?? []).includes(o.id)}
                onPress={() => choose("modifiers", g.id, o.id, g.maxSelect)}/>)}
            </View>
          </View>)}
          {product.kind === "COMBO" && product.comboFixedItems.length > 0 && <View style={st.section}>
            <Text style={st.sectionName}>Có sẵn trong combo</Text>
            {product.comboFixedItems.map(x => <Text style={st.description} key={x.id}>
              {x.quantity} × {x.childProduct.name}{x.variant ? " • " + x.variant.name : ""}
            </Text>)}
          </View>}
          {product.comboGroups.map(g => <View key={g.id} style={st.section}>
            <View style={st.sectionTitle}><Text style={st.sectionName}>{g.name}</Text>
              <Text style={st.hint}>{g.minSelect > 0 ? "Bắt buộc" : "Tùy chọn"} · {g.minSelect}–{g.maxSelect}</Text></View>
            <View style={st.wrap}>{usableComboOptions(g).map(o => <Chip key={o.id}
              text={o.label + (o.priceDeltaVnd ? " +" + money(o.priceDeltaVnd) : "")}
              checked={(choice.combo[g.id] ?? []).includes(o.id)}
              onPress={() => choose("combo", g.id, o.id, g.maxSelect)}/>)}</View>
          </View>)}
          <View style={st.section}>
            <Text style={st.sectionName}>Số lượng</Text>
            <View style={st.quantity}>
              <Pressable accessibilityRole="button" accessibilityLabel="Giảm số lượng"
                style={st.step} onPress={() => setChoice(p => ({ ...p, quantity: Math.max(1, p.quantity - 1) }))}>
                <Text style={st.stepText}>−</Text></Pressable>
              <Text style={st.count}>{choice.quantity}</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="Tăng số lượng"
                style={st.step} onPress={() => setChoice(p => ({ ...p, quantity: Math.min(99, p.quantity + 1) }))}>
                <Text style={st.stepText}>+</Text></Pressable>
            </View>
          </View>
          <Text style={st.sectionName}>Ghi chú chế biến</Text>
          <TextInput value={choice.note} onChangeText={v => setChoice(p => ({ ...p, note: v }))}
            maxLength={500} multiline placeholder="Ví dụ: Không hành, ít cay…" placeholderTextColor="#8D817C"
            style={st.input} accessibilityLabel="Ghi chú món"/>
          {!!error && <Text accessibilityRole="alert" style={st.error}>{error}</Text>}
        </ScrollView>
        <View style={st.footer}>
          <Text style={st.hint}>Giá dự kiến · Quán xác nhận món và giá sau khi duyệt.</Text>
          <Pressable accessibilityRole="button" disabled={!!message}
            accessibilityState={{ disabled: !!message }} onPress={save}
            style={[st.add, !!message && st.disabled]}>
            <Text style={st.addText}>{message ? "Chọn đủ tùy chọn" : "Thêm " + choice.quantity + " vào giỏ"}</Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  </Modal>;
}
function Chip({ text, checked, onPress }: { text: string; checked: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="checkbox" accessibilityState={{ checked }}
    onPress={onPress} style={[st.chip, checked && st.chipOn]}>
    <Text style={[st.chipText, checked && st.chipTextOn]}>{checked ? "✓ " : ""}{text}</Text>
  </Pressable>;
}
const st = StyleSheet.create({
  backdrop: { flex: 1, padding: 12, backgroundColor: "rgba(30,18,15,0.58)", justifyContent: "center" },
  sheet: { backgroundColor: "#FFFFFF", width: "100%", maxWidth: 570, maxHeight: "96%",
    alignSelf: "center", borderRadius: 18, overflow: "hidden" },
  hero: { width: "100%", height: 190, backgroundColor: pale, position: "relative" },
  photo: { height: "100%", width: "100%" },
  photoEmpty: { height: "100%", backgroundColor: pale, justifyContent: "center", alignItems: "center" },
  floatingClose: { position: "absolute", top: 8, right: 8, minWidth: 44, minHeight: 44,
    backgroundColor: "rgba(255,255,255,0.95)", borderRadius: 22, alignItems: "center",
    justifyContent: "center" },
  top: { paddingHorizontal: 16, paddingVertical: 12, flexDirection: "row",
    alignItems: "center", borderBottomWidth: 1, borderColor: border, gap: 10 },
  title: { fontSize: 18, fontWeight: "900", color: ink },
  closeText: { color: ink, fontSize: 18 },
  body: { padding: 14, gap: 15 },
  photoHint: { fontSize: 15, fontWeight: "900", color: "#BD8C70" },
  price: { fontSize: 17, fontWeight: "900", color: accent },
  hint: { fontSize: 12, color: "#796A65" },
  description: { fontSize: 13, lineHeight: 20, color: "#645451" },
  section: { gap: 9, borderTopWidth: 1, borderColor: border, paddingTop: 12 },
  sectionTitle: { gap: 4 },
  sectionName: { fontSize: 15, fontWeight: "800", color: ink },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { minHeight: 44, paddingHorizontal: 12, paddingVertical: 11, borderRadius: 10,
    borderWidth: 1, borderColor: border, backgroundColor: "#FFFFFF", justifyContent: "center" },
  chipOn: { backgroundColor: "#FCEBEC", borderColor: accent },
  chipText: { color: ink, fontSize: 13, fontWeight: "600" },
  chipTextOn: { color: accent },
  quantity: { flexDirection: "row", alignItems: "center", gap: 15 },
  step: { width: 44, height: 44, backgroundColor: pale, borderRadius: 10,
    alignItems: "center", justifyContent: "center" },
  stepText: { fontSize: 25, color: accent, fontWeight: "700" },
  count: { minWidth: 26, fontSize: 17, textAlign: "center", fontWeight: "800", color: ink },
  input: { minHeight: 74, borderWidth: 1, borderColor: border, borderRadius: 10,
    padding: 12, color: ink, fontSize: 14, textAlignVertical: "top" },
  error: { color: accent, fontSize: 13 },
  footer: { padding: 12, paddingBottom: 16, gap: 8, borderTopWidth: 1, borderColor: border,
    backgroundColor: "#FFFFFF" },
  add: { minHeight: 50, backgroundColor: accent, borderRadius: 11,
    justifyContent: "center", alignItems: "center" },
  disabled: { opacity: 0.5 },
  addText: { color: "#FFFFFF", fontWeight: "800", fontSize: 14 },
});
