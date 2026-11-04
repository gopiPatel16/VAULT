--
-- PostgreSQL database dump
--

\restrict DUKNhvNINhwlcdw83HS63sj6hHpVPbycv9fqfKa6qWMo9YD1yieOKSl0XjjwWH8

-- Dumped from database version 16.14 (Homebrew)
-- Dumped by pg_dump version 16.14 (Homebrew)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

ALTER TABLE IF EXISTS ONLY public.vault_secret DROP CONSTRAINT IF EXISTS vault_secret_updated_by_fkey;
ALTER TABLE IF EXISTS ONLY public.sessions DROP CONSTRAINT IF EXISTS sessions_device_id_fkey;
ALTER TABLE IF EXISTS ONLY public.sessions DROP CONSTRAINT IF EXISTS sessions_client_id_fkey;
ALTER TABLE IF EXISTS ONLY public.favorites DROP CONSTRAINT IF EXISTS favorites_document_id_fkey;
ALTER TABLE IF EXISTS ONLY public.favorites DROP CONSTRAINT IF EXISTS favorites_client_id_fkey;
ALTER TABLE IF EXISTS ONLY public.enrollment_codes DROP CONSTRAINT IF EXISTS enrollment_codes_created_by_admin_fkey;
ALTER TABLE IF EXISTS ONLY public.enrollment_codes DROP CONSTRAINT IF EXISTS enrollment_codes_client_id_fkey;
ALTER TABLE IF EXISTS ONLY public.documents DROP CONSTRAINT IF EXISTS documents_uploaded_by_fkey;
ALTER TABLE IF EXISTS ONLY public.documents DROP CONSTRAINT IF EXISTS documents_category_id_fkey;
ALTER TABLE IF EXISTS ONLY public.document_tags DROP CONSTRAINT IF EXISTS document_tags_tag_id_fkey;
ALTER TABLE IF EXISTS ONLY public.document_tags DROP CONSTRAINT IF EXISTS document_tags_document_id_fkey;
ALTER TABLE IF EXISTS ONLY public.document_grants DROP CONSTRAINT IF EXISTS document_grants_session_id_fkey;
ALTER TABLE IF EXISTS ONLY public.document_grants DROP CONSTRAINT IF EXISTS document_grants_device_id_fkey;
ALTER TABLE IF EXISTS ONLY public.document_grants DROP CONSTRAINT IF EXISTS document_grants_client_id_fkey;
ALTER TABLE IF EXISTS ONLY public.devices DROP CONSTRAINT IF EXISTS devices_client_id_fkey;
ALTER TABLE IF EXISTS ONLY public.client_document_access DROP CONSTRAINT IF EXISTS client_document_access_document_id_fkey;
ALTER TABLE IF EXISTS ONLY public.client_document_access DROP CONSTRAINT IF EXISTS client_document_access_client_id_fkey;
ALTER TABLE IF EXISTS ONLY public.client_category_access DROP CONSTRAINT IF EXISTS client_category_access_client_id_fkey;
ALTER TABLE IF EXISTS ONLY public.client_category_access DROP CONSTRAINT IF EXISTS client_category_access_category_id_fkey;
ALTER TABLE IF EXISTS ONLY public.admin_sessions DROP CONSTRAINT IF EXISTS admin_sessions_admin_id_fkey;
DROP INDEX IF EXISTS public.tags_name_key;
DROP INDEX IF EXISTS public.sessions_refresh_token_hash_key;
DROP INDEX IF EXISTS public.sessions_family_id_idx;
DROP INDEX IF EXISTS public.sessions_expires_at_idx;
DROP INDEX IF EXISTS public.sessions_device_id_idx;
DROP INDEX IF EXISTS public.enrollment_codes_code_hash_key;
DROP INDEX IF EXISTS public.enrollment_codes_client_id_idx;
DROP INDEX IF EXISTS public.documents_uploaded_at_idx;
DROP INDEX IF EXISTS public.documents_search_text_trgm_idx;
DROP INDEX IF EXISTS public.documents_deleted_at_idx;
DROP INDEX IF EXISTS public.documents_category_id_idx;
DROP INDEX IF EXISTS public.document_grants_token_hash_key;
DROP INDEX IF EXISTS public.document_grants_expires_at_idx;
DROP INDEX IF EXISTS public.document_grants_client_id_idx;
DROP INDEX IF EXISTS public.dmp_attempts_device_id_at_idx;
DROP INDEX IF EXISTS public.dmp_attempts_at_idx;
DROP INDEX IF EXISTS public.devices_client_id_idx;
DROP INDEX IF EXISTS public.clients_login_id_key;
DROP INDEX IF EXISTS public.categories_slug_key;
DROP INDEX IF EXISTS public.audit_log_event_idx;
DROP INDEX IF EXISTS public.audit_log_at_idx;
DROP INDEX IF EXISTS public.audit_log_actor_id_idx;
DROP INDEX IF EXISTS public.admins_username_key;
DROP INDEX IF EXISTS public.admin_sessions_token_hash_key;
DROP INDEX IF EXISTS public.admin_sessions_expires_at_idx;
DROP INDEX IF EXISTS public.admin_sessions_admin_id_idx;
ALTER TABLE IF EXISTS ONLY public.vault_secret DROP CONSTRAINT IF EXISTS vault_secret_pkey;
ALTER TABLE IF EXISTS ONLY public.tags DROP CONSTRAINT IF EXISTS tags_pkey;
ALTER TABLE IF EXISTS ONLY public.sessions DROP CONSTRAINT IF EXISTS sessions_pkey;
ALTER TABLE IF EXISTS ONLY public.favorites DROP CONSTRAINT IF EXISTS favorites_pkey;
ALTER TABLE IF EXISTS ONLY public.enrollment_codes DROP CONSTRAINT IF EXISTS enrollment_codes_pkey;
ALTER TABLE IF EXISTS ONLY public.documents DROP CONSTRAINT IF EXISTS documents_pkey;
ALTER TABLE IF EXISTS ONLY public.document_tags DROP CONSTRAINT IF EXISTS document_tags_pkey;
ALTER TABLE IF EXISTS ONLY public.document_grants DROP CONSTRAINT IF EXISTS document_grants_pkey;
ALTER TABLE IF EXISTS ONLY public.dmp_attempts DROP CONSTRAINT IF EXISTS dmp_attempts_pkey;
ALTER TABLE IF EXISTS ONLY public.devices DROP CONSTRAINT IF EXISTS devices_pkey;
ALTER TABLE IF EXISTS ONLY public.clients DROP CONSTRAINT IF EXISTS clients_pkey;
ALTER TABLE IF EXISTS ONLY public.client_document_access DROP CONSTRAINT IF EXISTS client_document_access_pkey;
ALTER TABLE IF EXISTS ONLY public.client_category_access DROP CONSTRAINT IF EXISTS client_category_access_pkey;
ALTER TABLE IF EXISTS ONLY public.categories DROP CONSTRAINT IF EXISTS categories_pkey;
ALTER TABLE IF EXISTS ONLY public.audit_log DROP CONSTRAINT IF EXISTS audit_log_pkey;
ALTER TABLE IF EXISTS ONLY public.admins DROP CONSTRAINT IF EXISTS admins_pkey;
ALTER TABLE IF EXISTS ONLY public.admin_sessions DROP CONSTRAINT IF EXISTS admin_sessions_pkey;
ALTER TABLE IF EXISTS ONLY public._prisma_migrations DROP CONSTRAINT IF EXISTS _prisma_migrations_pkey;
ALTER TABLE IF EXISTS public.dmp_attempts ALTER COLUMN id DROP DEFAULT;
ALTER TABLE IF EXISTS public.audit_log ALTER COLUMN id DROP DEFAULT;
DROP TABLE IF EXISTS public.vault_secret;
DROP TABLE IF EXISTS public.tags;
DROP TABLE IF EXISTS public.sessions;
DROP TABLE IF EXISTS public.favorites;
DROP TABLE IF EXISTS public.enrollment_codes;
DROP TABLE IF EXISTS public.documents;
DROP TABLE IF EXISTS public.document_tags;
DROP TABLE IF EXISTS public.document_grants;
DROP SEQUENCE IF EXISTS public.dmp_attempts_id_seq;
DROP TABLE IF EXISTS public.dmp_attempts;
DROP TABLE IF EXISTS public.devices;
DROP TABLE IF EXISTS public.clients;
DROP TABLE IF EXISTS public.client_document_access;
DROP TABLE IF EXISTS public.client_category_access;
DROP TABLE IF EXISTS public.categories;
DROP SEQUENCE IF EXISTS public.audit_log_id_seq;
DROP TABLE IF EXISTS public.audit_log;
DROP TABLE IF EXISTS public.admins;
DROP TABLE IF EXISTS public.admin_sessions;
DROP TABLE IF EXISTS public._prisma_migrations;
DROP TYPE IF EXISTS public."DeviceStatus";
DROP TYPE IF EXISTS public."ClientStatus";
DROP EXTENSION IF EXISTS pg_trgm;
--
-- Name: pg_trgm; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;


--
-- Name: EXTENSION pg_trgm; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pg_trgm IS 'text similarity measurement and index searching based on trigrams';


--
-- Name: ClientStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."ClientStatus" AS ENUM (
    'active',
    'suspended',
    'revoked'
);


--
-- Name: DeviceStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."DeviceStatus" AS ENUM (
    'active',
    'revoked'
);


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: _prisma_migrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public._prisma_migrations (
    id character varying(36) NOT NULL,
    checksum character varying(64) NOT NULL,
    finished_at timestamp with time zone,
    migration_name character varying(255) NOT NULL,
    logs text,
    rolled_back_at timestamp with time zone,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    applied_steps_count integer DEFAULT 0 NOT NULL
);


--
-- Name: admin_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admin_sessions (
    id uuid NOT NULL,
    admin_id uuid NOT NULL,
    token_hash bytea NOT NULL,
    issued_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    expires_at timestamp(3) with time zone NOT NULL,
    revoked_at timestamp(3) with time zone,
    step_up_at timestamp(3) with time zone,
    ip_hash text
);


--
-- Name: admins; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admins (
    id uuid NOT NULL,
    username text NOT NULL,
    password_hash text NOT NULL,
    totp_secret_enc bytea NOT NULL,
    totp_enabled boolean DEFAULT false NOT NULL,
    recovery_code_hashes text[],
    failed_attempts integer DEFAULT 0 NOT NULL,
    locked_until timestamp(3) with time zone,
    created_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    last_login_at timestamp(3) with time zone
);


--
-- Name: audit_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_log (
    id bigint NOT NULL,
    at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    actor_type text NOT NULL,
    actor_id uuid,
    device_id uuid,
    event text NOT NULL,
    target_type text,
    target_id text,
    result text NOT NULL,
    ip_hash text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    prev_hash bytea,
    entry_hash bytea NOT NULL
);


--
-- Name: audit_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.audit_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: audit_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.audit_log_id_seq OWNED BY public.audit_log.id;


--
-- Name: categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.categories (
    id uuid NOT NULL,
    slug text NOT NULL,
    name text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: client_category_access; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.client_category_access (
    client_id uuid NOT NULL,
    category_id uuid NOT NULL,
    granted_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: client_document_access; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.client_document_access (
    client_id uuid NOT NULL,
    document_id uuid NOT NULL,
    granted_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: clients; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.clients (
    id uuid NOT NULL,
    display_name text NOT NULL,
    login_id text NOT NULL,
    password_hash text NOT NULL,
    status public."ClientStatus" DEFAULT 'active'::public."ClientStatus" NOT NULL,
    max_devices integer DEFAULT 5 NOT NULL,
    created_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    revoked_at timestamp(3) with time zone
);


--
-- Name: devices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.devices (
    id uuid NOT NULL,
    client_id uuid NOT NULL,
    name text NOT NULL,
    platform text NOT NULL,
    public_key bytea NOT NULL,
    status public."DeviceStatus" DEFAULT 'active'::public."DeviceStatus" NOT NULL,
    enrolled_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    last_seen_at timestamp(3) with time zone,
    revoked_at timestamp(3) with time zone
);


--
-- Name: dmp_attempts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dmp_attempts (
    id bigint NOT NULL,
    client_id uuid,
    device_id uuid,
    ip_hash text,
    success boolean NOT NULL,
    at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: dmp_attempts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.dmp_attempts_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: dmp_attempts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.dmp_attempts_id_seq OWNED BY public.dmp_attempts.id;


--
-- Name: document_grants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.document_grants (
    id uuid NOT NULL,
    token_hash bytea NOT NULL,
    client_id uuid NOT NULL,
    device_id uuid NOT NULL,
    session_id uuid NOT NULL,
    dmp_version integer NOT NULL,
    issued_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    expires_at timestamp(3) with time zone NOT NULL,
    revoked_at timestamp(3) with time zone
);


--
-- Name: document_tags; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.document_tags (
    document_id uuid NOT NULL,
    tag_id uuid NOT NULL
);


--
-- Name: documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.documents (
    id uuid NOT NULL,
    title text NOT NULL,
    original_filename text NOT NULL,
    mime_type text NOT NULL,
    size_bytes bigint NOT NULL,
    sha256 bytea NOT NULL,
    category_id uuid NOT NULL,
    storage_key text NOT NULL,
    enc_dek bytea NOT NULL,
    enc_dek_nonce bytea NOT NULL,
    enc_dek_tag bytea NOT NULL,
    search_text text NOT NULL,
    document_date date,
    uploaded_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) with time zone NOT NULL,
    deleted_at timestamp(3) with time zone,
    uploaded_by uuid
);


--
-- Name: enrollment_codes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.enrollment_codes (
    id uuid NOT NULL,
    client_id uuid NOT NULL,
    code_hash bytea NOT NULL,
    expires_at timestamp(3) with time zone NOT NULL,
    used_at timestamp(3) with time zone,
    created_by_admin uuid NOT NULL,
    created_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: favorites; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.favorites (
    client_id uuid NOT NULL,
    document_id uuid NOT NULL,
    created_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sessions (
    id uuid NOT NULL,
    client_id uuid NOT NULL,
    device_id uuid NOT NULL,
    refresh_token_hash bytea NOT NULL,
    family_id uuid NOT NULL,
    issued_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    expires_at timestamp(3) with time zone NOT NULL,
    revoked_at timestamp(3) with time zone,
    reuse_detected_at timestamp(3) with time zone
);


--
-- Name: tags; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tags (
    id uuid NOT NULL,
    name text NOT NULL
);


--
-- Name: vault_secret; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vault_secret (
    id integer DEFAULT 1 NOT NULL,
    dmp_hash text,
    dmp_version integer DEFAULT 0 NOT NULL,
    grant_ttl_seconds integer DEFAULT 300 NOT NULL,
    configured_at timestamp(3) with time zone,
    updated_at timestamp(3) with time zone,
    updated_by uuid,
    CONSTRAINT vault_secret_single_row CHECK ((id = 1))
);


--
-- Name: audit_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log ALTER COLUMN id SET DEFAULT nextval('public.audit_log_id_seq'::regclass);


--
-- Name: dmp_attempts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dmp_attempts ALTER COLUMN id SET DEFAULT nextval('public.dmp_attempts_id_seq'::regclass);


--
-- Data for Name: _prisma_migrations; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public._prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count) FROM stdin;
b0387fb3-308c-4287-ae47-d3535294721d	f0ee77188c65eb6874cd1637b4907e8e6da94ac439d4fdf252328c41003968bf	2026-08-10 11:55:42.516643+05:30	20260810000000_init	\N	\N	2026-08-10 11:55:42.276642+05:30	1
f64eb0b5-ae10-4d65-bb9e-037428b0cc0c	a6e8b91784b031e72bf449d75db1bebbf080057ec1eecd5420adc6dbc70334a5	2026-08-12 11:17:35.793563+05:30	20260812000000_timestamptz	\N	\N	2026-08-12 11:17:35.700029+05:30	1
\.


--
-- Data for Name: admin_sessions; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.admin_sessions (id, admin_id, token_hash, issued_at, expires_at, revoked_at, step_up_at, ip_hash) FROM stdin;
11b9c62f-d30c-4272-8938-dc113ab4ebcf	71569cee-c5f5-41b1-a836-db616cddd9af	\\x8f413d413d42e725d031bc3cc829995e5bdd12b64216144bf1280304a5f61171	2026-08-19 10:34:39.726+05:30	2026-08-19 11:34:39.724+05:30	\N	2026-08-19 10:34:39.724+05:30	PiMnpW_iOeRXisXQd8FVJJNNnuoC88Ew0GSYRGQb16E
27c206c5-505f-4be0-a603-1e9bcce52edd	71569cee-c5f5-41b1-a836-db616cddd9af	\\xdee62616df2bc599e191eea074c10c5c44bfea73b5c737f6a68714a92cf91586	2026-08-19 11:42:18.083+05:30	2026-08-19 12:42:18.082+05:30	\N	2026-08-19 11:42:18.082+05:30	PiMnpW_iOeRXisXQd8FVJJNNnuoC88Ew0GSYRGQb16E
f0be0406-a03f-48f0-ab2e-f9cb6cbae133	71569cee-c5f5-41b1-a836-db616cddd9af	\\x57c1f6ef56af100813ce2f13dc4732e9f1a6852f9363b88746db56ea4a0b392d	2026-08-19 12:39:13.988+05:30	2026-08-19 13:39:13.986+05:30	\N	2026-08-19 12:39:13.986+05:30	PiMnpW_iOeRXisXQd8FVJJNNnuoC88Ew0GSYRGQb16E
\.


--
-- Data for Name: admins; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.admins (id, username, password_hash, totp_secret_enc, totp_enabled, recovery_code_hashes, failed_attempts, locked_until, created_at, last_login_at) FROM stdin;
71569cee-c5f5-41b1-a836-db616cddd9af	radha	$argon2id$v=19$m=65536,t=3,p=4$2x6fmNKu4X25w5voBCN1jg$xNhFKH91l8sGPDVjMvwvDqxDTDsUOJJzE2iwCbXFS78	\\x3ae0db056c105658595220ae4a6f32dc589a1ba6369aea4c9cdb671e633f61228b053e4e19f2de3b15c5420154fa100f4fb3427042c9bf54543519390fd47a69478b79b31f3b2ca1aa45f3c3f1198f30	t	{"$argon2id$v=19$m=65536,t=3,p=4$P7meiXdANflOvWuSD3B39Q$2ooUqIhuprzC56rCdNFTGKwTpM8PlCTcSjZ5qtEJmCQ","$argon2id$v=19$m=65536,t=3,p=4$Z0rPHI+E4DRzRkChsLrypw$q5Fjnmgb8d0BGBRiuMtvAmoELf6FnVEs8L3rOL/7ANM","$argon2id$v=19$m=65536,t=3,p=4$GYx0bmtu0Ez538fSb9gczA$YOCJvL6JY1CbkHt2RCoSiGMBGwY1nmzBOldZDuOQWVY","$argon2id$v=19$m=65536,t=3,p=4$YMQjoUy6JBvHuPyOrgGN6w$of/zMZat/Z4lEoPqJZM/FJYI0RfDaKjFeZvhVyGqlMY","$argon2id$v=19$m=65536,t=3,p=4$Bj2nzigbMLCE7PsyNSwXbw$IL6dZ87swGHSDD8AmWQSvCjUpR8RLj5gxLUeQxR7i9A","$argon2id$v=19$m=65536,t=3,p=4$/EEjTPMyucLcORtIrZFpjQ$H03eolorNN+84LbsGnF9mUe40b3Kpf0ahCVvNzytagU","$argon2id$v=19$m=65536,t=3,p=4$CEjXL8ZFY0f3gYl4ZPp0HQ$cIwGzPlUvxti52imFpETZlY7f/Ej9fADbYy9OQSCujE","$argon2id$v=19$m=65536,t=3,p=4$SJTtc9aJWDyphs4h3DrG+A$w4hQNbkz5LteAOw6Eq15yXc3Lt4gW/gwigL9GFj8VrY"}	0	\N	2026-08-18 13:38:43.77+05:30	2026-08-19 12:39:13.986+05:30
\.


--
-- Data for Name: audit_log; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.audit_log (id, at, actor_type, actor_id, device_id, event, target_type, target_id, result, ip_hash, metadata, prev_hash, entry_hash) FROM stdin;
1	2026-08-19 10:34:40.781+05:30	admin	71569cee-c5f5-41b1-a836-db616cddd9af	\N	admin.login.success	\N	\N	success	PiMnpW_iOeRXisXQd8FVJJNNnuoC88Ew0GSYRGQb16E	{}	\N	\\xeea5703371dc7719d42fb39686f12dea48ddb3bbb58e48c88c1245e8dd3cdf37
2	2026-08-19 10:37:28.391+05:30	admin	71569cee-c5f5-41b1-a836-db616cddd9af	\N	dmp.ttl_changed	\N	\N	success	PiMnpW_iOeRXisXQd8FVJJNNnuoC88Ew0GSYRGQb16E	{"seconds": 60}	\\xeea5703371dc7719d42fb39686f12dea48ddb3bbb58e48c88c1245e8dd3cdf37	\\x48e31c7c3863dc7d40a6ea8fc8b430ff0310230dd012e70ee217a7c6ad770d19
3	2026-08-19 10:37:29.275+05:30	admin	71569cee-c5f5-41b1-a836-db616cddd9af	\N	dmp.ttl_changed	\N	\N	success	PiMnpW_iOeRXisXQd8FVJJNNnuoC88Ew0GSYRGQb16E	{"seconds": 60}	\\x48e31c7c3863dc7d40a6ea8fc8b430ff0310230dd012e70ee217a7c6ad770d19	\\x2d3c9d74b615269d24b10548e367fd8930d7dfc3d03f5f494380cfabcf7eb0ff
4	2026-08-19 10:39:33.354+05:30	admin	71569cee-c5f5-41b1-a836-db616cddd9af	\N	document.uploaded	document	5ca9284f-d526-4ca5-a760-b63187aa9137	success	PiMnpW_iOeRXisXQd8FVJJNNnuoC88Ew0GSYRGQb16E	{"mimeType": "image/jpeg", "sizeBytes": 213236}	\\x2d3c9d74b615269d24b10548e367fd8930d7dfc3d03f5f494380cfabcf7eb0ff	\\xc8caaa61b4b197514c347cd6261806e3e19e5c7237bdbada147ca9fde03a3c94
5	2026-08-19 10:40:00.964+05:30	admin	71569cee-c5f5-41b1-a836-db616cddd9af	\N	document.uploaded	document	4160dc45-3b18-4b27-9cf6-f0243693a354	success	PiMnpW_iOeRXisXQd8FVJJNNnuoC88Ew0GSYRGQb16E	{"mimeType": "image/jpeg", "sizeBytes": 329236}	\\xc8caaa61b4b197514c347cd6261806e3e19e5c7237bdbada147ca9fde03a3c94	\\x07de95264d3421ed2c4c33ce129f17550296328c3fad1b62c7ae867b4338e468
6	2026-08-19 10:43:23.299+05:30	admin	71569cee-c5f5-41b1-a836-db616cddd9af	\N	client.enrolled	client	a2d7d1f9-635a-4cb6-b161-18e7ad822f88	success	PiMnpW_iOeRXisXQd8FVJJNNnuoC88Ew0GSYRGQb16E	{"action": "client created"}	\\x07de95264d3421ed2c4c33ce129f17550296328c3fad1b62c7ae867b4338e468	\\x22623c3f225795712f0eb5aa74e6059abcc67a1f667ceed8cb093a5b618dc17d
7	2026-08-19 11:42:18.114+05:30	admin	71569cee-c5f5-41b1-a836-db616cddd9af	\N	admin.login.success	\N	\N	success	PiMnpW_iOeRXisXQd8FVJJNNnuoC88Ew0GSYRGQb16E	{}	\\x22623c3f225795712f0eb5aa74e6059abcc67a1f667ceed8cb093a5b618dc17d	\\xa994be528516cd52ba9ae441ef03d5774fbf6ad8daa4114e1ad155b03c49b91e
8	2026-08-19 11:43:08.487+05:30	admin	71569cee-c5f5-41b1-a836-db616cddd9af	\N	dmp.configured	\N	\N	success	PiMnpW_iOeRXisXQd8FVJJNNnuoC88Ew0GSYRGQb16E	{}	\\xa994be528516cd52ba9ae441ef03d5774fbf6ad8daa4114e1ad155b03c49b91e	\\x5bc1ce8ab4c347efa128b21941eac5fb68ea28835c7283c3135b126217b7c2dc
9	2026-08-19 11:50:21.702+05:30	client	a2d7d1f9-635a-4cb6-b161-18e7ad822f88	5a2ed664-5ac4-4577-ba8a-7367332d3d16	client.enrolled	device	5a2ed664-5ac4-4577-ba8a-7367332d3d16	success	PiMnpW_iOeRXisXQd8FVJJNNnuoC88Ew0GSYRGQb16E	{"platform": "linux"}	\\x5bc1ce8ab4c347efa128b21941eac5fb68ea28835c7283c3135b126217b7c2dc	\\xeb86cf0bf81951d0925cbf778df560198ee0e24a3d9c038f3464a5b9b2f57962
10	2026-08-19 11:50:38.617+05:30	client	a2d7d1f9-635a-4cb6-b161-18e7ad822f88	5a2ed664-5ac4-4577-ba8a-7367332d3d16	client.login.success	\N	\N	success	PiMnpW_iOeRXisXQd8FVJJNNnuoC88Ew0GSYRGQb16E	{}	\\xeb86cf0bf81951d0925cbf778df560198ee0e24a3d9c038f3464a5b9b2f57962	\\xbb2b01167f1c0826775394edd3e5587a0d1b3d17522d2ea8c0c95ef3f4d8ccd8
11	2026-08-19 11:51:21.634+05:30	client	a2d7d1f9-635a-4cb6-b161-18e7ad822f88	5a2ed664-5ac4-4577-ba8a-7367332d3d16	dmp.verify.success	\N	\N	success	PiMnpW_iOeRXisXQd8FVJJNNnuoC88Ew0GSYRGQb16E	{"ttlSeconds": 60}	\\xbb2b01167f1c0826775394edd3e5587a0d1b3d17522d2ea8c0c95ef3f4d8ccd8	\\xcba5330fbe53ffe00f3279d542453cf1486b4853132e111032f2b493f65a0815
12	2026-08-19 11:51:25.501+05:30	client	a2d7d1f9-635a-4cb6-b161-18e7ad822f88	5a2ed664-5ac4-4577-ba8a-7367332d3d16	document.downloaded	document	5ca9284f-d526-4ca5-a760-b63187aa9137	success	PiMnpW_iOeRXisXQd8FVJJNNnuoC88Ew0GSYRGQb16E	{"fileType": "image/jpeg"}	\\xcba5330fbe53ffe00f3279d542453cf1486b4853132e111032f2b493f65a0815	\\x07ac71f298a9134144ff753fbf3af1bc6f60da042889546a1e19e553cbe4d073
13	2026-08-19 11:51:39.969+05:30	client	a2d7d1f9-635a-4cb6-b161-18e7ad822f88	5a2ed664-5ac4-4577-ba8a-7367332d3d16	document.viewed	document	5ca9284f-d526-4ca5-a760-b63187aa9137	success	PiMnpW_iOeRXisXQd8FVJJNNnuoC88Ew0GSYRGQb16E	{"fileType": "image/jpeg"}	\\x07ac71f298a9134144ff753fbf3af1bc6f60da042889546a1e19e553cbe4d073	\\x1892388b96fcbf10747123eb3a7dbb7963253425cf0cf2b894fb773162402285
14	2026-08-19 12:04:59.926+05:30	client	a2d7d1f9-635a-4cb6-b161-18e7ad822f88	5a2ed664-5ac4-4577-ba8a-7367332d3d16	client.login.failure	\N	\N	failure	PiMnpW_iOeRXisXQd8FVJJNNnuoC88Ew0GSYRGQb16E	{}	\\x1892388b96fcbf10747123eb3a7dbb7963253425cf0cf2b894fb773162402285	\\x535b60775403849b2aa1b5fad73221718d589188026fb1dba13dcfc735b9ed85
15	2026-08-19 12:05:16.409+05:30	client	a2d7d1f9-635a-4cb6-b161-18e7ad822f88	5a2ed664-5ac4-4577-ba8a-7367332d3d16	client.login.success	\N	\N	success	PiMnpW_iOeRXisXQd8FVJJNNnuoC88Ew0GSYRGQb16E	{}	\\x535b60775403849b2aa1b5fad73221718d589188026fb1dba13dcfc735b9ed85	\\xc487a4d9fa4a37ae6a7a2f85fac082984409ee94e5e27baa261a7f9b82c48b52
16	2026-08-19 12:39:14.016+05:30	admin	71569cee-c5f5-41b1-a836-db616cddd9af	\N	admin.login.success	\N	\N	success	PiMnpW_iOeRXisXQd8FVJJNNnuoC88Ew0GSYRGQb16E	{}	\\xc487a4d9fa4a37ae6a7a2f85fac082984409ee94e5e27baa261a7f9b82c48b52	\\xa911af07dd43dccbbf97e391c59a386d41439656701b043d961db9e7f79d51fc
17	2026-08-19 12:40:27.475+05:30	client	a2d7d1f9-635a-4cb6-b161-18e7ad822f88	83d988dd-0322-4fc0-b68e-f5e737e26ead	client.enrolled	device	83d988dd-0322-4fc0-b68e-f5e737e26ead	success	PiMnpW_iOeRXisXQd8FVJJNNnuoC88Ew0GSYRGQb16E	{"platform": "linux"}	\\xa911af07dd43dccbbf97e391c59a386d41439656701b043d961db9e7f79d51fc	\\xc35333ac9ee99a4e689491ad9582ec9219e2adcc9a8e7e0ff1fcb572d8b38f09
18	2026-08-19 12:40:48.793+05:30	client	a2d7d1f9-635a-4cb6-b161-18e7ad822f88	83d988dd-0322-4fc0-b68e-f5e737e26ead	client.login.success	\N	\N	success	PiMnpW_iOeRXisXQd8FVJJNNnuoC88Ew0GSYRGQb16E	{}	\\xc35333ac9ee99a4e689491ad9582ec9219e2adcc9a8e7e0ff1fcb572d8b38f09	\\xb10a3093fddfd77f1924f85916a448f9a7e910f63dd31f4c05089abca5fedb2e
19	2026-08-19 12:41:12.007+05:30	client	a2d7d1f9-635a-4cb6-b161-18e7ad822f88	83d988dd-0322-4fc0-b68e-f5e737e26ead	client.login.success	\N	\N	success	PiMnpW_iOeRXisXQd8FVJJNNnuoC88Ew0GSYRGQb16E	{}	\\xb10a3093fddfd77f1924f85916a448f9a7e910f63dd31f4c05089abca5fedb2e	\\x1fb6cb07e88a9401087027403add7acc566f6da87cc60f22d8ca8d96db1f175b
\.


--
-- Data for Name: categories; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.categories (id, slug, name, sort_order, created_at) FROM stdin;
16292d9a-752e-435a-a16b-a4825551db33	personal	Personal	10	2026-08-10 17:25:42.278+05:30
811d642e-e4c8-4b86-87b9-160512de1bfe	education	Education	20	2026-08-10 17:25:42.278+05:30
d7ba5229-39b7-4901-a8d6-07257fd40f0a	work	Work	30	2026-08-10 17:25:42.278+05:30
921fbf6f-41b5-4bad-9db8-c2ab7ac9ab0b	finance	Finance	40	2026-08-10 17:25:42.278+05:30
53b48d76-dd27-4351-857d-eb4dfefb046a	government	Government	50	2026-08-10 17:25:42.278+05:30
a2171ef4-17e8-437d-8f5b-8849cd01dea3	property	Property	60	2026-08-10 17:25:42.278+05:30
5c9939b1-9b9b-45b8-8fbb-6cd8a755b9dd	vehicle	Vehicle	70	2026-08-10 17:25:42.278+05:30
b9be9426-2c40-4c83-831c-0bee1dd4252e	legal	Legal	80	2026-08-10 17:25:42.278+05:30
21e0e3c5-0ecf-4fb0-a750-f251fdd33edc	other	Other	90	2026-08-10 17:25:42.278+05:30
\.


--
-- Data for Name: client_category_access; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.client_category_access (client_id, category_id, granted_at) FROM stdin;
a2d7d1f9-635a-4cb6-b161-18e7ad822f88	53b48d76-dd27-4351-857d-eb4dfefb046a	2026-08-19 12:39:26.063+05:30
a2d7d1f9-635a-4cb6-b161-18e7ad822f88	b9be9426-2c40-4c83-831c-0bee1dd4252e	2026-08-19 12:39:26.063+05:30
\.


--
-- Data for Name: client_document_access; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.client_document_access (client_id, document_id, granted_at) FROM stdin;
\.


--
-- Data for Name: clients; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.clients (id, display_name, login_id, password_hash, status, max_devices, created_at, revoked_at) FROM stdin;
a2d7d1f9-635a-4cb6-b161-18e7ad822f88	Radha	radha12	$argon2id$v=19$m=65536,t=3,p=4$9KVfRC3d5HHO5m3bwk70vw$GGtmlyF2WVN+91O3gaxR2ItMfLA7dpaXOaNVXaIT4I0	active	5	2026-08-19 10:43:22.788+05:30	\N
\.


--
-- Data for Name: devices; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.devices (id, client_id, name, platform, public_key, status, enrolled_at, last_seen_at, revoked_at) FROM stdin;
5a2ed664-5ac4-4577-ba8a-7367332d3d16	a2d7d1f9-635a-4cb6-b161-18e7ad822f88	My device	linux	\\x3059301306072a8648ce3d020106082a8648ce3d0301070342000438e0d87f7075eea6f97215430814710138132805abbedf788b129fa8ee7348d678f7e8671fbbcbf3caf455500085d9f30ca3c3ae870c65f941a8c32a5b626868	active	2026-08-19 11:50:21.692+05:30	2026-08-19 12:06:09.303+05:30	\N
83d988dd-0322-4fc0-b68e-f5e737e26ead	a2d7d1f9-635a-4cb6-b161-18e7ad822f88	My device	linux	\\x3059301306072a8648ce3d020106082a8648ce3d03010703420004b737b4782411315998a5af187ee285546044aa6a6740435c77d516b9ebd43d614cf8ef7052d17e8a21b19d94b05e47fd96798c2a815c55a2fa0176146ecd9db0	active	2026-08-19 12:40:27.469+05:30	2026-08-19 12:41:12.131+05:30	\N
\.


--
-- Data for Name: dmp_attempts; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.dmp_attempts (id, client_id, device_id, ip_hash, success, at) FROM stdin;
1	a2d7d1f9-635a-4cb6-b161-18e7ad822f88	5a2ed664-5ac4-4577-ba8a-7367332d3d16	PiMnpW_iOeRXisXQd8FVJJNNnuoC88Ew0GSYRGQb16E	t	2026-08-19 11:51:21.62+05:30
\.


--
-- Data for Name: document_grants; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.document_grants (id, token_hash, client_id, device_id, session_id, dmp_version, issued_at, expires_at, revoked_at) FROM stdin;
7c0f99e0-611b-4c54-abb5-c22936b8be50	\\x1d03d6a0b3846e53f835e7b99a44588aeb8fe62f09617ad94b77bd283d0e44c6	a2d7d1f9-635a-4cb6-b161-18e7ad822f88	5a2ed664-5ac4-4577-ba8a-7367332d3d16	3607e7e9-715d-48d8-b98d-75f0332aecdf	1	2026-08-19 11:51:21.624+05:30	2026-08-19 11:52:21.623+05:30	\N
\.


--
-- Data for Name: document_tags; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.document_tags (document_id, tag_id) FROM stdin;
\.


--
-- Data for Name: documents; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.documents (id, title, original_filename, mime_type, size_bytes, sha256, category_id, storage_key, enc_dek, enc_dek_nonce, enc_dek_tag, search_text, document_date, uploaded_at, updated_at, deleted_at, uploaded_by) FROM stdin;
5ca9284f-d526-4ca5-a760-b63187aa9137	Aadhar card	bmw-garage-italia-newsletter.jpg	image/jpeg	213236	\\x5466381d186138f252ea3f47110a8a3741bad18b40fe050b05b996616464839c	53b48d76-dd27-4351-857d-eb4dfefb046a	da/67/da67b54b-9516-4a85-88c4-5a328f2ef9b3.bin	\\x60e05145f4cc61a6b29ddfc2fa73d274afbb70dd03bc645208861ef7ab72b44d	\\xbe1f4fada83c9c3d6957dc15	\\xde767c3f82dd424f9d212ccd94601271	aadhar card bmw-garage-italia-newsletter.jpg government	\N	2026-08-19 10:39:32.81+05:30	2026-08-19 10:39:32.81+05:30	\N	71569cee-c5f5-41b1-a836-db616cddd9af
4160dc45-3b18-4b27-9cf6-f0243693a354	Legal Document	_.jpeg	image/jpeg	329236	\\xfe48ac58711fb5b75aa378832b3eb7493256be20d2b23e051321ebee73000487	b9be9426-2c40-4c83-831c-0bee1dd4252e	b8/90/b8906af3-9622-4350-adb5-034344913e43.bin	\\xa764faf5e47bbe7e48b49e11f6092d1ac5896f30f154f4e451b4613e34120d59	\\x70dfb028dfa2b0aea2861936	\\x95184a79c0c348a3503eb85d34521430	legal document _.jpeg legal	\N	2026-08-19 10:40:00.638+05:30	2026-08-19 10:40:00.638+05:30	\N	71569cee-c5f5-41b1-a836-db616cddd9af
\.


--
-- Data for Name: enrollment_codes; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.enrollment_codes (id, client_id, code_hash, expires_at, used_at, created_by_admin, created_at) FROM stdin;
2cd07865-8f7d-499c-a79b-20e021fdd1bb	a2d7d1f9-635a-4cb6-b161-18e7ad822f88	\\xba6a93d26e4363b64ca58bf390dd872748b211e94622bd07f7329543366aba4e	2026-08-19 10:58:43.56+05:30	\N	71569cee-c5f5-41b1-a836-db616cddd9af	2026-08-19 10:43:43.561+05:30
d33808de-9439-434e-83c2-9c63b304da55	a2d7d1f9-635a-4cb6-b161-18e7ad822f88	\\xa2dcda7002502b7c4add05d79ab6534491a698398787aab31e1c93a32722b836	2026-08-19 12:00:07.843+05:30	2026-08-19 11:50:21.687+05:30	71569cee-c5f5-41b1-a836-db616cddd9af	2026-08-19 11:45:07.844+05:30
62cd71f4-24de-4ec0-a700-8a220bc7fb35	a2d7d1f9-635a-4cb6-b161-18e7ad822f88	\\x78d7eade6218eb7f9668bed9d86ad74574798f269a48ac3067ac3bda1c802359	2026-08-19 12:54:30.496+05:30	2026-08-19 12:40:27.466+05:30	71569cee-c5f5-41b1-a836-db616cddd9af	2026-08-19 12:39:30.497+05:30
\.


--
-- Data for Name: favorites; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.favorites (client_id, document_id, created_at) FROM stdin;
\.


--
-- Data for Name: sessions; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.sessions (id, client_id, device_id, refresh_token_hash, family_id, issued_at, expires_at, revoked_at, reuse_detected_at) FROM stdin;
3607e7e9-715d-48d8-b98d-75f0332aecdf	a2d7d1f9-635a-4cb6-b161-18e7ad822f88	5a2ed664-5ac4-4577-ba8a-7367332d3d16	\\xcc3efe10f816cf6ea63279d6291d7043e36bcb5234424f94093e8f07e028a100	d835bae9-bb6d-471f-9fa8-6b9d69af8924	2026-08-19 11:51:49.079+05:30	2026-09-18 11:51:49.077+05:30	\N	\N
044cd44e-8f0c-49bb-be2f-ea654f0c8062	a2d7d1f9-635a-4cb6-b161-18e7ad822f88	5a2ed664-5ac4-4577-ba8a-7367332d3d16	\\xc3e73caad4c626027182be2e832683e50562764551c876def8d2ceb8a911f9e5	d835bae9-bb6d-471f-9fa8-6b9d69af8924	2026-08-19 11:50:38.607+05:30	2026-09-18 11:50:38.605+05:30	2026-08-19 11:51:49.082+05:30	\N
b1582843-2297-46a3-9f5a-f3fba4969819	a2d7d1f9-635a-4cb6-b161-18e7ad822f88	5a2ed664-5ac4-4577-ba8a-7367332d3d16	\\xbbe29a213f72b9c9b4962f2ae8c40371b43cc0fc8ca6d7f18382de99aa6a4939	406d9a95-851b-4755-90d1-f6409346b8fc	2026-08-19 12:05:16.402+05:30	2026-09-18 12:05:16.401+05:30	2026-08-19 12:05:34.34+05:30	\N
056880e4-ef6c-4522-9bcb-b33ddd143214	a2d7d1f9-635a-4cb6-b161-18e7ad822f88	5a2ed664-5ac4-4577-ba8a-7367332d3d16	\\xa9b96e07d0fc090c68bcffdb84a58ae2074aa10c78b98133aedb4e0eb85db839	406d9a95-851b-4755-90d1-f6409346b8fc	2026-08-19 12:05:34.338+05:30	2026-09-18 12:05:34.336+05:30	2026-08-19 12:05:40.661+05:30	\N
9fb02503-dca0-4730-b742-d49062b9a179	a2d7d1f9-635a-4cb6-b161-18e7ad822f88	5a2ed664-5ac4-4577-ba8a-7367332d3d16	\\x67cbb1063bec24d924ccec5770cf96850fc3dc9b91c27fb4d6988340e410e09c	406d9a95-851b-4755-90d1-f6409346b8fc	2026-08-19 12:05:40.659+05:30	2026-09-18 12:05:40.658+05:30	2026-08-19 12:05:55.506+05:30	\N
2e61de0d-9573-4cf9-a42b-2df0837bac04	a2d7d1f9-635a-4cb6-b161-18e7ad822f88	5a2ed664-5ac4-4577-ba8a-7367332d3d16	\\x6c92c82cc17e4c2f038d0582f2f81155daf546f0ee02a68715f9d6c8ac013648	406d9a95-851b-4755-90d1-f6409346b8fc	2026-08-19 12:05:55.504+05:30	2026-09-18 12:05:55.502+05:30	2026-08-19 12:05:56.942+05:30	\N
46c4b865-135a-4e19-8d76-66ebb4eff06f	a2d7d1f9-635a-4cb6-b161-18e7ad822f88	5a2ed664-5ac4-4577-ba8a-7367332d3d16	\\x9d30ab2615a38de1a22cd1ba5bdf65215f0b930600203ff1d3cbd55776da776c	406d9a95-851b-4755-90d1-f6409346b8fc	2026-08-19 12:05:56.94+05:30	2026-09-18 12:05:56.939+05:30	2026-08-19 12:06:02.699+05:30	\N
93997183-de5b-4606-bb48-48b75e6dc67f	a2d7d1f9-635a-4cb6-b161-18e7ad822f88	5a2ed664-5ac4-4577-ba8a-7367332d3d16	\\x1b99fe324a5d2e9d05262b59c4ba321500fa17c654275ca5d469cb5f45cfb10d	406d9a95-851b-4755-90d1-f6409346b8fc	2026-08-19 12:06:09.131+05:30	2026-09-18 12:06:09.129+05:30	\N	\N
e68ccc66-b3c6-46b8-a1e1-95c4e950e995	a2d7d1f9-635a-4cb6-b161-18e7ad822f88	5a2ed664-5ac4-4577-ba8a-7367332d3d16	\\x712e87ec558a5517d41a3f20e99670d5d9480dd98dca1f13f49c635fe7fc8f68	406d9a95-851b-4755-90d1-f6409346b8fc	2026-08-19 12:06:02.697+05:30	2026-09-18 12:06:02.695+05:30	2026-08-19 12:06:09.132+05:30	\N
6842c293-f814-4e8f-9678-0000a3097b19	a2d7d1f9-635a-4cb6-b161-18e7ad822f88	83d988dd-0322-4fc0-b68e-f5e737e26ead	\\x44429f849186c4e53642a1bf690b5b776e9329f2e6ea03200b0fcd31865aa47f	3608a4a9-9bc6-4dce-96de-465dc3e42c8e	2026-08-19 12:40:48.789+05:30	2026-09-18 12:40:48.787+05:30	\N	\N
833096d1-8f5e-4ee1-b562-bf9428c10f0c	a2d7d1f9-635a-4cb6-b161-18e7ad822f88	83d988dd-0322-4fc0-b68e-f5e737e26ead	\\x4bbd08f04963bed217272fe315e948f657e5c5f88d314b384b00d0f324cc2de3	495e540d-3d4c-4503-8aa4-e43921845758	2026-08-19 12:41:12.001+05:30	2026-09-18 12:41:12+05:30	\N	\N
\.


--
-- Data for Name: tags; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.tags (id, name) FROM stdin;
\.


--
-- Data for Name: vault_secret; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.vault_secret (id, dmp_hash, dmp_version, grant_ttl_seconds, configured_at, updated_at, updated_by) FROM stdin;
1	$argon2id$v=19$m=65536,t=3,p=4$9gjPeSGSmIjTg+5uc3PApA$QKXm2fENNXDP9VjtciU+lnpzZh+/Tr0dm0wePX8Li4g	1	60	2026-08-19 11:43:08.483+05:30	2026-08-19 11:43:08.483+05:30	71569cee-c5f5-41b1-a836-db616cddd9af
\.


--
-- Name: audit_log_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.audit_log_id_seq', 19, true);


--
-- Name: dmp_attempts_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.dmp_attempts_id_seq', 1, true);


--
-- Name: _prisma_migrations _prisma_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public._prisma_migrations
    ADD CONSTRAINT _prisma_migrations_pkey PRIMARY KEY (id);


--
-- Name: admin_sessions admin_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_sessions
    ADD CONSTRAINT admin_sessions_pkey PRIMARY KEY (id);


--
-- Name: admins admins_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admins
    ADD CONSTRAINT admins_pkey PRIMARY KEY (id);


--
-- Name: audit_log audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_pkey PRIMARY KEY (id);


--
-- Name: categories categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.categories
    ADD CONSTRAINT categories_pkey PRIMARY KEY (id);


--
-- Name: client_category_access client_category_access_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_category_access
    ADD CONSTRAINT client_category_access_pkey PRIMARY KEY (client_id, category_id);


--
-- Name: client_document_access client_document_access_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_document_access
    ADD CONSTRAINT client_document_access_pkey PRIMARY KEY (client_id, document_id);


--
-- Name: clients clients_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clients
    ADD CONSTRAINT clients_pkey PRIMARY KEY (id);


--
-- Name: devices devices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.devices
    ADD CONSTRAINT devices_pkey PRIMARY KEY (id);


--
-- Name: dmp_attempts dmp_attempts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dmp_attempts
    ADD CONSTRAINT dmp_attempts_pkey PRIMARY KEY (id);


--
-- Name: document_grants document_grants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_grants
    ADD CONSTRAINT document_grants_pkey PRIMARY KEY (id);


--
-- Name: document_tags document_tags_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_tags
    ADD CONSTRAINT document_tags_pkey PRIMARY KEY (document_id, tag_id);


--
-- Name: documents documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_pkey PRIMARY KEY (id);


--
-- Name: enrollment_codes enrollment_codes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.enrollment_codes
    ADD CONSTRAINT enrollment_codes_pkey PRIMARY KEY (id);


--
-- Name: favorites favorites_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.favorites
    ADD CONSTRAINT favorites_pkey PRIMARY KEY (client_id, document_id);


--
-- Name: sessions sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_pkey PRIMARY KEY (id);


--
-- Name: tags tags_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tags
    ADD CONSTRAINT tags_pkey PRIMARY KEY (id);


--
-- Name: vault_secret vault_secret_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vault_secret
    ADD CONSTRAINT vault_secret_pkey PRIMARY KEY (id);


--
-- Name: admin_sessions_admin_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX admin_sessions_admin_id_idx ON public.admin_sessions USING btree (admin_id);


--
-- Name: admin_sessions_expires_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX admin_sessions_expires_at_idx ON public.admin_sessions USING btree (expires_at);


--
-- Name: admin_sessions_token_hash_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX admin_sessions_token_hash_key ON public.admin_sessions USING btree (token_hash);


--
-- Name: admins_username_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX admins_username_key ON public.admins USING btree (username);


--
-- Name: audit_log_actor_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_log_actor_id_idx ON public.audit_log USING btree (actor_id);


--
-- Name: audit_log_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_log_at_idx ON public.audit_log USING btree (at);


--
-- Name: audit_log_event_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_log_event_idx ON public.audit_log USING btree (event);


--
-- Name: categories_slug_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX categories_slug_key ON public.categories USING btree (slug);


--
-- Name: clients_login_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX clients_login_id_key ON public.clients USING btree (login_id);


--
-- Name: devices_client_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX devices_client_id_idx ON public.devices USING btree (client_id);


--
-- Name: dmp_attempts_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX dmp_attempts_at_idx ON public.dmp_attempts USING btree (at);


--
-- Name: dmp_attempts_device_id_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX dmp_attempts_device_id_at_idx ON public.dmp_attempts USING btree (device_id, at);


--
-- Name: document_grants_client_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX document_grants_client_id_idx ON public.document_grants USING btree (client_id);


--
-- Name: document_grants_expires_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX document_grants_expires_at_idx ON public.document_grants USING btree (expires_at);


--
-- Name: document_grants_token_hash_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX document_grants_token_hash_key ON public.document_grants USING btree (token_hash);


--
-- Name: documents_category_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX documents_category_id_idx ON public.documents USING btree (category_id);


--
-- Name: documents_deleted_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX documents_deleted_at_idx ON public.documents USING btree (deleted_at);


--
-- Name: documents_search_text_trgm_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX documents_search_text_trgm_idx ON public.documents USING gin (search_text public.gin_trgm_ops);


--
-- Name: documents_uploaded_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX documents_uploaded_at_idx ON public.documents USING btree (uploaded_at);


--
-- Name: enrollment_codes_client_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX enrollment_codes_client_id_idx ON public.enrollment_codes USING btree (client_id);


--
-- Name: enrollment_codes_code_hash_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX enrollment_codes_code_hash_key ON public.enrollment_codes USING btree (code_hash);


--
-- Name: sessions_device_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sessions_device_id_idx ON public.sessions USING btree (device_id);


--
-- Name: sessions_expires_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sessions_expires_at_idx ON public.sessions USING btree (expires_at);


--
-- Name: sessions_family_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sessions_family_id_idx ON public.sessions USING btree (family_id);


--
-- Name: sessions_refresh_token_hash_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX sessions_refresh_token_hash_key ON public.sessions USING btree (refresh_token_hash);


--
-- Name: tags_name_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX tags_name_key ON public.tags USING btree (name);


--
-- Name: admin_sessions admin_sessions_admin_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_sessions
    ADD CONSTRAINT admin_sessions_admin_id_fkey FOREIGN KEY (admin_id) REFERENCES public.admins(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: client_category_access client_category_access_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_category_access
    ADD CONSTRAINT client_category_access_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.categories(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: client_category_access client_category_access_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_category_access
    ADD CONSTRAINT client_category_access_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: client_document_access client_document_access_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_document_access
    ADD CONSTRAINT client_document_access_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: client_document_access client_document_access_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_document_access
    ADD CONSTRAINT client_document_access_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.documents(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: devices devices_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.devices
    ADD CONSTRAINT devices_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: document_grants document_grants_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_grants
    ADD CONSTRAINT document_grants_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: document_grants document_grants_device_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_grants
    ADD CONSTRAINT document_grants_device_id_fkey FOREIGN KEY (device_id) REFERENCES public.devices(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: document_grants document_grants_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_grants
    ADD CONSTRAINT document_grants_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.sessions(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: document_tags document_tags_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_tags
    ADD CONSTRAINT document_tags_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.documents(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: document_tags document_tags_tag_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_tags
    ADD CONSTRAINT document_tags_tag_id_fkey FOREIGN KEY (tag_id) REFERENCES public.tags(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: documents documents_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.categories(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: documents documents_uploaded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES public.admins(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: enrollment_codes enrollment_codes_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.enrollment_codes
    ADD CONSTRAINT enrollment_codes_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: enrollment_codes enrollment_codes_created_by_admin_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.enrollment_codes
    ADD CONSTRAINT enrollment_codes_created_by_admin_fkey FOREIGN KEY (created_by_admin) REFERENCES public.admins(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: favorites favorites_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.favorites
    ADD CONSTRAINT favorites_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: favorites favorites_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.favorites
    ADD CONSTRAINT favorites_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.documents(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: sessions sessions_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: sessions sessions_device_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_device_id_fkey FOREIGN KEY (device_id) REFERENCES public.devices(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: vault_secret vault_secret_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vault_secret
    ADD CONSTRAINT vault_secret_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.admins(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- PostgreSQL database dump complete
--

\unrestrict DUKNhvNINhwlcdw83HS63sj6hHpVPbycv9fqfKa6qWMo9YD1yieOKSl0XjjwWH8

