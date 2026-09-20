-- Remove legacy technical-memory tables and columns from databases created before
-- conversation-memory-mcp became a pure conversation-history service.
DROP TABLE IF EXISTS memory_candidates;
