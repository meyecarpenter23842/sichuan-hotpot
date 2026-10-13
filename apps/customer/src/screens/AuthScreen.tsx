import React, { useEffect, useState } from "react";
import {
  ActivityIndicator, Image, KeyboardAvoidingView, Platform, Pressable,
  ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View,
} from "react-native";
import * as Google from "expo-auth-session/providers/google";
import * as WebBrowser from "expo-web-browser";
import { apiRequest, type AuthTokens } from "../api";
import { emailError, passwordError, usernameError } from "../validation";
import { palette } from "../theme";

WebBrowser.maybeCompleteAuthSession();

type Mode = "login" | "register" | "verify" | "forgot" | "reset";
type Props = {
  onAuthenticated: (tokens: AuthTokens) => Promise<void>;
  onGuest: () => void;
};

const googleWebId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || "";
const googleAndroidId = process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID || "";
const googleConfigured = Platform.OS === "web" ? !!googleWebId : !!googleAndroidId;
const heroUrl = "https://pub-63ed7b1c33514906ab6e2d82f41bffce.r2.dev/system-image/login-hero.png";
const googleG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACQAAAAkCAYAAADhAJiYAAAABmJLR0QA/wD/AP+gvaeTAAAEp0lEQVRYhe2YW2xUVRSGv7VnzrTSKb3R1jQhpsiDlyrCtIDIpRQUxIiRm4QH9EEgaAKBBxNASRNRE5VQE42XxJiIF+4kJIhgbwoqpaACUdQaFFGgYNvQ23Smc87yoU5tyxw6LW0TE/+ns2f9e60vZ++z954t9FG1MwtGocwWdALIWCADSAc8QCNwXkXPgBy2ncgnOeXfnutLfonHpMWYy4cLlgiyAvS+ePsBDujnOLyaWXH8gIDeMFDtjPz7BdkM3BUnhJu+8GBWZpRV/dAvIA0ErMtpng2i+hxgbhAmqjaFZdll1R/0CajuwQnD7bDuB508QCBdpQrPZ5VVF8caQm/PH+pnBlIiYedTYOIgwACIQIpbsNtQKEhEzXuDCANCSWZZ9Rq3Cd7tDV2Zkb8OeDTO1BHgmKpUCdRiVIBslHHApJ65O2FKq9de72vzAmgF/tC5tFeaPpRl6vQKEgTZIl779cyDJy7GMjQU3pMa8VirFNYAqQCqsiW77Nja3pILQLjUWt26J7ck/JPr0Eb1DcYszvqsqqZXbKDugYKREZtdqHyZXd47TCdQe6n1XfhM6pjWAyPRkMfFqhXYwblZld83x5O4s1cgYMmJE+3x+iV4MDHX67HPAjh1CTTvzcW+ktjTV+MLJUxIPXKkoS8w/ZGxjD2ls5ERIvmJn/GNqevqUcGsGAoYAKNIty1BvA5Jc86T9NDviOWAzynNLKuqGAqYDiDRkbECvrvrSV7yy29Ou3fjUMEAGEGGuwU9OS0nby6tOjrYEIXFDanRZy/guvKoSmO8SYs2NS3sD4waeUQ66jzVASROCI296YvosLgzi+zoD5AoCOyOto2o/OVmrtfEe8ftWDi6P4X6IkWzOoFU9Vc3Y4qEczIJDvGkNnoyVkCBXcFcrqr1WOCj+bcNMkfn6m88PvsoYHeLqsX6xgJKWvKIqPGJ6FuBt5dbg0WjyoXos1em0NBeytfAZIAaO4X1jfn8YSf920NkGsPr3kBZgbgcHVQXuRYUkyzou25xY+RsZymAcKm1SuC1fW23sLklj7C6brDbwuGkJ08t3driljyWija1PIzoPldgmF2xwX8Q/jkPWZ72j4625aS91DxmI9c90Mtiy9c6MbBtwTOjjOzZuWin7eYs+HjBJMV5UYyc1LOhW8XxuVkjYW/wq84KXSOBbfNLBFa7A3XTOUX3C6bKEa01tuOI8WQpOg6YBdwZNXraRjPs0tOInX5tFuVQ+bP+WTGBCisKvc2X0ksRmRYnVNwS289NtSvxBvN68PB4xQb/+9F2t+GpnF4ZCbfrIuD0QAOpp5nWnM2E0vbR5Uj9Z2Jy0vauvmvmy6mley8bnzMdOD7QUOAQSt9NW+bWjqboCwdWSei6QADH5u2ts4yZKvDmQCN5gneQUD8PoDpjtP+dnvFe/9vnb58/B+VlukzS/khsPwn18/A1FgHS5IgzvnL98B/7DARAcbEpuP30EpTl2rGAxnv7gYmMwLo6HV9TEWIPAwhhmFu+zn8oJni8iaMav2Nhru04s4HxwFhghHTcD1l03A9dUJEaX0teu9U4tc0bzL+I02VmGMrdYP7Xf1J/AzZyp/maK4iUAAAAAElFTkSuQmCC";

function Action({ label, onPress, secondary = false, disabled = false, children }: {
  label: string; onPress: () => void; secondary?: boolean; disabled?: boolean;
  children?: React.ReactNode;
}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label}
    accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
    style={({ pressed }) => [s.action, secondary && s.secondary, disabled && s.disabled,
      pressed && !disabled && s.pressed]}>
    {children}
    <Text style={[s.actionText, secondary && s.secondaryText]}>{label}</Text>
  </Pressable>;
}

function Entry({ label, value, onChange, placeholder, secret = false, digits = false, maxLength,
  autoComplete }: {
  label: string; value: string; onChange: (next: string) => void; placeholder: string;
  secret?: boolean; digits?: boolean; maxLength?: number;
  autoComplete?: "email" | "username" | "current-password" | "new-password" | "one-time-code";
}) {
  const [visible, setVisible] = useState(false);
  return <View style={s.field}>
    <Text style={s.label}>{label}</Text>
    <View style={s.inputBox}>
      <TextInput style={s.input} value={value} onChangeText={onChange}
        placeholder={placeholder} placeholderTextColor={palette.placeholder}
        accessibilityLabel={label} autoCorrect={false}
        autoComplete={autoComplete} textContentType={secret ? "password" : undefined}
        autoCapitalize="none" keyboardType={digits ? "number-pad" : autoComplete === "email" ? "email-address" : "default"}
        secureTextEntry={secret && !visible} maxLength={maxLength}
      />
      {secret && <Pressable accessibilityRole="button" accessibilityLabel={visible ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
        style={s.eye} onPress={() => setVisible(v => !v)}>
        <Text style={s.eyeText}>{visible ? "Ẩn" : "Hiện"}</Text>
      </Pressable>}
    </View>
  </View>;
}

export function AuthScreen({ onAuthenticated, onGuest }: Props) {
  const { height, width } = useWindowDimensions();
  const compact = height < 750 || width <= 350;
  const veryShort = height < 625;
  const [mode, setMode] = useState<Mode>("login");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [imageFailed, setImageFailed] = useState(false);
  const [googleRequest, googleResponse, googlePrompt] = Google.useIdTokenAuthRequest({
    webClientId: googleWebId || "unconfigured.apps.googleusercontent.com",
    androidClientId: googleAndroidId || "unconfigured.apps.googleusercontent.com",
  });

  function switchMode(next: Mode) {
    setMode(next); setError(""); setInfo(""); setCode(""); setPassword("");
  }

  useEffect(() => {
    if (!googleResponse) return;
    if (googleResponse.type === "error") { setError("Không thể đăng nhập Google."); return; }
    if (googleResponse.type !== "success") return;
    const idToken = googleResponse.params?.id_token;
    if (!idToken) { setError("Google chưa trả về mã xác minh."); return; }
    let disposed = false;
    setBusy(true);
    apiRequest<AuthTokens>("/auth/google", { method: "POST", body: { idToken } })
      .then(async tokens => { if (!disposed) await onAuthenticated(tokens); })
      .catch(e => { if (!disposed) setError(e instanceof Error ? e.message : "Đăng nhập Google thất bại."); })
      .finally(() => { if (!disposed) setBusy(false); });
    return () => { disposed = true; };
  }, [googleResponse, onAuthenticated]);

  async function submit() {
    if (busy) return;
    const problem = mode === "login" || mode === "register"
      ? usernameError(username) || passwordError(password, mode === "register")
      : mode === "forgot" ? emailError(email) : mode === "reset"
        ? emailError(email) || (code.length !== 6 ? "Nhập đúng mã gồm 6 chữ số." : passwordError(password, true))
        : emailError(email) || (code.length !== 6 ? "Nhập đúng mã gồm 6 chữ số." : null);
    if (mode === "register" && !problem && emailError(email)) {
      setError(emailError(email)!); return;
    }
    if (problem) { setError(problem); return; }
    setError(""); setInfo(""); setBusy(true);
    try {
      if (mode === "login") {
        const tokens = await apiRequest<AuthTokens>("/auth/login", {
          method: "POST", body: { username: username.trim(), password },
        });
        await onAuthenticated(tokens);
      } else if (mode === "register") {
        await apiRequest("/auth/register/request-code", {
          method: "POST", body: { username: username.trim(), email: email.trim(), password },
        });
        setInfo("Mã xác minh đã gửi vào email. Kiểm tra cả thư rác.");
        setMode("verify"); setCode("");
      } else if (mode === "verify") {
        const tokens = await apiRequest<AuthTokens>("/auth/register/confirm-code", {
          method: "POST", body: { email: email.trim(), code },
        });
        await onAuthenticated(tokens);
      } else if (mode === "forgot") {
        await apiRequest("/auth/password/request-code", {
          method: "POST", body: { email: email.trim() },
        });
        setInfo("Nếu email đã đăng ký, mã khôi phục sẽ được gửi đến hộp thư.");
        setMode("reset"); setCode("");
      } else {
        await apiRequest("/auth/password/reset", {
          method: "POST", body: { email: email.trim(), code, password },
        });
        switchMode("login");
        setInfo("Đã đổi mật khẩu. Hãy đăng nhập lại.");
      }
    } catch (e) { setError(e instanceof Error ? e.message : "Có lỗi xảy ra, hãy thử lại."); }
    finally { setBusy(false); }
  }

  const login = mode === "login";
  const content = <View style={[s.content, compact && s.compactContent]}>
    <Text style={[s.heading, compact && s.headingCompact]}>
      {mode === "login" ? "Đăng nhập" : mode === "register" ? "Tạo tài khoản"
        : mode === "verify" ? "Xác minh email" : mode === "forgot" ? "Quên mật khẩu" : "Đặt lại mật khẩu"}
    </Text>
    {login || mode === "register" ? (
      <View style={s.tabs}>
        <Pressable accessibilityRole="button" accessibilityLabel="Đăng nhập" style={[s.tab, login && s.tabSelected]}
          onPress={() => switchMode("login")}><Text style={[s.tabText, login && s.tabTextSelected]}>Đăng nhập</Text></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Đăng ký" style={[s.tab, !login && s.tabSelected]}
          onPress={() => switchMode("register")}><Text style={[s.tabText, !login && s.tabTextSelected]}>Đăng ký</Text></Pressable>
      </View>
    ) : <Text style={s.hint}>{mode === "verify" ? "Nhập mã 6 số đã gửi đến " + email
      : "Dùng email đã xác minh để lấy lại mật khẩu."}</Text>}
    {(login || mode === "register") && <Entry label="Tên đăng nhập" value={username} onChange={setUsername}
      placeholder="Tên đăng nhập" autoComplete="username" maxLength={32} />}
    {(mode === "register" || mode === "forgot") && <Entry label="Email" value={email}
      onChange={setEmail} placeholder="vidu@gmail.com" autoComplete="email" maxLength={254} />}
    {(mode === "verify" || mode === "reset") && <Entry label="Mã xác minh (6 số)" value={code}
      onChange={setCode} placeholder="000000" digits maxLength={6} autoComplete="one-time-code" />}
    {(mode === "login" || mode === "register" || mode === "reset") && <Entry
      label={mode === "reset" ? "Mật khẩu mới" : "Mật khẩu"}
      value={password} onChange={setPassword}
      placeholder={mode === "login" ? "Nhập mật khẩu" : "6–8 ký tự, không yêu cầu ký tự đặc biệt"}
      secret maxLength={8} autoComplete={login ? "current-password" : "new-password"} />}
    {login && <Pressable style={s.forgot} accessibilityRole="button" onPress={() => switchMode("forgot")}>
      <Text style={s.link}>Quên mật khẩu?</Text></Pressable>}
    {mode === "register" && <Text style={s.hint}>Mật khẩu 6–8 ký tự bất kỳ. Bắt buộc xác minh email để hoàn tất đăng ký.</Text>}
    {!!error && <Text accessibilityRole="alert" style={s.error}>{error}</Text>}
    {!!info && <Text accessibilityRole="alert" style={s.info}>{info}</Text>}
    <Action label={busy ? "Đang xử lý..." : mode === "login" ? "Đăng nhập"
      : mode === "register" ? "Gửi mã đăng ký" : mode === "verify" ? "Xác nhận mã và tạo tài khoản"
        : mode === "forgot" ? "Gửi mã khôi phục" : "Đổi mật khẩu"}
      disabled={busy} onPress={() => void submit()} />
    {busy && <ActivityIndicator color={palette.red} accessibilityLabel="Đang xử lý" />}
    {login && <>
      <View style={s.divider}><View style={s.rule} /><Text style={s.dividerText}>hoặc</Text><View style={s.rule} /></View>
      <Action label="Tiếp tục với Google" secondary disabled={!googleConfigured || !googleRequest || busy}
        onPress={() => { setError(""); void googlePrompt().catch(() => setError("Không mở được Google.")); }}>
        <Image source={{ uri: googleG }} style={s.googleLogo} accessibilityLabel="Logo Google nhiều màu" />
      </Action>
      {!googleConfigured && <Text style={s.configHint}>Đăng nhập Google đang chờ cấu hình OAuth.</Text>}
      <Pressable accessibilityRole="button" accessibilityLabel="Xem thực đơn mà không cần đăng nhập"
        style={s.guest} onPress={onGuest}><Text style={s.guestText}>Xem thực đơn mà không cần đăng nhập  →</Text></Pressable>
    </>}
    {!login && <Pressable accessibilityRole="button" style={s.back} onPress={() => switchMode(mode === "reset" ? "forgot" : "login")}>
      <Text style={s.link}>← Quay lại {mode === "reset" ? "quên mật khẩu" : "đăng nhập"}</Text>
    </Pressable>}
  </View>;
  return <KeyboardAvoidingView style={s.root} behavior={Platform.OS === "ios" ? "padding" : undefined}>
    <View style={[s.frame, { maxWidth: 510 }]}>
      <View style={[s.hero, { height: login ? Math.max(92, Math.min(180, height * (veryShort ? 0.17 : 0.21))) : 116 }]}>
        {imageFailed ? <View style={s.heroFallback}><Text style={s.fallbackSymbol}>♨</Text></View>
          : <Image source={{ uri: heroUrl }} style={s.heroImage} resizeMode="cover"
              accessibilityLabel="Ảnh lẩu Tứ Xuyên" onError={() => setImageFailed(true)} />}
        <View style={s.heroOverlay}>
          <Text style={s.logoTitle}>SICHUAN HOTPOT</Text>
          <Text style={s.logoSub}>LẨU TỨ XUYÊN & TRÀ SỮA</Text>
        </View>
      </View>
      {login ? <View style={s.loginNoScroll}>{content}</View>
        : <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}
            contentContainerStyle={s.scrolling}>{content}</ScrollView>}
    </View>
  </KeyboardAvoidingView>;
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.white },
  frame: { flex: 1, width: "100%", alignSelf: "center", backgroundColor: palette.white },
  hero: { width: "100%", overflow: "hidden", backgroundColor: palette.red },
  heroImage: { width: "100%", height: "100%" },
  heroFallback: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: palette.red },
  fallbackSymbol: { color: palette.white, fontSize: 62 },
  heroOverlay: { position: "absolute", top: 0, bottom: 0, left: 0, right: 0,
    justifyContent: "flex-end", paddingHorizontal: 20, paddingBottom: 13,
    backgroundColor: "rgba(80,0,0,0.36)" },
  logoTitle: { fontSize: 21, fontWeight: "900", color: palette.white, letterSpacing: 0.8 },
  logoSub: { fontSize: 11, fontWeight: "800", color: palette.white, letterSpacing: 1.3 },
  loginNoScroll: { flex: 1, justifyContent: "center", minHeight: 0 },
  scrolling: { flexGrow: 1, justifyContent: "center", paddingBottom: 16 },
  content: { width: "100%", paddingHorizontal: 20, gap: 9 },
  compactContent: { gap: 6, paddingHorizontal: 16 },
  heading: { color: palette.text, fontWeight: "900", fontSize: 25, textAlign: "center", marginBottom: 1 },
  headingCompact: { fontSize: 22 },
  tabs: { flexDirection: "row", borderRadius: 10, backgroundColor: palette.softRed, padding: 3 },
  tab: { flex: 1, minHeight: 37, justifyContent: "center", alignItems: "center", borderRadius: 8 },
  tabSelected: { backgroundColor: palette.red },
  tabText: { fontSize: 14, fontWeight: "800", color: palette.red },
  tabTextSelected: { color: palette.white },
  field: { gap: 4 },
  label: { color: palette.text, fontSize: 13, fontWeight: "700" },
  inputBox: { minHeight: 44, backgroundColor: palette.white, borderColor: palette.line,
    borderRadius: 10, borderWidth: 1, flexDirection: "row", alignItems: "center" },
  input: { color: palette.text, paddingHorizontal: 12, fontSize: 16, minHeight: 42,
    flex: 1, paddingVertical: 6 },
  eye: { minWidth: 44, minHeight: 42, justifyContent: "center", alignItems: "center" },
  eyeText: { color: palette.red, fontWeight: "700", fontSize: 12 },
  action: { backgroundColor: palette.red, borderRadius: 11, minHeight: 46,
    justifyContent: "center", alignItems: "center", flexDirection: "row", gap: 10, paddingHorizontal: 13 },
  actionText: { color: palette.white, fontWeight: "800", fontSize: 15 },
  secondary: { backgroundColor: palette.white, borderWidth: 1, borderColor: palette.line },
  secondaryText: { color: palette.text },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.8 },
  googleLogo: { width: 24, height: 24 },
  divider: { flexDirection: "row", alignItems: "center", gap: 10 },
  rule: { flex: 1, height: 1, backgroundColor: palette.line },
  dividerText: { color: palette.muted, fontSize: 12 },
  forgot: { alignSelf: "flex-end", minHeight: 26, justifyContent: "center" },
  link: { color: palette.red, fontSize: 13, fontWeight: "700" },
  guest: { minHeight: 39, alignSelf: "center", justifyContent: "center" },
  guestText: { color: palette.red, fontWeight: "800", fontSize: 13, textAlign: "center" },
  configHint: { color: palette.muted, fontSize: 11, textAlign: "center" },
  back: { minHeight: 44, alignSelf: "center", justifyContent: "center" },
  hint: { fontSize: 12, lineHeight: 18, color: palette.muted, textAlign: "center" },
  error: { color: palette.red, fontSize: 12, lineHeight: 17, textAlign: "center" },
  info: { color: "#117A3F", fontSize: 12, textAlign: "center" },
});
