-- Comps snapshots in the calculation library (client ruling: comps are saved
-- as dated snapshots, filed by address).
--
-- Widens the calculator check on an EXISTING calculations table to accept
-- 'comps'. Safe to run more than once, and backward compatible: every row the
-- old constraint allowed is still allowed. Until it runs, comps snapshots are
-- rejected by the old check — the lookup itself still works and the member
-- sees "couldn't be saved" under it; calculator entries are unaffected.
--
-- (A fresh install gets the widened check straight from sql/calculations.sql.)
alter table calculations drop constraint if exists calculations_calculator_check;
alter table calculations add constraint calculations_calculator_check
  check (calculator in ('flip', 'brrrr', 'land_purchase', 'comps'));
