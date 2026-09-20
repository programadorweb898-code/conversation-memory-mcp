-- Remove legacy technical-memory tables from databases created before
-- conversation-memory-mcp became a pure conversation-history service.
DROP TABLE IF EXISTS memory_candidates;
