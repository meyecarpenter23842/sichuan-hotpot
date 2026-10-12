import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator, KeyboardAvoidingView, Linking, Platform, Pressable,
  ScrollView, StatusBar, StyleSheet, Text, TextInput, View, Image,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import * as Location from "expo-location";
import * as Google from "expo-auth-session/providers/google";
import * as WebBrowser from "expo-web-browser";
import {
  addCartLine, cartItemCount, setCartQuantity,
  type CartLine,
} from "../../packages/shared/src/cart";
import {
  apiRequest, safeProductImageUrl, type AuthTokens, type BranchMenu, type BranchSummary,
  type Principal, type Product, type ModifierGroup, type SavedAddress, type SavedAddresses,
} from "./src/api";
import { addressError, optionSelectionError, passwordError, phoneError, usernameError, vnd } from "./src/validation";

WebBrowser.maybeCompleteAuthSession();

type Screen = "home" | "menu" | "detail" | "cart" | "account" | "login" | "address";
type AuthMode = "login" | "register";
type AddressDraft = {
  label: string; phone: string; line1: string; latitude: string; longitude: string;
};
const CART_KEY = "hotpot.cart.v1";
const BRANCH_KEY = "hotpot.branch.v1";
const ADDRESS_KEY = "hotpot.address.draft.v1";
const REFRESH_KEY = "hotpot.auth.refresh.v1";
const brand = "#AD282A";
const apiMissingMessage = "Chưa kết nối máy chủ. Vui lòng kiểm tra cấu hình API và thử lại.";
const authWebClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || "";
const authAndroidClientId = process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID || "";
const loginHeroUrl = "https://pub-63ed7b1c33514906ab6e2d82f41bffce.r2.dev/system-image/login-hero.png";
const googleReady = Boolean(
  Platform.OS === "web" ? authWebClientId : authAndroidClientId,
);

function Button({ label, onPress, disabled = false, alternate = false }: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  alternate?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button" accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled} onPress={onPress}
      style={({ pressed }) => [
        styles.button, alternate && styles.buttonOutline,
        disabled && styles.buttonDisabled, pressed && !disabled && styles.pressed,
      ]}
    >
      <Text style={[styles.buttonText, alternate && styles.buttonOutlineText]}>{label}</Text>
    </Pressable>
  );
}

function Field({ label, value, onChangeText, placeholder, secureTextEntry = false, keyboardType = "default" }: {
  label: string; value: string; onChangeText: (text: string) => void;
  placeholder?: string; secureTextEntry?: boolean;
  keyboardType?: "default" | "phone-pad" | "decimal-pad";
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={styles.input} value={value} onChangeText={onChangeText}
        placeholder={placeholder} placeholderTextColor="#8F7770"
        secureTextEntry={secureTextEntry} keyboardType={keyboardType}
        autoCapitalize="none" autoCorrect={false}
        accessibilityLabel={label}
      />
    </View>
  );
}

function Notice({ message, error = false }: { message: string; error?: boolean }) {
  return (
    <View style={[styles.notice, error && styles.noticeError]} accessibilityRole="alert">
      <Text style={styles.noticeText}>{message}</Text>
    </View>
  );
}

function IconTile({ name }: { name: string }) {
  const tea = /trà|tea|sữa/i.test(name);
  return (
    <View style={[styles.iconTile, tea && styles.iconTileTea]}>
      <Text style={styles.iconGlyph}>{tea ? "🧋" : "🍲"}</Text>
    </View>
  );
}


function ProductArtwork({ product, large = false }: { product: Product; large?: boolean }) {
  const [broken, setBroken] = useState(false);
  const uri = safeProductImageUrl(product.imageKey);
  useEffect(() => setBroken(false), [uri]);
  if (!uri || broken) return <IconTile name={product.name} />;
  return <Image source={{ uri }} resizeMode="cover"
    style={large ? styles.productImageLarge : styles.productImage}
    accessibilityLabel={"Ảnh món " + product.name} onError={() => setBroken(true)} />;
}

function selectedModifierPrice(product: Product, ids: readonly string[]): number {
  return (product.modifierGroups ?? []).flatMap(group => group.options)
    .filter(option => ids.includes(option.id))
    .reduce((total, option) => total + option.priceDeltaVnd, 0);
}

function CustomerApp() {
  const [screen, setScreen] = useState<Screen>("home");
  const [branches, setBranches] = useState<BranchSummary[]>([]);
  const [branchId, setBranchId] = useState("");
  const [menu, setMenu] = useState<BranchMenu | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState("");
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(null);
  const [selectedQuantity, setSelectedQuantity] = useState(1);
  const [selectedModifierIds, setSelectedModifierIds] = useState<string[]>([]);
  const [detailError, setDetailError] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [cartLoaded, setCartLoaded] = useState(false);
  const [notice, setNotice] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [principal, setPrincipal] = useState<Principal | null>(null);
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [authError, setAuthError] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [loginHeroFailed, setLoginHeroFailed] = useState(false);
  const [loginReturnTo, setLoginReturnTo] = useState<"cart" | "account">("account");
  const [address, setAddress] = useState<AddressDraft>({
    label: "Nhà", phone: "", line1: "", latitude: "", longitude: "",
  });
  const [savedAddresses, setSavedAddresses] = useState<SavedAddress[]>([]);
  const [addressReturnTo, setAddressReturnTo] = useState<"cart" | "account">("cart");
  const [addressBusy, setAddressBusy] = useState(false);
  const [addressSaving, setAddressSaving] = useState(false);
  const [addressErrorText, setAddressErrorText] = useState("");

  const [googleRequest, googleResponse, promptGoogle] = Google.useIdTokenAuthRequest({
    webClientId: authWebClientId || "unconfigured.apps.googleusercontent.com",
    androidClientId: authAndroidClientId || "unconfigured.apps.googleusercontent.com",
  });

  const refreshCatalogue = useCallback(async (requestedBranch?: string) => {
    setCatalogLoading(true);
    setCatalogError("");
    try {
      let activeBranch = requestedBranch;
      if (!activeBranch) {
        const [list, savedId] = await Promise.all([
          apiRequest<BranchSummary[]>("/catalog/branches"),
          AsyncStorage.getItem(BRANCH_KEY).catch(() => null),
        ]);
        setBranches(list);
        activeBranch = list.find(branch => branch.id === savedId)?.id ?? list[0]?.id;
      }
      if (!activeBranch) {
        setMenu(null);
        setBranchId("");
        return;
      }
      const response = await apiRequest<BranchMenu>(
        "/catalog/branches/" + encodeURIComponent(activeBranch),
      );
      setBranchId(activeBranch);
      setMenu(response);
      // Preserve the live branch: cart product IDs are branch-scoped by catalogue.
      await AsyncStorage.setItem(BRANCH_KEY, activeBranch).catch(() => {
        setNotice("Không thể lưu chi nhánh. Vui lòng kiểm tra dung lượng thiết bị.");
      });
      setCategoryId(old => response.categories.some(cat => cat.id === old)
        ? old : (response.categories[0]?.id ?? ""));
    } catch (error) {
      setCatalogError(error instanceof Error ? error.message : apiMissingMessage);
      setMenu(null);
    } finally {
      setCatalogLoading(false);
    }
  }, []);

  useEffect(() => { void refreshCatalogue(); }, [refreshCatalogue]);

  useEffect(() => {
    let mounted = true;
    async function restoreDrafts() {
      try {
        const [savedCart, savedAddress] = await Promise.all([
          AsyncStorage.getItem(CART_KEY), AsyncStorage.getItem(ADDRESS_KEY),
        ]);
        if (!mounted) return;
        if (savedCart) {
          const parsed: unknown = JSON.parse(savedCart);
          if (Array.isArray(parsed)) {
            let clean: CartLine[] = [];
            for (const raw of parsed.slice(0, 100)) {
              if (!raw || typeof raw !== "object" || !("selection" in raw)
                  || !("quantity" in raw) || !("key" in raw)) continue;
              try {
                const line = raw as CartLine;
                const next = addCartLine(clean, line.selection, line.quantity);
                if (next.some(item => item.key === line.key)) clean = next;
              } catch { /* Ignore malformed or obsolete on-device lines. */ }
            }
            setCart(clean);
          }
        }
        if (savedAddress) {
          const draft: unknown = JSON.parse(savedAddress);
          if (draft && typeof draft === "object" && "line1" in draft) {
            const candidate = draft as Partial<AddressDraft>;
            setAddress({
              label: typeof candidate.label === "string" ? candidate.label : "Nhà",
              phone: typeof candidate.phone === "string" ? candidate.phone : "",
              line1: typeof candidate.line1 === "string" ? candidate.line1 : "",
              latitude: typeof candidate.latitude === "string" ? candidate.latitude : "",
              longitude: typeof candidate.longitude === "string" ? candidate.longitude : "",
            });
          }
        }
      } catch {
        if (mounted) setNotice("Không thể khôi phục giỏ hàng đã lưu trên thiết bị.");
      } finally {
        if (mounted) setCartLoaded(true);
      }
    }
    void restoreDrafts();
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (!cartLoaded) return;
    AsyncStorage.setItem(CART_KEY, JSON.stringify(cart)).catch(() => {
      setNotice("Không thể lưu giỏ hàng. Vui lòng kiểm tra dung lượng thiết bị.");
    });
  }, [cart, cartLoaded]);

  useEffect(() => {
    if (Platform.OS === "web") return;
    let mounted = true;
    async function restoreSession() {
      try {
        const refreshToken = await SecureStore.getItemAsync(REFRESH_KEY);
        if (!refreshToken) return;
        const tokens = await apiRequest<AuthTokens>("/auth/refresh", {
          method: "POST", body: { refreshToken },
        });
        await SecureStore.setItemAsync(REFRESH_KEY, tokens.refreshToken);
        const user = await apiRequest<Principal>("/auth/me", {
          accessToken: tokens.accessToken,
        });
        if (mounted) { setAccessToken(tokens.accessToken); setPrincipal(user); }
      } catch {
        await SecureStore.deleteItemAsync(REFRESH_KEY).catch(() => undefined);
      }
    }
    void restoreSession();
    return () => { mounted = false; };
  }, []);

  const saveLogin = useCallback(async (tokens: AuthTokens) => {
    const who = await apiRequest<Principal>("/auth/me", { accessToken: tokens.accessToken });
    if (who.role !== "CUSTOMER") throw new Error("Tài khoản này không thuộc ứng dụng khách hàng.");
    if (Platform.OS !== "web") await SecureStore.setItemAsync(REFRESH_KEY, tokens.refreshToken);
    setAccessToken(tokens.accessToken);
    setPrincipal(who);
    setAuthError("");
    setPassword("");
    setScreen(loginReturnTo);
    setNotice(loginReturnTo === "cart" ? "Đăng nhập thành công. Vui lòng kiểm tra địa chỉ giao hàng." : "Đăng nhập thành công.");
  }, [loginReturnTo]);

  useEffect(() => {
    if (!googleResponse) return;
    if (googleResponse.type === "error") { setAuthError("Không thể xác thực với Google. Vui lòng thử lại."); return; }
    if (googleResponse.type !== "success") return;
    const idToken = googleResponse.params?.id_token;
    if (!idToken) {
      setAuthError("Google chưa trả về mã định danh hợp lệ.");
      return;
    }
    let cancelled = false;
    setAuthLoading(true);
    apiRequest<AuthTokens>("/auth/google", { method: "POST", body: { idToken } })
      .then(tokens => cancelled ? undefined : saveLogin(tokens))
      .catch(error => {
        if (!cancelled) setAuthError(error instanceof Error ? error.message : "Đăng nhập Google thất bại.");
      })
      .finally(() => { if (!cancelled) setAuthLoading(false); });
    return () => { cancelled = true; };
  }, [googleResponse, saveLogin]);

  async function submitCredentials() {
    if (authLoading) return;
    const error = usernameError(username) || passwordError(password, authMode === "register");
    if (error) { setAuthError(error); return; }
    setAuthLoading(true);
    setAuthError("");
    try {
      const tokens = await apiRequest<AuthTokens>(
        authMode === "register" ? "/auth/register" : "/auth/login",
        { method: "POST", body: { username: username.trim(), password } },
      );
      await saveLogin(tokens);
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Không thể đăng nhập.");
    } finally {
      setAuthLoading(false);
    }
  }

  async function signOut() {
    const token = accessToken;
    setPrincipal(null);
    setAccessToken("");
    setSavedAddresses([]);
    setAddress({ label: "Nhà", phone: "", line1: "", latitude: "", longitude: "" });
    // Clear user-sensitive phone/GPS from local storage on logout.
    await AsyncStorage.removeItem(ADDRESS_KEY).catch(() => undefined);
    if (Platform.OS !== "web") await SecureStore.deleteItemAsync(REFRESH_KEY).catch(() => undefined);
    if (token) await apiRequest("/auth/logout", { method: "POST", accessToken: token }).catch(() => undefined);
    setNotice("Đã đăng xuất trên thiết bị.");
  }

  useEffect(() => {
    if (!accessToken) { setSavedAddresses([]); return; }
    let active = true;
    apiRequest<SavedAddresses>("/customer/addresses", { accessToken })
      .then(result => {
        if (!active) return;
        setSavedAddresses(result.addresses);
        setAddress(old => ({ ...old, phone: old.phone || result.phone || "" }));
      })
      .catch(() => { if (active) setNotice("Không thể tải địa chỉ đã lưu. Hãy thử lại."); });
    return () => { active = false; };
  }, [accessToken]);

  async function locateMe() {
    if (addressBusy) return;
    setAddressBusy(true);
    setAddressErrorText("");
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== "granted") {
        throw new Error("Bạn chưa cho phép truy cập vị trí. Có thể nhập tọa độ thủ công.");
      }
      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      setAddress(old => ({
        ...old, latitude: position.coords.latitude.toFixed(7),
        longitude: position.coords.longitude.toFixed(7),
      }));
      setNotice("Đã lấy GPS. Kiểm tra lại số nhà, tên đường và vị trí ghim trước khi đặt.");
    } catch (error) {
      setAddressErrorText(error instanceof Error ? error.message : "Không lấy được GPS.");
    } finally {
      setAddressBusy(false);
    }
  }

  async function saveAddress() {
    if (addressSaving) return;
    const error = phoneError(address.phone)
      || addressError(address.line1, address.latitude, address.longitude);
    if (error) { setAddressErrorText(error); return; }
    if (!address.label.trim() || address.label.trim().length > 100) {
      setAddressErrorText("Đặt tên gợi nhớ địa chỉ (tối đa 100 ký tự).");
      return;
    }
    setAddressSaving(true);
    setAddressErrorText("");
    try {
      if (principal && accessToken) {
        const created = await apiRequest<SavedAddress>("/customer/addresses", {
          method: "POST", accessToken,
          body: { label: address.label, line1: address.line1,
            phone: address.phone.replace(/[\s.-]/g, ""),
            latitude: address.latitude, longitude: address.longitude },
        });
        setSavedAddresses(old => [created, ...old]);
        setNotice("Đã lưu địa chỉ vào tài khoản.");
      } else {
        setNotice("Đã lưu bản nháp trên thiết bị. Đăng nhập để lưu nhiều địa chỉ.");
      }
      if (principal) {
        // Account-owned address is stored on backend, not plain-text device cache.
        await AsyncStorage.removeItem(ADDRESS_KEY).catch(() => undefined);
      } else {
        await AsyncStorage.setItem(ADDRESS_KEY, JSON.stringify(address));
      }
      setScreen(addressReturnTo);
    } catch (error) {
      setAddressErrorText(error instanceof Error ? error.message : "Không lưu được địa chỉ.");
    } finally { setAddressSaving(false); }
  }

  function selectSavedAddress(saved: SavedAddress) {
    setAddress(old => ({ ...old, label: saved.label, line1: saved.line1,
      latitude: saved.latitude, longitude: saved.longitude }));
    setAddressErrorText("");
    setNotice("Đã chọn địa chỉ " + saved.label + ". Phí giao sẽ được tính lại khi đặt hàng.");
    setScreen(addressReturnTo);
  }

  async function deleteSavedAddress(saved: SavedAddress) {
    if (!accessToken || addressSaving) return;
    setAddressSaving(true);
    try {
      await apiRequest("/customer/addresses/" + encodeURIComponent(saved.id), {
        method: "DELETE", accessToken,
      });
      setSavedAddresses(old => old.filter(x => x.id !== saved.id));
      setNotice("Đã xóa địa chỉ đã lưu.");
    } catch (error) {
      setAddressErrorText(error instanceof Error ? error.message : "Không xóa được địa chỉ.");
    } finally { setAddressSaving(false); }
  }

  function openProduct(product: Product) {
    setSelectedProduct(product);
    setSelectedVariantId(null);
    setSelectedQuantity(1);
    setSelectedModifierIds([]);
    setDetailError("");
    setNotice("");
    setScreen("detail");
  }

  function addSelectedProduct() {
    if (!selectedProduct || !selectedProduct.isAvailable) return;
    const selectionError = optionSelectionError(selectedProduct.modifierGroups ?? [], selectedModifierIds);
    if (selectionError) { setDetailError(selectionError); return; }
    setDetailError("");
    try {
      setCart(old => addCartLine(old, {
        productId: selectedProduct.id, variantId: selectedVariantId, modifierIds: selectedModifierIds,
      }, selectedQuantity));
      setScreen("cart");
      setNotice("Đã thêm món vào giỏ hàng.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Không thể thêm món.");
    }
  }

  const products = useMemo(() => menu?.categories.flatMap(cat => cat.products) ?? [], [menu]);
  const productsById = useMemo(
    () => new Map(products.map(product => [product.id, product])),
    [products],
  );
  const filteredCategories = useMemo(() => (
    menu?.categories.filter(cat => !categoryId || categoryId === cat.id)
      .map(cat => ({
        ...cat, products: cat.products.filter(product =>
          product.name.toLocaleLowerCase("vi").includes(search.toLocaleLowerCase("vi").trim())),
      })) ?? []
  ), [menu, categoryId, search]);
  const hasStoredAddress = !phoneError(address.phone)
    && !addressError(address.line1, address.latitude, address.longitude);
  const itemCount = cartItemCount(cart);

  function showProduct(product: Product) {
    return (
      <Pressable
        key={product.id} style={styles.productCard}
        accessibilityRole="button" accessibilityLabel={"Xem món " + product.name}
        onPress={() => openProduct(product)}
      >
        <ProductArtwork product={product} />
        <View style={styles.productInfo}>
          <Text style={styles.productName} numberOfLines={2}>{product.name}</Text>
          <Text style={styles.price}>{vnd(product.priceVnd)}</Text>
          <Text style={styles.availability}>{product.isAvailable ? "Xem món và tùy chọn" : "Tạm hết hàng"}</Text>
        </View>
        <Text style={styles.forward}>›</Text>
      </Pressable>
    );
  }

  function cataloguePanel() {
    if (catalogLoading) return <ActivityIndicator size="large" color={brand} style={styles.loader} />;
    if (catalogError) {
      return <View style={styles.section}><Notice message={catalogError} error /><Button label="Thử tải lại thực đơn" onPress={() => void refreshCatalogue()} /></View>;
    }
    if (!menu || menu.categories.length === 0) {
      return <View style={styles.section}>
        <Text style={styles.emptyTitle}>Thực đơn đang được cập nhật</Text>
        <Text style={styles.muted}>Hiện chưa có món công khai từ cửa hàng. Không hiển thị giá hay sản phẩm mẫu.</Text>
        <Button label="Làm mới" onPress={() => void refreshCatalogue()} alternate />
      </View>;
    }
    return (
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Danh mục yêu thích</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.pills}>
          <Pressable
            onPress={() => setCategoryId("")}
            style={[styles.pill, !categoryId && styles.pillActive]}
            accessibilityRole="button"
          ><Text style={[styles.pillText, !categoryId && styles.pillTextActive]}>Tất cả</Text></Pressable>
          {menu.categories.map(cat => (
            <Pressable
              key={cat.id} onPress={() => setCategoryId(cat.id)}
              accessibilityRole="button" style={[styles.pill, categoryId === cat.id && styles.pillActive]}
            ><Text style={[styles.pillText, categoryId === cat.id && styles.pillTextActive]}>{cat.name}</Text></Pressable>
          ))}
        </ScrollView>
        {filteredCategories.map(cat => (
          <View key={cat.id} style={styles.categoryBlock}>
            <Text style={styles.categoryTitle}>{cat.name}</Text>
            {cat.products.length === 0
              ? <Text style={styles.muted}>Chưa có món phù hợp.</Text>
              : cat.products.map(showProduct)}
          </View>
        ))}
      </View>
    );
  }

  function mainContent() {
    switch (screen) {
      case "home":
      case "menu":
        return (
          <>
            {screen === "home" && (
              <View style={styles.hero}>
                <Text style={styles.heroEyebrow}>SICHUAN HOTPOT & MILK TEA</Text>
                <Text style={styles.heroTitle}>Lẩu Tứ Xuyên{String.fromCharCode(10)}đậm vị, nóng hổi</Text>
                <Text style={styles.heroSubtitle}>Thưởng thức lẩu cay và trà sữa ngay tại nhà</Text>
                <Pressable
                  style={styles.heroAction} accessibilityRole="button"
                  onPress={() => setScreen("menu")}
                ><Text style={styles.heroActionText}>Khám phá thực đơn  →</Text></Pressable>
              </View>
            )}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Giao hàng từ</Text>
              {branches.length > 0 ? (
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  {branches.map(branch => (
                    <Pressable key={branch.id} onPress={() => void refreshCatalogue(branch.id)}
                      style={[styles.branchPill, branchId === branch.id && styles.branchActive]}
                      accessibilityRole="button" accessibilityState={{ selected: branchId === branch.id }}>
                      <Text style={styles.branchText}>{branch.name}</Text>
                    </Pressable>
                  ))}
                </ScrollView>
              ) : <Text style={styles.muted}>Chưa có chi nhánh đang bán.</Text>}
              <Field label="Tìm món ăn, trà sữa" value={search} onChangeText={setSearch}
                placeholder="Nhập tên món bạn muốn tìm..." />
            </View>
            {cataloguePanel()}
          </>
        );
      case "detail": {
        const item = selectedProduct;
        if (!item) return <Notice message="Không tìm thấy món. Vui lòng chọn lại." error />;
        const variant = item.variants.find(v => v.id === selectedVariantId);
        const total = item.priceVnd + (variant?.priceDeltaVnd ?? 0) + selectedModifierPrice(item, selectedModifierIds);
        return (
          <View style={styles.section}>
            <Button label="‹ Trở lại thực đơn" alternate onPress={() => setScreen("menu")} />
            <View style={styles.detailHero}><ProductArtwork product={item} large /></View>
            <Text style={styles.detailTitle}>{item.name}</Text>
            <Text style={styles.detailPrice}>{vnd(total)}</Text>
            <Text style={styles.muted}>Giá hiển thị để tham khảo. Máy chủ sẽ xác nhận lại giá khi đặt hàng.</Text>
            {item.variants.length > 0 && (
              <View style={styles.group}>
                <Text style={styles.sectionTitle}>Khẩu phần / kích cỡ</Text>
                <Pressable style={styles.option} accessibilityRole="radio"
                  accessibilityState={{ checked: selectedVariantId === null }}
                  onPress={() => setSelectedVariantId(null)}>
                  <Text style={styles.optionText}>{selectedVariantId === null ? "◉" : "◯"} Mặc định</Text>
                  <Text>{vnd(item.priceVnd)}</Text>
                </Pressable>
                {item.variants.filter(v => v.isAvailable).map(v => (
                  <Pressable key={v.id} style={styles.option} accessibilityRole="radio"
                    accessibilityState={{ checked: selectedVariantId === v.id }}
                    onPress={() => setSelectedVariantId(v.id)}>
                    <Text style={styles.optionText}>{selectedVariantId === v.id ? "◉" : "◯"} {v.name}</Text>
                    <Text>{vnd(item.priceVnd + v.priceDeltaVnd)}</Text>
                  </Pressable>
                ))}
              </View>
            )}
            {(item.modifierGroups ?? []).map((group: ModifierGroup) => (
              <View key={group.id} style={styles.group}>
                <Text style={styles.sectionTitle}>{group.name}</Text>
                <Text style={styles.muted}>{group.minSelect > 0 ? "Bắt buộc chọn tối thiểu " + group.minSelect : "Tùy chọn"} · Tối đa {group.maxSelect}</Text>
                {group.options.map(option => {
                  const selected = selectedModifierIds.includes(option.id);
                  return <Pressable key={option.id} style={[styles.option, !option.isAvailable && styles.optionUnavailable]}
                    disabled={!option.isAvailable}
                    accessibilityRole={group.maxSelect === 1 ? "radio" : "checkbox"}
                    accessibilityState={{ checked: selected, disabled: !option.isAvailable }}
                    onPress={() => {
                      setDetailError("");
                      setSelectedModifierIds(current => {
                        if (selected) return current.filter(id => id !== option.id);
                        const ids = new Set(group.options.map(o => o.id));
                        if (group.maxSelect === 1) return [...current.filter(id => !ids.has(id)), option.id];
                        if (current.filter(id => ids.has(id)).length >= group.maxSelect) {
                          setDetailError("Đã chọn tối đa " + group.maxSelect + " cho " + group.name);
                          return current;
                        }
                        return [...current, option.id];
                      });
                    }}>
                    <Text style={styles.optionText}>{selected ? "◉" : "◯"} {option.name}{option.isAvailable ? "" : " · Hết"}</Text>
                    <Text style={styles.optionPrice}>{option.priceDeltaVnd ? "+ " + vnd(option.priceDeltaVnd) : "0 ₫"}</Text>
                  </Pressable>;
                })}
              </View>
            ))}
            {!!detailError && <Notice message={detailError} error />}
            <View style={styles.quantityLine}>
              <Text style={styles.sectionTitle}>Số lượng</Text>
              <View style={styles.quantityStepper}>
                <Pressable style={styles.step} accessibilityRole="button" accessibilityLabel="Giảm số lượng"
                  onPress={() => setSelectedQuantity(q => Math.max(1, q - 1))}><Text style={styles.stepText}>−</Text></Pressable>
                <Text style={styles.qtyText}>{selectedQuantity}</Text>
                <Pressable style={styles.step} accessibilityRole="button" accessibilityLabel="Tăng số lượng"
                  onPress={() => setSelectedQuantity(q => Math.min(99, q + 1))}><Text style={styles.stepText}>+</Text></Pressable>
              </View>
            </View>
            <Button label={item.isAvailable ? "Thêm vào giỏ · " + vnd(total * selectedQuantity) : "Món đang tạm hết"}
              disabled={!item.isAvailable} onPress={addSelectedProduct} />
          </View>
        );
      }
      case "cart":
        return (
          <View style={styles.section}>
            <Text style={styles.pageTitle}>Giỏ hàng</Text>
            {cart.length === 0 ? (
              <View style={styles.empty}>
                <Text style={styles.emptyTitle}>Chưa có món nào</Text>
                <Text style={styles.muted}>Xem thực đơn và chọn món ngon cho bữa ăn nhé.</Text>
                <Button label="Xem thực đơn" onPress={() => setScreen("menu")} />
              </View>
            ) : (
              <>
                {cart.map(line => {
                  const product = productsById.get(line.selection.productId);
                  const variant = product?.variants.find(v => v.id === line.selection.variantId);
                  const groups = product?.modifierGroups ?? [];
                  const options = groups.flatMap(group => group.options)
                    .filter(option => line.selection.modifierIds.includes(option.id));
                  const unavailable = !product || !product.isAvailable
                    || (line.selection.variantId !== null && (!variant || !variant.isAvailable))
                    || optionSelectionError(groups, line.selection.modifierIds) !== null;
                  const price = product ? product.priceVnd + (variant?.priceDeltaVnd ?? 0)
                    + selectedModifierPrice(product, line.selection.modifierIds) : 0;
                  return (
                    <View key={line.key} style={styles.cartLine}>
                      <View style={styles.cartLineDetails}>
                        <Text style={styles.productName}>{product?.name ?? "Món không còn trong thực đơn"}</Text>
                        {variant && <Text style={styles.muted}>{variant.name}</Text>}
                        {options.length > 0 && <Text style={styles.muted}>{options.map(o => o.name).join(" · ")}</Text>}
                        <Text style={styles.price}>{product ? vnd(price * line.quantity) : "Cần chọn món khác"}</Text>
                        {unavailable && <Text style={styles.warning}>Món hoặc tùy chọn không còn bán</Text>}
                      </View>
                      <View style={styles.quantityStepper}>
                        <Pressable style={styles.step} accessibilityRole="button" accessibilityLabel="Giảm hoặc xóa món"
                          onPress={() => setCart(old => setCartQuantity(old, line.key, Math.max(0, line.quantity - 1)))}>
                          <Text style={styles.stepText}>−</Text>
                        </Pressable>
                        <Text style={styles.qtyText}>{line.quantity}</Text>
                        <Pressable style={styles.step} accessibilityRole="button" accessibilityLabel="Tăng số lượng"
                          onPress={() => {
                            try { setCart(old => setCartQuantity(old, line.key, Math.min(99, line.quantity + 1))); }
                            catch { setNotice("Số lượng tối đa là 99."); }
                          }}>
                          <Text style={styles.stepText}>+</Text>
                        </Pressable>
                      </View>
                    </View>
                  );
                })}
                <Text style={styles.sectionTitle}>Tạm tính (không phải báo giá đặt hàng)</Text>
                <Text style={styles.detailPrice}>{vnd(cart.reduce((sum, line) => {
                  const product = productsById.get(line.selection.productId);
                  if (!product) return sum;
                  const variant = product.variants.find(v => v.id === line.selection.variantId);
                  return sum + (product.priceVnd + (variant?.priceDeltaVnd ?? 0)
                     + selectedModifierPrice(product, line.selection.modifierIds)) * line.quantity;
                }, 0))}</Text>
                <Text style={styles.muted}>Chưa gồm phí giao theo km thực tế, giảm giá và kiểm tra tình trạng món.</Text>
                <View style={styles.group}>
                  <Text style={styles.sectionTitle}>Thông tin nhận hàng</Text>
                  <Text style={styles.muted}>{hasStoredAddress ? address.line1 : "Chưa có địa chỉ và vị trí GPS hợp lệ"}</Text>
                  <Button label={hasStoredAddress ? "Sửa địa chỉ giao hàng" : "Thêm địa chỉ giao hàng"}
                    alternate onPress={() => { setAddressReturnTo("cart"); setScreen("address"); }} />
                </View>
                {!principal && <Button label="Đăng nhập để tiếp tục" onPress={() => { setLoginReturnTo("cart"); setScreen("login"); }} />}
                <Notice message="Chưa mở đặt hàng: API báo phí tuyến đường và tạo đơn chống trùng sẽ hoàn thành trong P3. Ứng dụng không gửi đơn hoặc báo thanh toán thành công khi thiếu xác nhận từ máy chủ." />
                <Button label="Đặt hàng (chưa khả dụng)" disabled onPress={() => undefined} />
              </>
            )}
          </View>
        );
      case "account":
        return (
          <View style={styles.section}>
            <Text style={styles.pageTitle}>Tài khoản</Text>
            {principal ? (
              <>
                <Text style={styles.muted}>Đã đăng nhập · {principal.role}</Text>
                <Text style={styles.muted}>Mã tài khoản: {principal.id.slice(0, 8)}…</Text>
                <Button label="Địa chỉ giao hàng" alternate onPress={() => { setAddressReturnTo("account"); setScreen("address"); }} />
                <Button label="Đăng xuất" alternate onPress={() => void signOut()} />
              </>
            ) : (
              <>
                <Text style={styles.muted}>Xem thực đơn thoải mái. Đăng nhập khi cần mua hàng.</Text>
                <Button label="Đăng nhập / Tạo tài khoản" onPress={() => { setLoginReturnTo("account"); setScreen("login"); }} />
              </>
            )}
            <View style={styles.group}>
              <Text style={styles.sectionTitle}>Đơn hàng của tôi</Text>
              <Text style={styles.muted}>Lịch sử và theo dõi đơn sẽ khả dụng khi backend hỗ trợ tạo đơn thực tế.</Text>
            </View>
          </View>
        );
      case "login":
        return (
          <View style={styles.loginPage}>
            <View style={styles.loginHeroFrame}>
              {!loginHeroFailed ? (
                <Image
                  source={{ uri: loginHeroUrl }}
                  resizeMode="cover"
                  style={styles.loginHeroImage}
                  accessibilityLabel="Ảnh lẩu Tứ Xuyên dùng cho màn đăng nhập"
                  onError={() => setLoginHeroFailed(true)}
                />
              ) : (
                <View style={styles.loginHeroFallback}>
                  <Text style={styles.loginHeroFallbackIcon}>♨</Text>
                  <Text style={styles.loginHeroFallbackText}>SICHUAN HOTPOT</Text>
                </View>
              )}
              <View style={styles.loginHeroTint}>
                <Pressable
                  accessibilityRole="button" accessibilityLabel="Quay lại"
                  style={styles.loginBack}
                  onPress={() => setScreen(loginReturnTo)}
                ><Text style={styles.loginBackText}>‹  Trở lại</Text></Pressable>
                <View style={styles.loginHeroCopy}>
                  <Text style={styles.loginEyebrow}>SICHUAN HOTPOT & MILK TEA</Text>
                  <Text style={styles.loginHeadline}>Hương vị Tứ Xuyên,{"\n"}gắn kết yêu thương</Text>
                </View>
              </View>
            </View>
            <View style={styles.loginContent}>
              <Text style={styles.loginWelcome}>{authMode === "login" ? "Chào mừng trở lại!" : "Tạo tài khoản mới"}</Text>
              <Text style={styles.loginSupporting}>Đăng nhập để lưu giỏ hàng và theo dõi đơn của bạn.</Text>
              <View style={styles.segmentRow}>
                <Pressable style={[styles.segment, authMode === "login" && styles.segmentActive]}
                  accessibilityRole="button" accessibilityState={{ selected: authMode === "login" }}
                  disabled={authLoading}
                  onPress={() => { setAuthMode("login"); setAuthError(""); }}>
                  <Text style={styles.segmentText}>Đăng nhập</Text>
                </Pressable>
                <Pressable style={[styles.segment, authMode === "register" && styles.segmentActive]}
                  accessibilityRole="button" accessibilityState={{ selected: authMode === "register" }}
                  disabled={authLoading}
                  onPress={() => { setAuthMode("register"); setAuthError(""); }}>
                  <Text style={styles.segmentText}>Đăng ký</Text>
                </Pressable>
              </View>
              <Field label="Tên đăng nhập" value={username} onChangeText={setUsername} placeholder="Tên đăng nhập" />
              <Field label="Mật khẩu" value={password} onChangeText={setPassword}
                placeholder={authMode === "register" ? "Tối thiểu 12 ký tự" : "Nhập mật khẩu"}
                secureTextEntry={!showPassword} />
              <Pressable accessibilityRole="button" accessibilityLabel={showPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
                onPress={() => setShowPassword(old => !old)}
                style={styles.smallAction}>
                <Text style={styles.linkText}>{showPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"}</Text>
              </Pressable>
              {authMode === "register" && <Text style={styles.muted}>Tên đăng nhập 3–32 ký tự, mật khẩu tối thiểu 12 ký tự.</Text>}
              {authError ? <Notice message={authError} error /> : null}
              <Button label={authLoading ? "Đang xác thực..." : authMode === "login" ? "Đăng nhập" : "Tạo tài khoản"}
                disabled={authLoading} onPress={() => void submitCredentials()} />
              {authLoading && <ActivityIndicator accessibilityLabel="Đang xác thực" color={brand} />}
              <View style={styles.loginDivider}>
                <View style={styles.loginDividerLine} />
                <Text style={styles.loginDividerText}>hoặc</Text>
                <View style={styles.loginDividerLine} />
              </View>
              <Button label="Tiếp tục với Google" alternate disabled={!googleRequest || !googleReady || authLoading}
                onPress={() => { setAuthError(""); void promptGoogle().catch(() => setAuthError("Không mở được cửa sổ Google.")); }} />
              {!googleReady && <Text style={styles.muted}>Google chưa được cấu hình cho nền tảng này. Có thể đăng nhập bằng tài khoản.</Text>}
              <Text style={styles.loginFootnote}>Chưa có API khôi phục mật khẩu tự động. Liên hệ cửa hàng khi cần hỗ trợ tài khoản.</Text>
              <Pressable accessibilityRole="button" onPress={() => setScreen("menu")} style={styles.loginGuest}>
                <Text style={styles.loginGuestText}>Xem thực đơn mà không cần đăng nhập  →</Text>
              </Pressable>
            </View>
          </View>
        );
      case "address":
        return (
          <View style={styles.section}>
            <Button label={addressReturnTo === "cart" ? "‹ Trở về giỏ hàng" : "‹ Trở về tài khoản"}
              alternate onPress={() => setScreen(addressReturnTo)} />
            <Text style={styles.pageTitle}>Địa chỉ giao hàng</Text>
            <Text style={styles.muted}>Xác nhận số nhà, đường và vị trí ghim. Phí giao thực tế sẽ được máy chủ tính khi đặt hàng.</Text>
            {!!principal && savedAddresses.length > 0 && (
              <View style={styles.group}>
                <Text style={styles.sectionTitle}>Địa chỉ đã lưu ({savedAddresses.length}/10)</Text>
                {savedAddresses.map(saved => (
                  <View key={saved.id} style={styles.savedAddress}>
                    <View style={styles.cartLineDetails}>
                      <Text style={styles.productName}>{saved.label}</Text>
                      <Text style={styles.muted}>{saved.line1}</Text>
                    </View>
                    <Pressable accessibilityRole="button" accessibilityLabel={"Dùng địa chỉ " + saved.label}
                      style={styles.addressSmallButton} onPress={() => selectSavedAddress(saved)}>
                      <Text style={styles.linkText}>Chọn</Text>
                    </Pressable>
                    <Pressable accessibilityRole="button" accessibilityLabel={"Xóa địa chỉ " + saved.label}
                      style={styles.addressSmallButton} disabled={addressSaving}
                      onPress={() => void deleteSavedAddress(saved)}>
                      <Text style={styles.warning}>Xóa</Text>
                    </Pressable>
                  </View>
                ))}
              </View>
            )}
            <Text style={styles.sectionTitle}>{principal ? "Thêm địa chỉ mới" : "Lưu địa chỉ tạm"}</Text>
            <Field label="Tên gợi nhớ (Nhà, Công ty...)" value={address.label}
              onChangeText={text => setAddress(old => ({ ...old, label: text }))} placeholder="Nhà" />
            <Field label="Số điện thoại" value={address.phone}
              onChangeText={text => setAddress(old => ({ ...old, phone: text }))}
              keyboardType="phone-pad" placeholder="09..." />
            <Field label="Số nhà, đường, phường/xã" value={address.line1}
              onChangeText={text => setAddress(old => ({ ...old, line1: text }))}
              placeholder="Ví dụ: 25 Nguyễn Trãi, Phường ..." />
            <Button label={addressBusy ? "Đang lấy GPS..." : "Dùng vị trí GPS hiện tại"} alternate
              disabled={addressBusy} onPress={() => void locateMe()} />
            <Text style={styles.muted}>Nếu không cho phép GPS, nhập tọa độ từ ghim bản đồ đã kiểm tra.</Text>
            <Field label="Vĩ độ (latitude)" value={address.latitude}
              onChangeText={text => setAddress(old => ({ ...old, latitude: text }))}
              keyboardType="decimal-pad" placeholder="10.0000000" />
            <Field label="Kinh độ (longitude)" value={address.longitude}
              onChangeText={text => setAddress(old => ({ ...old, longitude: text }))}
              keyboardType="decimal-pad" placeholder="106.0000000" />
            {!!address.latitude && !!address.longitude && (
              <Button label="Kiểm tra ghim trên bản đồ" alternate onPress={() => {
                const lat = Number(address.latitude), lon = Number(address.longitude);
                if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
                  setAddressErrorText("Tọa độ không hợp lệ.");
                  return;
                }
                void Linking.openURL("https://www.openstreetmap.org/?mlat=" + lat + "&mlon=" + lon + "#map=17/" + lat + "/" + lon);
              }} />
            )}
            {!!addressErrorText && <Notice message={addressErrorText} error />}
            <Button label={addressSaving ? "Đang lưu địa chỉ..." : principal ? "Lưu địa chỉ vào tài khoản" : "Lưu bản nháp trên máy"}
              disabled={addressSaving} onPress={() => void saveAddress()} />
            {!principal && <Text style={styles.muted}>Đăng nhập để đồng bộ nhiều địa chỉ. Bản nháp chỉ lưu trên thiết bị.</Text>}
          </View>
        );
    }
  }

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.safeArea} edges={["top", "bottom"]}>
        <StatusBar barStyle="dark-content" backgroundColor="#FFF7EB" />
        <View style={styles.shell}>
          <View style={styles.header}>
            <View style={styles.logoBadge}><Text style={styles.logoGlyph}>♨</Text></View>
            <View style={styles.headerText}>
              <Text style={styles.brandName}>SICHUAN HOTPOT</Text>
              <Text style={styles.brandSub}>Lẩu Tứ Xuyên & Trà Sữa</Text>
            </View>
            <Pressable style={styles.headerCart} onPress={() => setScreen("cart")}
              accessibilityRole="button" accessibilityLabel={"Giỏ hàng, " + itemCount + " món"}>
              <Text style={styles.headerCartText}>Giỏ · {itemCount}</Text>
            </Pressable>
          </View>
          <KeyboardAvoidingView style={styles.body}
            behavior={Platform.OS === "ios" ? "padding" : undefined}>
            <ScrollView keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.scrollContent}
              showsVerticalScrollIndicator={false}>
              {notice ? <Notice message={notice} /> : null}
              {mainContent()}
            </ScrollView>
          </KeyboardAvoidingView>
          <View style={styles.bottomNavigation}>
            {([
              ["home", "Trang chủ", "⌂"],
              ["menu", "Thực đơn", "☷"],
              ["cart", "Giỏ hàng", "▣"],
              ["account", "Tài khoản", "♙"],
            ] as const).map(([target, label, glyph]) => (
              <Pressable key={target} style={styles.navItem}
                accessibilityRole="tab" accessibilityState={{ selected: screen === target }}
                accessibilityLabel={label} onPress={() => { setNotice(""); setScreen(target); }}>
                <Text style={[styles.navGlyph, screen === target && styles.navActive]}>{glyph}</Text>
                <Text style={[styles.navLabel, screen === target && styles.navActive]}>{label}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#FFF7EB" },
  shell: { flex: 1, width: "100%", maxWidth: 620, alignSelf: "center", backgroundColor: "#FFF9F1" },
  header: { paddingHorizontal: 18, paddingVertical: 14, flexDirection: "row", alignItems: "center", borderBottomWidth: 1, borderBottomColor: "#F3DFD0" },
  logoBadge: { width: 44, height: 44, borderRadius: 14, backgroundColor: brand, alignItems: "center", justifyContent: "center" },
  logoGlyph: { color: "#FFF7EB", fontSize: 26, fontWeight: "800" },
  headerText: { flex: 1, paddingHorizontal: 10 },
  brandName: { fontSize: 15, fontWeight: "900", color: brand, letterSpacing: 0.4 },
  brandSub: { fontSize: 12, color: "#75564A" },
  headerCart: { minWidth: 70, minHeight: 44, borderRadius: 13, backgroundColor: "#F8E5D8", justifyContent: "center", alignItems: "center" },
  headerCartText: { fontSize: 13, color: brand, fontWeight: "800" },
  body: { flex: 1 },
  scrollContent: { paddingBottom: 28 },
  loginPage: { backgroundColor: "#FFF8F0", paddingBottom: 24 },
  loginHeroFrame: { width: "100%", height: 268, backgroundColor: "#7C2326", overflow: "hidden" },
  loginHeroImage: { width: "100%", height: "100%" },
  loginHeroFallback: { width: "100%", height: "100%", backgroundColor: "#822524", alignItems: "center", justifyContent: "center" },
  loginHeroFallbackIcon: { color: "#F9D29C", fontSize: 64 },
  loginHeroFallbackText: { fontWeight: "900", color: "#FFF1D9", fontSize: 23, letterSpacing: 2 },
  loginHeroTint: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(34,12,10,0.32)", justifyContent: "space-between", paddingHorizontal: 22, paddingVertical: 16 },
  loginBack: { minHeight: 44, alignSelf: "flex-start", justifyContent: "center", paddingHorizontal: 10, borderRadius: 22, backgroundColor: "rgba(30,10,10,0.48)" },
  loginBackText: { color: "#FFF7ED", fontWeight: "700" },
  loginHeroCopy: { gap: 7, paddingBottom: 12 },
  loginEyebrow: { color: "#F6CE93", letterSpacing: 2, fontSize: 11, fontWeight: "900" },
  loginHeadline: { color: "#FFFDF8", fontSize: 26, fontWeight: "900", lineHeight: 34 },
  loginContent: { paddingHorizontal: 24, paddingTop: 25, gap: 11 },
  loginWelcome: { color: "#4C2520", fontSize: 26, lineHeight: 34, fontWeight: "900" },
  loginSupporting: { color: "#856B5A", fontSize: 13, lineHeight: 21, marginBottom: 7 },
  loginDivider: { flexDirection: "row", gap: 12, alignItems: "center", justifyContent: "center", marginVertical: 8 },
  loginDividerLine: { flex: 1, height: 1, backgroundColor: "#DFC9B9" },
  loginDividerText: { color: "#826758", fontSize: 12 },
  loginFootnote: { color: "#7D6458", fontSize: 12, lineHeight: 19 },
  loginGuest: { alignSelf: "center", minHeight: 44, paddingVertical: 12, justifyContent: "center" },
  loginGuestText: { color: brand, fontWeight: "700", textAlign: "center", fontSize: 13 },
  section: { paddingHorizontal: 18, paddingTop: 22, gap: 13 },
  hero: { backgroundColor: brand, borderRadius: 0, minHeight: 205, paddingHorizontal: 24, paddingVertical: 24, justifyContent: "center", gap: 7 },
  heroEyebrow: { color: "#FBE3BA", fontWeight: "800", fontSize: 11, letterSpacing: 1.3 },
  heroTitle: { color: "#FFF7EB", fontWeight: "900", fontSize: 30, lineHeight: 36 },
  heroSubtitle: { color: "#FBE5D8", fontSize: 13, lineHeight: 20 },
  heroAction: { marginTop: 8, backgroundColor: "#FFE9BB", minHeight: 44, alignSelf: "flex-start", borderRadius: 12, paddingHorizontal: 17, justifyContent: "center" },
  heroActionText: { color: "#743019", fontWeight: "800", fontSize: 13 },
  pageTitle: { fontSize: 27, fontWeight: "900", color: "#3E2620", marginTop: 4 },
  sectionTitle: { color: "#462923", fontSize: 18, fontWeight: "800" },
  categoryTitle: { color: "#462923", fontSize: 17, fontWeight: "800", marginBottom: 7 },
  categoryBlock: { gap: 8, paddingTop: 8 },
  pills: { flexGrow: 0 },
  pill: { paddingHorizontal: 16, minHeight: 44, borderRadius: 24, backgroundColor: "#F7E7DA", justifyContent: "center", marginRight: 8 },
  pillActive: { backgroundColor: brand },
  pillText: { color: "#704B3D", fontWeight: "700" },
  pillTextActive: { color: "white" },
  branchPill: { borderRadius: 12, borderWidth: 1, borderColor: "#DCC2B2", paddingHorizontal: 12, paddingVertical: 11, marginRight: 8, minHeight: 44 },
  branchActive: { borderColor: brand, backgroundColor: "#FAE6DC" },
  branchText: { color: "#56362C", fontSize: 13, fontWeight: "700" },
  productCard: { backgroundColor: "white", minHeight: 108, borderRadius: 16, padding: 10, flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: "#F1E3D6" },
  productImage: { height: 86, width: 86, borderRadius: 12, backgroundColor: "#F8ECE2" },
  productImageLarge: { width: "100%", height: "100%", borderRadius: 16, backgroundColor: "#F8ECE2" },
  iconTile: { backgroundColor: "#FCE4D8", height: 86, width: 86, borderRadius: 12, justifyContent: "center", alignItems: "center" },
  iconTileTea: { backgroundColor: "#F5E2C7" },
  iconGlyph: { fontSize: 43 },
  productInfo: { flex: 1, paddingHorizontal: 12, gap: 4 },
  productName: { color: "#3F2820", fontSize: 15, fontWeight: "800", lineHeight: 21 },
  price: { color: brand, fontSize: 16, fontWeight: "900" },
  availability: { color: "#866959", fontSize: 12 },
  forward: { color: brand, fontSize: 31 },
  detailHero: { height: 165, backgroundColor: "#FCE9DA", borderRadius: 16, justifyContent: "center", alignItems: "center" },
  detailTitle: { fontSize: 27, fontWeight: "900", color: "#3E2620" },
  detailPrice: { color: brand, fontSize: 24, fontWeight: "900" },
  group: { marginTop: 8, gap: 12, paddingVertical: 16, borderTopWidth: 1, borderTopColor: "#EBD9CA" },
  option: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 12, minHeight: 48, borderBottomWidth: 1, borderBottomColor: "#F1E2D8" },
  optionUnavailable: { opacity: 0.45 },
  optionPrice: { color: "#A7382A", fontWeight: "700", fontSize: 13 },
  savedAddress: { flexDirection: "row", alignItems: "center", backgroundColor: "#FFF", borderRadius: 12, borderWidth: 1, borderColor: "#EAD7C8", padding: 10, gap: 4 },
  addressSmallButton: { minHeight: 44, paddingHorizontal: 8, justifyContent: "center" },
  optionText: { color: "#482E25", fontSize: 15, fontWeight: "700" },
  quantityLine: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 13 },
  quantityStepper: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: "#E8CBB9", borderRadius: 12 },
  step: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  stepText: { fontSize: 21, color: brand, fontWeight: "800" },
  qtyText: { textAlign: "center", minWidth: 24, fontWeight: "800", color: "#4C3027" },
  cartLine: { backgroundColor: "white", borderRadius: 15, borderWidth: 1, borderColor: "#F2E1D5", padding: 14, flexDirection: "row", alignItems: "center", gap: 12 },
  cartLineDetails: { flex: 1, gap: 6 },
  empty: { gap: 14, alignItems: "stretch", paddingVertical: 30 },
  emptyTitle: { fontSize: 20, fontWeight: "800", color: "#492E26" },
  muted: { color: "#806556", fontSize: 13, lineHeight: 21 },
  warning: { color: brand, fontSize: 13, fontWeight: "700" },
  notice: { margin: 14, padding: 13, borderRadius: 12, backgroundColor: "#FAEBCB" },
  noticeError: { backgroundColor: "#FBE1DE" },
  noticeText: { color: "#623E2F", fontSize: 13, lineHeight: 19 },
  field: { gap: 7, paddingTop: 3 },
  fieldLabel: { color: "#5E4237", fontSize: 14, fontWeight: "800" },
  input: { backgroundColor: "white", borderWidth: 1, borderColor: "#E1C6B8", borderRadius: 12, minHeight: 48, paddingHorizontal: 14, fontSize: 15, color: "#392820" },
  button: { backgroundColor: brand, borderRadius: 14, minHeight: 50, justifyContent: "center", alignItems: "center", paddingHorizontal: 14, paddingVertical: 10, marginVertical: 2 },
  buttonText: { color: "white", fontSize: 15, textAlign: "center", fontWeight: "800" },
  buttonOutline: { backgroundColor: "transparent", borderWidth: 1, borderColor: brand },
  buttonOutlineText: { color: brand },
  buttonDisabled: { opacity: 0.45 },
  pressed: { opacity: 0.8 },
  segmentRow: { flexDirection: "row", backgroundColor: "#F1DFD1", borderRadius: 14, padding: 4 },
  segment: { flex: 1, alignItems: "center", justifyContent: "center", minHeight: 44, borderRadius: 11 },
  segmentActive: { backgroundColor: "white" },
  segmentText: { color: brand, fontSize: 14, fontWeight: "800" },
  smallAction: { alignSelf: "flex-end", paddingVertical: 9, minHeight: 44, justifyContent: "center" },
  linkText: { color: brand, fontSize: 13, fontWeight: "700" },
  orText: { textAlign: "center", paddingVertical: 8 },
  bottomNavigation: { borderTopWidth: 1, borderTopColor: "#EDD9CD", backgroundColor: "white", flexDirection: "row", justifyContent: "space-around", minHeight: 65 },
  navItem: { flex: 1, minHeight: 64, alignItems: "center", justifyContent: "center", gap: 2 },
  navGlyph: { fontSize: 24, color: "#9C8A82" },
  navLabel: { color: "#9C8A82", fontSize: 11, fontWeight: "800" },
  navActive: { color: brand },
  loader: { marginTop: 30 },
});

export default CustomerApp;
