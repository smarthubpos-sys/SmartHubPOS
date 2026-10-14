import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { fileURLToPath } from "node:url";
export default defineConfig({ plugins:[react(),tailwindcss()], resolve:{alias:[{find:"@/convex",replacement:path.resolve(path.dirname(fileURLToPath(import.meta.url)),"convex")},{find:"@",replacement:path.resolve(path.dirname(fileURLToPath(import.meta.url)),"src")}] }, server:{host:"0.0.0.0"}, build:{chunkSizeWarningLimit:1000} });
