# Hosting survey — the real cPanel host

Surveyed: 2026-08-26. Design: docs/superpowers/specs/2026-08-26-laravel-mariadb-inertia-migration-design.md §8.
Each finding below is a decision input; the "Consequence" column is what the rest of
the Phase 0 plan does with the answer.

**This survey has not yet been run against the host.** Nobody has SSH or cPanel
credentials for the shared host in this session, so rows 2–14 below are
`UNANSWERED — product owner to run`, not findings. Row 1 is the one exception: it is
settled by an explicit product-owner instruction rather than by a probe (see below),
and is recorded as answered. Tasks 2–20 of the Phase 0 plan consume no unanswered
row here — the only host answer they depend on is the PHP/Laravel version pin in row
1. Task 21, the deploy pipeline, consumes exactly the rows below whose Consequence
column carries a "Task 21 assumes" note — that note is the single source of truth
for which rows Task 21 depends on, not a hand-copied row range, so the two can never
drift apart. As of this writing that is every row except row 1 (settled by
instruction, not a Task 21 assumption) and row 10 (a schema-migration decision for
earlier tasks, not the deploy pipeline). Task 21 will be authored against those
documented default assumptions, and revisited once this survey actually returns from
the host.

| # | Question | Answer | Consequence |
|---|---|---|---|
| 1 | PHP 8.4 selectable? | **Answered: yes — by instruction, not probe.** The product owner instructed on 2026-08-26 that the PHP and Laravel versions must match `~/Documents/priest-liturgy`, whose `composer.json` pins `"php": "^8.4"` and `"laravel/framework": "^13.0"`. This repository has not confirmed PHP 8.4 is selectable on the actual cPanel host's PHP Selector. | Yes → proceed; Laravel 13, `"php": "^8.4"`. **No → BLOCKING. Stop and escalate.** There is no Laravel 12 fallback (see Global Constraints): the version is pinned to `~/Documents/priest-liturgy` by decision, so a host without 8.4 is a hosting problem to solve, not a framework version to give up. Because this row is answered by instruction rather than by a probe against the real host, the "no PHP 8.4" branch has not been ruled out — it remains the blocking condition to check for the moment the survey is actually run. |
| 2 | `pdo_mysql` loaded? | UNANSWERED — product owner to run. Probe: `php -m \| grep -iE 'pdo_mysql\|gd\|imagick\|zip\|fileinfo\|sodium\|intl\|mbstring\|openssl\|curl\|bcmath'` | Must be yes; if the selector has it unticked, tick it. Hard blocker otherwise. **Task 21 assumes:** `pdo_mysql` is present and ticked; the deploy pipeline does not itself verify this. |
| 3 | `gd` / `imagick`? | UNANSWERED — product owner to run. Probe: `php -m \| grep -iE 'pdo_mysql\|gd\|imagick\|zip\|fileinfo\|sodium\|intl\|mbstring\|openssl\|curl\|bcmath'` | Decides Intervention Image's driver in Phase 1 (`imagick` preferred, `gd` fallback). Phase 0 records, does not install. **Task 21 assumes:** `gd` (the more commonly available driver on shared cPanel hosting), with `imagick` used instead if the survey finds it present. |
| 4 | `zip`, `fileinfo`, `intl`, `mbstring` loaded? | UNANSWERED — product owner to run. Probe: `php -m \| grep -iE 'pdo_mysql\|gd\|imagick\|zip\|fileinfo\|sodium\|intl\|mbstring\|openssl\|curl\|bcmath'` | Composer + Laravel requirements. Tick in the selector if unticked. **Task 21 assumes:** all four are present; the deploy pipeline does not itself verify this. |
| 5 | `PASSWORD_ARGON2ID` defined? | UNANSWERED — product owner to run. Probe: `php -r 'var_dump(defined("PASSWORD_ARGON2ID"));'` | Yes → `HASH_DRIVER=argon2id` (Task 16). No → `HASH_DRIVER=bcrypt`, the spec's documented fallback, recorded here. **Task 21 assumes bcrypt** (`HASH_DRIVER=bcrypt`) as the safe default until the survey confirms argon2id support; see "The hashing decision" below. |
| 6 | `symlink()` allowed? | UNANSWERED — product owner to run. Probes: `php -r 'echo ini_get("disable_functions"), PHP_EOL;'`, `php -r 'var_dump(function_exists("symlink"), function_exists("exec"), function_exists("proc_open"));'`, and the docroot swap probe: `cd ~ && mv public_html public_html.bak && ln -s /home/$USER/olibra/public public_html 2>&1; ls -la public_html; rm public_html 2>/dev/null; mv public_html.bak public_html` | Yes → `public_html` becomes a symlink to `public/`, and `storage:link` works. No → Task 21 uses the `index.php` shim docroot and a `FILESYSTEM_DISK` path inside the webroot. **Task 21 assumes the `index.php` shim docroot** (not the symlink) as the safer default until the survey confirms `symlink()` works on this specific host; see "The docroot decision" below. |
| 7 | `exec`/`proc_open` allowed? | UNANSWERED — product owner to run. Probe: same `function_exists` command as row 6. | Affects nothing in Phase 0 (no `sharp`-style shelling out), recorded for Phase 1's PDF work. **Task 21 assumes:** not needed; no assumption required. |
| 8 | MariaDB version | UNANSWERED — product owner to run. Probe: `mysql -e 'select version();'` | Must report 10.11.x, matching the design. **Task 21 assumes:** MariaDB 10.11.x, matching the design's tested baseline. |
| 9 | The `create trigger` probe succeeded? | UNANSWERED — product owner to run. Probes: `mysql -e "show grants for current_user();"`, and the exact trigger probe below. | Yes → Task 12 ships triggers as designed. **ERROR 1419** (binary logging on, no SUPER, `log_bin_trust_function_creators=0` — common on managed MariaDB, and invisible in CI where binlog is off) → ask the host to set `log_bin_trust_function_creators=1`; refused → the trigger migrations still run in dev/CI, production loses only the belt-and-braces layer, and this row documents the loss (the application never issues DELETE on loans / UPDATE on audit_log anyway). A bare privilege error means the same fallback. **Task 21 assumes:** triggers are shipped as designed; if row 9 comes back with ERROR 1419 and the host refuses `log_bin_trust_function_creators=1`, this row's documented loss (belt-and-braces only, not required application behavior) applies without further Task 21 changes. |
| 10 | The `_probe` table — the schema's real generated-column shapes, with their unique indexes — created cleanly? | UNANSWERED — product owner to run. Probe: the exact `_probe` table DDL below. | Yes → §4.1's mechanism works on this host. Errno 1901 or any refusal → escape hatch: app-maintained folded/key columns via model observers (spec §4.2 option 2), decided here, not later. The probe uses VARCHAR(36) operands deliberately — CHAR(36) fails with 1901 on every 10.11 (see the plan's Global Constraints), so a CHAR-based probe would condemn a healthy host. |
| 11 | Cron with `* * * * *` allowed? | UNANSWERED — product owner to run. Probe: check cPanel → Cron Jobs page for the minimum allowed interval. | Drives the scheduler and queue drain (Task 21). If the minimum interval is coarser, record it and adjust `--max-time` accordingly. **Task 21 assumes:** `* * * * *` is allowed. |
| 12 | cPanel Git™ Version Control available? | UNANSWERED — product owner to run. Probe: check cPanel for the Git™ Version Control feature. | Yes → deploy via `.cpanel.yml`. No → rsync over SSH (Task 21 carries both; this row picks one). **Task 21 assumes cPanel Git™ / `.cpanel.yml` deploy** as the default path until the survey confirms availability; see "The deploy channel decision" below — and its "which channel is actually wired" paragraph for what is actually implemented today (rsync-over-SSH, not this row's default; `.cpanel.yml` ships correct but inert until an artifact-delivery mechanism into its git remote exists). |
| 13 | Composer on host? | UNANSWERED — product owner to run. Probe: `which composer 2>&1` | Irrelevant if artifact ships `vendor/` (it does); recorded because a host composer makes hotfixes easier. **Task 21 assumes:** no host composer; the deploy artifact ships `vendor/`. |
| 14 | SSH access? | UNANSWERED — product owner to run. Probe: attempt an SSH session; cPanel → Terminal if no SSH key is set up yet. | rsync path and `php artisan migrate` at deploy need it; without SSH, deploy is cPanel Git + a post-deploy hook. **Task 21 assumes:** SSH access is available. |
| 15 | Does the host serve `.wasm` as `application/wasm`? | UNANSWERED — product owner to run. Probe, once an artifact is deployed: `curl -sI https://<host>/build/assets/ \| grep -i content-type` against the hashed `zxing_reader-*.wasm` Vite emits, or check whether the stack's `mime.types` maps `wasm`. | NOT a blocker. The QR scanner (`resources/js/components/copy-scanner.tsx`) loads its ~1.07 MB decoder from this app's own origin rather than a CDN, and emscripten's loader prefers `WebAssembly.instantiateStreaming()`, which requires the `application/wasm` content type. Served as `application/octet-stream` the streaming call is rejected and the loader falls back to buffering the whole binary before compiling: slower to the first scan, identical afterwards, and correct either way. If the type is wrong, an `AddType application/wasm .wasm` line in `public/.htaccess` fixes it. |

Node presence (`which node npm 2>&1`) is also UNANSWERED — product owner to run. It is
not required (assets build in CI), and is recorded for completeness only; it does not
gate any task.

### The `_probe` table DDL (for row 10)

Ready to run on the host, exactly as the plan specifies — not attempted here:

```sql
create table _probe (
  id int primary key,
  bookshelf_id varchar(36) character set ascii collate ascii_bin,
  status varchar(20) character set ascii collate ascii_bin,
  copy_id varchar(36) character set ascii collate ascii_bin,
  name varchar(255),
  deleted_at datetime(6) null,
  active_copy_id varchar(36) character set ascii collate ascii_bin
    generated always as (if(status = 'active', copy_id, null)) stored,
  name_key binary(32) generated always as
    (if(deleted_at is null, unhex(sha2(concat_ws(0x1f, bookshelf_id, char_length(name), name), 256)), null)) stored,
  unique (active_copy_id),
  unique (name_key)
);
```

Run against database `olibra`:

```bash
mysql -e "<DDL above>" olibra 2>&1
mysql -e "drop table _probe;" olibra
```

### The trigger probe (for row 9)

```sql
create trigger _probe_t before delete on _probe for each row
  signal sqlstate '45000' set message_text = 'no';
```

```bash
mysql -e "<trigger DDL above>" olibra 2>&1
```

## The docroot decision

Row 6 (`symlink()` allowed?) is unanswered. Until the survey returns, Task 21 assumes
the **`index.php` shim docroot** — the more conservative option that works whether or
not `symlink()` turns out to be permitted — rather than the `public_html` → `public/`
symlink. If the survey later confirms `symlink()` works, Task 21 should switch to the
symlink approach, since it is the design's preferred mechanism.

## The hashing decision

Row 5 (`PASSWORD_ARGON2ID` defined?) is unanswered — for the **production host**
only. Every other environment (local Docker, CI, and this repository's own
`.env`/`.env.example`/`phpunit.xml` defaults) runs `HASH_DRIVER=argon2id`
unconditionally: those runtimes are controlled by this repo and argon2id is
known present there, the database is greenfield so no existing hash needs
migrating, and `password_verify()` reads the algorithm from the hash's own
prefix, so a later switch on any one environment is survivable without a
rehash pass.

`HASH_DRIVER=bcrypt` is a **production-only fallback**, and only if row 5
comes back negative: until the survey runs against the real host, Task 21
assumes **`HASH_DRIVER=bcrypt`** in production's `.env` as the conservative
default, the spec's documented fallback, rather than assuming argon2id
support it cannot yet confirm. If the survey later confirms argon2id
support, Task 21's production `.env` switches to `HASH_DRIVER=argon2id` too,
matching every other environment, per Task 16. Cost if this default turns
out to be wrong in either direction: a one-line `.env` change at deploy, not
a rehash.

## The deploy channel decision

Rows 12 (cPanel Git™ available?) and 14 (SSH access?) are unanswered. Until the survey
returns, Task 21 assumes **cPanel Git™ Version Control with `.cpanel.yml`** as the
deploy channel, rather than rsync over SSH. If the survey later finds cPanel Git™
unavailable, Task 21 falls back to the rsync-over-SSH path it also carries.

**Which channel is actually wired, as implemented:** both files exist —
`.cpanel.yml` for cPanel Git™, `.github/workflows/deploy-laravel.yml` for
rsync-over-SSH — but the GitHub Actions workflow is the one with a working
`Ship` step, using rsync-over-SSH rather than this section's stated default.
Reasoning: rsync-over-SSH needs no cPanel-side git configuration to exist
before the first run — it only needs row 14 (SSH access), which Task 21 also
assumes — while cPanel Git™ additionally needs a git remote set up in cPanel
first and a way to get the built artifact (with `vendor/` and `public/build/`)
into whatever repo it pulls from, which `.cpanel.yml`'s own tasks cannot do by
themselves. `.cpanel.yml` still ships, correct and ready, as the channel to
flip to once row 12 confirms cPanel Git™ is available and someone wires its
git remote — its `deployment.tasks` call the same idempotent
`deploy/post-deploy.sh`, so switching channels does not change what runs on
the host, only how the files get there.

## Cron lines (create in cPanel → Cron Jobs)

    * * * * * cd $HOME/olibra && /path/to/php84/bin/php artisan schedule:run >> /dev/null 2>> $HOME/olibra/storage/logs/cron-schedule.err.log
    0 2 * * * mysqldump --defaults-extra-file=$HOME/.my.cnf --single-transaction <db_name> | gzip > $HOME/backups/olibra-$(date +\%F).sql.gz

`$HOME` (not a hand-typed `/home/<account>`) is what dreamtube's DEPLOYMENT.md
uses in every cron example, precisely so these two lines are copy-pasteable
verbatim into cPanel's Cron Jobs form on any account — cron sets `$HOME` from
`/etc/passwd` itself, so nothing here needs editing except the two pieces
that genuinely have no substitute: the PHP path and `<db_name>`.

The first line is the scheduler tick; queue draining rides it
(`routes/console.php`'s `Schedule::command('queue:work --stop-when-empty
--max-time=50')->everyMinute()`). Because `queue:work` is not backgrounded
(no `->runInBackground()`), a tick that finds queued work blocks for up to
50 seconds before the tick returns — the *next* minute's `schedule:run`
still fires on schedule regardless (cron invokes independently each minute),
but whatever else is due in the same tick as a busy queue drain runs late by
however long the drain took. This is the mechanism behind the Phase 2
reminder sweep's own comment in `routes/console.php`: once that line is
uncommented, a long queue drain in the same minute as 07:00 delays the sweep
by however many seconds the drain took, not by a full tick.

**`/path/to/php84/bin/php` is a placeholder, not a real path** — dreamtube's
DEPLOYMENT.md found `/opt/alt/php84/usr/bin/php` (CloudLinux alt-php) on the
same host profile, *not* `/usr/local/bin/ea-php84`, and warns explicitly
against ever writing bare `php` in a cron entry: it works in an interactive
SSH session only because cPanel puts the right binary first on that PATH,
and cron does not read `~/.bashrc` — it runs with roughly
`PATH=/usr/bin:/bin` and can silently pick up a `php-cgi` build of the right
version instead. That binary passes every version check, drops the
`schedule:run` argument because CGI does not populate `$argv`, and exits 0
having run nothing — cron logs a success every minute while the entire
pipeline does nothing. Resolve the real path with `php -r 'echo
PHP_BINARY;'` in an actual cPanel SSH session (row 14) before creating this
cron line, and confirm it explicitly with `php -r 'echo PHP_SAPI;'` (must
print `cli`) rather than trusting `php -v`'s version number alone.
`deploy/post-deploy.sh` runs the same check itself (`PHP_BIN`, defaulting to
`php`, overridable via the `DEPLOY_PHP_BIN` repository secret) precisely
because the same ambiguity applies to a non-interactive SSH command, not
only to cron.

Stdout is discarded and stderr is appended to a file, not the reverse — this
matches dreamtube's runbook's reasoning: `schedule:run` fires 1440 times a
day and prints "No scheduled commands are ready to run." on nearly all of
them, so logging everything is a disk-quota problem nobody remembers to
reclaim, and an empty stderr-only log is a real signal (anything in it means
something actually went wrong). It also cannot catch the php-cgi failure mode
above, which writes to stdout and exits 0 — that failure is caught by
checking `PHP_SAPI` directly, not by reading either log, which is exactly why
`post-deploy.sh` checks it structurally instead of trusting a clean log.

The second line is the database half of the backup story; the file half is
`$HOME/olibra/storage/`, and the restore path for BOTH must be rehearsed and
written into a deployment runbook at cutover — spec §10 risk 3 says this
plainly. It needs two things nothing else in this document creates:

- **`$HOME/.my.cnf`**, `chmod 600`, containing:
  ```
  [client]
  user=<db_user>
  password=<db_password>
  ```
  A bare `mysqldump --single-transaction <db_name>` has no credentials at
  all on a cPanel account with no assumed root `~/.my.cnf` — the realistic
  failure is not a loud error, it's an access-denied `mysqldump` writing
  nothing meaningful to stdout, piped through `gzip` regardless, landing as
  a small-but-nonzero `.gz` file that *looks* like a backup and restores
  nothing. Never put the password directly in the crontab line — it is
  readable by anything that can read `crontab -l`.
- **`mkdir -p $HOME/backups`** — cPanel does not create this directory, and
  a cron job whose redirect target's parent directory does not exist fails
  silently in the same "looks fine, isn't" way.

Both belong in the first deploy checklist below, before this cron line is
ever created. `<db_name>` is a placeholder for the same reason the PHP path
above is: nobody has the real database name from this session.

## Docroot wiring (per row 6)

Three options, in the order to actually try them:

1. **Document Root override (try this first).** In cPanel → Domains, set the
   domain's Document Root directly to `/home/<account>/olibra/public`. No
   symlink, no shim, and row 6 (`symlink()` allowed?) never matters — this is
   what dreamtube's DEPLOYMENT.md offers first, and it is the option that
   was actually load-bearing in a real deployment on this host profile.
   Whether cPanel's Domains UI permits a Document Root outside
   `public_html` at all is itself unconfirmed on OLibra's account, which is
   why this is "try first," not "assumed."
2. **Symlink**, if option 1 is unavailable and row 6 confirms `symlink()`
   works:
   `mv ~/public_html ~/public_html.old && ln -s /home/<account>/olibra/public ~/public_html`
3. **Shim fallback**, if neither of the above is available — **Task 21's
   coded default** (see "The docroot decision" above) until row 6 returns:
   `deploy/public_html-index.php.template` ships a real copy of Laravel's
   `public/index.php` with its two require paths repointed at a sibling
   `olibra/` application directory (rather than existing only as a sentence
   in this file). Copy it to `~/public_html/index.php`, dropping the
   `.template` suffix. Unlike options 1 and 2, the shim leaves `public/` and
   `public_html/` as two separate directories, so the built assets
   (`public/build/`, `public/.htaccess`) have to be kept in sync on **every**
   deploy, not wired once — `deploy/post-deploy.sh` does this automatically
   when the `PUBLIC_HTML_PATH` environment variable is set for that run
   (see the script's own comment), and does nothing when it is unset, which
   is the correct behaviour under options 1 and 2.

None of the three is performed by `deploy/post-deploy.sh` itself as a
one-time action — choosing and wiring the docroot is a by-hand setup step,
not part of the repeatable deploy. (Row 12's table cell above still names
cPanel Git™ as the default deploy channel; see "which channel is actually
wired" a few paragraphs above that table for the as-implemented answer,
which is rsync-over-SSH — the two are a different decision from the docroot
one on this line.)

## First deploy checklist

1. Create the MySQL database and user in cPanel; grant ALL. dreamtube's
   DEPLOYMENT.md flags the "add user to database" step as a separate form
   that is easy to miss — skipping it gives `SQLSTATE[42000] [1044] Access
   denied` at migrate time even though the user and password are both
   correct.
2. Write /home/<account>/olibra/.env by hand (never deployed — it is
   excluded from the artifact and from the rsync target): APP_KEY from
   `php artisan key:generate --show` locally, APP_ENV=production,
   APP_DEBUG=false, APP_URL, DB_CONNECTION=mariadb (not `mysql` — see the
   design's Global Constraints and dreamtube's DEPLOYMENT.md for the errno
   1901 this exact mistake produces), DB_*, SESSION_DRIVER=hashed-database
   (not `database` — that is a real, distinct Laravel driver, so the typo
   fails silently: raw session ids would land in the `sessions` table
   instead of sha256(session id), defeating
   `App\Support\HashedDatabaseSessionHandler` entirely, and on cPanel the
   database dump and this very `.env` sit in the same home directory, which
   is what turns that into an authentication bypass rather than a mere
   confidentiality loss — `deploy/post-deploy.sh` now refuses to proceed if
   this is wrong), QUEUE_CONNECTION=database, CACHE_STORE=database,
   HASH_DRIVER per row 5 (bcrypt until confirmed otherwise — see "The
   hashing decision" above).
3. Confirm the CLI PHP binary and SAPI explicitly before anything else runs
   — `php -r 'echo PHP_SAPI, " ", PHP_VERSION;'` in a real SSH session must
   print `cli 8.4.x`, not merely a version number from `php -v`. Set the
   `DEPLOY_PHP_BIN` repository secret to the resolved absolute path if it is
   not bare `php`.
4. Wire the docroot (see "Docroot wiring" above — try the Document Root
   override first) and, if the shim ends up chosen, copy
   `deploy/public_html-index.php.template` into place per its own header.
5. Create `$HOME/.my.cnf` (`chmod 600`) and `mkdir -p $HOME/backups` — both
   required by the backup cron line below, neither created automatically.
6. Run the deploy workflow (`.github/workflows/deploy-laravel.yml`, manual
   dispatch); verify /login renders over HTTPS. This is the acceptance test
   named in the Phase 0 exit criteria — nothing in this repository has
   verified it yet, because nobody has run the workflow against a real host.
7. Create the cron lines above, with the real PHP CLI path from step 3
   substituted for the placeholder.
