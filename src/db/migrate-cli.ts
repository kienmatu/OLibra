import { connect } from "./client";
import { migrate } from "./migrate";

/**
 * `bun run db:migrate` — applies every pending migration to whatever
 * `DATABASE_URL` names (compose.yaml's `db`, unless overridden). Thin on
 * purpose: `migrate()` is the tested unit, this is just the process that
 * calls it and reports what happened.
 */
async function main() {
  const sql = connect();
  try {
    const { applied } = await migrate(sql);
    if (applied.length === 0) {
      console.log("No pending migrations.");
    } else {
      console.log(`Applied ${applied.length} migration(s):`);
      for (const name of applied) console.log(`  ${name}`);
    }
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
