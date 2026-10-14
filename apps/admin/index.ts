import { registerRootComponent } from "expo";
import AdminApp from "./App";
import { configureAdminViewport } from "./src/pwa-viewport";
import { Platform } from "react-native";

if (Platform.OS === "web") configureAdminViewport();
registerRootComponent(AdminApp);
