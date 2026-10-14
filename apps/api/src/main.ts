import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { configureApp } from "./bootstrap";
import { OrderRealtimeService } from "./orders/order-realtime.service";

async function main(): Promise<void> {
  const rawPort = process.env.PORT ?? "3000";
  const port = Number(rawPort);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new Error("Invalid PORT");
  }
  const app = await NestFactory.create(AppModule);
  configureApp(app);
  app.get(OrderRealtimeService).attach(app.getHttpServer());
  app.enableShutdownHooks();
  await app.listen(port, process.env.HOST ?? "127.0.0.1");
}

void main().catch(() => {
  // Never print environment variables or exception payloads at process startup.
  console.error("API startup failed; inspect sanitized service diagnostics");
  process.exitCode = 1;
});
