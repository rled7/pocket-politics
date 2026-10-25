-- =====================================================================
-- Read queries the app renders from the affiliation schema.
-- psql usage:  psql -d <db> -v user_id=<uuid> -f affiliation_queries.sql
-- In FastAPI these become parameterized queries ($1 = user id).
-- =====================================================================

-- 1. Profile -> "My communities" (districts grouped by level, then orgs)
SELECT kind, level, district_type, org_type, name, role, visibility
FROM v_user_affiliations
WHERE user_id = :'user_id'
ORDER BY kind,
         array_position(ARRAY['federal', 'state', 'local']::jurisdiction_level[], level),
         district_type, name;

-- 2. Profile -> "Who represents me"
SELECT level, office_title, full_name, party, district_name
FROM v_current_representatives
WHERE user_id = :'user_id'
ORDER BY array_position(ARRAY['federal', 'state', 'local']::jurisdiction_level[], level), office_title, seat;

-- 3. Community page -> "Overlap with your other communities"
--    e.g. "1199SEIU members in your Senate district: 12". Suppressed rows
--    (NULL = fewer than k consenting people) are hidden, not shown as 0.
WITH mine AS (
    SELECT community_id, name FROM v_user_affiliations WHERE user_id = :'user_id'
)
SELECT * FROM (
    SELECT a.name AS community_a, b.name AS community_b,
           community_overlap(a.community_id, b.community_id) AS people
    FROM mine a
    JOIN mine b ON a.community_id < b.community_id
) pairs
WHERE people IS NOT NULL
ORDER BY people DESC;

-- 4. Org page -> parent union rollup (SEIU and all locals)
SELECT c.name, t.depth,
       (SELECT count(*) FROM memberships m WHERE m.community_id = t.org_id AND m.status = 'active') AS members
FROM organization_tree((SELECT id FROM communities WHERE slug = 'seiu')) t
JOIN communities c ON c.id = t.org_id
ORDER BY t.depth, c.name;

-- 5. Org page -> "Officials who represent this building" (tenant association)
SELECT od.district_type, o.full_name, t.office_title
FROM organization_districts((SELECT id FROM communities WHERE slug = 'grand-st-tenants')) od
JOIN official_terms t ON t.district_id = od.district_id AND t.term @> current_date
JOIN officials o      ON o.id = t.official_id
ORDER BY od.district_type;
