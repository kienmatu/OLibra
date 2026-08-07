/**
 * Where the suite's database lives, and the one guard worth having here.
 *
 * The suite truncates every table between tests. Pointing it at the
 * development database — a one-character slip in a URL — would silently
 * destroy whatever was being worked on. So the URL must name `olibra_test`,
 * and anything else is refused before a connection is opened.
 */
export function testDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      "TEST_DATABASE_URL is not set. Start the test database with:\n" +
        "  docker compose --profile test up -d db-test\n" +
        "and copy .env.example to .env",
    );
  }
  if (!url.includes("olibra_test")) {
    throw new Error(
      `TEST_DATABASE_URL must name the olibra_test database, got: ${url}`,
    );
  }
  return url;
}
