import type { INestApplication } from "@nestjs/common";
import { ValidationPipe } from "@nestjs/common";
import helmet from "helmet";
import { ApiExceptionFilter } from "./http/api-exception.filter";

export function configureApp(app: INestApplication): void {
  app.use(helmet());
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    forbidUnknownValues: true,
    validationError: { target: false, value: false },
  }));
  app.useGlobalFilters(new ApiExceptionFilter());
}
