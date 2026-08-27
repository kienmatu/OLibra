#!/usr/bin/env bash
# Runs ON the cPanel host after files land (rsync-over-ssh in
# .github/workflows/deploy-laravel.yml, or cPanel Git's own deployment task
# in .cpanel.yml — see docs/HOSTING.md for which channel is wired).
#
# Idempotent by design: every artisan step below is safe to re-run, so a
# failure partway through leaves nothing to manually unwind — fix the cause
# and run this script again. `set -euo pipefail` means the first failing
# command stops the script (loudly, non-zero exit) rather than limping on
# with half a deploy applied under it.
set -euo pipefail

trap 'echo "post-deploy.sh: failed at line $LINENO — re-run after fixing the cause; every step above is safe to repeat." >&2' ERR

APP_PATH="${1:?usage: post-deploy.sh /home/<account>/olibra}"
cd "$APP_PATH"

# Never write bare `php` here. dreamtube's DEPLOYMENT.md documents a
# production outage caused by exactly this: `php -v` can report the right
# version while actually resolving to a php-cgi build that silently drops
# the command-line argument and exits 0 having done nothing. This runs over
# a non-interactive ssh/cPanel-Git invocation, which does not necessarily
# get the interactive PATH that puts the right binary first — so resolve
# and verify explicitly rather than trusting `php` to mean CLI 8.4.
PHP_BIN="${PHP_BIN:-php}"

PHP_CHECK=$("$PHP_BIN" -r 'echo PHP_SAPI, " ", PHP_VERSION;' 2>&1) || {
    echo "post-deploy.sh: '$PHP_BIN -r ...' failed outright — that is itself the php-cgi tell (cgi-fcgi refuses -r). Set PHP_BIN to the CLI binary's absolute path (docs/HOSTING.md; dreamtube's runbook found /opt/alt/php84/usr/bin/php on the same host profile, NOT /usr/local/bin/ea-php84)." >&2
    exit 1
}
PHP_SAPI_ACTUAL="${PHP_CHECK%% *}"
PHP_VERSION_ACTUAL="${PHP_CHECK#* }"
if [ "$PHP_SAPI_ACTUAL" != "cli" ]; then
    echo "post-deploy.sh: PHP_BIN='$PHP_BIN' resolved to SAPI '$PHP_SAPI_ACTUAL', not 'cli'. This is the quiet failure mode: artisan boots, prints its command list, and exits 0 having run nothing. Set PHP_BIN to the CLI binary explicitly." >&2
    exit 1
fi
case "$PHP_VERSION_ACTUAL" in
    8.4.*|8.5.*|8.6.*|9.*) : ;;
    *)
        echo "post-deploy.sh: PHP_BIN='$PHP_BIN' resolved to CLI $PHP_VERSION_ACTUAL. This app needs >= 8.4 (config/database.php's mariadb driver, Laravel 13's own floor — docs/HOSTING.md row 1). A MultiPHP downgrade breaks every database connection; do not proceed." >&2
        exit 1
        ;;
esac

# docs/HOSTING.md row 5 / "The hashing decision": .env.example and
# config/hashing.php both default HASH_DRIVER to argon2id, but that default
# is only known-safe in environments this repo controls (local Docker, CI).
# The production .env is hand-written per row 5 and is supposed to fall
# back to bcrypt on a host without argon2id — but nothing enforced that
# until now. Read HASH_DRIVER straight out of the host's real .env (not
# Laravel's resolved config — artisan has not booted yet at this point in
# the script) so a host that ships argon2id=true in .env by copy-paste
# mistake, on a host that turns out to lack the extension, fails HERE
# instead of at the first login attempt after a green deploy.
HASH_DRIVER_CONFIGURED=$(grep -E '^HASH_DRIVER=' .env 2>/dev/null | tail -n1 | cut -d= -f2- || true)
if [ "$HASH_DRIVER_CONFIGURED" = "argon2id" ]; then
    "$PHP_BIN" -r 'exit(defined("PASSWORD_ARGON2ID") ? 0 : 1);' || {
        echo "post-deploy.sh: .env sets HASH_DRIVER=argon2id but '$PHP_BIN' has no PASSWORD_ARGON2ID (docs/HOSTING.md row 5 unanswered/negative on this host). Every Hash::make() call would throw and every login would 500. Set HASH_DRIVER=bcrypt in .env, the spec's documented fallback, until the survey confirms argon2id support." >&2
        exit 1
    }
fi

# PR #57 review follow-up: docs/HOSTING.md's first-deploy checklist step 2
# used to say SESSION_DRIVER=database — a real, distinct Laravel session
# driver, so that instruction failed silently rather than erroring. Under
# it, raw session ids land straight in the `sessions` table instead of
# sha256(session id), defeating App\Support\HashedDatabaseSessionHandler
# entirely, and config/session.php's own default of hashed-database only
# guards a MISSING SESSION_DRIVER — it cannot guard a WRONG one. On cPanel
# the database dump and this .env sit in the same home directory, which is
# what turns a database leak into a session/authentication bypass rather
# than a mere confidentiality loss. Read straight out of the host's real
# .env, the same way the HASH_DRIVER check above does, and refuse anything
# other than hashed-database — but an unset value is fine, since the config
# default already covers it.
SESSION_DRIVER_CONFIGURED=$(grep -E '^SESSION_DRIVER=' .env 2>/dev/null | tail -n1 | cut -d= -f2- || true)
if [ -n "$SESSION_DRIVER_CONFIGURED" ] && [ "$SESSION_DRIVER_CONFIGURED" != "hashed-database" ]; then
    echo "post-deploy.sh: .env sets SESSION_DRIVER=$SESSION_DRIVER_CONFIGURED, not hashed-database. Every other driver — especially Laravel's own real 'database' driver, an easy typo of the intended one — stores raw session ids instead of App\\Support\\HashedDatabaseSessionHandler's sha256(session id), and on cPanel the database dump sits in the same home directory as this .env: a leaked dump becomes a live session/authentication bypass, not just a confidentiality loss. Set SESSION_DRIVER=hashed-database in .env, or remove the line entirely — config/session.php already defaults to it." >&2
    exit 1
fi

# Storage skeleton (the deploy artifact excludes storage/app, storage/logs
# and storage/framework — see the rsync excludes in
# .github/workflows/deploy-laravel.yml — so these directories must exist
# before Laravel writes to them, on every deploy, not only the first).
mkdir -p storage/framework/cache storage/framework/sessions storage/framework/views \
    storage/logs storage/app/public
chmod -R 775 storage bootstrap/cache

# `|| true`: symlink() may be disabled on this host (docs/HOSTING.md row 6,
# unanswered — Task 21 assumes the index.php shim docroot, not the
# public_html symlink, until the survey says otherwise). When the docroot is
# the shim, storage:link either isn't needed or fails harmlessly; when it is
# needed and symlink() really is disabled, this line must not abort the rest
# of the deploy over it. The command is itself idempotent — a no-op once the
# link exists.
"$PHP_BIN" artisan storage:link || true

"$PHP_BIN" artisan migrate --force

# PR #57 review follow-up: database/seeders/CategorySeeder.php's own header
# explains why this line exists — src/db/migrations/20260810_02_seed_default_
# categories.sql used to seed the six default categories on the Postgres
# side, and nothing on this side ever ran its Laravel replacement. A fresh
# install had no categories and no way to make one, so the required "Thể
# loại" field on "Thêm sách mới" could never be satisfied — the one other
# data-affecting migration step, migrate --force above, does not create rows,
# only tables. DatabaseSeeder gates DemoShelfSeeder behind
# app()->environment('local'), so this is safe to run unconditionally on
# every deploy: production only ever gets CategorySeeder. CategorySeeder is
# also idempotent by construction (a withTrashed() existence guard, per its
# own docstring, because categories.slug's unique index is not soft-delete-
# aware like the schema's other ten), so re-running it on every deploy — not
# only the first — is deliberate rather than merely harmless.
"$PHP_BIN" artisan db:seed --force

"$PHP_BIN" artisan config:cache
"$PHP_BIN" artisan route:cache
"$PHP_BIN" artisan view:cache

# Docroot shim mode only (docs/HOSTING.md row 6's last-resort option,
# deploy/public_html-index.php.template): unlike the preferred Document-Root
# override or the public_html symlink, the shim leaves public_html/ a
# separate directory from public/ — so the assets Vite just built have to be
# copied over on EVERY deploy, not wired once. Skipped entirely (no-op) when
# PUBLIC_HTML_PATH is unset, which is the case for both of the other two
# docroot options and is why this is not unconditional.
if [ -n "${PUBLIC_HTML_PATH:-}" ]; then
    echo "post-deploy.sh: PUBLIC_HTML_PATH set — syncing public/build and public/.htaccess into $PUBLIC_HTML_PATH"
    mkdir -p "$PUBLIC_HTML_PATH"
    rm -rf "$PUBLIC_HTML_PATH/build"
    cp -r public/build "$PUBLIC_HTML_PATH/build"
    cp public/.htaccess "$PUBLIC_HTML_PATH/.htaccess"
fi

echo "post-deploy.sh: done."
