import "./dayjs";
import { createApp } from "vue";
import { createPinia } from "pinia";
import "inter-ui/inter-variable.css";
import "./styles.css";
import App from "./App.vue";
import { router } from "./router";
import "cesium/Build/Cesium/Widgets/widgets.css";
import "./cesiumIon"; // sets Ion.defaultAccessToken

createApp(App).use(router).use(createPinia()).mount("#app");
