# .artifacts

Every temporary file this project produces lives here, and nothing here is ever committed.

The whole point is that **deleting this directory is always safe**. If you ever hesitate before `rm -rf .artifacts/`, something was written to the wrong place. No build input, no source file, no configuration, and nothing a person would miss belongs here.

## Layout

Write to the subdirectory that matches what the file *is*, not which tool produced it. A tool that needs somewhere new to write gets a new subdirectory and a row in this table.

| Directory | Contents |
|---|---|
| `scratch/` | Throwaway working files. Anything with no other home. Assume it is deleted the moment you stop looking at it. |
| `logs/` | Captured command output, dev server logs, deploy transcripts. |
| `coverage/` | Pest and Vitest coverage reports, HTML and Clover. |
| `exports/` | Generated CSV and Excel exports produced while testing the export feature. |
| `screenshots/` | UI screenshots and visual comparisons. |
| `db/` | Local database dumps and seed snapshots. **Never a production dump** — see below. |
| `reports/` | PHPStan baselines under review, profiling output, dependency audits. |

Deeper nesting is fine where it helps: `logs/deploy/2026-08-06.log` beats twenty files in one directory.

These subdirectories are **not** committed — only this README is — so a fresh clone has none of them. Create the one you need on demand with `mkdir -p .artifacts/logs`. Do not add `.gitkeep` files to force them into the repository; empty directories are not worth tracking, and the exception would invite others.

## Rules

1. **Nothing here is committed.** `.gitignore` excludes everything except this README. Do not add exceptions.
2. **Nothing here is an input to anything.** No build step, test, migration, or deploy may read from `.artifacts/`. If a file matters to the build, it belongs in the repository.
3. **Never write real user data here.** No production database dumps, no exports containing real readers' names, dates of birth, parents' names, or phone numbers. This directory is untracked, easy to forget, and easy to accidentally archive or share. The people in that data are mostly children.
4. **Prefix with a date when files accumulate.** `logs/2026-08-06-deploy.log`, not `logs/deploy-final-2.log`.
5. **Clean up after yourself.** If you created a scratch file to answer one question, delete it when you have the answer.

## Cleaning

```bash
rm -rf .artifacts/*/
```

That removes every subdirectory and leaves this README in place. Doing it at any moment, without reading what is inside first, must never break anything.
