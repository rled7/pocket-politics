-- =====================================================================
-- Pocket Politics — 001 Identity & Affiliations (reference DDL)
-- Target: PostgreSQL 16 + PostGIS 3 + btree_gist
--
-- First migration (PHASES task 1.5). Verified by
-- packages/db/tests/affiliations_test.sql.
--
-- Model in one sentence:
--   A person (users) lives somewhere (residences), which places them in
--   districts automatically; they can also join organizations (unions,
--   tenant associations, town halls). Districts and organizations are both
--   "communities", so every affiliation is one row in one table
--   (memberships), however many overlap.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS btree_gist;   -- uuid/int equality inside EXCLUDE constraints

-- ---------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------
CREATE TYPE user_role          AS ENUM ('citizen', 'moderator', 'admin');
CREATE TYPE community_kind     AS ENUM ('district', 'organization');
CREATE TYPE district_type      AS ENUM (
    'community_board',   -- NYC community district
    'city_council',
    'borough',
    'state_assembly',
    'state_senate',
    'us_house',
    'us_senate'          -- statewide, 2 seats
);
CREATE TYPE jurisdiction_level AS ENUM ('local', 'state', 'federal');
CREATE TYPE org_type           AS ENUM (
    'labor_union',          -- 1199SEIU, 32BJ SEIU, ...
    'tenant_association',   -- building / complex tenant union
    'civic_forum',          -- town hall, community council
    'community_group',
    'advocacy_group',
    'other'
);
CREATE TYPE join_policy        AS ENUM ('open', 'approval', 'invite_only');
CREATE TYPE membership_source  AS ENUM ('geo', 'self_declared', 'org_verified', 'admin');
CREATE TYPE membership_status  AS ENUM ('pending', 'active', 'ended');
CREATE TYPE membership_role    AS ENUM ('member', 'officer', 'page_admin');
CREATE TYPE visibility         AS ENUM ('private', 'members', 'public');

-- ---------------------------------------------------------------------
-- People
-- ---------------------------------------------------------------------
CREATE TABLE users (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    handle        text NOT NULL CHECK (handle ~ '^[A-Za-z0-9_]{3,30}$'),
    display_name  text,
    email         text NOT NULL,
    password_hash text NOT NULL,
    role          user_role NOT NULL DEFAULT 'citizen',
    created_at    timestamptz NOT NULL DEFAULT now(),
    deleted_at    timestamptz
);
CREATE UNIQUE INDEX users_handle_lower_uq ON users (lower(handle));
CREATE UNIQUE INDEX users_email_lower_uq  ON users (lower(email));

-- Where a person lives. Only the geocoded point + postcode are stored;
-- the street address string is discarded after geocoding.
-- History is kept (valid range) so past district membership is explainable.
CREATE TABLE residences (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    location    geometry(Point, 4326) NOT NULL,
    postcode    text,
    is_primary  boolean NOT NULL DEFAULT true,
    verified_at timestamptz,                         -- NULL = self-reported
    valid       tstzrange NOT NULL DEFAULT tstzrange(now(), NULL),
    -- one primary residence at a time
    EXCLUDE USING gist (user_id WITH =, valid WITH &&) WHERE (is_primary)
);
CREATE INDEX residences_location_gix ON residences USING gist (location);

-- ---------------------------------------------------------------------
-- Communities: supertype for everything a person can belong to.
-- (id, kind) + composite FKs below guarantee a community is EITHER a
-- district OR an organization, never both.
-- ---------------------------------------------------------------------
CREATE TABLE communities (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    kind        community_kind NOT NULL,
    name        text NOT NULL,
    slug        text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9-]+$'),
    description text,
    created_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (id, kind)
);

-- Districts: identity is stable across redistricting (Senate District 59
-- stays the same community, so its ideas/history survive); geometry is
-- versioned separately in district_boundaries.
CREATE TABLE districts (
    community_id  uuid PRIMARY KEY,
    kind          community_kind NOT NULL DEFAULT 'district' CHECK (kind = 'district'),
    district_type district_type NOT NULL,
    level         jurisdiction_level GENERATED ALWAYS AS (
                      CASE
                          WHEN district_type IN ('us_house', 'us_senate')           THEN 'federal'::jurisdiction_level
                          WHEN district_type IN ('state_assembly', 'state_senate')  THEN 'state'::jurisdiction_level
                          ELSE 'local'::jurisdiction_level
                      END) STORED,
    region        text NOT NULL,          -- 'NY' (state/federal), 'NYC' (city)
    code          text NOT NULL,          -- '59', '10', 'MN03'
    seats         smallint NOT NULL DEFAULT 1 CHECK (seats BETWEEN 1 AND 51),
    FOREIGN KEY (community_id, kind) REFERENCES communities (id, kind) ON DELETE CASCADE,
    UNIQUE (district_type, region, code)
);

CREATE TABLE district_boundaries (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    district_id uuid NOT NULL REFERENCES districts (community_id) ON DELETE CASCADE,
    boundary    geometry(MultiPolygon, 4326) NOT NULL CHECK (ST_IsValid(boundary)),
    valid       daterange NOT NULL CHECK (NOT isempty(valid)),
    source      text NOT NULL,            -- e.g. 'census_tiger_2024', 'nyc_dcp_25a'
    -- one boundary version per district at any date
    EXCLUDE USING gist (district_id WITH =, valid WITH &&)
);
CREATE INDEX district_boundaries_gix ON district_boundaries USING gist (boundary);

-- Organizations: unions, tenant associations, town halls, ...
CREATE TABLE organizations (
    community_id uuid PRIMARY KEY,
    kind         community_kind NOT NULL DEFAULT 'organization' CHECK (kind = 'organization'),
    org_type     org_type NOT NULL,
    parent_id    uuid REFERENCES organizations (community_id) ON DELETE SET NULL,  -- SEIU -> 32BJ
    location     geometry(Point, 4326),   -- building / meeting hall; NULL for city/statewide orgs
    join_policy  join_policy NOT NULL DEFAULT 'approval',
    verified_at  timestamptz,             -- page claimed by real officers
    FOREIGN KEY (community_id, kind) REFERENCES communities (id, kind) ON DELETE CASCADE,
    CHECK (parent_id IS DISTINCT FROM community_id),
    CHECK (org_type <> 'tenant_association' OR location IS NOT NULL)
);
CREATE INDEX organizations_parent_idx   ON organizations (parent_id);
CREATE INDEX organizations_location_gix ON organizations USING gist (location);

-- Prevent hierarchy cycles (A -> B -> A). Advisory lock serializes
-- concurrent re-parenting so two transactions can't each close half a loop.
CREATE FUNCTION organizations_no_cycle() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.parent_id IS NULL THEN
        RETURN NEW;
    END IF;
    PERFORM pg_advisory_xact_lock(hashtext('org_hierarchy'));
    IF EXISTS (
        WITH RECURSIVE anc(id) AS (
            SELECT NEW.parent_id
            UNION
            SELECT o.parent_id
            FROM organizations o
            JOIN anc ON o.community_id = anc.id
            WHERE o.parent_id IS NOT NULL
        )
        SELECT 1 FROM anc WHERE id = NEW.community_id
    ) THEN
        RAISE EXCEPTION 'organization hierarchy cycle: % -> %', NEW.community_id, NEW.parent_id
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER organizations_no_cycle
BEFORE INSERT OR UPDATE OF parent_id ON organizations
FOR EACH ROW EXECUTE FUNCTION organizations_no_cycle();

-- ---------------------------------------------------------------------
-- Memberships: the single many-to-many between people and communities.
-- Worst case (union + tenant assoc + town hall + 6 districts) is just
-- nine rows here.
-- ---------------------------------------------------------------------
CREATE TABLE memberships (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id        uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    community_id   uuid NOT NULL,
    community_kind community_kind NOT NULL,
    role           membership_role NOT NULL DEFAULT 'member',
    source         membership_source NOT NULL,
    status         membership_status NOT NULL DEFAULT 'active',
    visibility     visibility NOT NULL DEFAULT 'private',
    count_in_stats boolean NOT NULL DEFAULT false,   -- consent to appear in aggregate counts
    started_at     timestamptz NOT NULL DEFAULT now(),
    ended_at       timestamptz,
    FOREIGN KEY (community_id, community_kind) REFERENCES communities (id, kind) ON DELETE CASCADE,
    -- districts come ONLY from address; orgs NEVER from address
    CHECK ((community_kind = 'district') = (source = 'geo')),
    -- districts have no officers/admins
    CHECK (community_kind = 'organization' OR role = 'member'),
    CHECK ((status = 'ended') = (ended_at IS NOT NULL))
);
-- one open (pending/active) membership per person per community; history allowed
CREATE UNIQUE INDEX memberships_one_open_uq      ON memberships (user_id, community_id) WHERE status <> 'ended';
CREATE INDEX        memberships_community_active ON memberships (community_id)          WHERE status = 'active';
CREATE INDEX        memberships_user_active      ON memberships (user_id)               WHERE status = 'active';

-- ---------------------------------------------------------------------
-- Elected officials and their terms
-- ---------------------------------------------------------------------
CREATE TABLE officials (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    full_name  text NOT NULL,
    party      text,
    website    text,
    user_id    uuid UNIQUE REFERENCES users (id) ON DELETE SET NULL,   -- claimed profile
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE official_terms (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    official_id  uuid NOT NULL REFERENCES officials (id) ON DELETE CASCADE,
    district_id  uuid NOT NULL REFERENCES districts (community_id) ON DELETE RESTRICT,
    office_title text NOT NULL,           -- 'State Senator', 'Council Member'
    seat         smallint NOT NULL DEFAULT 1 CHECK (seat >= 1),
    term         daterange NOT NULL CHECK (NOT isempty(term)),
    -- no two people in the same seat at the same time
    EXCLUDE USING gist (district_id WITH =, seat WITH =, term WITH &&)
);
CREATE INDEX official_terms_official_idx ON official_terms (official_id);

-- =====================================================================
-- Geo sync: address -> district memberships
-- =====================================================================

-- Recompute one person's district memberships from their current primary
-- residence. Districts they're still in keep the SAME membership row
-- (started_at preserved); districts they left are ended; new ones added.
-- Point exactly on a boundary: one district per type, lowest code wins
-- (deterministic; flagged in EDGE_CASES.md for manual review).
CREATE FUNCTION sync_geo_memberships(p_user_id uuid) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
    PERFORM pg_advisory_xact_lock(hashtext('geo:' || p_user_id::text));

    WITH target AS (
        SELECT DISTINCT ON (d.district_type) d.community_id
        FROM residences r
        JOIN district_boundaries b
          ON b.valid @> current_date
         AND ST_Covers(b.boundary, r.location)
        JOIN districts d ON d.community_id = b.district_id
        WHERE r.user_id = p_user_id
          AND r.is_primary
          AND r.valid @> now()
        ORDER BY d.district_type, d.code
    ),
    ended AS (
        UPDATE memberships m
           SET status = 'ended', ended_at = now()
         WHERE m.user_id = p_user_id
           AND m.source = 'geo'
           AND m.status = 'active'
           AND m.community_id NOT IN (SELECT community_id FROM target)
    )
    INSERT INTO memberships (user_id, community_id, community_kind, source, status, visibility, count_in_stats)
    SELECT p_user_id, t.community_id, 'district', 'geo', 'active', 'private', true
    FROM target t
    WHERE NOT EXISTS (
        SELECT 1 FROM memberships m
        WHERE m.user_id = p_user_id
          AND m.community_id = t.community_id
          AND m.status = 'active'
    );
END $$;

-- Deferred so a move (end old residence + insert new) is evaluated once,
-- at commit, against the final state: no end/restart churn.
CREATE FUNCTION residences_sync_trg() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP IN ('INSERT', 'UPDATE') THEN
        PERFORM sync_geo_memberships(NEW.user_id);
    END IF;
    IF TG_OP = 'DELETE' OR (TG_OP = 'UPDATE' AND NEW.user_id <> OLD.user_id) THEN
        PERFORM sync_geo_memberships(OLD.user_id);
    END IF;
    RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER residences_sync_geo
AFTER INSERT OR UPDATE OR DELETE ON residences
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION residences_sync_trg();

-- App entry point for "I moved". One transaction.
CREATE FUNCTION move_residence(p_user_id uuid, p_location geometry, p_postcode text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
    v_id uuid;
BEGIN
    UPDATE residences
       SET valid = tstzrange(lower(valid), now())
     WHERE user_id = p_user_id AND is_primary AND upper_inf(valid);

    INSERT INTO residences (user_id, location, postcode)
    VALUES (p_user_id, p_location, p_postcode)
    RETURNING id INTO v_id;

    RETURN v_id;
END $$;

-- Redistricting job: after loading new district_boundaries versions,
-- re-run sync for everyone with a current residence. Production runs this
-- in user-id chunks from a queued job, not one transaction.
CREATE FUNCTION resync_all_geo_memberships() RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
    v_user uuid;
    v_n    integer := 0;
BEGIN
    FOR v_user IN
        SELECT DISTINCT user_id FROM residences WHERE is_primary AND valid @> now()
    LOOP
        PERFORM sync_geo_memberships(v_user);
        v_n := v_n + 1;
    END LOOP;
    RETURN v_n;
END $$;

-- =====================================================================
-- Read-side helpers (what the app renders)
-- =====================================================================

-- Every active affiliation for a person, districts and orgs together.
CREATE VIEW v_user_affiliations AS
SELECT m.user_id,
       m.community_id,
       c.kind,
       c.name,
       c.slug,
       d.district_type,
       d.level,
       d.code,
       o.org_type,
       o.parent_id,
       m.role,
       m.source,
       m.visibility,
       m.started_at
FROM memberships m
JOIN communities c        ON c.id = m.community_id
LEFT JOIN districts d     ON d.community_id = m.community_id
LEFT JOIN organizations o ON o.community_id = m.community_id
WHERE m.status = 'active';

-- "Who represents me": district memberships -> current terms -> officials.
CREATE VIEW v_current_representatives AS
SELECT m.user_id,
       d.community_id AS district_id,
       c.name         AS district_name,
       d.district_type,
       d.level,
       t.office_title,
       t.seat,
       o.id           AS official_id,
       o.full_name,
       o.party
FROM memberships m
JOIN districts d      ON d.community_id = m.community_id
JOIN communities c    ON c.id = d.community_id
JOIN official_terms t ON t.district_id = d.community_id AND t.term @> current_date
JOIN officials o      ON o.id = t.official_id
WHERE m.source = 'geo' AND m.status = 'active';

-- Districts an organization's location falls in (e.g. which senator and
-- council member represent a tenant association's building).
CREATE FUNCTION organization_districts(p_org_id uuid)
RETURNS TABLE (district_id uuid, district_type district_type, code text)
LANGUAGE sql STABLE AS $$
    SELECT DISTINCT ON (d.district_type) d.community_id, d.district_type, d.code
    FROM organizations o
    JOIN district_boundaries b ON b.valid @> current_date AND ST_Covers(b.boundary, o.location)
    JOIN districts d           ON d.community_id = b.district_id
    WHERE o.community_id = p_org_id
    ORDER BY d.district_type, d.code
$$;

-- An organization and all its descendants (SEIU -> 1199SEIU, 32BJ, ...).
CREATE FUNCTION organization_tree(p_root uuid)
RETURNS TABLE (org_id uuid, depth integer)
LANGUAGE sql STABLE AS $$
    WITH RECURSIVE t(org_id, depth) AS (
        SELECT p_root, 0
        UNION ALL
        SELECT o.community_id, t.depth + 1
        FROM organizations o
        JOIN t ON o.parent_id = t.org_id
        WHERE t.depth < 20
    )
    SELECT org_id, depth FROM t
$$;

-- Member list as seen by a given viewer. private = only yourself;
-- members = fellow active members; public = everyone.
CREATE FUNCTION community_members(p_community_id uuid, p_viewer_id uuid)
RETURNS TABLE (user_id uuid, handle text, role membership_role, since timestamptz)
LANGUAGE sql STABLE AS $$
    SELECT u.id, u.handle, m.role, m.started_at
    FROM memberships m
    JOIN users u ON u.id = m.user_id
    WHERE m.community_id = p_community_id
      AND m.status = 'active'
      AND u.deleted_at IS NULL
      AND (   m.visibility = 'public'
           OR m.user_id = p_viewer_id
           OR (m.visibility = 'members' AND EXISTS (
                   SELECT 1 FROM memberships v
                   WHERE v.user_id = p_viewer_id
                     AND v.community_id = p_community_id
                     AND v.status = 'active')))
$$;

-- How many people are in BOTH communities (e.g. 32BJ members in Senate
-- District 59). Only counts consenting memberships, and returns NULL
-- below k so small groups can't be singled out.
CREATE FUNCTION community_overlap(p_a uuid, p_b uuid, p_k integer DEFAULT 10)
RETURNS integer
LANGUAGE sql STABLE AS $$
    SELECT CASE WHEN n >= p_k THEN n END
    FROM (
        SELECT count(*)::integer AS n
        FROM memberships a
        JOIN memberships b ON b.user_id = a.user_id
        WHERE a.community_id = p_a AND a.status = 'active' AND a.count_in_stats
          AND b.community_id = p_b AND b.status = 'active' AND b.count_in_stats
    ) s
$$;
