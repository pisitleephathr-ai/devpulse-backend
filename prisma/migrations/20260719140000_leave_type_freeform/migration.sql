-- Make LeaveRequest.type a free-form string so leave types come from the
-- admin-configured LeaveTypePolicy list instead of a fixed enum. Existing rows
-- keep their current values (the old enum codes are cast to text and preserved).

-- Convert the column from the enum to TEXT (existing enum values become their
-- textual form, e.g. 'VACATION').
ALTER TABLE "LeaveRequest" ALTER COLUMN "type" TYPE TEXT USING "type"::TEXT;

-- The enum is no longer referenced by any column — drop it.
DROP TYPE "LeaveType";
