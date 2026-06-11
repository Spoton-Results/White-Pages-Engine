-- ✅ CHANGED: align page_type enum with current Blueprint UI and add X vs Y comparison
ALTER TYPE page_type ADD VALUE IF NOT EXISTS 'state_service';
ALTER TYPE page_type ADD VALUE IF NOT EXISTS 'industry_state';
ALTER TYPE page_type ADD VALUE IF NOT EXISTS 'service_problem';
ALTER TYPE page_type ADD VALUE IF NOT EXISTS 'city_service_problem';
ALTER TYPE page_type ADD VALUE IF NOT EXISTS 'comparison';
