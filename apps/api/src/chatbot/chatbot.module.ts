import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { PrismaModule } from "../database/prisma.module";
import { AdminChatbotController, PublicChatbotController } from "./chatbot.controller";
import { ChatbotService } from "./chatbot.service";

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [PublicChatbotController, AdminChatbotController],
  providers: [ChatbotService],
})
export class ChatbotModule {}
