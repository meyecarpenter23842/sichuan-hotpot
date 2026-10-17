import {
  BadRequestException, ConflictException, ForbiddenException, HttpException,
  Injectable, NotFoundException, ServiceUnavailableException,
} from "@nestjs/common";
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { GoogleAuth } from "google-auth-library";
import { AuthService } from "../auth/auth.service";
import { PrismaService } from "../database/prisma.service";

const ZALO_PHONE = "0902964685";
const CHAT_NAME = "Hỗ trợ Lẩu Tứ Xuyên";
const WELCOME_MESSAGE = "Xin chào! Tôi có thể giúp bạn chọn món, xem thông tin sản phẩm và giải đáp các câu hỏi về cửa hàng.";
const GOOGLE_SCOPE = "https://www.googleapis.com/auth/cloud-platform";
const CX_LOCATIONS = [
  "global", "us-central1", "northamerica-northeast1", "us-east1", "us-west1", "us",
  "europe-west1", "europe-west2", "europe-west3", "europe-west4", "europe-west6", "eu",
  "australia-southeast1", "asia-northeast1", "asia-south1", "asia-southeast1", "asia-southeast2",
] as const;

interface StoredCredentials {
  type: "service_account";
  project_id: string;
  client_email: string;
  private_key: string;
}
interface CredentialRecord {
  projectId: string | null;
  credentialCiphertext: string | null;
  credentialIv: string | null;
  credentialTag: string | null;
}
export interface ChatbotConfigInput {
  revision: number;
  enabled: boolean;
  zaloEnabled: boolean;
  agentResourceName: string;
  environmentResourceName: string;
}
interface AgentItem {
  name: string;
  displayName: string;
  location: string;
  defaultLanguageCode: string;
}
interface EnvironmentItem {
  name: string;
  displayName: string;
}
class GoogleCxError extends Error {
  constructor(readonly status: number) {
    super("Google Dialogflow CX request failed");
  }
}

function parseServiceAccount(raw: string): StoredCredentials {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new BadRequestException("File JSON Google không hợp lệ."); }
  if (!parsed || typeof parsed !== "object") throw new BadRequestException("File JSON Google không hợp lệ.");
  const value = parsed as Record<string, unknown>;
  const type = value.type;
  const projectId = value.project_id;
  const clientEmail = value.client_email;
  const privateKey = value.private_key;
  if (type !== "service_account" || typeof projectId !== "string"
      || typeof clientEmail !== "string" || typeof privateKey !== "string") {
    throw new BadRequestException("JSON phải là Service Account của Google Cloud.");
  }
  const cleanProject = projectId.trim();
  const cleanEmail = clientEmail.trim();
  if (!/^[a-z][a-z0-9-]{4,126}[a-z0-9]$/.test(cleanProject)
      || cleanEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)
      || privateKey.length < 100 || privateKey.length > 12000
      || !privateKey.includes("BEGIN PRIVATE KEY")) {
    throw new BadRequestException("Service Account JSON thiếu project, email hoặc private key hợp lệ.");
  }
  return { type: "service_account", project_id: cleanProject, client_email: cleanEmail, private_key: privateKey };
}

function agentParts(resource: string): { projectId: string; location: string; agentId: string } | null {
  const match = resource.match(/^projects\/([^/]+)\/locations\/([^/]+)\/agents\/([^/]+)$/);
  return match ? { projectId: match[1]!, location: match[2]!, agentId: match[3]! } : null;
}
function cleanOptional(value: string): string | null {
  const clean = value.trim();
  return clean ? clean : null;
}

@Injectable()
export class ChatbotService {
  private readonly tokenCache = new Map<string, { projectId: string; token: string; expiresAt: number }>();
  private readonly chatRate = new Map<string, { startedAt: number; count: number }>();

  constructor(private readonly prisma: PrismaService, private readonly auth: AuthService) {}
  private get db() { return this.prisma.database; }

  private async branch(branchId: string) {
    const row = await this.db.branch.findUnique({ where: { id: branchId }, select: { id: true } });
    if (!row) throw new NotFoundException("BRANCH_NOT_FOUND");
  }
  private async owner(authorization: string | undefined, branchId: string) {
    const principal = await this.auth.principal(authorization);
    if (principal.role !== "OWNER") throw new ForbiddenException("OWNER_REQUIRED");
    await this.branch(branchId);
  }

  private encryptionKey(): Buffer {
    const root = process.env.AUTH_JWT_SECRET;
    if (!root || Buffer.byteLength(root, "utf8") < 32) {
      throw new ServiceUnavailableException("Chatbot encryption unavailable");
    }
    return Buffer.from(hkdfSync("sha256", Buffer.from(root, "utf8"),
      Buffer.from("sichuan-hotpot", "utf8"), Buffer.from("dialogflow-cx-credentials:v1", "utf8"), 32));
  }
  private encrypt(credentials: StoredCredentials) {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.encryptionKey(), iv);
    const plaintext = Buffer.from(JSON.stringify(credentials), "utf8");
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return {
      credentialCiphertext: ciphertext.toString("base64"),
      credentialIv: iv.toString("base64"),
      credentialTag: cipher.getAuthTag().toString("base64"),
    };
  }
  private decrypt(row: CredentialRecord): StoredCredentials {
    if (!row.credentialCiphertext || !row.credentialIv || !row.credentialTag) {
      throw new ConflictException("Chưa tải Service Account JSON cho chatbot.");
    }
    try {
      const decipher = createDecipheriv("aes-256-gcm", this.encryptionKey(), Buffer.from(row.credentialIv, "base64"));
      decipher.setAuthTag(Buffer.from(row.credentialTag, "base64"));
      const clear = Buffer.concat([
        decipher.update(Buffer.from(row.credentialCiphertext, "base64")), decipher.final(),
      ]).toString("utf8");
      return parseServiceAccount(clear);
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new ServiceUnavailableException("Không giải mã được cấu hình chatbot.");
    }
  }

  private async accessToken(credentials: StoredCredentials, cacheKey: string): Promise<string> {
    const cached = this.tokenCache.get(cacheKey);
    if (cached && cached.projectId === credentials.project_id && cached.expiresAt > Date.now()) return cached.token;
    try {
      const google = new GoogleAuth({
        credentials: {
          project_id: credentials.project_id,
          client_email: credentials.client_email,
          private_key: credentials.private_key,
        },
        scopes: [GOOGLE_SCOPE],
      });
      const client = await google.getClient();
      const result = await client.getAccessToken();
      const token = typeof result === "string" ? result : result.token;
      if (!token) throw new Error("NO_GOOGLE_TOKEN");
      this.tokenCache.set(cacheKey, { projectId: credentials.project_id, token, expiresAt: Date.now() + 45 * 60 * 1000 });
      return token;
    } catch {
      throw new ServiceUnavailableException("Không xác thực được Service Account Google.");
    }
  }
  private host(location: string): string {
    return location === "global" ? "https://dialogflow.googleapis.com"
      : "https://" + location + "-dialogflow.googleapis.com";
  }
  private async googleJson(url: string, token: string, projectId: string,
    method: "GET" | "POST" = "GET", body?: unknown): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(url, {
        method, signal: controller.signal,
        headers: {
          Accept: "application/json",
          Authorization: "Bearer " + token,
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (!response.ok) throw new GoogleCxError(response.status);
      return await response.json();
    } catch (error) {
      if (error instanceof GoogleCxError) throw error;
      throw new GoogleCxError(503);
    } finally {
      clearTimeout(timer);
    }
  }

  private async scanAgents(credentials: StoredCredentials, token: string): Promise<AgentItem[]> {
    const found: AgentItem[] = [];
    let successCount = 0;
    await Promise.all(CX_LOCATIONS.map(async location => {
      const base = this.host(location);
      try {
        const raw = await this.googleJson(
          base + "/v3/projects/" + encodeURIComponent(credentials.project_id)
            + "/locations/" + encodeURIComponent(location) + "/agents?pageSize=1000",
          token, credentials.project_id,
        ) as { agents?: Array<{ name?: unknown; displayName?: unknown; defaultLanguageCode?: unknown }> };
        successCount += 1;
        for (const agent of raw.agents ?? []) {
          if (typeof agent.name !== "string" || typeof agent.displayName !== "string") continue;
          const parts = agentParts(agent.name);
          if (!parts || parts.projectId !== credentials.project_id || parts.location !== location) continue;
          found.push({
            name: agent.name,
            displayName: agent.displayName,
            location,
            defaultLanguageCode: typeof agent.defaultLanguageCode === "string" && agent.defaultLanguageCode
              ? agent.defaultLanguageCode : "vi",
          });
        }
      } catch {
        // A project can legitimately have no access in some regional endpoints.
      }
    }));
    if (successCount === 0) {
      throw new ServiceUnavailableException("Service Account chưa có quyền đọc Dialogflow CX hoặc API chưa được bật.");
    }
    return found.sort((a, b) => a.displayName.localeCompare(b.displayName, "vi") || a.location.localeCompare(b.location));
  }

  private adminPayload(row: Awaited<ReturnType<typeof this.db.chatbotConfig.findUnique>>) {
    return {
      enabled: row?.enabled ?? false,
      zaloEnabled: row?.zaloEnabled ?? true,
      zaloPhone: ZALO_PHONE,
      displayName: CHAT_NAME,
      welcomeMessage: WELCOME_MESSAGE,
      projectId: row?.projectId ?? null,
      credentialsConfigured: !!(row?.credentialCiphertext && row.credentialIv && row.credentialTag),
      agentResourceName: row?.agentResourceName ?? null,
      agentDisplayName: row?.agentDisplayName ?? null,
      agentLocation: row?.agentLocation ?? null,
      defaultLanguageCode: row?.defaultLanguageCode ?? null,
      environmentResourceName: row?.environmentResourceName ?? null,
      environmentDisplayName: row?.environmentDisplayName ?? null,
      revision: row?.revision ?? 0,
    };
  }

  async publicGet(branchId: string) {
    await this.branch(branchId);
    const row = await this.db.chatbotConfig.findUnique({ where: { branchId } });
    const configured = !!(row?.credentialCiphertext && row.credentialIv && row.credentialTag && row.agentResourceName);
    return {
      enabled: row?.enabled === true && configured,
      configured,
      zaloEnabled: row?.zaloEnabled ?? true,
      zaloPhone: ZALO_PHONE,
      displayName: CHAT_NAME,
      welcomeMessage: WELCOME_MESSAGE,
    };
  }
  async adminGet(authorization: string | undefined, branchId: string) {
    await this.owner(authorization, branchId);
    return this.adminPayload(await this.db.chatbotConfig.findUnique({ where: { branchId } }));
  }

  async saveCredentials(authorization: string | undefined, branchId: string, rawJson: string) {
    await this.owner(authorization, branchId);
    const credentials = parseServiceAccount(rawJson);
    let token: string;
    try { token = await this.accessToken(credentials, "upload:" + branchId); }
    catch { throw new BadRequestException("Không xác thực được Service Account Google."); }
    let agents: AgentItem[];
    try { agents = await this.scanAgents(credentials, token); }
    catch { throw new BadRequestException("Service Account chưa đọc được Dialogflow CX. Kiểm tra IAM và Dialogflow API."); }
    const encrypted = this.encrypt(credentials);
    this.tokenCache.delete(branchId);
    this.tokenCache.delete("upload:" + branchId);
    const saved = await this.db.chatbotConfig.upsert({
      where: { branchId },
      create: { branchId, projectId: credentials.project_id, ...encrypted },
      update: {
        projectId: credentials.project_id, ...encrypted, enabled: false,
        agentResourceName: null, agentDisplayName: null, agentLocation: null,
        defaultLanguageCode: null, environmentResourceName: null, environmentDisplayName: null,
        revision: { increment: 1 },
      },
    });
    return { config: this.adminPayload(saved), agents };
  }

  async listAgents(authorization: string | undefined, branchId: string) {
    await this.owner(authorization, branchId);
    const row = await this.db.chatbotConfig.findUnique({ where: { branchId } });
    if (!row) throw new ConflictException("Chưa tải Service Account JSON cho chatbot.");
    const credentials = this.decrypt(row);
    const token = await this.accessToken(credentials, branchId);
    return { agents: await this.scanAgents(credentials, token) };
  }

  async listEnvironments(authorization: string | undefined, branchId: string, agentResourceName: string) {
    await this.owner(authorization, branchId);
    const row = await this.db.chatbotConfig.findUnique({ where: { branchId } });
    if (!row) throw new ConflictException("Chưa tải Service Account JSON cho chatbot.");
    const credentials = this.decrypt(row);
    const parts = agentParts(agentResourceName);
    if (!parts || parts.projectId !== credentials.project_id || !CX_LOCATIONS.includes(parts.location as typeof CX_LOCATIONS[number])) {
      throw new BadRequestException("Agent không thuộc project Dialogflow CX đã tải.");
    }
    const token = await this.accessToken(credentials, branchId);
    const raw = await this.googleJson(
      this.host(parts.location) + "/v3/" + agentResourceName + "/environments?pageSize=100",
      token, credentials.project_id,
    ) as { environments?: Array<{ name?: unknown; displayName?: unknown }> };
    const environments: EnvironmentItem[] = [];
    for (const env of raw.environments ?? []) {
      if (typeof env.name === "string" && typeof env.displayName === "string"
          && env.name.startsWith(agentResourceName + "/environments/")) {
        environments.push({ name: env.name, displayName: env.displayName });
      }
    }
    return { environments: environments.sort((a, b) => a.displayName.localeCompare(b.displayName, "vi")) };
  }

  private async verifiedAgent(credentials: StoredCredentials, token: string, resource: string) {
    const parts = agentParts(resource);
    if (!parts || parts.projectId !== credentials.project_id
        || !CX_LOCATIONS.includes(parts.location as typeof CX_LOCATIONS[number])) {
      throw new BadRequestException("Agent không thuộc project Dialogflow CX đã tải.");
    }
    const raw = await this.googleJson(this.host(parts.location) + "/v3/" + resource,
      token, credentials.project_id) as { name?: unknown; displayName?: unknown; defaultLanguageCode?: unknown };
    if (raw.name !== resource || typeof raw.displayName !== "string") {
      throw new BadRequestException("Không xác minh được Agent Dialogflow CX.");
    }
    return {
      name: resource,
      displayName: raw.displayName,
      location: parts.location,
      defaultLanguageCode: typeof raw.defaultLanguageCode === "string" && raw.defaultLanguageCode
        ? raw.defaultLanguageCode : "vi",
    };
  }
  private async verifiedEnvironment(credentials: StoredCredentials, token: string,
    agentResourceName: string, environmentResourceName: string) {
    if (!environmentResourceName.startsWith(agentResourceName + "/environments/")) {
      throw new BadRequestException("Environment không thuộc Agent đã chọn.");
    }
    const parts = agentParts(agentResourceName)!;
    const raw = await this.googleJson(this.host(parts.location) + "/v3/" + environmentResourceName,
      token, credentials.project_id) as { name?: unknown; displayName?: unknown };
    if (raw.name !== environmentResourceName || typeof raw.displayName !== "string") {
      throw new BadRequestException("Không xác minh được Environment Dialogflow CX.");
    }
    return { name: environmentResourceName, displayName: raw.displayName };
  }

  async updateConfig(authorization: string | undefined, branchId: string, input: ChatbotConfigInput) {
    await this.owner(authorization, branchId);
    const current = await this.db.chatbotConfig.findUnique({ where: { branchId } });
    if (!current) {
      if (input.revision !== 0) throw new ConflictException("CHATBOT_CONFIG_CHANGED_RELOAD");
      if (input.enabled || cleanOptional(input.agentResourceName)) {
        throw new ConflictException("Tải Service Account JSON trước khi bật chatbot.");
      }
      const created = await this.db.chatbotConfig.create({
        data: { branchId, enabled: false, zaloEnabled: input.zaloEnabled },
      });
      return this.adminPayload(created);
    }
    if (current.revision !== input.revision) throw new ConflictException("CHATBOT_CONFIG_CHANGED_RELOAD");

    const agentResourceName = cleanOptional(input.agentResourceName);
    const environmentResourceName = cleanOptional(input.environmentResourceName);
    let agentDisplayName: string | null = null;
    let agentLocation: string | null = null;
    let defaultLanguageCode: string | null = null;
    let environmentDisplayName: string | null = null;

    if (agentResourceName) {
      const credentials = this.decrypt(current);
      if (agentResourceName === current.agentResourceName) {
        agentDisplayName = current.agentDisplayName;
        agentLocation = current.agentLocation;
        defaultLanguageCode = current.defaultLanguageCode;
      } else {
        const token = await this.accessToken(credentials, branchId);
        const agent = await this.verifiedAgent(credentials, token, agentResourceName);
        agentDisplayName = agent.displayName;
        agentLocation = agent.location;
        defaultLanguageCode = agent.defaultLanguageCode;
      }
      if (environmentResourceName) {
        if (environmentResourceName === current.environmentResourceName
            && agentResourceName === current.agentResourceName) {
          environmentDisplayName = current.environmentDisplayName;
        } else {
          const token = await this.accessToken(credentials, branchId);
          const env = await this.verifiedEnvironment(credentials, token, agentResourceName, environmentResourceName);
          environmentDisplayName = env.displayName;
        }
      }
    } else if (environmentResourceName) {
      throw new BadRequestException("Chọn Agent trước khi chọn Environment.");
    }
    if (input.enabled && (!agentResourceName || !current.credentialCiphertext)) {
      throw new ConflictException("Chọn Agent Dialogflow CX trước khi bật chatbot.");
    }

    const updated = await this.db.chatbotConfig.updateMany({
      where: { branchId, revision: input.revision },
      data: {
        enabled: input.enabled, zaloEnabled: input.zaloEnabled,
        agentResourceName, agentDisplayName, agentLocation, defaultLanguageCode,
        environmentResourceName, environmentDisplayName,
        revision: { increment: 1 },
      },
    });
    if (updated.count !== 1) throw new ConflictException("CHATBOT_CONFIG_CHANGED_RELOAD");
    return this.adminPayload(await this.db.chatbotConfig.findUniqueOrThrow({ where: { branchId } }));
  }

  private checkRate(branchId: string, sessionId: string) {
    const key = branchId + ":" + sessionId;
    const now = Date.now();
    const current = this.chatRate.get(key);
    if (!current || now - current.startedAt >= 60000) {
      this.chatRate.set(key, { startedAt: now, count: 1 });
      if (this.chatRate.size > 2000) {
        for (const [entry, value] of this.chatRate) {
          if (now - value.startedAt > 120000) this.chatRate.delete(entry);
        }
      }
      return;
    }
    if (current.count >= 20) throw new HttpException("Bạn gửi tin nhắn quá nhanh. Vui lòng thử lại sau.", 429);
    current.count += 1;
  }

  async message(branchId: string, sessionId: string, textInput: string) {
    await this.branch(branchId);
    const row = await this.db.chatbotConfig.findUnique({ where: { branchId } });
    if (!row?.enabled || !row.agentResourceName || !row.credentialCiphertext) {
      throw new ServiceUnavailableException("Chatbot đang tạm nghỉ.");
    }
    this.checkRate(branchId, sessionId);
    const text = textInput.trim();
    if (!text) throw new BadRequestException("Tin nhắn không được để trống.");
    const credentials = this.decrypt(row);
    const parts = agentParts(row.agentResourceName);
    if (!parts || parts.projectId !== credentials.project_id) {
      throw new ServiceUnavailableException("Cấu hình chatbot không hợp lệ.");
    }
    const token = await this.accessToken(credentials, branchId);
    const sessionParent = row.environmentResourceName || row.agentResourceName;
    const url = this.host(parts.location) + "/v3/" + sessionParent + "/sessions/"
      + encodeURIComponent(sessionId) + ":detectIntent";
    let raw: unknown;
    try {
      raw = await this.googleJson(url, token, credentials.project_id, "POST", {
        queryInput: { text: { text }, languageCode: row.defaultLanguageCode || "vi" },
        queryParams: { timeZone: "Asia/Ho_Chi_Minh" },
      });
    } catch {
      throw new ServiceUnavailableException("Chatbot Google đang bận. Vui lòng thử lại hoặc liên hệ Zalo.");
    }
    const body = raw as {
      queryResult?: { responseMessages?: Array<{ text?: { text?: unknown[] } }> }
    };
    const pieces: string[] = [];
    for (const message of body.queryResult?.responseMessages ?? []) {
      for (const value of message.text?.text ?? []) {
        if (typeof value === "string" && value.trim()) pieces.push(value.trim());
      }
    }
    return {
      reply: pieces.join("\n").trim()
        || "Xin lỗi, tôi chưa có câu trả lời phù hợp. Bạn có thể liên hệ Zalo để được hỗ trợ.",
    };
  }
}
