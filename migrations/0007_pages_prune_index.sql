-- ✅ CHANGED: support website-scoped published page pruning in deterministic batches.
-- 🔒 UNTOUCHED: no columns, constraints, statuses, or unrelated indexes are changed.
CREATE INDEX CONCURRENTLY IF NOT EXISTS pages_website_status_id_idx
ON pages (website_id, status, id);
