-- qa_logs.tool_calls — the tool invocation trace, persisted.
-- ADDITIVE ONLY. Run once in the Supabase SQL editor (applied to the live
-- project 2026-08-06 as migration `add_qa_logs_tool_calls`).
--
-- Why: the /chat response has always carried `tool_calls` as trace evidence,
-- and the log discarded it. Diagnosing whether a turn actually invoked a tool
-- (the transcript-recall investigation) took forensic triangulation across
-- session_state timestamps and token accounting — one column turns that hour
-- into one query. Shape: [{ name, args, ok }] per invocation, in call order.

alter table qa_logs add column if not exists tool_calls jsonb;
