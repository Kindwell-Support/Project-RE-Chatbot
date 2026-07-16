-- ADDITIVE ONLY. match_documents is untouched — the n8n ingestion workflow
-- depends on it. Applied to the live project 2026-07-15 as migration
-- `add_match_documents_distinct`; kept here so other environments can apply it.
--
-- Why: the documents table receives duplicate rows daily (n8n re-ingestion on
-- five schedule triggers, no dedupe — being fixed at source, in n8n). Deduping
-- in SQL keeps retrieval O(1) in the duplication ratio instead of over-fetching
-- a fixed multiple that silently goes stale as copies accumulate.
create or replace function public.match_documents_distinct(
  query_embedding vector,
  match_count integer default 5,
  filter jsonb default '{}'::jsonb,
  scan_count integer default 200
)
returns table(
  id bigint,
  content text,
  metadata jsonb,
  similarity double precision,
  scanned integer,
  distinct_scanned integer
)
language sql
stable
as $$
  with nearest as (
    select d.id as doc_id,
           d.content as doc_content,
           d.metadata as doc_metadata,
           1 - (d.embedding <=> query_embedding) as sim,
           md5(lower(regexp_replace(btrim(d.content), '\s+', ' ', 'g'))) as content_key
    from documents d
    where d.metadata @> filter
    order by d.embedding <=> query_embedding
    limit scan_count
  ),
  deduped as (
    select distinct on (n.content_key)
           n.doc_id, n.doc_content, n.doc_metadata, n.sim
    from nearest n
    order by n.content_key, n.sim desc
  ),
  stats as (
    select (select count(*) from nearest)::int as n_scanned,
           (select count(*) from deduped)::int as n_distinct
  )
  select dd.doc_id, dd.doc_content, dd.doc_metadata, dd.sim,
         s.n_scanned, s.n_distinct
  from deduped dd, stats s
  order by dd.sim desc
  limit match_count;
$$;
