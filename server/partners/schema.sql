CREATE TABLE IF NOT EXISTS partner_users (
 id uuid PRIMARY KEY, email text NOT NULL UNIQUE CHECK(email=lower(email)), password_hash text,
 platform_admin boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS partner_applications (
 id uuid PRIMARY KEY, email text NOT NULL UNIQUE, company_key text NOT NULL UNIQUE, data jsonb NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','under_review','approved','rejected')),
 notes text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS partner_organizations (
 id uuid PRIMARY KEY, application_id uuid UNIQUE REFERENCES partner_applications(id), name text NOT NULL,
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','suspended')), profile jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS partner_memberships (
 user_id uuid REFERENCES partner_users(id), org_id uuid REFERENCES partner_organizations(id),
 role text NOT NULL DEFAULT 'partner_admin' CHECK(role IN ('partner_admin','partner_editor')), PRIMARY KEY(user_id,org_id), UNIQUE(user_id)
);
CREATE TABLE IF NOT EXISTS partnerships (
 org_id uuid PRIMARY KEY REFERENCES partner_organizations(id), type text NOT NULL DEFAULT 'founding',
 status text NOT NULL DEFAULT 'invited' CHECK(status IN ('invited','active','expired','suspended','terminated')),
 starts_at timestamptz, ends_at timestamptz, max_properties integer NOT NULL DEFAULT 5 CHECK(max_properties=5),
 agreement_version text NOT NULL, accepted_at timestamptz NOT NULL, representative text NOT NULL,
 advertising_permission boolean NOT NULL, logo_permission boolean NOT NULL DEFAULT false, commitments jsonb NOT NULL DEFAULT '[]'
);
CREATE TABLE IF NOT EXISTS partner_tokens (
 hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES partner_users(id), purpose text NOT NULL CHECK(purpose IN ('invite','recovery')),
 expires_at timestamptz NOT NULL, used_at timestamptz
);
CREATE TABLE IF NOT EXISTS partner_sessions (
 hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES partner_users(id), csrf text NOT NULL, expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS partner_properties (
 id uuid PRIMARY KEY, org_id uuid NOT NULL REFERENCES partner_organizations(id), slug text NOT NULL UNIQUE,
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','pending_review','changes_requested','approved','rejected','archived')),
 draft jsonb NOT NULL, published jsonb, address_key text NOT NULL, neighborhood_verified boolean NOT NULL DEFAULT false,
 review_note text NOT NULL DEFAULT '', reviewed_by uuid REFERENCES partner_users(id), reviewed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), archived_at timestamptz,
 UNIQUE(org_id,id)
);
CREATE UNIQUE INDEX IF NOT EXISTS property_address_unique ON partner_properties(address_key) WHERE status <> 'archived';
CREATE INDEX IF NOT EXISTS property_org_status ON partner_properties(org_id,status);
CREATE INDEX IF NOT EXISTS property_city_hood ON partner_properties((published->>'city'),(published->>'neighborhood')) WHERE published IS NOT NULL;
CREATE TABLE IF NOT EXISTS partner_revisions (
 id uuid PRIMARY KEY, property_id uuid NOT NULL REFERENCES partner_properties(id), actor_id uuid REFERENCES partner_users(id),
 data jsonb NOT NULL, action text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS partner_media (
 id uuid PRIMARY KEY, org_id uuid NOT NULL, property_id uuid NOT NULL, object_key text NOT NULL UNIQUE,
 alt text NOT NULL, bytes integer NOT NULL CHECK(bytes>0), created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(org_id,property_id) REFERENCES partner_properties(org_id,id)
);
CREATE TABLE IF NOT EXISTS partner_campaigns (
 id uuid PRIMARY KEY, org_id uuid NOT NULL REFERENCES partner_organizations(id), code text NOT NULL UNIQUE, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS partner_events (
 id uuid PRIMARY KEY, org_id uuid NOT NULL REFERENCES partner_organizations(id), property_id uuid REFERENCES partner_properties(id),
 kind text NOT NULL CHECK(kind IN ('impression','detail','outbound','referral')), source text NOT NULL, city text, neighborhood text,
 campaign_id uuid REFERENCES partner_campaigns(id), session_hash text NOT NULL, dedup_key text NOT NULL UNIQUE, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS partner_events_org_date ON partner_events(org_id,created_at);
CREATE INDEX IF NOT EXISTS partner_events_property_date ON partner_events(property_id,created_at);
CREATE TABLE IF NOT EXISTS partner_audit (
 id uuid PRIMARY KEY, actor_id uuid REFERENCES partner_users(id), org_id uuid REFERENCES partner_organizations(id),
 action text NOT NULL, target text NOT NULL, detail jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS partner_mail (
 id uuid PRIMARY KEY, dedup_key text NOT NULL UNIQUE, recipient text NOT NULL, subject text NOT NULL, body text NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sent','failed')), attempts integer NOT NULL DEFAULT 0,
 error text, created_at timestamptz NOT NULL DEFAULT now(), sent_at timestamptz
);
CREATE TABLE IF NOT EXISTS partner_rate_limits (key text PRIMARY KEY, count integer NOT NULL, expires_at timestamptz NOT NULL);
