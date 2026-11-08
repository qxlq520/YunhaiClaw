import { createApp } from "vue";
import App from "./App.vue";
import { router } from "./router";
import { initApp } from "./lib/store";
import "./styles/theme.css";

initApp();

createApp(App).use(router).mount("#app");
