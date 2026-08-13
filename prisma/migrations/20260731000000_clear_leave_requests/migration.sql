-- One-time data cleanup (requested): remove ALL "แจ้งติดธุระ" (leave) records
-- for every user, permanently. This runs exactly once per database when
-- `prisma migrate deploy` applies it. It is IRREVERSIBLE — the rows are gone.
--
-- Note: the LeaveRequest table structure, LeaveTypePolicy, and all other data
-- are untouched; only the declaration rows are deleted.
DELETE FROM "LeaveRequest";
