// src/cesiumIon.ts
import { Ion } from "cesium";

// Use a Vite env var. Put your token in .env.local as VITE_CESIUM_ION_TOKEN="...".
Ion.defaultAccessToken = import.meta.env.VITE_CESIUM_ION_TOKEN || "";