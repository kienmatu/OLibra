-- All three ship in postgresql-contrib, which the official image includes,
-- so no custom image is needed (DB §11).
create extension if not exists pgcrypto;   -- gen_random_uuid()
create extension if not exists unaccent;   -- search folding (DB §5)
create extension if not exists pg_trgm;    -- substring search over folded text
