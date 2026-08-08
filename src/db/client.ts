import postgres, { type Sql } from "postgres";

/**
 * The one place that knows how to reach the database.
 *
 * `DATABASE_URL` is configuration and nothing else (SDD §8) — no code here
 * cares whether Postgres runs in the compose file or somewhere managed.
 */
export function connect(url = process.env.DATABASE_URL): Sql {
  if (!url) throw new Error("DATABASE_URL is not set");
  return postgres(url, {
    // Transaction-mode pooling is compatible with `set local`, which RLS
    // needs (DB §3). Session-mode is not. Recorded here because the failure,
    // if this is ever changed, is silent cross-tenant leakage rather than an
    // error.
    prepare: false,
    onnotice: () => {},
  });
}

export type { Sql };
