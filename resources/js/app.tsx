import "../css/app.css";

import { createInertiaApp, type ResolvedComponent } from "@inertiajs/react";
import { resolvePageComponent } from "laravel-vite-plugin/inertia-helpers";
import { createRoot } from "react-dom/client";
import type { route as routeFn } from "ziggy-js";
import { initializeTheme } from "./hooks/use-appearance";

declare global {
    const route: typeof routeFn;
}

const appName = import.meta.env.VITE_APP_NAME || "Laravel";

createInertiaApp({
    title: (title) => `${title} - ${appName}`,
    resolve: (name): Promise<ResolvedComponent> =>
        resolvePageComponent(
            `./pages/${name}.tsx`,
            // Exclude co-located test files. If this glob is ever switched to
            // `eager: true` (or a test file otherwise gets matched eagerly), an
            // eager import runs every matched module's top-level code at
            // startup, and a *.test.tsx's vi.mock() call throws before
            // anything renders -- taking down every page while the test
            // suites stay green (dreamtube's app.tsx hit this).
            import.meta.glob<ResolvedComponent>(["./pages/**/*.tsx", "!./pages/**/*.test.tsx"]),
        ),
    setup({ el, App, props }) {
        const root = createRoot(el);

        root.render(<App {...props} />);
    },
    progress: {
        color: "#4B5563",
    },
});

// This will set light / dark mode on load...
initializeTheme();
