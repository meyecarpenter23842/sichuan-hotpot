import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { CustomerAddressesController } from "./customer-addresses.controller";

@Module({ imports: [AuthModule], controllers: [CustomerAddressesController] })
export class CustomerAddressesModule {}
