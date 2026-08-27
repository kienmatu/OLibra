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
"$PHP_BIN" artisan config:cache
"$PHP_BIN" artisan route:cache
"$PHP_BIN" artisan view:cache

echo "post-deploy.sh: done."
