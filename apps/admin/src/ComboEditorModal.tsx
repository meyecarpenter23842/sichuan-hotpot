import React, { useMemo, useState } from "react";
import {
  Image, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet,
  Text, View,
} from "react-native";
import {
  imageUrl, request, type AdminCatalog, type CatalogGroup, type CatalogOption,
  type CatalogProduct,
} from "./api";
import { Action, Field, Notice } from "./ui";
import { c, font } from "./theme";
import { Icon } from "./Icon";

type FixedDraft = {
  key: string; productId: string; variantId: string | null; quantity: number;
};
type OptionDraft = {
  key: string; sourceType: "PRODUCT" | "TOPPING";
  productId: string | null; modifierOptionId: string | null;
  variantId: string | null; quantity: number; priceDelta: string;
};
type GroupDraft = {
  key: string; name: string; minSelect: string; maxSelect: string; options: OptionDraft[];
};
type PickerTarget = { kind: "fixed" } | { kind: "option"; groupIndex: number };
type LibraryTopping = { option: CatalogOption; group: CatalogGroup };

const draftKey = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
function integer(value: string, max: number): number {
  if (!/^\d+$/.test(value.trim())) throw Error("Vui lòng nhập số nguyên không âm.");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > max) throw Error("Giá trị vượt giới hạn.");
  return parsed;
}
function VariantChoices({ item, value, onChange }: {
  item: CatalogProduct; value: string | null; onChange: (variantId: string | null) => void;
}) {
  if (item.variants.length === 0) return null;
  return <View style={st.variantBlock}>
    <Text style={st.variantLabel}>Size / khẩu phần</Text>
    <View style={st.variantWrap}>
      <Pressable accessibilityRole="button" accessibilityLabel="Chọn size mặc định"
        style={[st.variantChip, value === null && st.variantChipActive]}
        onPress={() => onChange(null)}>
        <Text style={[st.variantChipText, value === null && st.variantChipTextActive]}>Mặc định</Text>
      </Pressable>
      {item.variants.map(variant =>
        <Pressable key={variant.id} accessibilityRole="button"
          accessibilityLabel={"Chọn size " + variant.name}
          accessibilityState={{ selected: value === variant.id, disabled: !variant.isAvailable }}
          disabled={!variant.isAvailable}
          style={[st.variantChip, value === variant.id && st.variantChipActive,
            !variant.isAvailable && st.variantChipDisabled]}
          onPress={() => onChange(variant.id)}>
          <Text style={[st.variantChipText, value === variant.id && st.variantChipTextActive]}>
            {variant.name}{variant.isAvailable ? "" : " · hết"}
          </Text>
        </Pressable>)}
    </View>
  </View>;
}
function SmallPhoto({ imageKey, label }: { imageKey?: string | null; label: string }) {
  const uri = imageUrl(imageKey ?? null);
  return uri
    ? <Image source={{ uri }} accessibilityLabel={label} style={st.smallPhoto} />
    : <View style={st.smallPhotoPlaceholder}><Text style={st.photoPlaceholderText}>Ảnh</Text></View>;
}

export function ComboEditorModal({
  catalog, product, token, root, onClose, reload, onFeedback,
  onPickImage, onRemoveImage, mediaBusy = false,
}: {
  catalog: AdminCatalog; product: CatalogProduct | null; token: string; root: string;
  onClose: () => void; reload: () => Promise<void>;
  onFeedback: (message: string, failed?: boolean) => void;
  onPickImage?: (productId: string) => void;
  onRemoveImage?: (productId: string) => void;
  mediaBusy?: boolean;
}) {
  const [fixed, setFixed] = useState<FixedDraft[]>(() => product?.comboFixedItems.map(item => ({
    key: item.id, productId: item.childProduct.id,
    variantId: item.variantId ?? item.variant?.id ?? null, quantity: item.quantity,
  })) ?? []);
  const [groups, setGroups] = useState<GroupDraft[]>(() => product?.comboGroups.map(group => ({
    key: group.id, name: group.name, minSelect: String(group.minSelect),
    maxSelect: String(group.maxSelect),
    options: [
      ...group.options.map(option => ({
        key: option.id, sourceType: "PRODUCT" as const, productId: option.childProduct.id,
        modifierOptionId: null, variantId: option.variantId ?? option.variant?.id ?? null,
        quantity: option.quantity, priceDelta: String(option.priceDeltaVnd),
        sortOrder: option.sortOrder,
      })),
      ...(group.modifierOptions ?? []).map(option => ({
        key: option.id, sourceType: "TOPPING" as const, productId: null,
        modifierOptionId: option.modifierOption.id, variantId: null,
        quantity: option.quantity, priceDelta: String(option.priceDeltaVnd),
        sortOrder: option.sortOrder,
      })),
    ].sort((a, b) => a.sortOrder - b.sortOrder).map(({ sortOrder: _sortOrder, ...option }) => option),
  })) ?? []);
  const [picker, setPicker] = useState<PickerTarget | null>(null);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const products = useMemo(() => catalog.categories.flatMap(category => category.products), [catalog]);
  const standardProducts = useMemo(() => products.filter(item =>
    item.kind === "STANDARD" && item.id !== product?.id), [products, product?.id]);
  const productById = useMemo(() => new Map(products.map(item => [item.id, item])), [products]);
  const libraryToppings = useMemo<LibraryTopping[]>(() =>
    (catalog.modifierLibrary ?? []).flatMap(group =>
      group.options.map(option => ({ option, group }))), [catalog.modifierLibrary]);
  const toppingById = useMemo(() => new Map(libraryToppings.map(item =>
    [item.option.id, item] as const)), [libraryToppings]);

  if (!product) return null;

  const selectedProductIds = new Set(
    picker?.kind === "fixed"
      ? fixed.map(item => item.productId)
      : picker?.kind === "option"
        ? groups[picker.groupIndex]?.options.flatMap(item => item.productId ? [item.productId] : []) ?? []
        : [],
  );
  const selectedToppingIds = new Set(
    picker?.kind === "option"
      ? groups[picker.groupIndex]?.options.flatMap(item =>
        item.modifierOptionId ? [item.modifierOptionId] : []) ?? []
      : [],
  );
  const term = search.trim().toLocaleLowerCase("vi");
  const productCandidates = standardProducts.filter(item => !selectedProductIds.has(item.id)
    && (!term || item.name.toLocaleLowerCase("vi").includes(term)));
  const toppingCandidates = picker?.kind === "option"
    ? libraryToppings.filter(item => !selectedToppingIds.has(item.option.id)
      && (!term || (item.option.name + " " + item.group.name).toLocaleLowerCase("vi").includes(term)))
    : [];

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
  function chooseProduct(item: CatalogProduct, variantId: string | null = null) {
    if (!picker) return;
    if (picker.kind === "fixed") {
      setFixed(rows => [...rows, {
        key: draftKey(), productId: item.id, variantId, quantity: 1,
      }]);
    } else {
      setGroups(rows => rows.map((group, index) => index !== picker.groupIndex ? group : ({
        ...group, options: [...group.options, {
          key: draftKey(), sourceType: "PRODUCT", productId: item.id,
          modifierOptionId: null, variantId, quantity: 1, priceDelta: "0",
        }],
      })));
    }
    setPicker(null); setSearch("");
  }
  function chooseTopping(item: LibraryTopping) {
    if (!picker || picker.kind !== "option") return;
    setGroups(rows => rows.map((group, index) => index !== picker.groupIndex ? group : ({
      ...group, options: [...group.options, {
        key: draftKey(), sourceType: "TOPPING", productId: null,
        modifierOptionId: item.option.id, variantId: null, quantity: 1,
        priceDelta: String(item.option.priceDeltaVnd),
      }],
    })));
    setPicker(null); setSearch("");
  }

  async function save() {
    if (!product || busy || mediaBusy) return;
    setError("");
    try {
      if (fixed.length === 0 && groups.length === 0) {
        throw Error("Combo phải có ít nhất một thành phần hoặc một nhóm lựa chọn.");
      }
      const payload = {
        fixedItems: fixed.map((row, index) => ({
          productId: row.productId, variantId: row.variantId,
          quantity: row.quantity, sortOrder: index,
        })),
        groups: groups.map((group, groupIndex) => {
          const name = group.name.trim();
          if (!name) throw Error("Mỗi nhóm lựa chọn cần có tên.");
          if (group.options.length === 0) {
            throw Error("Nhóm “" + name + "” chưa có món hoặc topping để chọn.");
          }
          const minSelect = integer(group.minSelect, 30);
          const maxSelect = integer(group.maxSelect, 30);
          if (maxSelect < 1 || minSelect > maxSelect) {
            throw Error("Nhóm “" + name + "” có số chọn tối thiểu/tối đa chưa hợp lệ.");
          }
          return {
            name, minSelect, maxSelect, sortOrder: groupIndex,
            options: group.options.map((option, optionIndex) => ({
              ...(option.sourceType === "PRODUCT"
                ? { productId: option.productId, variantId: option.variantId }
                : { modifierOptionId: option.modifierOptionId }),
              quantity: option.quantity,
              priceDeltaVnd: integer(option.priceDelta, 100000000), sortOrder: optionIndex,
            })),
          };
        }),
      };
      setBusy(true);
      await request(root + "/products/" + product.id + "/combo", token, "PUT", payload);
      await reload();
      onFeedback("Đã lưu combo gồm món thường và topping thư viện.");
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không lưu được combo.");
    } finally { setBusy(false); }
  }

  const locked = busy || mediaBusy;
  const comboImage = imageUrl(product.imageKey);

  return <>
    <Modal visible transparent animationType="slide"
      onRequestClose={() => { if (!locked) onClose(); }}>
      <KeyboardAvoidingView style={st.backdrop} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={st.modal}>
          <View style={st.heading}>
            <View style={st.headingCopy}>
              <Text style={st.title}>Thiết lập combo</Text>
              <Text style={st.sub} numberOfLines={2}>
                {product.name} · Giá gốc {product.priceVnd.toLocaleString("vi-VN")}đ
              </Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="Đóng thiết lập combo"
              style={st.close} disabled={locked} onPress={onClose}>
              <Icon name="close" size={19} color={c.secondary} />
            </Pressable>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={st.body}
            showsVerticalScrollIndicator={false}>
            <View style={st.imageCard}>
              {comboImage
                ? <Image source={{ uri: comboImage }} accessibilityLabel={"Ảnh combo " + product.name}
                    style={st.comboImage} />
                : <View style={st.comboImagePlaceholder}><Text style={st.photoPlaceholderText}>Ảnh combo</Text></View>}
              <View style={st.imageCopy}>
                <Text style={st.sectionTitle}>Ảnh combo</Text>
                <Text style={st.sub}>Dùng cùng ảnh sản phẩm trên trang chủ, thực đơn và chi tiết combo.</Text>
                <View style={st.imageActions}>
                  <Action label={product.imageKey ? "Thay ảnh" : "＋ Chọn ảnh"} secondary
                    disabled={locked || !onPickImage} onPress={() => onPickImage?.(product.id)} />
                  {!!product.imageKey && <Action label="Gỡ ảnh" secondary
                    disabled={locked || !onRemoveImage} onPress={() => onRemoveImage?.(product.id)} />}
                </View>
              </View>
            </View>
            <Text style={st.help}>
              Combo dùng món thường và topping từ thư viện chung. Giá combo là giá gốc cộng phụ thu từng lựa chọn; máy chủ kiểm tra lại món, size và topping khi đặt.
            </Text>
            {!!error && <Notice text={error} error />}

            <View style={st.sectionHead}>
              <View style={st.sectionCopy}>
                <Text style={st.sectionTitle}>Thành phần cố định</Text>
                <Text style={st.sub}>Luôn có trong mỗi combo</Text>
              </View>
              <Action label="＋ Thêm món" secondary disabled={locked}
                onPress={() => { setSearch(""); setPicker({ kind: "fixed" }); }} />
            </View>
            {fixed.length === 0 && <Text style={st.empty}>Chưa có thành phần cố định.</Text>}
            {fixed.map((row, index) => {
              const item = productById.get(row.productId);
              return <View key={row.key} style={st.row}>
                <View style={st.rowCopy}>
                  <Text style={st.rowName}>{item?.name ?? "Món đã bị thay đổi"}</Text>
                  <Text style={[st.sub, !item?.isAvailable && st.warning]}>
                    {item?.isAvailable ? "Đang bán" : "Đang tạm hết"}
                  </Text>
                  {item && <VariantChoices item={item} value={row.variantId}
                    onChange={variantId => setFixed(rows => rows.map((entry, current) =>
                      current === index ? { ...entry, variantId } : entry))} />}
                </View>
                <View style={st.stepper}>
                  <Pressable accessibilityRole="button" accessibilityLabel="Giảm số lượng"
                    style={st.step} disabled={row.quantity <= 1 || locked}
                    onPress={() => changeFixed(index, -1)}><Text style={st.stepText}>−</Text></Pressable>
                  <Text style={st.qty}>{row.quantity}</Text>
                  <Pressable accessibilityRole="button" accessibilityLabel="Tăng số lượng"
                    style={st.step} disabled={row.quantity >= 99 || locked}
                    onPress={() => changeFixed(index, 1)}><Text style={st.stepText}>＋</Text></Pressable>
                </View>
                <Pressable accessibilityRole="button" accessibilityLabel={"Xóa " + (item?.name ?? "món")}
                  style={st.remove} disabled={locked}
                  onPress={() => setFixed(rows => rows.filter((_, i) => i !== index))}>
                  <Text style={st.removeText}>Xóa</Text>
                </Pressable>
              </View>;
            })}

            <View style={st.sectionHead}>
              <View style={st.sectionCopy}>
                <Text style={st.sectionTitle}>Nhóm khách lựa chọn</Text>
                <Text style={st.sub}>Có thể trộn món thường và topping thư viện trong cùng nhóm</Text>
              </View>
              <Action label="＋ Nhóm" secondary disabled={locked} onPress={() =>
                setGroups(rows => [...rows, {
                  key: draftKey(), name: "", minSelect: "1", maxSelect: "1", options: [],
                }])} />
            </View>
            {groups.length === 0 && <Text style={st.empty}>Chưa có nhóm lựa chọn.</Text>}
            {groups.map((group, groupIndex) => <View key={group.key} style={st.group}>
              <View style={st.groupTitleRow}>
                <Text style={st.groupNumber}>Nhóm {groupIndex + 1}</Text>
                <Pressable accessibilityRole="button" accessibilityLabel="Xóa nhóm"
                  style={st.remove} disabled={locked}
                  onPress={() => setGroups(rows => rows.filter((_, i) => i !== groupIndex))}>
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
                const item = option.productId ? productById.get(option.productId) : undefined;
                const topping = option.modifierOptionId ? toppingById.get(option.modifierOptionId) : undefined;
                const label = item?.name ?? topping?.option.name ?? "Lựa chọn đã thay đổi";
                const available = item
                  ? item.isAvailable
                  : Boolean(topping?.option.isAvailable && topping.group.isAvailable);
                return <View key={option.key} style={st.option}>
                  <View style={st.optionIdentity}>
                    <SmallPhoto imageKey={item?.imageKey ?? topping?.option.imageKey}
                      label={"Ảnh " + label} />
                    <View style={st.rowCopy}>
                      <View style={st.nameLine}>
                        <Text style={st.rowName} numberOfLines={2}>{label}</Text>
                        <Text style={[st.sourceBadge,
                          option.sourceType === "TOPPING" && st.toppingBadge]}>
                          {option.sourceType === "TOPPING" ? "TOPPING" : "MÓN"}
                        </Text>
                      </View>
                      <Text style={[st.sub, !available && st.warning]}>
                        {option.sourceType === "TOPPING" && topping
                          ? topping.group.name + " · " : ""}
                        {available ? "Đang bán" : "Đang tạm hết"}
                      </Text>
                      {item && <VariantChoices item={item} value={option.variantId}
                        onChange={variantId => changeOption(groupIndex, optionIndex, { variantId })} />}
                    </View>
                  </View>
                  <View style={st.optionControls}>
                    <View style={st.stepper}>
                      <Pressable accessibilityRole="button" accessibilityLabel="Giảm phần trong lựa chọn"
                        style={st.step} disabled={option.quantity <= 1 || locked}
                        onPress={() => changeOption(groupIndex, optionIndex, {
                          quantity: Math.max(1, option.quantity - 1),
                        })}><Text style={st.stepText}>−</Text></Pressable>
                      <Text style={st.qty}>{option.quantity}</Text>
                      <Pressable accessibilityRole="button" accessibilityLabel="Tăng phần trong lựa chọn"
                        style={st.step} disabled={option.quantity >= 99 || locked}
                        onPress={() => changeOption(groupIndex, optionIndex, {
                          quantity: Math.min(99, option.quantity + 1),
                        })}><Text style={st.stepText}>＋</Text></Pressable>
                    </View>
                    <View style={st.delta}>
                      <Field label="Phụ thu" numeric value={option.priceDelta}
                        onChangeText={priceDelta => changeOption(groupIndex, optionIndex, { priceDelta })} />
                    </View>
                    <Pressable accessibilityRole="button" accessibilityLabel={"Xóa " + label}
                      style={st.remove} disabled={locked} onPress={() => setGroups(rows => rows.map((row, i) =>
                        i !== groupIndex ? row : {
                          ...row, options: row.options.filter((_, oi) => oi !== optionIndex),
                        }))}><Text style={st.removeText}>Xóa</Text></Pressable>
                  </View>
                </View>;
              })}
              <Action label="＋ Thêm món / topping" secondary disabled={locked} onPress={() => {
                setSearch(""); setPicker({ kind: "option", groupIndex });
              }} />
            </View>)}
          </ScrollView>
          <View style={st.actions}>
            <Action label="Hủy" secondary disabled={locked} onPress={onClose} />
            <Action label={locked ? "Đang xử lý…" : "Lưu cấu hình combo"}
              disabled={locked} onPress={() => void save()} />
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>

    <Modal visible={picker !== null} transparent animationType="fade"
      onRequestClose={() => { setPicker(null); setSearch(""); }}>
      <View style={st.backdrop}>
        <View style={st.picker}>
          <View style={st.heading}>
            <Text style={st.title}>{picker?.kind === "fixed" ? "Chọn món cố định" : "Thêm món / topping"}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Đóng danh sách lựa chọn"
              style={st.close} onPress={() => { setPicker(null); setSearch(""); }}>
              <Icon name="close" size={19} color={c.secondary} />
            </Pressable>
          </View>
          <View style={st.search}><Field label="Tìm" value={search}
            onChangeText={setSearch} placeholder="Tên món, topping, nhóm topping..." /></View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={st.pickerBody}>
            <Text style={st.pickerSection}>Món thường</Text>
            {productCandidates.map(item => <View key={item.id} style={st.pickCard}>
              <View style={st.pickRow}>
                <SmallPhoto imageKey={item.imageKey} label={"Ảnh " + item.name} />
                <View style={st.rowCopy}>
                  <Text style={st.rowName}>{item.name}</Text>
                  <Text style={st.sub}>
                    {item.priceVnd.toLocaleString("vi-VN")}đ · {item.isAvailable ? "Đang bán" : "Tạm hết"}
                  </Text>
                </View>
                {item.variants.length === 0 &&
                  <Pressable accessibilityRole="button" accessibilityLabel={"Chọn " + item.name}
                    style={st.pickAdd} onPress={() => chooseProduct(item, null)}>
                    <Text style={st.pickGlyph}>＋</Text>
                  </Pressable>}
              </View>
              {item.variants.length > 0 && <View style={st.pickVariants}>
                <Text style={st.variantLabel}>Chọn size / khẩu phần cho combo</Text>
                <View style={st.variantWrap}>
                  <Pressable accessibilityRole="button"
                    accessibilityLabel={"Chọn " + item.name + " size mặc định"}
                    style={st.variantChip} onPress={() => chooseProduct(item, null)}>
                    <Text style={st.variantChipText}>Mặc định</Text>
                  </Pressable>
                  {item.variants.map(variant =>
                    <Pressable key={variant.id} accessibilityRole="button"
                      accessibilityLabel={"Chọn " + item.name + " size " + variant.name}
                      disabled={!variant.isAvailable}
                      style={[st.variantChip, !variant.isAvailable && st.variantChipDisabled]}
                      onPress={() => chooseProduct(item, variant.id)}>
                      <Text style={st.variantChipText}>
                        {variant.name}{variant.isAvailable ? "" : " · hết"}
                      </Text>
                    </Pressable>)}
                </View>
              </View>}
            </View>)}
            {productCandidates.length === 0 &&
              <Text style={st.empty}>Không có món thường phù hợp.</Text>}

            {picker?.kind === "option" && <>
              <Text style={st.pickerSection}>Topping thư viện chung</Text>
              {toppingCandidates.map(item => <Pressable key={item.option.id}
                accessibilityRole="button"
                accessibilityLabel={"Chọn topping " + item.option.name + " từ " + item.group.name}
                style={st.toppingPick} onPress={() => chooseTopping(item)}>
                <SmallPhoto imageKey={item.option.imageKey} label={"Ảnh topping " + item.option.name} />
                <View style={st.rowCopy}>
                  <Text style={st.rowName}>{item.option.name}</Text>
                  <Text style={st.sub}>
                    {item.group.name} · {item.option.priceDeltaVnd.toLocaleString("vi-VN")}đ ·
                    {" "}{item.option.isAvailable && item.group.isAvailable ? "Đang bán" : "Tạm hết"}
                  </Text>
                </View>
                <Text style={st.pickGlyph}>＋</Text>
              </Pressable>)}
              {toppingCandidates.length === 0 &&
                <Text style={st.empty}>Không có topping thư viện phù hợp.</Text>}
            </>}
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
  picker: { maxHeight: "82%", backgroundColor: c.white, borderRadius: 18,
    marginHorizontal: 12, marginBottom: 20, overflow: "hidden" },
  heading: { minHeight: 64, flexDirection: "row", alignItems: "center", gap: 10,
    paddingHorizontal: 16, borderBottomWidth: 1, borderColor: c.line },
  headingCopy: { flex: 1, minWidth: 0 },
  title: { flex: 1, color: c.ink, fontSize: 18, fontWeight: "900" },
  close: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  body: { padding: 14, paddingBottom: 28, gap: 12 },
  help: { color: c.secondary, fontSize: font.note, lineHeight: 19,
    backgroundColor: "#FFF8EC", borderRadius: 10, padding: 10 },
  imageCard: { minHeight: 112, flexDirection: "row", gap: 10, alignItems: "center",
    borderBottomWidth: 1, borderBottomColor: c.line, paddingBottom: 10 },
  comboImage: { width: 96, height: 96, borderRadius: 13, backgroundColor: c.pale },
  comboImagePlaceholder: { width: 96, height: 96, borderRadius: 13,
    backgroundColor: c.pale, alignItems: "center", justifyContent: "center" },
  imageCopy: { flex: 1, minWidth: 0, gap: 5 },
  imageActions: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  photoPlaceholderText: { color: c.secondary, fontSize: 11, fontWeight: "700" },
  sectionHead: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 },
  sectionCopy: { flex: 1, minWidth: 0 },
  sectionTitle: { color: c.ink, fontSize: 15, fontWeight: "900" },
  sub: { color: c.secondary, fontSize: font.note, lineHeight: 17 },
  warning: { color: c.red, fontWeight: "700" },
  empty: { color: c.secondary, fontSize: font.note, paddingVertical: 8 },
  row: { minHeight: 64, flexDirection: "row", alignItems: "center", gap: 8,
    borderBottomWidth: 1, borderBottomColor: c.line, paddingVertical: 6 },
  rowCopy: { flex: 1, minWidth: 0, gap: 4 },
  rowName: { color: c.ink, fontSize: 13, fontWeight: "800" },
  nameLine: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 5 },
  sourceBadge: { color: c.secondary, backgroundColor: "#F1F2F4", fontSize: 9,
    fontWeight: "900", borderRadius: 6, paddingHorizontal: 5, paddingVertical: 2, overflow: "hidden" },
  toppingBadge: { color: c.red, backgroundColor: "#FDE8EA" },
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
  option: { gap: 7, borderBottomWidth: 1, borderBottomColor: c.line, paddingBottom: 9 },
  optionIdentity: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  optionControls: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 7 },
  delta: { minWidth: 145, flexGrow: 1, maxWidth: 190 },
  actions: { flexDirection: "row", gap: 8, padding: 12, borderTopWidth: 1,
    borderTopColor: c.line, backgroundColor: c.white },
  variantBlock: { gap: 5, paddingTop: 4 },
  variantLabel: { color: c.secondary, fontSize: 11, fontWeight: "700" },
  variantWrap: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  variantChip: { minHeight: 40, justifyContent: "center", borderWidth: 1,
    borderColor: c.line, borderRadius: 9, paddingHorizontal: 10, paddingVertical: 6,
    backgroundColor: c.white },
  variantChipActive: { borderColor: c.red, backgroundColor: "#FDE8EA" },
  variantChipDisabled: { opacity: 0.4 },
  variantChipText: { color: c.secondary, fontSize: 11, fontWeight: "700" },
  variantChipTextActive: { color: c.red, fontWeight: "900" },
  search: { paddingHorizontal: 14, paddingTop: 10 },
  pickerBody: { paddingHorizontal: 14, paddingBottom: 24 },
  pickerSection: { color: c.ink, fontSize: 13, fontWeight: "900", paddingTop: 12, paddingBottom: 5 },
  pickCard: { borderBottomWidth: 1, borderBottomColor: c.line, paddingVertical: 6 },
  pickRow: { minHeight: 52, flexDirection: "row", alignItems: "center", gap: 8 },
  pickAdd: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  pickVariants: { gap: 6, paddingLeft: 52, paddingBottom: 7 },
  toppingPick: { minHeight: 58, flexDirection: "row", alignItems: "center", gap: 8,
    borderBottomWidth: 1, borderBottomColor: c.line, paddingVertical: 6 },
  smallPhoto: { width: 44, height: 44, borderRadius: 9, backgroundColor: c.pale },
  smallPhotoPlaceholder: { width: 44, height: 44, borderRadius: 9,
    backgroundColor: c.pale, alignItems: "center", justifyContent: "center" },
  pickGlyph: { color: c.red, fontWeight: "900", fontSize: 22, paddingHorizontal: 8 },
});
