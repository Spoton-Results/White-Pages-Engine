AGENT_RULES.md

STANDING RULES — READ BEFORE EVERY ACTION

1. Do not delete, remove, rewrite, or replace any existing files, functions, routes, database schema, or logic unless explicitly told to.
2. Do not refactor, clean up, simplify, or restructure anything that was not specifically requested.
3. Do not swap out libraries or reorganize folders without approval.
4. Before making any change, show me exactly what file you are changing, what you are changing, and what you are leaving untouched.
5. Make surgical fixes only. If something is broken, fix only that specific thing.
6. If you are unsure whether a change is safe, ask me first. Do not assume.
7. Do not improve things I did not ask you to improve.
8. All migrations must be backward compatible with safe defaults so existing live pages and tenants are never broken.
9. Never block a page from rendering just because it has no score or tier yet.
10. Existing pages without scores default to Tier 2 until the bulk scoring job runs.
