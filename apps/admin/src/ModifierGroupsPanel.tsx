import React, { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { type AdminCatalog, type CatalogGroup, type CatalogOption,
  type CatalogProduct, type CatalogVariant } from "./api";
import { Field } from "./ui";
import { Icon } from "./Icon";
import { StatusSwitch } from "./StatusSwitch";
import { c, font } from "./theme";

export function ModifierGroupsPanel({ catalog, busy, onCreateGroup, onEditGroup,
  onCreateOption, onEditOption, onEditVariant, onCreateVariant,
  onToggleOption, onToggleVariant }: {
  catalog: AdminCatalog;
  busy: boolean;
  onCreateGroup: (product: CatalogProduct) => void;
  onEditGroup: (product: CatalogProduct, group: CatalogGroup) => void;
  onCreateOption: (group: CatalogGroup) => void;
  onEditOption: (group: CatalogGroup, option: CatalogOption) => void;
  onCreateVariant: (product: CatalogProduct) => void;
  onEditVariant: (product: CatalogProduct, variant: CatalogVariant) => void;
  onToggleOption: (group: CatalogGroup, option: CatalogOption, next: boolean) => void;
  onToggleVariant: (variant: CatalogVariant, next: boolean) => void;
}) {
  const [expanded, setExpanded] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const products = useMemo(() => catalog.categories.flatMap(category => category.products)
    .filter(product => {
      const term = query.trim().toLocaleLowerCase("vi");
      return !term || product.name.toLocaleLowerCase("vi").includes(term)
        || product.modifierGroups.some(group =>
          group.name.toLocaleLowerCase("vi").includes(term)
          || group.options.some(option => option.name.toLocaleLowerCase("vi").includes(term)))
        || product.variants.some(variant => variant.name.toLocaleLowerCase("vi").includes(term));
    }), [catalog, query]);
  const toggle = (key: string) => setExpanded(old =>
    old.includes(key) ? old.filter(item => item !== key) : [...old, key]);
  const money = (value: number) => value.toLocaleString("vi-VN") + "đ";

  return <View style={s.container}>
    <Text style={s.scopeNote}>Các nhóm hiện được thiết lập riêng cho từng món.</Text>
    <Field label="Tìm món, nhóm hoặc topping" value={query}
      onChangeText={setQuery} placeholder="Tìm nhóm tùy chọn..." />
    {products.length === 0 && <Text style={s.empty}>Không có nhóm hoặc món phù hợp.</Text>}
    {products.map(product => <View key={product.id} style={s.productSection}>
      <View style={s.productHeading}>
        <View style={s.productCopy}>
          <Text style={s.productTitle} numberOfLines={2}>{product.name}</Text>
          <Text style={s.subtitle}>{product.modifierGroups.length} nhóm · {product.variants.length} size</Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel={"Thêm size cho " + product.name}
          style={s.compactAction} disabled={busy} onPress={() => onCreateVariant(product)}>
          <Icon name="plus" size={18} color={c.red} />
          <Text style={s.actionText}>Size</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={"Thêm nhóm cho " + product.name}
          style={s.compactAction} disabled={busy} onPress={() => onCreateGroup(product)}>
          <Icon name="plus" size={18} color={c.red} />
          <Text style={s.actionText}>Nhóm</Text>
        </Pressable>
      </View>
      {product.variants.length > 0 && (() => {
        const key = "variants:" + product.id;
        const open = expanded.includes(key);
        return <View style={s.section}>
          <Pressable accessibilityRole="button" accessibilityLabel={"Khẩu phần của " + product.name}
            accessibilityState={{ expanded: open }} style={s.sectionHead} onPress={() => toggle(key)}>
            <View style={s.sectionTitle}>
              <Text style={s.groupTitle}>Khẩu phần / size</Text>
              <Text style={s.subtitle}>{product.variants.length} lựa chọn</Text>
            </View>
            <View style={s.chevron}><Icon name="chevron" size={19} color={c.orange} /></View>
          </Pressable>
          {open && <View style={s.items}>
            {product.variants.map(variant => <View key={variant.id} style={s.optionRow}>
              <Pressable accessibilityRole="button" style={s.optionMain}
                accessibilityLabel={"Sửa size " + variant.name}
                onPress={() => onEditVariant(product, variant)} disabled={busy}>
                <Text style={s.optionName} numberOfLines={2}>{variant.name}</Text>
                <Text style={s.optionPrice}>+{money(variant.priceDeltaVnd)}</Text>
              </Pressable>
              <StatusSwitch value={variant.isAvailable} busy={busy}
                label={"Bán size " + variant.name + " của " + product.name}
                onValueChange={next => onToggleVariant(variant, next)} />
            </View>)}
            <Pressable accessibilityRole="button" style={s.addLine}
              disabled={busy} onPress={() => onCreateVariant(product)}>
              <Icon name="plus" size={17} color={c.red} />
              <Text style={s.addText}>Thêm size</Text>
            </Pressable>
          </View>}
        </View>;
      })()}
      {product.modifierGroups.length === 0 && <Text style={s.emptyInline}>
        Món chưa có nhóm tùy chọn. Chạm + Nhóm để tạo.
      </Text>}
      {product.modifierGroups.map(group => {
        const key = "group:" + group.id;
        const open = expanded.includes(key);
        return <View key={group.id} style={s.section}>
          <View style={s.sectionHeadRow}>
            <Pressable accessibilityRole="button" style={s.groupExpand}
              accessibilityLabel={"Mở nhóm " + group.name + " của " + product.name}
              accessibilityState={{ expanded: open }} onPress={() => toggle(key)}>
              <View style={s.sectionTitle}>
                <Text style={s.groupTitle} numberOfLines={2}>{group.name}</Text>
                <Text style={s.subtitle}>{group.options.length} tùy chọn ·
                  Chọn {group.minSelect}–{group.maxSelect}</Text>
              </View>
              <View style={s.chevron}><Icon name="chevron" size={19} color={c.orange} /></View>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel={"Sửa nhóm " + group.name}
              style={s.editGroup} disabled={busy} onPress={() => onEditGroup(product, group)}>
              <Icon name="edit" size={18} color={c.red} />
            </Pressable>
          </View>
          {open && <View style={s.items}>
            {group.options.length === 0 && <Text style={s.emptyInline}>
              Chưa có tùy chọn. Thêm để khách có thể lựa chọn.
            </Text>}
            {group.options.map(option => <View key={option.id} style={s.optionRow}>
              <Pressable accessibilityRole="button" style={s.optionMain}
                accessibilityLabel={"Sửa tùy chọn " + option.name}
                disabled={busy} onPress={() => onEditOption(group, option)}>
                <Text style={s.optionName} numberOfLines={2}>{option.name}</Text>
                <Text style={s.optionPrice}>{money(option.priceDeltaVnd)}</Text>
              </Pressable>
              <StatusSwitch value={option.isAvailable} busy={busy}
                label={"Bán " + option.name + " trong " + group.name}
                onValueChange={next => onToggleOption(group, option, next)} />
            </View>)}
            <Pressable accessibilityRole="button" style={s.addLine}
              disabled={busy} onPress={() => onCreateOption(group)}>
              <Icon name="plus" size={17} color={c.red} />
              <Text style={s.addText}>Thêm tùy chọn</Text>
            </Pressable>
          </View>}
        </View>;
      })}
    </View>)}
  </View>;
}

const s = StyleSheet.create({
  container: { gap: 7, paddingBottom: 16 },
  scopeNote: { color: c.secondary, fontSize: font.caption, lineHeight: 15 },
  productSection: { gap: 2, borderBottomWidth: 1, borderBottomColor: c.line,
    paddingBottom: 5 },
  productHeading: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 6 },
  productCopy: { flex: 1, minWidth: 0, gap: 2 },
  productTitle: { color: c.ink, fontSize: font.section, fontWeight: "800" },
  subtitle: { color: c.secondary, fontSize: font.caption },
  compactAction: { minHeight: 44, paddingHorizontal: 5, flexDirection: "row", gap: 2,
    alignItems: "center", borderRadius: 9, backgroundColor: c.soft },
  actionText: { color: c.red, fontSize: font.note, fontWeight: "700" },
  section: { backgroundColor: c.white, borderBottomWidth: 1, borderBottomColor: c.line },
  sectionHead: { minHeight: 48, flexDirection: "row", alignItems: "center",
    paddingHorizontal: 4, gap: 10 },
  sectionHeadRow: { flexDirection: "row", alignItems: "center" },
  groupExpand: { flex: 1, minHeight: 48, flexDirection: "row",
    alignItems: "center", gap: 8, paddingLeft: 4 },
  sectionTitle: { flex: 1, minWidth: 0, gap: 4 },
  groupTitle: { color: c.ink, fontSize: font.body, fontWeight: "700" },
  chevron: { width: 38, minHeight: 44, justifyContent: "center", alignItems: "center" },
  editGroup: { width: 44, height: 44, justifyContent: "center", alignItems: "center" },
  items: { paddingLeft: 10, paddingBottom: 3 },
  optionRow: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: 6,
    borderTopWidth: 1, borderTopColor: "#F1F2F3" },
  optionMain: { flex: 1, minHeight: 48, justifyContent: "center", gap: 3 },
  optionName: { color: c.ink, fontSize: font.body, fontWeight: "600" },
  optionPrice: { color: c.secondary, fontSize: font.note },
  empty: { textAlign: "center", color: c.secondary, fontSize: font.body,
    paddingVertical: 24 },
  emptyInline: { color: c.secondary, fontSize: font.note, paddingVertical: 8 },
  addLine: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 6 },
  addText: { color: c.red, fontSize: font.note, fontWeight: "700" },
});
