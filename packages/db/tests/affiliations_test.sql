-- =====================================================================
-- Affiliation schema tests. Run against a fresh DB with 001 applied:
--   psql -v ON_ERROR_STOP=1 -d <db> -f packages/db/tests/affiliations_test.sql
-- Any failure aborts with a non-zero exit. Each pass prints NOTICE PASS.
--
-- Geometry is SYNTHETIC (rectangles around lower Manhattan), not real
-- district lines. Officials are fictional.
--
-- Layout (lon -74.02..-73.93, lat 40.70..40.80):
--   State Senate   SD-59 west of -73.97 | SD-47 east
--   Assembly       AD-65 south of 40.73 | AD-74 north
--   City Council   CD-1  west of -73.98 | CD-2  east
--   US House       NY-10 south of 40.75 | NY-12 north
--   Community Bd   MN03  small box (-74.00..-73.97, 40.71..40.73)
--   US Senate      whole state box, 2 seats
-- Seed statements run outside DO blocks where the deferred geo-sync
-- trigger must commit before assertions read the result.
-- =====================================================================
\set QUIET on
\o /dev/null
SET client_min_messages = notice;

-- ---------- helpers (session-local) ----------
CREATE FUNCTION pg_temp.box(x1 float8, y1 float8, x2 float8, y2 float8) RETURNS geometry
LANGUAGE sql AS $$ SELECT ST_Multi(ST_MakeEnvelope(x1, y1, x2, y2, 4326)) $$;

CREATE FUNCTION pg_temp.pt(x float8, y float8) RETURNS geometry
LANGUAGE sql AS $$ SELECT ST_SetSRID(ST_MakePoint(x, y), 4326) $$;

CREATE FUNCTION pg_temp.c(p_slug text) RETURNS uuid
LANGUAGE sql AS $$ SELECT id FROM communities WHERE slug = p_slug $$;

CREATE FUNCTION pg_temp.u(p_handle text) RETURNS uuid
LANGUAGE sql AS $$ SELECT id FROM users WHERE handle = p_handle $$;

CREATE FUNCTION pg_temp.mk_district(p_slug text, p_name text, p_type district_type,
                                    p_region text, p_code text, p_box geometry, p_seats int DEFAULT 1)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v uuid;
BEGIN
    INSERT INTO communities (kind, name, slug) VALUES ('district', p_name, p_slug) RETURNING id INTO v;
    INSERT INTO districts (community_id, district_type, region, code, seats)
    VALUES (v, p_type, p_region, p_code, p_seats);
    INSERT INTO district_boundaries (district_id, boundary, valid, source)
    VALUES (v, p_box, daterange('2022-01-01', NULL), 'synthetic_test');
    RETURN v;
END $$;

CREATE FUNCTION pg_temp.mk_org(p_slug text, p_name text, p_type org_type,
                               p_parent text DEFAULT NULL, p_loc geometry DEFAULT NULL,
                               p_policy join_policy DEFAULT 'approval')
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v uuid;
BEGIN
    INSERT INTO communities (kind, name, slug) VALUES ('organization', p_name, p_slug) RETURNING id INTO v;
    INSERT INTO organizations (community_id, org_type, parent_id, location, join_policy)
    VALUES (v, p_type, pg_temp.c(p_parent), p_loc, p_policy);
    RETURN v;
END $$;

CREATE FUNCTION pg_temp.mk_user(p_handle text) RETURNS uuid
LANGUAGE sql AS $$
    INSERT INTO users (handle, email, password_hash)
    VALUES (p_handle, p_handle || '@example.test', 'x') RETURNING id
$$;

CREATE FUNCTION pg_temp.join_org(p_handle text, p_slug text, p_role membership_role DEFAULT 'member',
                                 p_vis visibility DEFAULT 'private', p_stats boolean DEFAULT false,
                                 p_source membership_source DEFAULT 'self_declared')
RETURNS void LANGUAGE sql AS $$
    INSERT INTO memberships (user_id, community_id, community_kind, role, source, visibility, count_in_stats)
    VALUES (pg_temp.u(p_handle), pg_temp.c(p_slug), 'organization', p_role, p_source, p_vis, p_stats)
$$;

-- Active district codes for a user, sorted
CREATE FUNCTION pg_temp.codes(p_handle text) RETURNS text[]
LANGUAGE sql AS $$
    SELECT array_agg(code ORDER BY code) FROM v_user_affiliations
    WHERE user_id = pg_temp.u(p_handle) AND kind = 'district'
$$;

-- =====================================================================
-- Seed: districts, orgs, officials
-- =====================================================================
SELECT pg_temp.mk_district('us-senate-ny', 'U.S. Senate — New York', 'us_senate',      'NY',  'NY',   pg_temp.box(-75, 40, -72, 42), 2);
SELECT pg_temp.mk_district('ny-10',        'NY-10',                  'us_house',       'NY',  '10',   pg_temp.box(-74.02, 40.70, -73.93, 40.75));
SELECT pg_temp.mk_district('ny-12',        'NY-12',                  'us_house',       'NY',  '12',   pg_temp.box(-74.02, 40.75, -73.93, 40.80));
SELECT pg_temp.mk_district('sd-59',        'State Senate District 59','state_senate',  'NY',  '59',   pg_temp.box(-74.02, 40.70, -73.97, 40.80));
SELECT pg_temp.mk_district('sd-47',        'State Senate District 47','state_senate',  'NY',  '47',   pg_temp.box(-73.97, 40.70, -73.93, 40.80));
SELECT pg_temp.mk_district('ad-65',        'Assembly District 65',   'state_assembly', 'NY',  '65',   pg_temp.box(-74.02, 40.70, -73.93, 40.73));
SELECT pg_temp.mk_district('ad-74',        'Assembly District 74',   'state_assembly', 'NY',  '74',   pg_temp.box(-74.02, 40.73, -73.93, 40.80));
SELECT pg_temp.mk_district('cd-1',         'Council District 1',     'city_council',   'NYC', '1',    pg_temp.box(-74.02, 40.70, -73.98, 40.80));
SELECT pg_temp.mk_district('cd-2',         'Council District 2',     'city_council',   'NYC', '2',    pg_temp.box(-73.98, 40.70, -73.93, 40.80));
SELECT pg_temp.mk_district('cb-mn03',      'Manhattan Community Board 3', 'community_board', 'NYC', 'MN03', pg_temp.box(-74.00, 40.71, -73.97, 40.73));

SELECT pg_temp.mk_org('seiu',             'SEIU',                         'labor_union');
SELECT pg_temp.mk_org('1199seiu',         '1199SEIU',                     'labor_union', 'seiu');
SELECT pg_temp.mk_org('32bj-seiu',        '32BJ SEIU',                    'labor_union', 'seiu');
SELECT pg_temp.mk_org('grand-st-tenants', 'Grand St Tenants Association', 'tenant_association', NULL, pg_temp.pt(-73.985, 40.72));
SELECT pg_temp.mk_org('les-town-hall',    'Lower East Side Town Hall',    'civic_forum', NULL, pg_temp.pt(-73.99, 40.715), 'open');

INSERT INTO officials (full_name, party) VALUES
    ('Demo Senator One', 'D'), ('Demo Senator Two', 'D'), ('Demo Rep Ten', 'D'), ('Demo Rep Twelve', 'D'),
    ('Demo State Senator 59', 'D'), ('Demo State Senator 47', 'D'),
    ('Demo Assembly 65', 'D'), ('Demo Assembly 74', 'D'),
    ('Demo Council 1', 'D'), ('Demo Council 2', 'D');

INSERT INTO official_terms (official_id, district_id, office_title, seat, term)
SELECT o.id, pg_temp.c(x.slug), x.title, x.seat, daterange('2025-01-01', '2027-01-01')
FROM (VALUES
    ('Demo Senator One',      'us-senate-ny', 'U.S. Senator',      1),
    ('Demo Senator Two',      'us-senate-ny', 'U.S. Senator',      2),
    ('Demo Rep Ten',          'ny-10',        'U.S. Representative', 1),
    ('Demo Rep Twelve',       'ny-12',        'U.S. Representative', 1),
    ('Demo State Senator 59', 'sd-59',        'State Senator',     1),
    ('Demo State Senator 47', 'sd-47',        'State Senator',     1),
    ('Demo Assembly 65',      'ad-65',        'Assembly Member',   1),
    ('Demo Assembly 74',      'ad-74',        'Assembly Member',   1),
    ('Demo Council 1',        'cd-1',         'Council Member',    1),
    ('Demo Council 2',        'cd-2',         'Council Member',    1)
) AS x(name, slug, title, seat)
JOIN officials o ON o.full_name = x.name;

-- =====================================================================
-- Seed: people + residences (each statement commits -> geo sync fires)
-- =====================================================================
SELECT pg_temp.mk_user(h) FROM unnest(ARRAY['maria', 'james', 'ana', 'leo']) AS h;
INSERT INTO residences (user_id, location) VALUES (pg_temp.u('maria'), pg_temp.pt(-73.985, 40.72));
INSERT INTO residences (user_id, location) VALUES (pg_temp.u('james'), pg_temp.pt(-73.95,  40.78));
INSERT INTO residences (user_id, location) VALUES (pg_temp.u('ana'),   pg_temp.pt(-73.99,  40.74));
INSERT INTO residences (user_id, location) VALUES (pg_temp.u('leo'),   pg_temp.pt(-73.98,  40.72));  -- exactly on CD-1/CD-2 line

-- 12 more 1199 members living in SD-59, 3 more 32BJ members in SD-47
SELECT pg_temp.mk_user(format('res%s', lpad(i::text, 2, '0'))) FROM generate_series(1, 12) i;
INSERT INTO residences (user_id, location)
SELECT pg_temp.u(format('res%s', lpad(i::text, 2, '0'))), pg_temp.pt(-74.00, 40.72) FROM generate_series(1, 12) i;
SELECT pg_temp.mk_user(format('bj%s', i)) FROM generate_series(1, 3) i;
INSERT INTO residences (user_id, location)
SELECT pg_temp.u(format('bj%s', i)), pg_temp.pt(-73.95, 40.76) FROM generate_series(1, 3) i;

-- Org memberships
SELECT pg_temp.join_org('maria', '1199seiu',         'member',  'members', true);
SELECT pg_temp.join_org('maria', 'grand-st-tenants', 'officer', 'public',  true, 'org_verified');
SELECT pg_temp.join_org('maria', 'les-town-hall',    'member',  'public',  false);
SELECT pg_temp.join_org('james', '32bj-seiu');                                      -- private, no stats
SELECT pg_temp.join_org(format('res%s', lpad(i::text, 2, '0')), '1199seiu', 'member', 'private', true) FROM generate_series(1, 12) i;
SELECT pg_temp.join_org(format('bj%s', i), '32bj-seiu', 'member', 'private', true) FROM generate_series(1, 3) i;

-- =====================================================================
-- Tests
-- =====================================================================

-- T1 worst case: Maria = 6 districts + union + tenant assoc + town hall
DO $$ BEGIN
    ASSERT pg_temp.codes('maria') = ARRAY['1', '10', '59', '65', 'MN03', 'NY'],
        format('T1 maria districts: %s', pg_temp.codes('maria'));
    ASSERT (SELECT count(*) FROM v_user_affiliations WHERE user_id = pg_temp.u('maria') AND kind = 'organization') = 3,
        'T1 maria orgs';
    RAISE NOTICE 'PASS T1  worst case: 6 districts + 3 orgs from one address + 3 joins';
END $$;

-- T2 non-participant still has districts
DO $$ BEGIN
    ASSERT pg_temp.codes('ana') = ARRAY['1', '10', '59', '74', 'NY'], format('T2 ana: %s', pg_temp.codes('ana'));
    ASSERT NOT EXISTS (SELECT 1 FROM v_user_affiliations WHERE user_id = pg_temp.u('ana') AND kind = 'organization'),
        'T2 ana has orgs';
    RAISE NOTICE 'PASS T2  non-participant: 5 districts, 0 orgs';
END $$;

-- T3 point exactly on a boundary resolves to exactly one district per type
DO $$ BEGIN
    ASSERT (SELECT count(*) FROM v_user_affiliations
            WHERE user_id = pg_temp.u('leo') AND district_type = 'city_council') = 1, 'T3 leo council count';
    ASSERT (SELECT code FROM v_user_affiliations
            WHERE user_id = pg_temp.u('leo') AND district_type = 'city_council') = '1', 'T3 leo tie-break';
    RAISE NOTICE 'PASS T3  boundary point: one council district, deterministic tie-break';
END $$;

-- T4 who represents me (US Senate has 2 seats; community board has no official)
DO $$ BEGIN
    ASSERT (SELECT count(*) FROM v_current_representatives WHERE user_id = pg_temp.u('maria')) = 6,
        format('T4 maria reps: %s', (SELECT count(*) FROM v_current_representatives WHERE user_id = pg_temp.u('maria')));
    RAISE NOTICE 'PASS T4  representatives: 6 officials across federal/state/local';
END $$;

-- T5 two people can't hold the same seat at the same time
DO $$ BEGIN
    BEGIN
        INSERT INTO officials (full_name) VALUES ('Interloper');
        INSERT INTO official_terms (official_id, district_id, office_title, seat, term)
        VALUES ((SELECT id FROM officials WHERE full_name = 'Interloper'), pg_temp.c('sd-59'),
                'State Senator', 1, daterange('2026-01-01', '2026-12-31'));
        RAISE EXCEPTION 'T5 FAIL: overlapping term accepted';
    EXCEPTION WHEN exclusion_violation THEN
        RAISE NOTICE 'PASS T5  overlapping official terms rejected';
    END;
END $$;

-- T6 org hierarchy cycle rejected (SEIU -> 1199SEIU -> SEIU)
DO $$ BEGIN
    BEGIN
        UPDATE organizations SET parent_id = pg_temp.c('1199seiu') WHERE community_id = pg_temp.c('seiu');
        RAISE EXCEPTION 'T6 FAIL: cycle accepted';
    EXCEPTION WHEN check_violation THEN
        RAISE NOTICE 'PASS T6  org hierarchy cycle rejected';
    END;
END $$;

-- T7 duplicate open membership rejected
DO $$ BEGIN
    BEGIN
        PERFORM pg_temp.join_org('maria', '1199seiu');
        RAISE EXCEPTION 'T7 FAIL: duplicate accepted';
    EXCEPTION WHEN unique_violation THEN
        RAISE NOTICE 'PASS T7  duplicate open membership rejected';
    END;
END $$;

-- T8 can't self-declare a district (districts only come from address)
DO $$ BEGIN
    BEGIN
        INSERT INTO memberships (user_id, community_id, community_kind, source)
        VALUES (pg_temp.u('ana'), pg_temp.c('sd-47'), 'district', 'self_declared');
        RAISE EXCEPTION 'T8 FAIL: self-declared district accepted';
    EXCEPTION WHEN check_violation THEN
        RAISE NOTICE 'PASS T8  self-declared district membership rejected';
    END;
END $$;

-- T9 a community can't be both a district and an organization
DO $$ BEGIN
    BEGIN
        INSERT INTO organizations (community_id, org_type) VALUES (pg_temp.c('sd-59'), 'other');
        RAISE EXCEPTION 'T9 FAIL: district reused as org';
    EXCEPTION WHEN foreign_key_violation THEN
        RAISE NOTICE 'PASS T9  district cannot double as organization';
    END;
END $$;

-- T10 tenant association must have a building location
DO $$ BEGIN
    BEGIN
        PERFORM pg_temp.mk_org('no-building', 'Nowhere Tenants', 'tenant_association');
        RAISE EXCEPTION 'T10 FAIL: tenant assoc without location';
    EXCEPTION WHEN check_violation THEN
        RAISE NOTICE 'PASS T10 tenant association requires location';
    END;
END $$;

-- T11 one primary residence at a time
DO $$ BEGIN
    BEGIN
        INSERT INTO residences (user_id, location) VALUES (pg_temp.u('maria'), pg_temp.pt(-73.95, 40.78));
        RAISE EXCEPTION 'T11 FAIL: second primary residence accepted';
    EXCEPTION WHEN exclusion_violation THEN
        RAISE NOTICE 'PASS T11 overlapping primary residences rejected';
    END;
END $$;

-- T12 invalid (self-intersecting) district geometry rejected at import
DO $$ BEGIN
    BEGIN
        INSERT INTO district_boundaries (district_id, boundary, valid, source)
        VALUES (pg_temp.c('cb-mn03'),
                ST_Multi(ST_GeomFromText('POLYGON((0 0, 1 1, 1 0, 0 1, 0 0))', 4326)),
                daterange('2030-01-01', NULL), 'bad_import');
        RAISE EXCEPTION 'T12 FAIL: bowtie polygon accepted';
    EXCEPTION WHEN check_violation THEN
        RAISE NOTICE 'PASS T12 invalid boundary geometry rejected';
    END;
END $$;

-- T13 two boundary versions for one district can't overlap in time
DO $$ BEGIN
    BEGIN
        INSERT INTO district_boundaries (district_id, boundary, valid, source)
        VALUES (pg_temp.c('cd-1'), pg_temp.box(-74.02, 40.70, -73.98, 40.80), daterange('2024-01-01', NULL), 'dup');
        RAISE EXCEPTION 'T13 FAIL: overlapping boundary versions accepted';
    EXCEPTION WHEN exclusion_violation THEN
        RAISE NOTICE 'PASS T13 overlapping boundary versions rejected';
    END;
END $$;

-- T14 tenant association's building -> its districts (same as Maria's)
DO $$ BEGIN
    ASSERT (SELECT array_agg(code ORDER BY code) FROM organization_districts(pg_temp.c('grand-st-tenants')))
           = pg_temp.codes('maria'), 'T14 org districts';
    RAISE NOTICE 'PASS T14 organization location resolves to districts';
END $$;

-- T15 member-list visibility by viewer
DO $$ BEGIN
    -- James isn't in 1199: Maria is members-only, everyone else private
    ASSERT (SELECT count(*) FROM community_members(pg_temp.c('1199seiu'), pg_temp.u('james'))) = 0, 'T15 outsider';
    -- res01 is a fellow member: sees Maria + self
    ASSERT (SELECT count(*) FROM community_members(pg_temp.c('1199seiu'), pg_temp.u('res01'))) = 2, 'T15 member';
    ASSERT EXISTS (SELECT 1 FROM community_members(pg_temp.c('1199seiu'), pg_temp.u('res01')) WHERE handle = 'maria'),
        'T15 member sees maria';
    -- Tenant association listing is public
    ASSERT (SELECT count(*) FROM community_members(pg_temp.c('grand-st-tenants'), pg_temp.u('ana'))) = 1, 'T15 public';
    RAISE NOTICE 'PASS T15 member lists respect private/members/public';
END $$;

-- T16 overlap counts: consent-only, suppressed below k
DO $$ BEGIN
    ASSERT community_overlap(pg_temp.c('1199seiu'), pg_temp.c('sd-59')) = 13,
        format('T16 1199 x SD-59 = %s', community_overlap(pg_temp.c('1199seiu'), pg_temp.c('sd-59')));
    -- 3 consenting 32BJ members in SD-47 (James didn't consent) -> below k -> NULL
    ASSERT community_overlap(pg_temp.c('32bj-seiu'), pg_temp.c('sd-47')) IS NULL, 'T16 suppression';
    ASSERT community_overlap(pg_temp.c('32bj-seiu'), pg_temp.c('sd-47'), 3) = 3, 'T16 consent filter';
    RAISE NOTICE 'PASS T16 overlap: 13 shown, small group suppressed, non-consent excluded';
END $$;

-- T17 union rollup: SEIU tree = SEIU + 1199 + 32BJ, 17 distinct members
DO $$ BEGIN
    ASSERT (SELECT count(*) FROM organization_tree(pg_temp.c('seiu'))) = 3, 'T17 tree size';
    ASSERT (SELECT count(DISTINCT m.user_id)
            FROM organization_tree(pg_temp.c('seiu')) t
            JOIN memberships m ON m.community_id = t.org_id AND m.status = 'active') = 17, 'T17 rollup';
    RAISE NOTICE 'PASS T17 union hierarchy rollup';
END $$;

-- T18 moving: unchanged districts keep the same membership row
CREATE TEMP TABLE before_move AS
SELECT community_id, id AS membership_id FROM memberships
WHERE user_id = pg_temp.u('ana') AND status = 'active';

SELECT move_residence(pg_temp.u('ana'), pg_temp.pt(-74.00, 40.76));   -- NY-10 -> NY-12, rest same

DO $$ BEGIN
    ASSERT pg_temp.codes('ana') = ARRAY['1', '12', '59', '74', 'NY'], format('T18 ana after: %s', pg_temp.codes('ana'));
    ASSERT (SELECT m.id FROM memberships m WHERE m.user_id = pg_temp.u('ana')
              AND m.community_id = pg_temp.c('sd-59') AND m.status = 'active')
           = (SELECT membership_id FROM before_move WHERE community_id = pg_temp.c('sd-59')),
        'T18 SD-59 membership churned';
    ASSERT EXISTS (SELECT 1 FROM memberships WHERE user_id = pg_temp.u('ana')
                   AND community_id = pg_temp.c('ny-10') AND status = 'ended'), 'T18 NY-10 not ended';
    ASSERT (SELECT count(*) FROM residences WHERE user_id = pg_temp.u('ana')) = 2, 'T18 residence history';
    RAISE NOTICE 'PASS T18 move: NY-10 ended, NY-12 added, unchanged districts kept';
END $$;

-- T19 redistricting: new SD lines effective today; identity preserved
UPDATE district_boundaries SET valid = daterange(lower(valid), current_date)
WHERE district_id IN (pg_temp.c('sd-59'), pg_temp.c('sd-47')) AND upper_inf(valid);
INSERT INTO district_boundaries (district_id, boundary, valid, source) VALUES
    (pg_temp.c('sd-59'), pg_temp.box(-74.02, 40.70, -73.99, 40.80), daterange(current_date, NULL), 'synthetic_redistrict'),
    (pg_temp.c('sd-47'), pg_temp.box(-73.99, 40.70, -73.93, 40.80), daterange(current_date, NULL), 'synthetic_redistrict');
SELECT resync_all_geo_memberships();

DO $$ BEGIN
    ASSERT '47' = ANY (pg_temp.codes('maria')) AND NOT '59' = ANY (pg_temp.codes('maria')),
        format('T19 maria: %s', pg_temp.codes('maria'));
    ASSERT '59' = ANY (pg_temp.codes('ana')), 'T19 ana should stay in 59';
    ASSERT EXISTS (SELECT 1 FROM v_current_representatives
                   WHERE user_id = pg_temp.u('maria') AND full_name = 'Demo State Senator 47'), 'T19 new senator';
    ASSERT community_overlap(pg_temp.c('1199seiu'), pg_temp.c('sd-59')) = 12, 'T19 overlap after redistrict';
    RAISE NOTICE 'PASS T19 redistricting moves Maria to SD-47; history kept';
END $$;

-- T20 deleting a user removes their memberships and residences
DO $$ BEGIN
    DELETE FROM users WHERE handle = 'bj3';
    ASSERT NOT EXISTS (SELECT 1 FROM memberships m LEFT JOIN users u ON u.id = m.user_id WHERE u.id IS NULL),
        'T20 orphan memberships';
    RAISE NOTICE 'PASS T20 hard delete cascades';
END $$;

\echo 'ALL TESTS PASSED'
