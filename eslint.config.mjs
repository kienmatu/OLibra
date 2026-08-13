import next from "eslint-config-next";

/**
 * eslint-config-next v16 ships a native flat config array, so it is spread
 * directly — no @eslint/eslintrc FlatCompat wrapper, which breaks under
 * ESLint 10.
 */
const config = [
  {
    /**
     * `.claude/**` is not source. Claude Code puts each session's git worktree
     * under `.claude/worktrees/<name>/`, and a worktree that has been run at
     * all carries its own `.next/` build output — hundreds of generated
     * chunks, minified and full of `eval`, which ESLint then tries to parse
     * with the TypeScript rules this config only ever meant for `src/`. The
     * result is a few hundred errors of the shape "Definition for rule
     * '@typescript-eslint/no-unused-vars' was not found" and `bun run check`
     * red for a reason that has nothing to do with the branch under it.
     *
     * The existing `.next/**` entry does not cover it: a leading-segment
     * pattern anchors to this config file's directory, so it matches the
     * repository's own build output and not a nested one several levels down.
     * Ignoring the whole directory rather than `.claude/worktrees/**\/.next/**`
     * is deliberate — nothing under `.claude/` is ours to lint, and a narrower
     * pattern would need widening again the first time a session writes
     * something else in there.
     */
    ignores: [
      ".next/**",
      ".claude/**",
      "out/**",
      "build/**",
      "node_modules/**",
      "next-env.d.ts",
    ],
  },
  ...next,
  {
    rules: {
      // Vietnamese prose is full of apostrophes and quotation marks; escaping
      // them in JSX costs more readability than it buys.
      "react/no-unescaped-entities": "off",
    },
  },
  {
    files: ["src/domain/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              // `@/app/*` catches the alias form. `**/app/*` additionally
              // catches a relative reach-up (`../../app/layout`), which the
              // alias pattern does not: G1 forbids reaching into src/app
              // regardless of how the specifier is spelled, and a relative
              // reach-up is exactly what an editor autocompletes.
              group: [
                "next",
                "next/*",
                "react",
                "react-dom",
                "@/app/*",
                "**/app/*",
              ],
              message:
                "The domain layer imports no framework (SDD §3.1). Move this to src/app/ and call the domain from there.",
            },
          ],
        },
      ],
      // G9 backstop for globals: no-restricted-imports only ever covers
      // import specifiers, so a bare `Bun.file(...)` call (no import at all)
      // sails through it untouched. Today the only thing that actually catches
      // that is `tsc` failing with TS2867 ("Cannot find name 'Bun'") — which
      // holds only because @types/bun is not installed; installing it would
      // silently remove that protection. This rule is the real backstop.
      "no-restricted-globals": [
        "error",
        {
          name: "Bun",
          message:
            "G9. The domain layer must stay runnable under a plain test runner (build and tests run on Node); no Bun-specific globals here.",
        },
      ],
    },
  },
];

export default config;
