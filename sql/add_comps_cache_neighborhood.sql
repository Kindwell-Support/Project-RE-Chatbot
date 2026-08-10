-- Neighbourhood-sales raw payload rides the EXISTING comps_cache row
-- (CONTRACT §14.16.1). ADDITIVE ONLY: one nullable column; rows predating
-- it read null and trigger one live aggregate fetch on next touch, then
-- cache. Aggregates themselves are COMPUTED per serve from this raw and
-- never stored — same rule as detail and demographics enrichment. Run once
-- in the Supabase SQL editor.
alter table comps_cache add column if not exists raw_neighborhood jsonb;
