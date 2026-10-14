import { registerRootComponent } from "expo";
import CustomerApp from "./App";
import { configureCustomerViewport } from "./src/pwa-viewport";
import { Platform } from "react-native";

if (Platform.OS === "web") configureCustomerViewport();
registerRootComponent(CustomerApp);
