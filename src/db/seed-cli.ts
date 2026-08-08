import { connect } from "./client";
import { seed } from "./seed";

/**
 * `bun run db:seed` — reproduces `src/lib/fixtures.ts` in whatever database
 * `DATABASE_URL` names (DATABASE.md §9). Run `db:migrate` first; `seed()`
 * assumes the schema already exists and does not create it.
 */
async function main() {
  const sql = connect();
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
