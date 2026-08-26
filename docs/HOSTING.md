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
1. Task 21, the deploy pipeline, is the one task that consumes rows 2–9; it will be
authored against the documented default assumptions called out in each of those
rows' "Task 21 assumes" note, and revisited once this survey actually returns from
the host.

| # | Question | Answer | Consequence |
|---|---|---|---|
| 1 | PHP 8.4 selectable? | **Answered: yes — by instruction, not probe.** The product owner instructed on 2026-08-26 that the PHP and Laravel versions must match `~/Documents/priest-liturgy`, whose `composer.json` pins `"php": "^8.4"` and `"laravel/framework": "^13.0"`. This repository has not confirmed PHP 8.4 is selectable on the actual cPanel host's PHP Selector. | Yes → proceed; Laravel 13, `"php": "^8.4"`. **No → BLOCKING. Stop and escalate.** There is no Laravel 12 fallback (see Global Constraints): the version is pinned to `~/Documents/priest-liturgy` by decision, so a host without 8.4 is a hosting problem to solve, not a framework version to give up. Because this row is answered by instruction rather than by a probe against the real host, the "no PHP 8.4" branch has not been ruled out — it remains the blocking condition to check for the moment the survey is actually run. |
| 2 | `pdo_mysql` loaded? | UNANSWERED — product owner to run. Probe: `php -m \| grep -iE 'pdo_mysql\|gd\|imagick\|zip\|fileinfo\|sodium\|intl\|mbstring\|openssl\|curl\|bcmath'` | Must be yes; if the selector has it unticked, tick it. Hard blocker otherwise. **Task 21 assumes:** `pdo_mysql` is present and ticked; the deploy pipeline does not itself verify this. |
| 3 | `gd` / `imagick`? | UNANSWERED — product owner to run. Probe: same `php -m \| grep -iE ...` command as row 2. | Decides Intervention Image's driver in Phase 1 (`imagick` preferred, `gd` fallback). Phase 0 records, does not install. **Task 21 assumes:** `gd` (the more commonly available driver on shared cPanel hosting), with `imagick` used instead if the survey finds it present. |
| 4 | `zip`, `fileinfo`, `intl`, `mbstring` loaded? | UNANSWERED — product owner to run. Probe: same `php -m \| grep -iE ...` command as row 2. | Composer + Laravel requirements. Tick in the selector if unticked. **Task 21 assumes:** all four are present; the deploy pipeline does not itself verify this. |
| 5 | `PASSWORD_ARGON2ID` defined? | UNANSWERED — product owner to run. Probe: `php -r 'var_dump(defined("PASSWORD_ARGON2ID"));'` | Yes → `HASH_DRIVER=argon2id` (Task 16). No → `HASH_DRIVER=bcrypt`, the spec's documented fallback, recorded here. **Task 21 assumes bcrypt** (`HASH_DRIVER=bcrypt`) as the safe default until the survey confirms argon2id support; see "The hashing decision" below. |
| 6 | `symlink()` allowed? | UNANSWERED — product owner to run. Probes: `php -r 'echo ini_get("disable_functions"), PHP_EOL;'`, `php -r 'var_dump(function_exists("symlink"), function_exists("exec"), function_exists("proc_open"));'`, and the docroot swap probe: `cd ~ && mv public_html public_html.bak && ln -s /home/$USER/olibra/public public_html 2>&1; ls -la public_html; rm public_html 2>/dev/null; mv public_html.bak public_html` | Yes → `public_html` becomes a symlink to `public/`, and `storage:link` works. No → Task 21 uses the `index.php` shim docroot and a `FILESYSTEM_DISK` path inside the webroot. **Task 21 assumes the `index.php` shim docroot** (not the symlink) as the safer default until the survey confirms `symlink()` works on this specific host; see "The docroot decision" below. |
| 7 | `exec`/`proc_open` allowed? | UNANSWERED — product owner to run. Probe: same `function_exists` command as row 6. | Affects nothing in Phase 0 (no `sharp`-style shelling out), recorded for Phase 1's PDF work. **Task 21 assumes:** not needed; no assumption required. |
| 8 | MariaDB version | UNANSWERED — product owner to run. Probe: `mysql -e 'select version();'` | Must report 10.11.x, matching the design. **Task 21 assumes:** MariaDB 10.11.x, matching the design's tested baseline. |
| 9 | The `create trigger` probe succeeded? | UNANSWERED — product owner to run. Probes: `mysql -e "show grants for current_user();"`, and the exact trigger probe below. | Yes → Task 12 ships triggers as designed. **ERROR 1419** (binary logging on, no SUPER, `log_bin_trust_function_creators=0` — common on managed MariaDB, and invisible in CI where binlog is off) → ask the host to set `log_bin_trust_function_creators=1`; refused → the trigger migrations still run in dev/CI, production loses only the belt-and-braces layer, and this row documents the loss (the application never issues DELETE on loans / UPDATE on audit_log anyway). A bare privilege error means the same fallback. **Task 21 assumes:** triggers are shipped as designed; if row 9 comes back with ERROR 1419 and the host refuses `log_bin_trust_function_creators=1`, this row's documented loss (belt-and-braces only, not required application behavior) applies without further Task 21 changes. |
| 10 | The `_probe` table — the schema's real generated-column shapes, with their unique indexes — created cleanly? | UNANSWERED — product owner to run. Probe: the exact `_probe` table DDL below. | Yes → §4.1's mechanism works on this host. Errno 1901 or any refusal → escape hatch: app-maintained folded/key columns via model observers (spec §4.2 option 2), decided here, not later. The probe uses VARCHAR(36) operands deliberately — CHAR(36) fails with 1901 on every 10.11 (see the plan's Global Constraints), so a CHAR-based probe would condemn a healthy host. |
| 11 | Cron with `* * * * *` allowed? | UNANSWERED — product owner to run. Probe: check cPanel → Cron Jobs page for the minimum allowed interval. | Drives the scheduler and queue drain (Task 21). If the minimum interval is coarser, record it and adjust `--max-time` accordingly. **Task 21 assumes:** `* * * * *` is allowed. |
| 12 | cPanel Git™ Version Control available? | UNANSWERED — product owner to run. Probe: check cPanel for the Git™ Version Control feature. | Yes → deploy via `.cpanel.yml`. No → rsync over SSH (Task 21 carries both; this row picks one). **Task 21 assumes cPanel Git™ / `.cpanel.yml` deploy** as the default path until the survey confirms availability; see "The deploy channel decision" below. |
| 13 | Composer on host? | UNANSWERED — product owner to run. Probe: `which composer 2>&1` | Irrelevant if artifact ships `vendor/` (it does); recorded because a host composer makes hotfixes easier. **Task 21 assumes:** no host composer; the deploy artifact ships `vendor/`. |
| 14 | SSH access? | UNANSWERED — product owner to run. Probe: attempt an SSH session; cPanel → Terminal if no SSH key is set up yet. | rsync path and `php artisan migrate` at deploy need it; without SSH, deploy is cPanel Git + a post-deploy hook. **Task 21 assumes:** SSH access is available. |

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

Row 5 (`PASSWORD_ARGON2ID` defined?) is unanswered. Until the survey returns, Task 21
assumes **`HASH_DRIVER=bcrypt`**, the spec's documented fallback, rather than
argon2id. If the survey later confirms argon2id support, this can switch to
`HASH_DRIVER=argon2id` per Task 16.

## The deploy channel decision

Rows 12 (cPanel Git™ available?) and 14 (SSH access?) are unanswered. Until the survey
returns, Task 21 assumes **cPanel Git™ Version Control with `.cpanel.yml`** as the
deploy channel, rather than rsync over SSH. If the survey later finds cPanel Git™
unavailable, Task 21 falls back to the rsync-over-SSH path it also carries.
