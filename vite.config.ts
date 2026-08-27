import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import laravel from "laravel-vite-plugin";
import { defineConfig } from "vite";

export default defineConfig({
    plugins: [
        laravel({
            input: ["resources/css/app.css", "resources/js/app.tsx"],
            refresh: true,
        }),
        react(),
        tailwindcss(),
    ],
    server: {
        host: "0.0.0.0",
        port: 5175,
        // Native FS events do not cross a macOS bind mount into Linux; without
        // polling the watcher dies with FSWatcher EINVAL and takes the dev
        // server with it (priest-liturgy's known-gaps.md).
        watch: { usePolling: true, interval: 300 },
        hmr: { host: "localhost" },
    },
});
