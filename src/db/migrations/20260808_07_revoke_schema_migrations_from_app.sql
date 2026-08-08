-- 0010_rls.sql's `grant select, insert, update on all tables in schema
-- public to olibra_app` swept up `schema_migrations` along with every real
-- table, so the role meant to serve untrusted application requests can
-- insert or update rows in the migration ledger. Harmless today — nothing
-- calls `migrate()` as `olibra_app`, and the ledger has no foreign key
-- anything else depends on — but wrong for a role whose whole point is
-- running with the least privilege an untrusted request needs. `select`
-- stays: there is no reason to hide the ledger, only to stop writing it.
revoke insert, update on schema_migrations from olibra_app;
