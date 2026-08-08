import { connect } from "./client";
import { seed } from "./seed";

/**
 * `bun run db:seed` — reproduces `src/lib/fixtures.ts` in whatever database
 * `MIGRATION_DATABASE_URL` names (DATABASE.md §9). Run `db:migrate` first;
 * `seed()` assumes the schema already exists and does not create it.
 *
 * CRITICAL 2: not `DATABASE_URL` — `seed()` runs its whole transaction as
 * `olibra_admin` (its own doc comment explains why: writing across every
 * fixture shelf in one pass), and the connecting role must actually be
 * granted that membership to `set local role` into it. `olibra_pool`
 * (DATABASE_URL) has that grant too as of this migration, so this would work
 * either way today — `MIGRATION_DATABASE_URL` is still the right choice
 * because seeding, like migrating, is an operator action against the
 * database directly, not a request the running application served.
 */
async function main() {
  const url = process.env.MIGRATION_DATABASE_URL;
  if (!url) {
    throw new Error("MIGRATION_DATABASE_URL is not set — see .env.example.");
  }
  const sql = connect(url);
  try {
    await seed(sql);
    console.log("Seed complete.");
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
