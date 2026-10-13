import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator, AppState, KeyboardAvoidingView, Linking, Modal, Platform, Pressable,
  ScrollView, StatusBar, StyleSheet, Text, TextInput, View, Image, useWindowDimensions,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import * as Location from "expo-location";
import {
  addCartLine, setCartQuantity,
  type CartLine,
} from "../../packages/shared/src/cart";
import {
  apiRequest, ApiRequestError, safeProductImageUrl, type AuthTokens, type BranchMenu, type BranchSummary,
  type Principal, type Product, type ModifierGroup, type SavedAddress, type SavedAddresses,
  type CheckoutReceipt, type CustomerOrderDetail,
} from "./src/api";
import { addressError, optionSelectionError, phoneError, vnd } from "./src/validation";
import { AuthScreen } from "./src/screens/AuthScreen";
import { CheckoutPanel } from "./src/screens/CheckoutPanel";
import { OrdersScreen } from "./src/screens/OrdersScreen";
import { PurchasedProductsScreen } from "./src/screens/PurchasedProductsScreen";
import { palette, typeScale } from "./src/theme";
import { HotpotNavIcon } from "./src/components/HotpotNavIcon";
import { HomeCategoryIcon, type HomeCategoryName } from "./src/components/HomeCategoryIcon";
import { AddressPinMap } from "./src/components/AddressPinMap";
import { actionDepth } from "./src/components/action-depth";
import { startBrowserSession, refreshBrowserSession, endBrowserSession } from "./src/auth/browser-session";

type Screen = "home" | "menu" | "detail" | "cart" | "account" | "orders" | "login" | "address" | "purchased";
type AddressDraft = {
  label: string; phone: string; line1: string; latitude: string; longitude: string;
};
const CART_KEY = "hotpot.cart.v1";
const BRANCH_KEY = "hotpot.branch.v1";
const ADDRESS_KEY = "hotpot.address.draft.v1";
const REFRESH_KEY = "hotpot.auth.refresh.v1";
async function writeRefresh(token: string): Promise<void> {
  if (Platform.OS === "web") await startBrowserSession(token);
  else await SecureStore.setItemAsync(REFRESH_KEY, token);
}
async function clearRefresh(): Promise<void> {
  if (Platform.OS === "web") {
    await endBrowserSession();
    await AsyncStorage.removeItem(REFRESH_KEY).catch(() => undefined);
  } else {
    await SecureStore.deleteItemAsync(REFRESH_KEY);
  }
}
async function refreshCredentials(): Promise<AuthTokens | null> {
  if (Platform.OS === "web") {
    const token = await refreshBrowserSession();
    return { ...token, refreshToken: "" };
  }
  const refreshToken = await SecureStore.getItemAsync(REFRESH_KEY);
  if (!refreshToken) return null;
  const tokens = await apiRequest<AuthTokens>("/auth/refresh", {
    method: "POST", body: { refreshToken },
  });
  await writeRefresh(tokens.refreshToken);
  return tokens;
}
const brand = palette.red;
const apiMissingMessage = "Chưa kết nối máy chủ. Vui lòng kiểm tra cấu hình API và thử lại.";

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
        styles.button, alternate ? actionDepth.secondary : actionDepth.primary,
        alternate && styles.buttonOutline, disabled && styles.buttonDisabled,
        pressed && !disabled && [styles.pressed, actionDepth.pressed],
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
        placeholder={placeholder} placeholderTextColor="#98A2B3"
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
  const type: HomeCategoryName = /trà|tea|sữa|drink/i.test(name) ? "milkTea"
    : /combo|set/i.test(name) ? "combo"
    : /topping|rau|nấm/i.test(name) ? "topping" : "hotpot";
  return (
    <View style={[styles.iconTile, type === "milkTea" && styles.iconTileTea]}>
      <HomeCategoryIcon name={type} size={52} />
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

// Use only the photography inside the approved mockup; do not display
// mockup discounts or prices, which are not production catalogue facts.
function HomeLifestylePhoto({ kind, width, height }: {
  kind: "hotpot" | "milkTea"; width: number; height: number;
}) {
  const x = kind === "hotpot" ? 315 : 690;
  const y = 1312;
  const cropWidth = kind === "hotpot" ? 165 : 180;
  const scale = width / cropWidth;
  return (
    <View style={{ width, height, overflow: "hidden" }}>
      <Image source={require("./assets/home-reference.png")} resizeMode="stretch"
        accessibilityLabel={kind === "hotpot" ? "Ảnh lẩu Tứ Xuyên" : "Ảnh trà sữa"}
        style={{ position: "absolute", width: 941 * scale, height: 1672 * scale,
          left: -x * scale, top: -y * scale }} />
    </View>
  );
}

function selectedModifierPrice(product: Product, ids: readonly string[]): number {
  return (product.modifierGroups ?? []).flatMap(group => group.options)
    .filter(option => ids.includes(option.id))
    .reduce((total, option) => total + option.priceDeltaVnd, 0);
}

function CustomerApp() {
  const { width: viewportWidth } = useWindowDimensions();
  // The approved static Home artwork has a 829x321 panel inside 01-home.png.
  // Match the panel aspect ratio at every viewport; all other UI remains interactive.
  const heroWidth = Math.min(viewportWidth, 620) - 24;
  const heroScale = heroWidth / 829;
  const [screen, setScreen] = useState<Screen>("login");
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
  const [authReady, setAuthReady] = useState(false);
  const [authRestoreError, setAuthRestoreError] = useState("");
  const [authRestoreAttempt, setAuthRestoreAttempt] = useState(0);
  const [accessExpiresAt, setAccessExpiresAt] = useState(0);
  const authEpoch = useRef(0);
  const renewing = useRef(false);
  const refreshFailures = useRef(0);
  const [retryAt, setRetryAt] = useState(0);
  const [loginReturnTo, setLoginReturnTo] = useState<"home" | "cart" | "account">("home");
  const [address, setAddress] = useState<AddressDraft>({
    label: "Nhà", phone: "", line1: "", latitude: "", longitude: "",
  });
  const [savedAddresses, setSavedAddresses] = useState<SavedAddress[]>([]);
  const [selectedAddressId, setSelectedAddressId] = useState<string | null>(null);
  const [focusOrderId, setFocusOrderId] = useState<string | null>(null);
  const [addressReturnTo, setAddressReturnTo] = useState<"cart" | "account">("cart");
  const [addressBusy, setAddressBusy] = useState(false);
  const [addressSaving, setAddressSaving] = useState(false);
  const [addressErrorText, setAddressErrorText] = useState("");
  const [addressModalOpen, setAddressModalOpen] = useState(false);
  const addressBeforeModal = useRef<AddressDraft | null>(null);

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
    let active = true;
    const epoch = authEpoch.current;
    async function restoreSession() {
      setAuthReady(false);
      if (Platform.OS === "web") await AsyncStorage.removeItem(REFRESH_KEY).catch(() => undefined);
      setAuthRestoreError("");
      try {
        const tokens = await refreshCredentials();
        if (!tokens) return;
        const who = await apiRequest<Principal>("/auth/me", {
          accessToken: tokens.accessToken,
        });
        if (who.role !== "CUSTOMER") throw new Error("Tài khoản không thuộc ứng dụng khách hàng.");
        if (active && epoch === authEpoch.current) {
          setAccessToken(tokens.accessToken);
          setPrincipal(who);
          setAccessExpiresAt(Date.now() + tokens.accessTokenExpiresInSeconds * 1000);
          setScreen("home");
        }
      } catch (error) {
        if (error instanceof ApiRequestError && error.status === 401) {
          // Missing browser cookie is the ordinary signed-out state.
          if (Platform.OS !== "web") await clearRefresh().catch(() => undefined);
        } else if (active) {
          setAuthRestoreError(error instanceof Error ? error.message : "Không thể khôi phục phiên.");
        }
      } finally {
        if (active && epoch === authEpoch.current) setAuthReady(true);
      }
    }
    void restoreSession();
    return () => { active = false; };
  }, [authRestoreAttempt]);

  const saveLogin = useCallback(async (tokens: AuthTokens) => {
    const who = await apiRequest<Principal>("/auth/me", { accessToken: tokens.accessToken });
    if (who.role !== "CUSTOMER") throw new Error("Tài khoản này không thuộc ứng dụng khách hàng.");
    await writeRefresh(tokens.refreshToken);
    authEpoch.current += 1;
    refreshFailures.current = 0;
    setRetryAt(0);
    setAuthRestoreError("");
    setAccessToken(tokens.accessToken);
    setPrincipal(who);
    setAccessExpiresAt(Date.now() + tokens.accessTokenExpiresInSeconds * 1000);
    setScreen(loginReturnTo);
    setNotice(loginReturnTo === "cart" ? "Đăng nhập thành công. Vui lòng kiểm tra địa chỉ giao hàng." : "Đăng nhập thành công.");
  }, [loginReturnTo]);

  const renewSession = useCallback(async () => {
    if (renewing.current) return;
    renewing.current = true;
    const epoch = authEpoch.current;
    try {
      const tokens = await refreshCredentials();
      if (!tokens || epoch !== authEpoch.current) return;
      refreshFailures.current = 0;
      setRetryAt(0);
      setAccessToken(tokens.accessToken);
      setAccessExpiresAt(Date.now() + tokens.accessTokenExpiresInSeconds * 1000);
    } catch (error) {
      if (epoch !== authEpoch.current) return;
      if (error instanceof ApiRequestError && error.status === 401) {
        await clearRefresh().catch(() => undefined);
        setAccessToken("");
        setPrincipal(null);
        setAccessExpiresAt(0);
        setScreen("login");
        setNotice("Phiên đăng nhập không còn hợp lệ. Vui lòng đăng nhập lại.");
      } else {
        // Retain the credential. Exponential retry prevents a 1-second refresh storm.
        const delay = Math.min(300_000, 15_000 * 2 ** Math.min(refreshFailures.current, 5));
        refreshFailures.current += 1;
        setRetryAt(Date.now() + delay);
        setNotice("Mạng gián đoạn. Ứng dụng sẽ thử kết nối lại.");
      }
    } finally {
      renewing.current = false;
    }
  }, []);

  useEffect(() => {
    if (!accessToken || !accessExpiresAt) return;
    const refresh = () => {
      if (Date.now() + 60_000 >= accessExpiresAt && Date.now() >= retryAt) {
        void renewSession();
      }
    };
    const scheduleAt = Math.max(retryAt, accessExpiresAt - 60_000);
    const timeout = setTimeout(() => { void renewSession(); },
      Math.max(1000, scheduleAt - Date.now()));
    const subscription = AppState.addEventListener("change", state => {
      if (state === "active") refresh();
    });
    if (Platform.OS === "web" && typeof document !== "undefined") {
      document.addEventListener("visibilitychange", refresh);
    }
    return () => {
      clearTimeout(timeout);
      subscription.remove();
      if (Platform.OS === "web" && typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", refresh);
      }
    };
  }, [accessToken, accessExpiresAt, retryAt, renewSession]);

  async function signOut() {
    const token = accessToken;
    authEpoch.current += 1;
    setPrincipal(null);
    setAccessToken("");
    setAccessExpiresAt(0);
    setRetryAt(0);
    refreshFailures.current = 0;
    setSavedAddresses([]);
    setSelectedAddressId(null);
    setFocusOrderId(null);
    setAddress({ label: "Nhà", phone: "", line1: "", latitude: "", longitude: "" });
    await Promise.all([
      AsyncStorage.removeItem(ADDRESS_KEY).catch(() => undefined),
      clearRefresh().catch(() => undefined),
      AsyncStorage.removeItem("hotpot.checkout.pending.v1").catch(() => undefined),
    ]);
    let revoked = true;
    if (token && Platform.OS !== "web") {
      try { await apiRequest("/auth/logout", { method: "POST", accessToken: token }); }
      catch { revoked = false; }
    }
    setLoginReturnTo("home");
    setScreen("login");
    setNotice(revoked ? "Đã đăng xuất." : "Đã đăng xuất trên thiết bị. Máy chủ chưa xác nhận thu hồi phiên.");
  }

  useEffect(() => {
    if (!accessToken) { setSavedAddresses([]); setSelectedAddressId(null); return; }
    let active = true;
    apiRequest<SavedAddresses>("/customer/addresses", { accessToken })
      .then(result => {
        if (!active) return;
        setSavedAddresses(result.addresses);
        setSelectedAddressId(old => result.addresses.some(a => a.id === old)
          ? old : (result.addresses[0]?.id ?? null));
        setAddress(old => {
          const saved = result.addresses.find(a => a.id === selectedAddressId) ?? result.addresses[0];
          return saved
            ? { ...old, label: saved.label, line1: saved.line1,
                latitude: saved.latitude, longitude: saved.longitude,
                phone: old.phone || result.phone || "" }
            : { ...old, phone: old.phone || result.phone || "" };
        });
      })
      .catch(() => { if (active) setNotice("Không thể tải địa chỉ đã lưu. Hãy thử lại."); });
    return () => { active = false; };
  }, [accessToken, selectedAddressId]);

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
        setSelectedAddressId(created.id);
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
      setAddressModalOpen(false);
      addressBeforeModal.current = null;
      setScreen(addressReturnTo);
    } catch (error) {
      setAddressErrorText(error instanceof Error ? error.message : "Không lưu được địa chỉ.");
    } finally { setAddressSaving(false); }
  }

  function selectSavedAddress(saved: SavedAddress, returnTo = addressReturnTo) {
    setSelectedAddressId(saved.id);
    setAddress(old => ({ ...old, label: saved.label, line1: saved.line1,
      latitude: saved.latitude, longitude: saved.longitude }));
    setAddressErrorText("");
    setNotice("Đã chọn địa chỉ " + saved.label + ". Phí giao sẽ được tính lại khi đặt hàng.");
    setScreen(returnTo);
  }

  function openAddressEditor(returnTo: "cart" | "account") {
    if (principal && savedAddresses.length >= 10) {
      setNotice("Tài khoản đã lưu tối đa 10 địa chỉ. Xóa một địa chỉ cũ trước khi thêm.");
      return;
    }
    addressBeforeModal.current = address;
    setAddress({ label: "Nhà", phone: address.phone, line1: "", latitude: "", longitude: "" });
    setAddressReturnTo(returnTo);
    setAddressErrorText("");
    setAddressModalOpen(true);
  }

  function closeAddressEditor() {
    if (addressSaving) return;
    if (addressBeforeModal.current) setAddress(addressBeforeModal.current);
    addressBeforeModal.current = null;
    setAddressErrorText("");
    setAddressModalOpen(false);
  }

  function showAddressPin(saved: SavedAddress) {
    const lat = Number(saved.latitude), lon = Number(saved.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      setNotice("Địa chỉ này chưa có tọa độ hợp lệ.");
      return;
    }
    void Linking.openURL("https://www.openstreetmap.org/?mlat=" + lat +
      "&mlon=" + lon + "#map=17/" + lat + "/" + lon)
      .catch(() => setNotice("Không mở được bản đồ ghim địa chỉ."));
  }

  function savedAddressCards(returnTo: "cart" | "account") {
    return savedAddresses.map(saved => (
      <View key={saved.id} style={[styles.savedAddress,
        selectedAddressId === saved.id && styles.savedAddressSelected]}>
        <View style={styles.addressCardCopy}>
          <Text style={styles.addressCardLabel}>{saved.label}
            {selectedAddressId === saved.id ? "  · Đang dùng" : ""}</Text>
          <Text style={styles.addressCardLine}>{saved.line1}</Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel={"Xem ghim " + saved.label}
          style={styles.addressPinButton} onPress={() => showAddressPin(saved)}>
          <Text style={styles.addressPinGlyph}>⌖</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={"Dùng địa chỉ " + saved.label}
          style={styles.addressSmallButton} onPress={() => selectSavedAddress(saved, returnTo)}>
          <Text style={styles.linkText}>Chọn</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={"Xóa địa chỉ " + saved.label}
          style={styles.addressSmallButton} disabled={addressSaving}
          onPress={() => void deleteSavedAddress(saved)}>
          <Text style={styles.warning}>Xóa</Text>
        </Pressable>
      </View>
    ));
  }

  async function deleteSavedAddress(saved: SavedAddress) {
    if (!accessToken || addressSaving) return;
    setAddressSaving(true);
    try {
      await apiRequest("/customer/addresses/" + encodeURIComponent(saved.id), {
        method: "DELETE", accessToken,
      });
      setSavedAddresses(old => old.filter(x => x.id !== saved.id));
      setSelectedAddressId(old => old === saved.id
        ? (savedAddresses.find(x => x.id !== saved.id)?.id ?? null) : old);
      if (selectedAddressId === saved.id) {
        const replacement = savedAddresses.find(x => x.id !== saved.id);
        setAddress(old => replacement ? { ...old, label: replacement.label, line1: replacement.line1,
          latitude: replacement.latitude, longitude: replacement.longitude }
          : { ...old, line1: "", latitude: "", longitude: "" });
      }
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

  function orderPlaced(receipt: CheckoutReceipt) {
    setCart([]);
    setFocusOrderId(receipt.orderId);
    setNotice("Đã nhận đơn #" + receipt.orderId.slice(0, 8) + ". " +
      (receipt.paymentMethod === "COD"
        ? "Thanh toán tiền mặt khi giao."
        : "Thanh toán QR đang chờ xác nhận của cửa hàng."));
    setScreen("orders");
  }

  function reorder(order: CustomerOrderDetail): string | null {
    if (order.branchId !== branchId) return "Chọn đúng chi nhánh đã đặt trước khi đặt lại.";
    let updated = [...cart];
    for (const item of order.items) {
      const product = item.productId ? productsById.get(item.productId) : null;
      if (!product || !product.isAvailable) return "Có món đã ngừng bán, vui lòng chọn món mới.";
      const variants = item.variantName === null ? [] : product.variants.filter(v =>
        v.name === item.variantName && v.isAvailable);
      if (item.variantName !== null && variants.length !== 1) {
        return "Khẩu phần của đơn cũ đã thay đổi, vui lòng chọn lại trên thực đơn.";
      }
      const modifierIds: string[] = [];
      const available = product.modifierGroups.flatMap(group => group.options);
      const used = new Set<string>();
      for (const modifier of item.modifiers) {
        const matches = available.filter(v => v.name === modifier.name
          && v.isAvailable && !used.has(v.id));
        if (matches.length !== 1) return "Topping đơn cũ đã thay đổi, vui lòng chọn lại.";
        modifierIds.push(matches[0]!.id);
        used.add(matches[0]!.id);
      }
      if (optionSelectionError(product.modifierGroups, modifierIds)) {
        return "Tùy chọn đơn cũ không còn hợp lệ, vui lòng chọn lại.";
      }
      try {
        updated = addCartLine(updated, {
          productId: product.id, variantId: variants[0]?.id ?? null, modifierIds,
        }, item.quantity);
      } catch {
        return "Giỏ hàng đã đầy hoặc số lượng vượt giới hạn.";
      }
    }
    setCart(updated);
    setNotice("Đã đưa món đang bán vào giỏ. Giá và phí giao sẽ được máy chủ tính lại.");
    setScreen("cart");
    return null;
  }

  function mainContent() {
    switch (screen) {

      case "home": {
        // Use live catalogue data; product photography, prices and stock come from API.
        const available = products.filter(item => item.isAvailable).slice(0, 8);
        const quick: readonly { name: string; icon: HomeCategoryName; terms: readonly string[] }[] = [
          { name: "Lẩu", icon: "hotpot", terms: ["lẩu", "hotpot"] },
          { name: "Trà sữa", icon: "milkTea", terms: ["trà", "sữa", "drink"] },
          { name: "Combo", icon: "combo", terms: ["combo", "set"] },
          { name: "Topping", icon: "topping", terms: ["topping", "thêm", "nấm"] },
          { name: "Ưu đãi", icon: "offers", terms: ["ưu đãi", "khuyến mãi", "giảm giá"] },
        ];
        return (
          <View style={styles.homePage}>
            <View style={styles.homeHeroRegion}>
              <Pressable style={[styles.homeBanner, { height: heroWidth * 321 / 829 }]}
                accessibilityRole="button" testID="home-approved-hero"
                accessibilityLabel="Khám phá thực đơn lẩu Tứ Xuyên và trà sữa" onPress={() => {
                  setCategoryId(""); setScreen("menu");
                }}>
                <Image source={require("./assets/home-reference.png")} resizeMode="stretch"
                  accessibilityLabel="Ảnh banner quảng bá theo mẫu đã duyệt"
                  style={[styles.homeBannerImage, {
                    left: -58 * heroScale, top: -232 * heroScale,
                    width: 941 * heroScale, height: 1672 * heroScale,
                  }]} />
              </Pressable>
            </View>
            <View style={styles.quickMenu}>
              {quick.map((item, index) => (
                <Pressable key={item.name} accessibilityRole="button"
                  accessibilityLabel={"Xem danh mục " + item.name}
                  style={[styles.quickItem, index === 0 ? styles.quickItemHotpot : styles.quickItemNeutral]}
                  onPress={() => {
                    const match = menu?.categories.find(cat =>
                      item.terms.some(term => cat.name.toLocaleLowerCase("vi").includes(term)));
                    setSearch("");
                    setCategoryId(match?.id ?? "");
                    setScreen("menu");
                  }}>
                  <HomeCategoryIcon name={item.icon} size={48} />
                  <Text style={styles.quickLabel} numberOfLines={1}>{item.name}</Text>
                </Pressable>
              ))}
            </View>
            <View style={styles.homeSection}>
              <View style={styles.homeSectionHead}>
                <View style={styles.homeSectionTitleRow}>
                  <HomeCategoryIcon name="offers" size={26} />
                  <Text testID="home-section-title" style={styles.homeSectionTitle}>Món nổi bật</Text>
                </View>
                <Pressable accessibilityRole="button" onPress={() => { setCategoryId(""); setScreen("menu"); }}
                  style={styles.homeSeeAll}><Text style={styles.linkText}>Xem tất cả  ›</Text></Pressable>
              </View>
              {available.length > 0 ? (
                <ScrollView horizontal showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.featureGrid}
                  style={styles.featureCarousel} testID="home-feature-carousel">
                  {available.map(item => (
                    <View key={item.id} style={styles.featureCard}>
                      <Pressable accessibilityRole="button" accessibilityLabel={"Xem món " + item.name}
                        onPress={() => openProduct(item)}>
                        <View style={styles.featureImage}><ProductArtwork product={item} large /></View>
                        <Text style={styles.featureTitle} numberOfLines={2}>{item.name}</Text>
                      </Pressable>
                      <View style={styles.featureFooter}>
                        <Text style={styles.featurePrice} numberOfLines={1}>{vnd(item.priceVnd)}</Text>
                        <Pressable style={styles.featureAddButton} accessibilityRole="button"
                          accessibilityLabel={"Chọn tùy chọn " + item.name}
                          onPress={() => openProduct(item)}>
                          <Text style={styles.featurePlus}>+</Text>
                        </Pressable>
                      </View>
                    </View>
                  ))}
                </ScrollView>
              ) : (
                <View style={styles.homeEmpty}>
                  <Text style={styles.emptyTitle}>Thực đơn đang cập nhật</Text>
                  <Text style={styles.muted}>
                    {catalogError ? "Chưa kết nối API thực đơn. Kiểm tra kết nối rồi thử lại." :
                      catalogLoading ? "Đang tải thực đơn từ cửa hàng..." : "Chưa có món được mở bán."}
                  </Text>
                  {!!catalogError && <Button label="Thử kết nối lại" alternate onPress={() => void refreshCatalogue()} />}
                  {!catalogError && <Button label="Xem thực đơn" alternate onPress={() => setScreen("menu")} />}
                </View>
              )}
            </View>
            <View style={styles.homeOffers}>
              <View style={styles.homeSectionHead}>
                <View style={styles.homeSectionTitleRow}>
                  <HomeCategoryIcon name="combo" size={26} />
                  <Text style={styles.homeSectionTitle}>Ưu đãi hôm nay</Text>
                </View>
                <Pressable accessibilityRole="button" accessibilityLabel="Xem danh mục ưu đãi"
                  style={styles.homeSeeAll}
                  onPress={() => {
                    const offer = menu?.categories.find(cat =>
                      /ưu đãi|khuyến mãi|giảm giá/i.test(cat.name));
                    setCategoryId(offer?.id ?? "");
                    setScreen("menu");
                  }}><Text style={styles.linkText}>Xem tất cả  ›</Text></Pressable>
              </View>
              <View style={styles.homeOfferGrid}>
                {([
                  { kind: "hotpot", title: "Khám phá lẩu", term: "lẩu" },
                  { kind: "milkTea", title: "Trà sữa thơm ngon", term: "trà" },
                ] as const).map(promo => {
                  const tileWidth = (Math.min(viewportWidth, 620) - 40) / 2;
                  return (
                    <Pressable key={promo.kind} accessibilityRole="button"
                      accessibilityLabel={promo.title} style={styles.homeOfferCard}
                      onPress={() => {
                        const match = menu?.categories.find(cat =>
                          cat.name.toLocaleLowerCase("vi").includes(promo.term));
                        setCategoryId(match?.id ?? "");
                        setSearch("");
                        setScreen("menu");
                      }}>
                      <HomeLifestylePhoto kind={promo.kind} width={tileWidth} height={112} />
                      <View style={styles.homeOfferCardShade}>
                        <Text style={styles.homeOfferCardTitle}>{promo.title}</Text>
                      </View>
                    </Pressable>
                  );
                })}
              </View>
              <Text style={styles.homeOfferNote}>Ưu đãi và giá thực tế theo thông tin cửa hàng.</Text>
            </View>
          </View>
        );
      }
      case "menu":
        return (
          <>
            <View style={styles.section}>
              <Text style={styles.pageTitle}>Thực đơn</Text>
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
              ) : <Text style={styles.muted}>Chi nhánh đang được cập nhật.</Text>}
              <Field label="Tìm món ăn, trà sữa" value={search} onChangeText={setSearch}
                placeholder="Nhập tên món bạn muốn tìm..." />
            </View>
            {cataloguePanel()}
          </>
        );
      case "orders":
        return <OrdersScreen accessToken={accessToken} focusOrderId={focusOrderId}
          onLogin={() => { setLoginReturnTo("account"); setScreen("login"); }}
          onReorder={reorder} />;
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
                  <Text style={styles.muted}>{selectedAddressId
                    ? savedAddresses.find(item => item.id === selectedAddressId)?.line1 ?? "Chọn địa chỉ đã lưu"
                    : "Chưa chọn địa chỉ đã lưu trong tài khoản"}</Text>
                  <Button label={hasStoredAddress ? "Sửa địa chỉ giao hàng" : "Thêm địa chỉ giao hàng"}
                    alternate onPress={() => { setAddressReturnTo("cart"); setScreen("address"); }} />
                </View>
                {!principal && <Button label="Đăng nhập để tiếp tục" onPress={() => { setLoginReturnTo("cart"); setScreen("login"); }} />}
                {!!principal && <CheckoutPanel accessToken={accessToken} userId={principal.id}
                  branchId={branchId} addressId={selectedAddressId} cart={cart} onPlaced={orderPlaced} />}
              </>
            )}
          </View>
        );
      case "purchased":
        return <PurchasedProductsScreen accessToken={accessToken}
          onLogin={() => { setLoginReturnTo("account"); setScreen("login"); }}
          onReorder={reorder} />;
      case "account":
        return (
          <View style={styles.accountPage}>
            <View style={styles.accountIdentity}>
              <HotpotNavIcon name="user" active size={38} />
              <View style={styles.accountIdentityText}>
                <Text style={styles.pageTitle}>Tôi</Text>
                <Text style={styles.muted}>{principal ? "Tài khoản khách hàng" : "Chào mừng đến Sichuan Hotpot"}</Text>
              </View>
            </View>
            {principal ? (
              <>
                <View style={styles.accountGroup}>
                  <View style={styles.accountGroupHeader}>
                    <Text style={styles.sectionTitle}>Địa chỉ giao hàng</Text>
                    <Pressable accessibilityRole="button" style={styles.accountAdd}
                      onPress={() => openAddressEditor("account")}>
                      <Text style={styles.linkText}>＋ Thêm địa chỉ</Text>
                    </Pressable>
                  </View>
                  {savedAddresses.length > 0 ? savedAddressCards("account") :
                    <Text style={styles.muted}>Chưa lưu địa chỉ. Thêm địa chỉ để đặt hàng nhanh hơn.</Text>}
                </View>
                <View style={styles.accountGroup}>
                  <Text style={styles.sectionTitle}>Đơn hàng & mua lại</Text>
                  <Button label="Sản phẩm đã mua" alternate onPress={() => setScreen("purchased")} />
                  <Button label="Lịch sử và theo dõi đơn hàng" alternate onPress={() => setScreen("orders")} />
                </View>
                <View style={styles.accountLogout}>
                  <Pressable accessibilityRole="button" style={({ pressed }) => [
                    styles.logoutButton, pressed && actionDepth.pressed,
                  ]} onPress={() => void signOut()}>
                    <Text style={styles.logoutText}>Đăng xuất</Text>
                  </Pressable>
                </View>
              </>
            ) : (
              <View style={styles.accountGroup}>
                <Text style={styles.muted}>Đăng nhập để lưu địa chỉ và xem các món đã mua.</Text>
                <Button label="Đăng nhập / Tạo tài khoản"
                  onPress={() => { setLoginReturnTo("account"); setScreen("login"); }} />
              </View>
            )}
          </View>
        );
      case "address":
        return (
          <View style={styles.section}>
            <Button label={addressReturnTo === "cart" ? "‹ Trở về giỏ hàng" : "‹ Trở về tài khoản"}
              alternate onPress={() => setScreen(addressReturnTo)} />
            <Text style={styles.pageTitle}>Địa chỉ giao hàng</Text>
            <Text style={styles.muted}>Kiểm tra địa chỉ và ghim trước khi chọn. Phí giao được máy chủ tính theo đường xe chạy.</Text>
            {!!principal && savedAddresses.length > 0 && (
              <View style={styles.accountGroup}>
                <Text style={styles.sectionTitle}>Địa chỉ đã lưu ({savedAddresses.length}/10)</Text>
                {savedAddressCards(addressReturnTo)}
              </View>
            )}
            <Button label={principal ? "＋ Thêm địa chỉ mới" : "＋ Thêm địa chỉ giao hàng"}
              onPress={() => openAddressEditor(addressReturnTo)} />
            {!!addressErrorText && <Notice message={addressErrorText} error />}
          </View>
        );
    }
  }

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.safeArea} edges={["top", "bottom"]}>
        <StatusBar barStyle="dark-content" backgroundColor={palette.white} />
        {!authReady ? (
          <View style={styles.sessionLoading}>
            <ActivityIndicator size="large" color={brand} />
            <Text style={styles.muted}>Đang khôi phục phiên đăng nhập…</Text>
          </View>
        ) : authRestoreError ? (
          <View style={styles.sessionLoading}>
            <Notice message={authRestoreError} error />
            <Button label="Thử khôi phục phiên" onPress={() => setAuthRestoreAttempt(n => n + 1)} />
            <Button label="Xem thực đơn" alternate onPress={() => {
              setAuthRestoreError(""); setScreen("home");
            }} />
          </View>
        ) : screen === "login" ? (
          <AuthScreen onAuthenticated={saveLogin} onGuest={() => { setNotice(""); setScreen("home"); }} />
        ) : (
          <View style={styles.shell}>
            {screen === "home" ? (
              <View style={styles.homeHeader}>
                <View style={styles.homeHeaderLine}>
                  <Pressable style={styles.deliveryLocation} accessibilityRole="button"
                    onPress={() => { setAddressReturnTo("account"); setScreen("address"); }}>
                    <Text style={styles.deliveryLocationTitle}>Giao đến  ⌄</Text>
                    <Text style={styles.deliveryLocationValue} numberOfLines={1}>
                      {address.line1 || "Chọn địa chỉ giao hàng"}
                    </Text>
                  </Pressable>
                  <View style={styles.homeHeaderActions}>
                    <Pressable style={styles.headerIconAction} onPress={() => setScreen("orders")}
                      accessibilityRole="button" accessibilityLabel="Thông báo đơn hàng, xem đơn hàng">
                      <HotpotNavIcon name="notifications" active size={27} />
                    </Pressable>
                    <Pressable style={styles.headerIconAction} onPress={() => setScreen("cart")}
                      accessibilityRole="button" accessibilityLabel="Giỏ hàng">
                      <HotpotNavIcon name="cart" active size={27} />
                    </Pressable>
                  </View>
                </View>

              </View>
            ) : (
              <View style={styles.header}>
                <View style={styles.logoBadge}><HotpotNavIcon name="hotpot" active size={29} /></View>
                <View style={styles.headerText}>
                  <Text style={styles.brandName}>SICHUAN HOTPOT</Text>
                  <Text style={styles.brandSub}>Lẩu Tứ Xuyên & Trà Sữa</Text>
                </View>
                <Pressable style={styles.headerCart} onPress={() => setScreen("cart")}
                  accessibilityRole="button" accessibilityLabel="Giỏ hàng">
                  <HotpotNavIcon name="cart" active size={25} />
                </Pressable>
              </View>
            )}
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
                ["home", "Trang chủ", "home"],
                ["menu", "Thực đơn", "menu"],
                ["orders", "Đơn hàng", "orders"],
                ["account", "Tôi", "user"],
              ] as const).map(([target, label, icon]) => (
                <Pressable key={target} style={styles.navItem}
                  accessibilityRole="tab" accessibilityState={{ selected: screen === target }}
                  accessibilityLabel={label} onPress={() => { setNotice(""); if (target === "orders") setFocusOrderId(null); setScreen(target); }}>
                  <HotpotNavIcon name={icon} active={screen === target} size={23} />
                  <Text style={[styles.navLabel, screen === target && styles.navActive]}>{label}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        )}
        <Modal visible={addressModalOpen} transparent animationType="slide"
          onRequestClose={closeAddressEditor}>
          <KeyboardAvoidingView style={styles.addressModalBackdrop}
            behavior={Platform.OS === "ios" ? "padding" : undefined}>
            <View style={styles.addressModalSheet}>
              <View style={styles.addressModalHeader}>
                <Text style={styles.sectionTitle}>Thêm địa chỉ mới</Text>
                <Pressable accessibilityRole="button" accessibilityLabel="Đóng thêm địa chỉ"
                  onPress={closeAddressEditor} style={styles.addressModalClose}>
                  <Text style={styles.addressModalCloseText}>✕</Text>
                </Pressable>
              </View>
              <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}
                contentContainerStyle={styles.addressModalBody}>
                <Text style={styles.muted}>Nhập địa chỉ, chọn GPS hoặc kéo ghim đến đúng vị trí nhận hàng.</Text>
            <Field label="Tên gợi nhớ (Nhà, Công ty...)" value={address.label}
              onChangeText={text => setAddress(old => ({ ...old, label: text }))} placeholder="Nhà" />
            <Field label="Số điện thoại" value={address.phone}
              onChangeText={text => { setAddress(old => ({ ...old, phone: text })); }}
              keyboardType="phone-pad" placeholder="09..." />
            <Field label="Số nhà, đường, phường/xã" value={address.line1}
              onChangeText={text => { setAddress(old => ({ ...old, line1: text })); }}
              placeholder="Ví dụ: 25 Nguyễn Trãi, Phường ..." />
            <AddressPinMap latitude={address.latitude} longitude={address.longitude}
              onChange={(latitude, longitude) => {
                setAddress(old => ({ ...old, latitude, longitude }));
              }} />
            <Button label={addressBusy ? "Đang lấy GPS..." : "Dùng vị trí GPS hiện tại"} alternate
              disabled={addressBusy} onPress={() => void locateMe()} />
            <Text style={styles.muted}>Nếu không cho phép GPS, nhập tọa độ từ ghim bản đồ đã kiểm tra.</Text>
            <Field label="Vĩ độ (latitude)" value={address.latitude}
              onChangeText={text => { setAddress(old => ({ ...old, latitude: text })); }}
              keyboardType="decimal-pad" placeholder="10.0000000" />
            <Field label="Kinh độ (longitude)" value={address.longitude}
              onChangeText={text => { setAddress(old => ({ ...old, longitude: text })); }}
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

                <Button label="Hủy" alternate disabled={addressSaving} onPress={closeAddressEditor} />
              </ScrollView>
            </View>
          </KeyboardAvoidingView>
        </Modal>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: palette.white },
  sessionLoading: { flex: 1, padding: 24, justifyContent: "center", alignItems: "stretch", gap: 16 },
  shell: { flex: 1, width: "100%", maxWidth: 620, alignSelf: "center", backgroundColor: palette.white, overflow: "hidden" },
  header: { paddingHorizontal: 16, paddingVertical: 11, flexDirection: "row", alignItems: "center", borderBottomWidth: 1, borderBottomColor: palette.line, backgroundColor: palette.white },
  logoBadge: { width: 44, height: 44, borderRadius: 13, backgroundColor: palette.white, borderColor: palette.line, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  logoGlyph: { color: "#FFFFFF", fontSize: 19, fontWeight: "800" },
  headerText: { flex: 1, paddingHorizontal: 10 },
  brandName: { fontSize: typeScale.body, fontWeight: "800", color: brand, letterSpacing: 0.4 },
  brandSub: { fontSize: typeScale.caption, color: "#667085" },
  headerCart: { minWidth: 44, minHeight: 44, justifyContent: "center", alignItems: "center" },
  headerCartText: { fontSize: typeScale.small, color: brand, fontWeight: "800" },
  body: { flex: 1, minHeight: 0, paddingBottom: 58 },
  scrollContent: { paddingBottom: 22, backgroundColor: palette.white, flexGrow: 1 },
  loginPage: { backgroundColor: "#FFFFFF", paddingBottom: 24 },
  loginHeroFrame: { width: "100%", height: 160, backgroundColor: palette.red, overflow: "hidden" },
  loginHeroImage: { width: "100%", height: "100%" },
  loginHeroFallback: { width: "100%", height: "100%", backgroundColor: "#822524", alignItems: "center", justifyContent: "center" },
  loginHeroFallbackIcon: { color: "#F9D29C", fontSize: 64 },
  loginHeroFallbackText: { fontWeight: "900", color: "#FFF1D9", fontSize: 23, letterSpacing: 2 },
  loginHeroTint: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(34,12,10,0.32)", justifyContent: "space-between", paddingHorizontal: 22, paddingVertical: 16 },
  loginBack: { minHeight: 44, alignSelf: "flex-start", justifyContent: "center", paddingHorizontal: 10, borderRadius: 22, backgroundColor: "rgba(30,10,10,0.48)" },
  loginBackText: { color: "#FFF7ED", fontWeight: "700" },
  loginHeroCopy: { gap: 7, paddingBottom: 12 },
  loginEyebrow: { color: "#FFFFFF", letterSpacing: 2, fontSize: 11, fontWeight: "900" },
  loginHeadline: { color: "#FFFDF8", fontSize: typeScale.hero, fontWeight: "900", lineHeight: 28 },
  loginContent: { paddingHorizontal: 24, paddingTop: 25, gap: 11 },
  loginWelcome: { color: "#20252B", fontSize: typeScale.page, lineHeight: 26, fontWeight: "900" },
  loginSupporting: { color: "#667085", fontSize: 13, lineHeight: 21, marginBottom: 7 },
  loginDivider: { flexDirection: "row", gap: 12, alignItems: "center", justifyContent: "center", marginVertical: 8 },
  loginDividerLine: { flex: 1, height: 1, backgroundColor: "#D0D5DD" },
  loginDividerText: { color: "#667085", fontSize: 12 },
  loginFootnote: { color: "#667085", fontSize: 12, lineHeight: 19 },
  loginGuest: { alignSelf: "center", minHeight: 44, paddingVertical: 12, justifyContent: "center" },
  loginGuestText: { color: brand, fontWeight: "700", textAlign: "center", fontSize: 13 },
  section: { paddingHorizontal: 16, paddingTop: 16, gap: 11 },
  accountPage: { paddingHorizontal: 16, paddingTop: 20, paddingBottom: 24,
    gap: 18, flexGrow: 1 },
  accountIdentity: { flexDirection: "row", alignItems: "center", gap: 14,
    paddingVertical: 16, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: palette.line },
  accountIdentityText: { flex: 1, gap: 3 },
  accountGroup: { padding: 14, borderRadius: 16, backgroundColor: palette.white,
    borderWidth: 1, borderColor: palette.line, gap: 12 },
  accountGroupHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  accountAdd: { minHeight: 44, justifyContent: "center", paddingHorizontal: 3 },
  accountLogout: { marginTop: "auto", paddingTop: 28, paddingBottom: 12 },
  logoutButton: { borderColor: palette.red, borderWidth: 1, backgroundColor: palette.softRed,
    minHeight: 48, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  logoutText: { color: palette.red, fontSize: typeScale.action, fontWeight: "800" },
  addressModalBackdrop: { flex: 1, backgroundColor: "rgba(17,24,39,0.45)",
    justifyContent: "center", alignItems: "center", paddingHorizontal: 12, paddingVertical: 20 },
  addressModalSheet: { width: "100%", maxWidth: 540, maxHeight: "94%", backgroundColor: palette.white,
    borderRadius: 20, overflow: "hidden" },
  addressModalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    borderBottomWidth: 1, borderBottomColor: palette.line, paddingHorizontal: 16, paddingVertical: 10 },
  addressModalClose: { minHeight: 44, minWidth: 44, justifyContent: "center", alignItems: "center" },
  addressModalCloseText: { fontSize: 18, color: palette.text },
  addressModalBody: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 30, gap: 12 },
  homePage: { flex: 1, backgroundColor: palette.white },
    homeHeader: { paddingHorizontal: 16, paddingTop: 11, paddingBottom: 10,
    backgroundColor: "#4A0C0A" },
  homeHeaderLine: { flexDirection: "row", alignItems: "center", gap: 12 },
  deliveryLocation: { flex: 1, minHeight: 49, justifyContent: "center" },
  deliveryLocationTitle: { color: palette.white, fontSize: 12, fontWeight: "700" },
  deliveryLocationValue: { color: palette.white, fontSize: 13, fontWeight: "600", marginTop: 4, maxWidth: 280 },
  homeCart: { minWidth: 44, minHeight: 44, justifyContent: "center" },
  homeHeaderActions: { flexDirection: "row", alignItems: "center", gap: 5 },
  headerIconAction: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  homeCartText: { color: palette.white, fontSize: typeScale.body, fontWeight: "800" },
  homeCartInner: { flexDirection: "row", alignItems: "center", gap: 4 },
  cartIconSurface: { backgroundColor: palette.white, borderRadius: 8, padding: 3 },
  headerCartInner: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5 },
  homeHeroRegion: { backgroundColor: "#4A0C0A", paddingBottom: 12 },
  homeBanner: { overflow: "hidden", marginHorizontal: 12,
    borderRadius: 18, backgroundColor: "#6D1710" },
  homeBannerImage: { position: "absolute" },
  homeBannerShade: { flex: 1, justifyContent: "center", paddingHorizontal: 18,
    backgroundColor: "rgba(47, 2, 0, 0.19)", gap: 7 },
  homeBannerTitle: { fontSize: typeScale.hero, lineHeight: 30, fontWeight: "900", fontStyle: "italic",
    color: "#FFF0D4", maxWidth: "80%" },
  homeBannerCaption: { color: "#FFF7E9", fontSize: typeScale.small, fontWeight: "700" },
  homeBannerCta: { alignSelf: "flex-start", backgroundColor: "#FFE8BE",
    borderRadius: 22, minHeight: 33, paddingHorizontal: 15, justifyContent: "center" },
  homeBannerCtaText: { color: "#9E201B", fontSize: typeScale.small, fontWeight: "900" },
  quickMenu: { flexDirection: "row", justifyContent: "space-between",
    paddingHorizontal: 10, paddingTop: 13, paddingBottom: 15, columnGap: 5 },
  quickItem: { position: "relative", flex: 1, minWidth: 0, minHeight: 89, borderRadius: 18,
    alignItems: "center", justifyContent: "center", paddingVertical: 7, gap: 6 },
  quickItemHotpot: { backgroundColor: "#FBE2E1" },
  quickItemNeutral: { backgroundColor: "#F7F6F5" },
  quickCornerBadge: { position: "absolute", top: 0, right: 0,
    backgroundColor: "#C91421", borderRadius: 12, paddingHorizontal: 5, minHeight: 18,
    justifyContent: "center" },
  quickCornerBadgeText: { color: "#FFFFFF", fontSize: 10, fontWeight: "800" },
  quickLabel: { color: "#1F2126", fontSize: 12, fontWeight: "700" },
  homeSection: { paddingTop: 3, paddingBottom: 12, gap: 10 },
  homeSectionHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 15 },
  homeSectionTitleRow: { flexDirection: "row", alignItems: "center", gap: 7, flexShrink: 1 },
  homeSectionTitle: { color: "#202020", fontSize: 18, fontWeight: "900" },
  homeSeeAll: { minHeight: 44, justifyContent: "center" },
  featureCarousel: { flexGrow: 0 },
  featureGrid: { flexDirection: "row", gap: 10, paddingHorizontal: 15, paddingBottom: 4 },
  featureCard: { width: 140, borderRadius: 12, paddingBottom: 9, overflow: "hidden",
    backgroundColor: palette.white, borderWidth: 1, borderColor: "#F3F0EE" },
  featureImage: { height: 118, width: "100%", alignItems: "center", justifyContent: "center",
    backgroundColor: "#FAEAEA" },
  featureTitle: { color: "#1F2024", fontWeight: "700", fontSize: 13, minHeight: 39,
    marginHorizontal: 8, marginTop: 8, lineHeight: 18 },
  featureFooter: { flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 8,
    alignItems: "center", gap: 4, marginTop: 3 },
  featurePrice: { color: "#C8111F", fontWeight: "900", fontSize: 14, flexShrink: 1 },
  featureAddButton: { width: 36, height: 36, borderRadius: 18, alignItems: "center",
    justifyContent: "center", backgroundColor: "#D51123" },
  featurePlus: { color: palette.white, fontWeight: "800", fontSize: 25, lineHeight: 29 },
  homeEmpty: { marginHorizontal: 15, backgroundColor: palette.graySurface, padding: 16,
    borderRadius: 13, gap: 10, alignItems: "stretch" },
  homeOffers: { paddingTop: 8, paddingBottom: 16, gap: 4 },
  homeOfferGrid: { flexDirection: "row", gap: 10, marginHorizontal: 15 },
  homeOfferCard: { flex: 1, borderRadius: 13, height: 112, overflow: "hidden", backgroundColor: "#6F2318" },
  homeOfferCardShade: { position: "absolute", left: 0, right: 0, bottom: 0,
    backgroundColor: "rgba(60,0,0,0.64)", paddingHorizontal: 9, paddingVertical: 9 },
  homeOfferCardTitle: { color: "#FFFFFF", fontSize: 13, fontWeight: "800" },
  homeOfferNote: { color: palette.muted, fontSize: 11, marginHorizontal: 15,
    paddingTop: 3 },
  hero: { backgroundColor: brand, borderRadius: 0, minHeight: 190, paddingHorizontal: 21, paddingVertical: 21, justifyContent: "center", gap: 9 },
  heroEyebrow: { color: "#FFFFFF", fontWeight: "800", fontSize: 11, letterSpacing: 1.3 },
  heroTitle: { color: "#FFFFFF", fontWeight: "900", fontSize: typeScale.hero, lineHeight: 28 },
  heroSubtitle: { color: "#FFFFFF", fontSize: 13, lineHeight: 20 },
  heroAction: { marginTop: 8, backgroundColor: "#FFFFFF", minHeight: 44, alignSelf: "flex-start", borderRadius: 10, paddingHorizontal: 16, justifyContent: "center" },
  heroActionText: { color: "#B3262D", fontWeight: "800", fontSize: 13 },
  pageTitle: { fontSize: typeScale.page, fontWeight: "800", color: "#20252B", marginTop: 4 },
  sectionTitle: { color: "#20252B", fontSize: typeScale.section, fontWeight: "800" },
  categoryTitle: { color: "#20252B", fontSize: 15, fontWeight: "800", marginBottom: 7 },
  categoryBlock: { gap: 8, paddingTop: 8 },
  pills: { flexGrow: 0 },
  pill: { paddingHorizontal: 16, minHeight: 44, borderRadius: 24, backgroundColor: "#F2F4F7", justifyContent: "center", marginRight: 8 },
  pillActive: { backgroundColor: brand },
  pillText: { color: "#667085", fontWeight: "700" },
  pillTextActive: { color: "white" },
  branchPill: { borderRadius: 12, borderWidth: 1, borderColor: "#DCC2B2", paddingHorizontal: 12, paddingVertical: 11, marginRight: 8, minHeight: 44 },
  branchActive: { borderColor: brand, backgroundColor: "#FFF0F0" },
  branchText: { color: "#344054", fontSize: 13, fontWeight: "700" },
  productCard: { backgroundColor: "white", minHeight: 98, borderRadius: 16, padding: 10, flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: "#E4E7EC" },
  productImage: { height: 76, width: 76, borderRadius: 12, backgroundColor: "#FFF0F0" },
  productImageLarge: { width: "100%", height: "100%", borderRadius: 16, backgroundColor: "#FFF0F0" },
  iconTile: { backgroundColor: "#FFF0F0", height: 76, width: 76, borderRadius: 12, justifyContent: "center", alignItems: "center" },
  iconTileTea: { backgroundColor: "#FFF0F0" },
  iconGlyph: { fontSize: 30 },
  productInfo: { flex: 1, paddingHorizontal: 12, gap: 3 },
  productName: { color: "#20252B", fontSize: typeScale.action, fontWeight: "800", lineHeight: 19 },
  price: { color: brand, fontSize: typeScale.action, fontWeight: "900" },
  availability: { color: "#667085", fontSize: 12 },
  forward: { color: brand, fontSize: 23 },
  detailHero: { height: 154, backgroundColor: "#FFF0F0", borderRadius: 16, justifyContent: "center", alignItems: "center" },
  detailTitle: { fontSize: typeScale.page, fontWeight: "800", color: "#20252B" },
  detailPrice: { color: brand, fontSize: 19, fontWeight: "900" },
  group: { marginTop: 8, gap: 9, paddingVertical: 12, borderTopWidth: 1, borderTopColor: "#E4E7EC" },
  option: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 12, minHeight: 48, borderBottomWidth: 1, borderBottomColor: "#E4E7EC" },
  optionUnavailable: { opacity: 0.45 },
  optionPrice: { color: "#B3262D", fontWeight: "700", fontSize: 13 },
  savedAddress: { flexDirection: "row", alignItems: "center", backgroundColor: palette.graySurface,
    borderRadius: 13, borderWidth: 1, borderColor: palette.line, padding: 10, gap: 3 },
  savedAddressSelected: { borderColor: palette.red, backgroundColor: palette.softRed },
  addressCardCopy: { flex: 1, gap: 4, minWidth: 0 },
  addressCardLabel: { color: palette.text, fontWeight: "800", fontSize: typeScale.body },
  addressCardLine: { color: palette.muted, fontSize: typeScale.small, lineHeight: 17 },
  addressPinButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  addressPinGlyph: { fontSize: 27, color: palette.red },
  addressSmallButton: { minHeight: 44, paddingHorizontal: 8, justifyContent: "center" },
  optionText: { color: "#20252B", fontSize: typeScale.action, fontWeight: "700" },
  quantityLine: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 13 },
  quantityStepper: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: "#D0D5DD", borderRadius: 12 },
  step: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  stepText: { fontSize: 18, color: brand, fontWeight: "800" },
  qtyText: { textAlign: "center", minWidth: 24, fontWeight: "800", color: "#20252B" },
  cartLine: { backgroundColor: "white", borderRadius: 15, borderWidth: 1, borderColor: "#E4E7EC", padding: 14, flexDirection: "row", alignItems: "center", gap: 12 },
  cartLineDetails: { flex: 1, gap: 6 },
  empty: { gap: 14, alignItems: "stretch", paddingVertical: 20 },
  emptyTitle: { fontSize: typeScale.section, fontWeight: "800", color: "#20252B" },
  muted: { color: "#667085", fontSize: 13, lineHeight: 21 },
  warning: { color: brand, fontSize: 13, fontWeight: "700" },
  notice: { margin: 14, padding: 13, borderRadius: 12, backgroundColor: "#F2F4F7" },
  noticeError: { backgroundColor: "#FEE4E2" },
  noticeText: { color: "#344054", fontSize: 13, lineHeight: 19 },
  field: { gap: 7, paddingTop: 3 },
  fieldLabel: { color: "#344054", fontSize: typeScale.body, fontWeight: "800" },
  input: { backgroundColor: "white", borderWidth: 1, borderColor: "#D0D5DD", borderRadius: 10, minHeight: 44, paddingHorizontal: 14, fontSize: 16, color: "#20252B" },
  button: { backgroundColor: brand, borderRadius: 14, minHeight: 46, justifyContent: "center", alignItems: "center", paddingHorizontal: 14, paddingVertical: 10, marginVertical: 2 },
  buttonText: { color: "white", fontSize: typeScale.action, textAlign: "center", fontWeight: "800" },
  buttonOutline: { backgroundColor: "transparent", borderWidth: 1, borderColor: brand },
  buttonOutlineText: { color: brand },
  buttonDisabled: { opacity: 0.45 },
  pressed: { opacity: 0.92 },
  segmentRow: { flexDirection: "row", backgroundColor: "#FFF0F0", borderRadius: 14, padding: 4 },
  segment: { flex: 1, alignItems: "center", justifyContent: "center", minHeight: 44, borderRadius: 11 },
  segmentActive: { backgroundColor: "white" },
  segmentText: { color: brand, fontSize: typeScale.body, fontWeight: "800" },
  smallAction: { alignSelf: "flex-end", paddingVertical: 9, minHeight: 44, justifyContent: "center" },
  linkText: { color: brand, fontSize: 13, fontWeight: "700" },
  orText: { textAlign: "center", paddingVertical: 8 },
  bottomNavigation: { position: "absolute", left: 0, right: 0, bottom: 0, zIndex: 5, borderTopWidth: 1, borderTopColor: "#E4E7EC", backgroundColor: "white", flexDirection: "row", justifyContent: "space-around", minHeight: 58 },
  navItem: { flex: 1, minHeight: 58, alignItems: "center", justifyContent: "center", gap: 2 },
  navGlyph: { fontSize: 20, color: "#98A2B3" },
  navLabel: { color: "#98A2B3", fontSize: typeScale.caption, fontWeight: "800" },
  navActive: { color: brand },
  loader: { marginTop: 30 },
});

export default CustomerApp;
