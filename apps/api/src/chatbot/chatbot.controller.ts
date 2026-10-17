import { Body, Controller, Get, Header, Headers, Param, ParseUUIDPipe, Post, Put } from "@nestjs/common";
import { IsBoolean, IsInt, IsString, Matches, MaxLength, Min, MinLength } from "class-validator";
import { ChatbotService } from "./chatbot.service";

const uuid = new ParseUUIDPipe({ version: "4" });

class CredentialUpload {
  @IsString() @MinLength(20) @MaxLength(32768)
  serviceAccountJson!: string;
}
class AgentEnvironmentsInput {
  @IsString() @MaxLength(512)
  @Matches(/^projects\/[^/]+\/locations\/[^/]+\/agents\/[^/]+$/)
  agentResourceName!: string;
}
class ChatbotConfigPut {
  @IsInt() @Min(0) revision!: number;
  @IsBoolean() enabled!: boolean;
  @IsBoolean() zaloEnabled!: boolean;
  @IsString() @MaxLength(512) agentResourceName!: string;
  @IsString() @MaxLength(512) environmentResourceName!: string;
}
class ChatMessageInput {
  @IsString() @Matches(/^[A-Za-z0-9_-]{12,36}$/)
  sessionId!: string;
  @IsString() @MinLength(1) @MaxLength(500)
  text!: string;
}

@Controller("catalog/branches/:branchId/chatbot")
export class PublicChatbotController {
  constructor(private readonly chatbot: ChatbotService) {}

  @Get()
  @Header("Cache-Control", "no-store")
  get(@Param("branchId", uuid) branchId: string) {
    return this.chatbot.publicGet(branchId);
  }

  @Post("message")
  @Header("Cache-Control", "no-store")
  message(@Param("branchId", uuid) branchId: string, @Body() input: ChatMessageInput) {
    return this.chatbot.message(branchId, input.sessionId, input.text);
  }
}

@Controller("admin/branches/:branchId/chatbot")
export class AdminChatbotController {
  constructor(private readonly chatbot: ChatbotService) {}

  @Get()
  @Header("Cache-Control", "no-store")
  get(@Headers("authorization") auth: string | undefined, @Param("branchId", uuid) branchId: string) {
    return this.chatbot.adminGet(auth, branchId);
  }

  @Put("credentials")
  upload(@Headers("authorization") auth: string | undefined, @Param("branchId", uuid) branchId: string,
    @Body() input: CredentialUpload) {
    return this.chatbot.saveCredentials(auth, branchId, input.serviceAccountJson);
  }

  @Post("agents")
  agents(@Headers("authorization") auth: string | undefined, @Param("branchId", uuid) branchId: string) {
    return this.chatbot.listAgents(auth, branchId);
  }

  @Post("environments")
  environments(@Headers("authorization") auth: string | undefined, @Param("branchId", uuid) branchId: string,
    @Body() input: AgentEnvironmentsInput) {
    return this.chatbot.listEnvironments(auth, branchId, input.agentResourceName);
  }

  @Put("config")
  config(@Headers("authorization") auth: string | undefined, @Param("branchId", uuid) branchId: string,
    @Body() input: ChatbotConfigPut) {
    return this.chatbot.updateConfig(auth, branchId, input);
  }
}
