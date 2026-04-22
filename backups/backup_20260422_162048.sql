--
-- PostgreSQL database dump
--

\restrict wVLQ7AekYfYy1scY4aivMchX1GyNFG6Uwdpw1jHZx5BkWKjd08E2grUTQn18nnZ

-- Dumped from database version 16.10
-- Dumped by pg_dump version 16.10

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

--
-- Name: account_plan; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.account_plan AS ENUM (
    'starter',
    'pro',
    'enterprise'
);


--
-- Name: account_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.account_status AS ENUM (
    'active',
    'paused',
    'suspended'
);


--
-- Name: job_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.job_status AS ENUM (
    'pending',
    'running',
    'completed',
    'failed',
    'cancelled'
);


--
-- Name: location_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.location_type AS ENUM (
    'state',
    'city',
    'neighborhood',
    'county'
);


--
-- Name: page_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.page_status AS ENUM (
    'draft',
    'review',
    'approved',
    'published',
    'pruned'
);


--
-- Name: page_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.page_type AS ENUM (
    'state_hub',
    'city_hub',
    'service_city',
    'industry_city',
    'problem_intent'
);


--
-- Name: user_role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.user_role AS ENUM (
    'super_admin',
    'account_admin',
    'editor',
    'viewer'
);


--
-- Name: website_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.website_status AS ENUM (
    'live',
    'syncing',
    'error',
    'paused'
);


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.accounts (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    plan public.account_plan DEFAULT 'starter'::public.account_plan NOT NULL,
    status public.account_status DEFAULT 'active'::public.account_status NOT NULL,
    settings jsonb DEFAULT '{}'::jsonb,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    agency_id character varying,
    client_status character varying(20) DEFAULT 'active'::character varying,
    report_token character varying(64),
    monthly_seo_spend numeric(10,2) DEFAULT 0
);


--
-- Name: admin_notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admin_notifications (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    website_id character varying NOT NULL,
    type text NOT NULL,
    title text NOT NULL,
    message text NOT NULL,
    metadata jsonb,
    read_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: agencies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agencies (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    contact_name text,
    email text,
    phone text,
    monthly_fee numeric,
    start_date text,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: api_usage_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.api_usage_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    account_id character varying,
    website_id character varying,
    generation_type character varying(50),
    model_used character varying(100),
    input_tokens integer,
    output_tokens integer,
    total_tokens integer,
    estimated_cost_cents integer,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: blueprints; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.blueprints (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    account_id character varying NOT NULL,
    website_id character varying,
    name text NOT NULL,
    page_type public.page_type NOT NULL,
    title_template text NOT NULL,
    meta_desc_template text NOT NULL,
    h1_template text NOT NULL,
    slug_template text NOT NULL,
    sections jsonb DEFAULT '[]'::jsonb NOT NULL,
    required_word_count integer DEFAULT 600 NOT NULL,
    min_publish_score numeric(4,2) DEFAULT 0.70 NOT NULL,
    min_local_signal numeric(4,2) DEFAULT 0.60 NOT NULL,
    max_similarity_threshold numeric(4,2) DEFAULT 0.85 NOT NULL,
    prompt_family text DEFAULT 'local_service'::text NOT NULL,
    faq_enabled boolean DEFAULT true NOT NULL,
    schema_types text[] DEFAULT '{LocalBusiness,FAQPage}'::text[],
    is_active boolean DEFAULT true NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    default_tier integer DEFAULT 2 NOT NULL,
    min_score_for_tier1 integer DEFAULT 80 NOT NULL,
    city_tier_rules jsonb,
    min_bank_completeness integer DEFAULT 70 NOT NULL,
    max_cities_per_state integer,
    state_allowlist text[]
);


--
-- Name: booked_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.booked_jobs (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    lead_id character varying,
    website_id character varying NOT NULL,
    page_id character varying NOT NULL,
    account_id character varying NOT NULL,
    job_value numeric(10,2),
    booked_date timestamp without time zone NOT NULL,
    status character varying(50) DEFAULT 'pending'::character varying,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: brand_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.brand_profiles (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    account_id character varying NOT NULL,
    name text NOT NULL,
    logo_url text,
    primary_color text,
    secondary_color text,
    tagline text,
    description text,
    phone text,
    email text,
    address text,
    social_links jsonb DEFAULT '{}'::jsonb,
    voice_and_tone text,
    custom_fields jsonb DEFAULT '{}'::jsonb,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: call_tracking_numbers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.call_tracking_numbers (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    website_id character varying NOT NULL,
    page_id character varying NOT NULL,
    service_id character varying NOT NULL,
    location_id character varying,
    dynamic_number character varying(20) NOT NULL,
    forward_to_number character varying(20) NOT NULL,
    is_active boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: client_weekly_digests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.client_weekly_digests (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    website_id character varying NOT NULL,
    account_id character varying NOT NULL,
    recipient_email character varying(255) NOT NULL,
    subject character varying(500),
    body_html text,
    body_text text,
    sent_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now(),
    status character varying(20) DEFAULT 'pending'::character varying
);


--
-- Name: content_variation_banks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.content_variation_banks (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    account_id character varying NOT NULL,
    website_id character varying NOT NULL,
    service text NOT NULL,
    section_name text NOT NULL,
    variations jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: demotion_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.demotion_logs (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    website_id character varying NOT NULL,
    page_id character varying NOT NULL,
    from_tier integer NOT NULL,
    to_tier integer NOT NULL,
    reason text NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: fallback_hit_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fallback_hit_logs (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    website_id character varying NOT NULL,
    slug text NOT NULL,
    hit_count integer DEFAULT 1 NOT NULL,
    first_seen_at timestamp without time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp without time zone DEFAULT now() NOT NULL,
    promoted boolean DEFAULT false NOT NULL,
    promoted_at timestamp without time zone
);


--
-- Name: generation_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.generation_jobs (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    account_id character varying NOT NULL,
    website_id character varying NOT NULL,
    blueprint_id character varying,
    name text NOT NULL,
    status public.job_status DEFAULT 'pending'::public.job_status NOT NULL,
    total_pages integer DEFAULT 0 NOT NULL,
    processed_pages integer DEFAULT 0 NOT NULL,
    passed_pages integer DEFAULT 0 NOT NULL,
    failed_pages integer DEFAULT 0 NOT NULL,
    error_log jsonb DEFAULT '[]'::jsonb,
    settings jsonb DEFAULT '{}'::jsonb,
    started_at timestamp without time zone,
    completed_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: hub_pages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hub_pages (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    website_id character varying NOT NULL,
    account_id character varying NOT NULL,
    hub_type text NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    tier integer DEFAULT 1 NOT NULL,
    quality_score integer,
    status text DEFAULT 'draft'::text NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    content text,
    parent_slug text,
    max_child_links integer DEFAULT 30 NOT NULL,
    meta_description text
);


--
-- Name: industries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.industries (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    account_id character varying NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    description text,
    naics_code text,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: internal_links; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.internal_links (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    website_id character varying NOT NULL,
    from_page_id character varying NOT NULL,
    to_page_id character varying NOT NULL,
    anchor_text text NOT NULL,
    link_type text DEFAULT 'contextual'::text NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: launch_health_scores; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.launch_health_scores (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    website_id character varying NOT NULL,
    score integer DEFAULT 0,
    max_score integer DEFAULT 100,
    breakdown jsonb,
    calculated_at timestamp without time zone DEFAULT now()
);


--
-- Name: leads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.leads (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    website_id character varying NOT NULL,
    page_id character varying,
    page_slug text,
    name text NOT NULL,
    business_name text,
    email text NOT NULL,
    phone text,
    message text,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: locations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.locations (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    account_id character varying NOT NULL,
    type public.location_type NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    state_code text,
    state_name text,
    population integer,
    lat numeric(10,7),
    lng numeric(10,7),
    parent_id character varying,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    city_tier integer
);


--
-- Name: onboarding_submissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.onboarding_submissions (
    id character varying DEFAULT (gen_random_uuid())::text NOT NULL,
    token character varying(64) NOT NULL,
    stripe_session_id character varying(255),
    stripe_customer_id character varying(255),
    plan_type character varying(50),
    agency_id character varying,
    account_id character varying,
    website_id character varying,
    status character varying(30) DEFAULT 'pending'::character varying,
    form_data jsonb,
    readiness_score integer DEFAULT 0,
    readiness_result jsonb,
    onboarding_notes text,
    created_at timestamp without time zone DEFAULT now(),
    submitted_at timestamp without time zone,
    generation_started_at timestamp without time zone,
    completed_at timestamp without time zone,
    governor_results jsonb,
    brand_input_score integer,
    brand_input_result jsonb,
    gap_report jsonb
);


--
-- Name: page_metrics; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.page_metrics (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    page_id character varying NOT NULL,
    website_id character varying NOT NULL,
    date text NOT NULL,
    impressions integer DEFAULT 0 NOT NULL,
    clicks integer DEFAULT 0 NOT NULL,
    avg_position numeric(6,2),
    ctr numeric(6,4),
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: page_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.page_versions (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    page_id character varying NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    content_html text NOT NULL,
    content_json jsonb,
    prompt_tokens integer,
    completion_tokens integer,
    review_notes text,
    is_active boolean DEFAULT false NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: pages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pages (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    website_id character varying NOT NULL,
    blueprint_id character varying,
    location_id character varying,
    service_id character varying,
    industry_id character varying,
    query_cluster_id character varying,
    page_type public.page_type NOT NULL,
    slug text NOT NULL,
    title text NOT NULL,
    meta_description text,
    h1 text NOT NULL,
    canonical_url text,
    status public.page_status DEFAULT 'draft'::public.page_status NOT NULL,
    publish_score numeric(4,2),
    local_signal_score numeric(4,2),
    word_count integer,
    passed_qa boolean,
    qa_report jsonb,
    published_at timestamp without time zone,
    prune_reason text,
    r2_key text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    tier integer DEFAULT 2 NOT NULL,
    quality_score integer,
    score_breakdown jsonb,
    index_status text DEFAULT 'queued'::text NOT NULL,
    fallback_hit_count integer DEFAULT 0 NOT NULL,
    last_evaluated_at timestamp without time zone,
    rollout_phase text,
    promotion_status text DEFAULT 'default'::text NOT NULL,
    noindex boolean DEFAULT false NOT NULL,
    is_draft boolean DEFAULT false,
    draft_reason character varying(50),
    publish_wave integer DEFAULT 0,
    override_published_by character varying(100),
    override_published_at timestamp without time zone,
    gsc_submitted_at timestamp without time zone,
    duplicate_flag boolean DEFAULT false,
    duplicate_of_slug character varying(500),
    duplicate_similarity numeric(5,4)
);


--
-- Name: query_clusters; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.query_clusters (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    account_id character varying NOT NULL,
    service_id character varying,
    name text NOT NULL,
    intent_type text NOT NULL,
    primary_keyword text NOT NULL,
    secondary_keywords text[] DEFAULT '{}'::text[],
    search_volume integer,
    difficulty integer,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: services; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.services (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    account_id character varying NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    description text,
    keywords text[] DEFAULT '{}'::text[],
    industry_id character varying,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: session; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.session (
    sid character varying NOT NULL,
    sess json NOT NULL,
    expire timestamp(6) without time zone NOT NULL
);


--
-- Name: sitemaps; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sitemaps (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    website_id character varying NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    url_count integer DEFAULT 0 NOT NULL,
    r2_key text,
    last_generated timestamp without time zone,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    xml_content text
);


--
-- Name: state_data; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.state_data (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    state_name text NOT NULL,
    state_abbr text NOT NULL,
    population integer NOT NULL,
    business_count integer NOT NULL,
    major_cities jsonb DEFAULT '[]'::jsonb NOT NULL,
    landmarks jsonb DEFAULT '[]'::jsonb NOT NULL,
    business_culture text NOT NULL,
    payment_regulations text NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: tracked_calls; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tracked_calls (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    website_id character varying NOT NULL,
    page_id character varying NOT NULL,
    service_id character varying NOT NULL,
    location_id character varying,
    dynamic_number character varying(20) NOT NULL,
    caller_phone_hash character varying(255),
    call_duration_seconds integer,
    call_timestamp timestamp without time zone NOT NULL,
    call_status character varying(50),
    call_provider_id character varying(255),
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: tracked_leads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tracked_leads (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    website_id character varying NOT NULL,
    page_id character varying NOT NULL,
    service_id character varying NOT NULL,
    location_id character varying,
    form_name character varying(255),
    submitter_name character varying(255),
    submitter_email character varying(255),
    submitter_phone character varying(20),
    message text,
    source_page_url text,
    source_page_title character varying(255),
    form_timestamp timestamp without time zone NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    account_id character varying,
    username text NOT NULL,
    email text NOT NULL,
    password text NOT NULL,
    role public.user_role DEFAULT 'viewer'::public.user_role NOT NULL,
    is_super_admin boolean DEFAULT false NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: variation_bank_completeness; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.variation_bank_completeness (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    website_id character varying NOT NULL,
    service text NOT NULL,
    has_intro boolean DEFAULT false NOT NULL,
    has_how_it_works boolean DEFAULT false NOT NULL,
    has_benefits boolean DEFAULT false NOT NULL,
    has_faq boolean DEFAULT false NOT NULL,
    has_cta boolean DEFAULT false NOT NULL,
    total_variations integer DEFAULT 0 NOT NULL,
    avg_variations_per_section integer DEFAULT 0 NOT NULL,
    completeness_score integer DEFAULT 0 NOT NULL,
    is_eligible_for_tier1 boolean DEFAULT false NOT NULL,
    last_computed_at timestamp without time zone DEFAULT now() NOT NULL,
    has_local_context boolean DEFAULT false NOT NULL,
    has_use_case boolean DEFAULT false NOT NULL,
    has_proof_trust boolean DEFAULT false NOT NULL,
    has_pain_point boolean DEFAULT false NOT NULL,
    has_local_stat boolean DEFAULT false NOT NULL
);


--
-- Name: websites; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.websites (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    account_id character varying NOT NULL,
    brand_profile_id character varying,
    name text NOT NULL,
    domain text NOT NULL,
    subdomain text,
    status public.website_status DEFAULT 'paused'::public.website_status NOT NULL,
    primary_industry text,
    target_locale text DEFAULT 'en-US'::text,
    robots_txt text,
    custom_head text,
    r2_prefix text,
    published_pages integer DEFAULT 0 NOT NULL,
    settings jsonb DEFAULT '{}'::jsonb,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    onboarding_status character varying(30) DEFAULT 'manual'::character varying,
    onboarding_submission_id character varying,
    launch_cap integer DEFAULT 100,
    warmup_mode boolean DEFAULT true,
    warmup_expires_at timestamp without time zone,
    first_publish_at timestamp without time zone,
    coverage_plan character varying(20) DEFAULT 'regional'::character varying,
    tier1_weekly_submit_cap integer DEFAULT 50,
    protection_mode boolean DEFAULT false,
    protection_expires_at timestamp without time zone,
    warmup_day integer DEFAULT 0,
    warmup_page_cap_override integer
);


--
-- Data for Name: accounts; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.accounts (id, name, slug, plan, status, settings, created_at, updated_at, agency_id, client_status, report_token, monthly_seo_spend) FROM stdin;
70ec4b1c-80b2-4c17-9d22-f63275d21310	SpotOn Results	spoton-results	enterprise	active	{}	2026-03-29 06:37:24.589544	2026-03-29 06:37:24.589544	\N	active	aa3a7bbf9ac8721094775193d60d7191	0.00
4d7ba690-ac0a-4654-9f41-1c773d6e8f92	SpotOn Nexus	spotonnexus	enterprise	active	{}	2026-04-11 02:32:31.630047	2026-04-11 02:32:31.630047	\N	active	13cac35a8a3ea757e7192c2f0bfc60a0	0.00
\.


--
-- Data for Name: admin_notifications; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.admin_notifications (id, website_id, type, title, message, metadata, read_at, created_at) FROM stdin;
\.


--
-- Data for Name: agencies; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.agencies (id, name, contact_name, email, phone, monthly_fee, start_date, status, created_at) FROM stdin;
\.


--
-- Data for Name: api_usage_log; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.api_usage_log (id, account_id, website_id, generation_type, model_used, input_tokens, output_tokens, total_tokens, estimated_cost_cents, created_at) FROM stdin;
\.


--
-- Data for Name: blueprints; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.blueprints (id, account_id, website_id, name, page_type, title_template, meta_desc_template, h1_template, slug_template, sections, required_word_count, min_publish_score, min_local_signal, max_similarity_threshold, prompt_family, faq_enabled, schema_types, is_active, metadata, created_at, updated_at, default_tier, min_score_for_tier1, city_tier_rules, min_bank_completeness, max_cities_per_state, state_allowlist) FROM stdin;
ba72618a-cc96-4cba-900c-b86f5637df90	70ec4b1c-80b2-4c17-9d22-f63275d21310	b7cfd050-7a02-4ef2-bcdb-1e044b063c3f	Service + City Page	service_city	{service} in {location}, {state} | SpotOn Results	Looking for {service} in {location}? SpotOn Results provides fast, reliable {service} to businesses in {location}, {state}. Get a free quote today!	{service} in {location}, {state}	{service}-{location}	[{"name": "Introduction", "description": "Overview of the merchant service offering for businesses in this specific city"}, {"name": "Why {location} Businesses Choose SpotOn Results", "description": "Local trust signals, specific business types in the city, why they need this service"}, {"name": "Our {service} Features", "description": "Detailed breakdown of what's included — rates, setup, support"}, {"name": "How It Works", "description": "Simple 3-step process: apply, get approved, start accepting payments"}, {"name": "Industries We Serve in {location}", "description": "Retail, restaurants, service businesses, healthcare, etc. in the city"}, {"name": "FAQ", "description": "4-6 questions about the service specific to local businesses"}, {"name": "Get Started Today", "description": "Strong CTA with contact info and free quote offer"}]	750	0.65	0.55	0.85	local_service	t	{LocalBusiness,FAQPage}	t	{}	2026-03-29 06:37:25.014302	2026-03-29 06:37:25.014302	2	80	\N	70	\N	\N
b6f1225f-290d-4b5c-ab93-893c60965abf	70ec4b1c-80b2-4c17-9d22-f63275d21310	b7cfd050-7a02-4ef2-bcdb-1e044b063c3f	State Hub Page	state_hub	Merchant Services in {state} | SpotOn Results	SpotOn Results provides merchant services and payment processing to businesses across {state}. Competitive rates, fast approval, 24/7 support. Get a free quote!	Merchant Services for {state} Businesses	merchant-services-{state}	[{"name": "Introduction", "description": "Overview of merchant services for businesses across the state"}, {"name": "Payment Processing in {state}", "description": "State-specific business landscape, major industries, why local businesses need good payment processing"}, {"name": "Cities We Serve in {state}", "description": "Major cities and business hubs in the state"}, {"name": "Our Services in {state}", "description": "Full range of services available statewide"}, {"name": "Why SpotOn Results for {state} Businesses", "description": "Local expertise, nationwide backing, state-specific compliance knowledge"}, {"name": "FAQ", "description": "State-specific questions about merchant services"}]	900	0.68	0.58	0.80	state_hub	t	{Organization,FAQPage}	t	{}	2026-03-29 06:37:25.018985	2026-03-29 06:37:25.018985	2	80	\N	70	\N	\N
2d8a7edb-e7cc-4579-bd0c-5d44bbc9cb5b	4d7ba690-ac0a-4654-9f41-1c773d6e8f92	\N	Test Service — Service + City Landing Page	service_city	{service} in {location}, {state} | {brand}	Professional {service} solutions in {location}, {state}. {brand} connects you with trusted {industry} providers. Get quotes & compare options today.	{service} in {location}, {state}	{service|slugify}/{location|slugify}-{state|slugify}	[{"name": "Hero Section", "description": "Attention-grabbing above-the-fold content with value proposition, CTA button, and trust indicators specific to {service} in {location}."}, {"name": "Service Overview", "description": "Detailed explanation of {service}, how it works, key benefits, and why businesses in {location} need this solution."}, {"name": "Local Market Context", "description": "Information about {location}'s business landscape, industry trends, and why {service} is essential for {location} merchants."}, {"name": "Provider Comparison", "description": "Table or list comparing top {service} providers available in {location}, including pricing, features, and ratings."}, {"name": "Benefits Section", "description": "Key advantages of {service}, including cost savings, efficiency gains, security features, and business growth impact."}, {"name": "Implementation Guide", "description": "Step-by-step process for getting started with {service} in {location}, including timeline, requirements, and what to expect."}, {"name": "FAQ Section", "description": "Common questions about {service} in {location}, covering costs, setup, compliance, support, and integration concerns."}, {"name": "CTA & Lead Generation", "description": "Multiple conversion opportunities including quote request form, phone number, and direct provider contact links for {location} area."}, {"name": "Social Proof", "description": "Customer testimonials, case studies, certifications, and trust badges relevant to {service} providers in {location}."}, {"name": "Local Schema Markup", "description": "Structured data for LocalBusiness, Service, AggregateRating, and FAQPage to enhance SERP visibility in {location}."}]	900	0.68	0.60	0.85	local_service	t	{LocalBusiness,FAQPage}	t	{}	2026-04-11 05:36:36.931364	2026-04-11 05:36:36.931364	2	80	\N	70	\N	\N
\.


--
-- Data for Name: booked_jobs; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.booked_jobs (id, lead_id, website_id, page_id, account_id, job_value, booked_date, status, created_at, updated_at) FROM stdin;
9e99ea29-a8b6-4533-a31a-ce0a269006c9	5f071076-bc8c-4ba4-8c30-2c609de3618d	b7cfd050-7a02-4ef2-bcdb-1e044b063c3f	b1ef0f69-4875-43f9-bb86-1bb35adc8363	70ec4b1c-80b2-4c17-9d22-f63275d21310	5000.00	2026-04-21 18:31:14.963	recorded	2026-04-21 18:31:14.963807	2026-04-21 18:31:14.963807
\.


--
-- Data for Name: brand_profiles; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.brand_profiles (id, account_id, name, logo_url, primary_color, secondary_color, tagline, description, phone, email, address, social_links, voice_and_tone, custom_fields, created_at, updated_at) FROM stdin;
17f98725-6109-46af-9553-f5992a1fd74a	70ec4b1c-80b2-4c17-9d22-f63275d21310	SpotOn Results	\N	#2563eb	#f59e0b	Merchant Services That Deliver Real Results	SpotOn Results provides cutting-edge merchant services and payment processing solutions to businesses nationwide. We help small and medium businesses accept payments, grow sales, and manage their finances smarter.	(800) 555-0300	info@spotonresults.com	spotonresults.com	{}	Professional, trustworthy, results-driven. Use clear, direct language. Emphasize savings, speed, and reliability. Speak to business owners who are busy and want solutions, not jargon.	{}	2026-03-29 06:37:24.760673	2026-03-29 06:37:24.760673
\.


--
-- Data for Name: call_tracking_numbers; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.call_tracking_numbers (id, website_id, page_id, service_id, location_id, dynamic_number, forward_to_number, is_active, created_at, updated_at) FROM stdin;
1705d765-2115-4e83-a13a-5dfc3b57b2c3	b7cfd050-7a02-4ef2-bcdb-1e044b063c3f	b1ef0f69-4875-43f9-bb86-1bb35adc8363	e22beced-37f8-4de0-b31d-47a6fa90ab79	5e35b164-da97-4032-bb55-825a3b7aa413	+15552935877	+14359995348	t	2026-04-21 18:30:53.817878	2026-04-21 18:30:53.817878
\.


--
-- Data for Name: client_weekly_digests; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.client_weekly_digests (id, website_id, account_id, recipient_email, subject, body_html, body_text, sent_at, created_at, status) FROM stdin;
\.


--
-- Data for Name: content_variation_banks; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.content_variation_banks (id, account_id, website_id, service, section_name, variations, created_at) FROM stdin;
bc3aa9e5-c38f-4bd4-98c9-c9605c82ac78	70ec4b1c-80b2-4c17-9d22-f63275d21310	b7cfd050-7a02-4ef2-bcdb-1e044b063c3f	Mobile Payment Solutions	intro	["<p>Your customers want to pay anywhere—at the counter, on the go, or outside your store. {{service}} from SpotOn Results lets you accept payments instantly from any location in {{city}}, {{state}}. Whether you're near {{landmark}} or across town, you're never without a payment solution. No more missed sales because a customer didn't have cash or wanted to checkout outside.</p>\\n<p>{{business_culture}} moves fast, and so should your payment processing. Our mobile solutions process transactions in seconds, deposit funds quickly, and integrate seamlessly with your existing systems. SpotOn Results handles the complexity so you can focus on what matters: running your business and serving customers.</p>", "<p>Cash flow problems cost {{city}}, {{state}} businesses thousands every year. Slow payment processing, missed transactions, and complicated systems drain your time and money. {{service}} from SpotOn Results solves this with mobile payments that work reliably, process instantly, and cost less than you'd expect. Accept cards, digital wallets, and more from any device.</p>\\n<p>Built for business owners who don't have time to waste, our platform works near {{landmark}} and everywhere else in {{state_abbr}}. Real-time reporting shows exactly what you're earning. Transparent pricing means no surprise fees. SpotOn Results delivers the speed and savings {{business_culture}} demands.</p>", "<p>{{service}} isn't just convenient—it's essential for {{city}} businesses competing in {{state}}. Customers expect flexibility in how they pay. When you can't deliver, they go elsewhere. SpotOn Results puts powerful mobile payment tools in your hands, so you're never caught without a way to process a sale, whether you're at {{landmark}} or anywhere in your service area.</p>\\n<p>Our merchants see faster checkouts, fewer abandoned transactions, and happier customers. {{business_culture}} appreciates reliability and results. That's exactly what you get: a payment solution that works every time, deposits you can count on, and support from a team that understands your business.</p>", "<p>Every {{city}} business has the same challenge: accept payments anywhere without complexity or risk. {{service}} from SpotOn Results removes that friction. Whether you're managing a single location near {{landmark}} or multiple spots across {{state}}, you get one unified system that processes payments fast, keeps data secure, and integrates with tools you already use.</p>\\n<p>{{business_culture}} doesn't settle for good enough. You need mobile payments that deliver on speed, security, and cost. SpotOn Results has been the trusted choice for {{state_abbr}} merchants because we focus on what drives your business forward: faster payments, lower fees, and zero headaches.</p>", "<p>Mobile payment solutions aren't a luxury anymore—they're how {{city}}, {{state}} customers expect to transact. SpotOn Results gives you the tools to meet that demand without overhauling your operations. {{service}} works whether you're at {{landmark}} or miles away, on any device, with zero complicated setup. Accept payments, get reports, manage everything from one dashboard.</p>\\n<p>{{business_culture}} values efficiency and transparency. Our mobile solution delivers both. You'll see lower processing costs, faster settlements, and clearer reporting than typical merchant services. SpotOn Results is built by people who understand {{state_abbr}} business owners—we solve real problems, not create new ones.</p>"]	2026-03-31 18:56:44.762056
4d83d611-3569-4a68-89d1-cbac9080ac2e	70ec4b1c-80b2-4c17-9d22-f63275d21310	b7cfd050-7a02-4ef2-bcdb-1e044b063c3f	Mobile Payment Solutions	benefits	["<p><strong>Accept payments anywhere, anytime.</strong> {{service}} from {{brand}} removes the constraint of a fixed checkout location. Your team can process transactions on the sales floor, at a customer's table, or even during a home service call. This flexibility means faster sales cycles and fewer abandoned transactions. Mobile payments work anywhere you have connectivity, keeping your business moving.</p>\\n<p><strong>Reduce operational friction and checkout time.</strong> Mobile payment solutions eliminate the need to direct customers to a stationary terminal. By bringing payment processing directly to the point of sale, you cut transaction time in half. Customers appreciate the speed, and your staff spends less time managing the checkout process. Faster transactions mean higher customer satisfaction and increased throughput.</p>\\n<p><strong>Comply with {{payment_regulations}} effortlessly.</strong> {{brand}} handles the complex compliance requirements so you don't have to. Our {{service}} solutions are built with PCI DSS standards and {{payment_regulations}} requirements embedded. Your business stays protected and audit-ready without added overhead. This peace of mind lets you focus on growth, not regulatory headaches.</p>\\n<p><strong>Access real-time reporting and transaction data.</strong> Every {{service}} transaction flows directly into your dashboard. Track sales, monitor inventory impact, and analyze customer behavior instantly. {{brand}} provides the insights you need to make smarter business decisions. Real-time data means you can spot trends before competitors do.</p>", "<p><strong>Lower your total cost of payment processing.</strong> Mobile payment solutions cut infrastructure costs significantly. You eliminate expensive terminal hardware and long-term leasing contracts. {{brand}}'s {{service}} model scales with your business—pay for what you use, when you use it. Lower fees and transparent pricing mean more money stays in your account.</p>\\n<p><strong>Build customer loyalty through seamless experiences.</strong> Customers expect frictionless payment options. {{service}} from {{brand}} meets that expectation with fast, secure, contactless transactions. Repeat customers appreciate the convenience and speed. When checkout feels effortless, customers return. Better experiences drive loyalty and word-of-mouth growth.</p>\\n<p><strong>Enable multiple payment methods on one platform.</strong> Accept credit cards, debit cards, digital wallets, and contactless payments through {{service}}. {{brand}} consolidates payment acceptance into a single solution, eliminating the need for multiple systems. Customers pay how they prefer, and you get unified reporting. Simplicity reduces training time and operational errors.</p>\\n<p><strong>Stay secure with enterprise-grade protection.</strong> {{payment_regulations}} compliance and fraud detection are built into every {{service}} transaction. {{brand}} uses encryption and tokenization to protect sensitive customer data. Your business avoids costly breaches and chargebacks. Security isn't an afterthought—it's the foundation.</p>", "<p><strong>Empower your team with intuitive technology.</strong> {{service}} from {{brand}} requires minimal training. Your staff can start processing payments immediately, even if they're not tech-savvy. The interface is designed for busy business owners and frontline employees. Simple tools mean fewer errors and faster onboarding. Your team stays focused on service, not struggling with technology.</p>\\n<p><strong>Increase sales by removing payment barriers.</strong> When customers can pay anywhere, conversion rates climb. {{service}} eliminates the moment when a customer might walk away due to a long checkout line. Mobile payments from {{brand}} capture sales that traditional systems miss. In retail and service industries, this difference compounds quickly.</p>\\n<p><strong>Scale your business without added infrastructure.</strong> {{brand}}'s {{service}} grows with you. Whether you're operating one location or ten, the same system works seamlessly. No need for new terminal hardware or complex integrations at each site. Cloud-based architecture means you scale cost-efficiently, without capital expenditure.</p>\\n<p><strong>Gain actionable insights from payment data.</strong> {{payment_regulations}}-compliant reporting from {{service}} shows you which products sell, which times are busiest, and which customers spend most. {{brand}} transforms transaction data into strategy. These insights drive inventory decisions, staffing plans, and marketing focus. Data-driven decisions outperform guesswork every time.</p>", "<p><strong>Eliminate the risk of cash handling.</strong> Mobile payments reduce your dependence on cash, cutting theft and administrative burden. {{service}} from {{brand}} makes digital payments the default. Less cash handling means fewer counting errors, reduced security concerns, and easier reconciliation. Your accounting team will thank you.</p>\\n<p><strong>Support contactless and digital wallet payments.</strong> Modern customers expect to tap, scan, or use their phone to pay. {{service}} supports Apple Pay, Google Pay, and contactless cards out of the box. {{Brand}} keeps your business aligned with customer preferences and safety expectations. Future-proof your payment acceptance today.</p>\\n<p><strong>Improve cash flow with faster settlement.</strong> {{brand}}'s {{service}} settles transactions quickly, getting funds to your account faster than traditional terminals. Faster settlement improves cash flow when you need it most. Watch your money land in your account in hours, not days. Better cash flow means better business decisions.</p>\\n<p><strong>Meet {{payment_regulations}} without hidden compliance costs.</strong> {{service}} from {{brand}} includes {{payment_regulations}} compliance in the base offering. No surprise audit fees, no unexpected compliance charges. Your total cost of ownership stays predictable. Transparent pricing and built-in compliance give you confidence and control.</p>", "<p><strong>Deliver a modern customer experience.</strong> Customers judge businesses by their payment experience. {{service}} from {{brand}} signals that you're modern, efficient, and customer-focused. Fast, secure, flexible payments build trust. In competitive markets, the customer experience is often what drives repeat business and referrals.</p>\\n<p><strong>Reduce dependency on physical location.</strong> Pop-ups, events, and mobile services become viable revenue streams with {{service}}. {{Brand}} lets you accept payments anywhere. Seasonal sales, trade shows, and remote deliveries all become easy to execute. Expand your business model without major infrastructure investment.</p>\\n<p><strong>Maintain security while staying {{payment_regulations}} compliant.</strong> {{service}} handles tokenization, encryption, and {{payment_regulations}} requirements automatically. You don't store sensitive card data. {{Brand}} manages the security overhead so you can focus on business. Enterprise-grade protection at a cost that scales with your business.</p>\\n<p><strong>Streamline reconciliation and accounting.</strong> Every {{service}} transaction flows directly into your accounting system. {{Brand}} integrates with popular accounting software, eliminating manual entry and reconciliation errors. Your books stay accurate in real-time. Less administrative work means less cost and fewer mistakes.</p>"]	2026-03-31 18:56:52.901478
aca92208-0ac7-45d5-b0da-303df656f69a	70ec4b1c-80b2-4c17-9d22-f63275d21310	b7cfd050-7a02-4ef2-bcdb-1e044b063c3f	Mobile Payment Solutions	how_it_works	["<p>Getting started with {{service}} from {{brand}} is straightforward. You'll begin with a quick consultation where our team assesses your business needs, current payment setup, and sales volume. We'll discuss your specific challenges—whether it's long checkout lines, cart abandonment, or the need to accept payments on-the-go. This conversation helps us recommend the right mobile solution for your operation, whether you're a retail shop in {{city}}, {{state}}, or a service-based business managing payments across multiple locations.</p>\\n<p>Once you've chosen your solution, our onboarding specialists guide you through application and approval. You'll provide standard merchant information, and we'll handle the heavy lifting with card networks and underwriting. Most {{brand}} clients in {{state}} get approved within 24-48 hours. We'll then ship your mobile hardware—whether that's a card reader, tablet-based POS, or smartphone attachment—directly to your business address.</p>\\n<p>Finally, our team completes your setup and training. We'll integrate your system with existing software, load your inventory or service menu, and walk your team through transactions, refunds, and reporting. You're live and processing payments quickly. Join thousands of {{business_count}} businesses trusting {{brand}} for reliable mobile payments that keep cash flowing while you focus on growth.</p>", "<p>The journey to accepting {{service}} starts with understanding your business. When you contact {{brand}}, we skip the sales pitch and ask the right questions: How many transactions daily? What devices do your customers prefer? Are you managing one location in {{city}}, {{state}}, or multiple sites? This discovery phase typically takes 15-20 minutes and determines whether you need a plug-in card reader, a full mobile POS system, or a hybrid approach for maximum flexibility.</p>\\n<p>After we identify your ideal solution, paperwork and approval happen fast. {{brand}} works directly with payment networks to expedite underwriting—most businesses approve same-day. You'll set up your merchant account, choose your pricing plan, and confirm hardware delivery details. We ship equipment within 24 hours, and it typically arrives in 2-3 business days to anywhere in {{state}}.</p>\\n<p>Implementation day is where {{brand}} shines. Our technicians configure your mobile payment setup, sync it with your registers or appointment software, and run test transactions to ensure everything works flawlessly. Your staff receives hands-on training on processing, security, and troubleshooting. With {{business_count}} satisfied merchants already running {{service}}, you'll join a proven network of successful businesses ready to accept payments anywhere, anytime.</p>", "<p>Starting with {{brand}}'s {{service}} begins the moment you reach out. Our merchant services team reviews your business type, transaction volume, and growth goals. Are you a brick-and-mortar retailer in {{city}}, {{state}} looking to speed up checkout? A mobile service provider needing on-site payments? A restaurant handling table-side orders? We match your specific use case to the right mobile payment technology—ensuring you get exactly what your business needs, nothing more.</p>\\n<p>The approval process moves quickly because {{brand}} streamlines every step. You'll complete a brief application, provide business documentation, and we'll handle processor verification with minimal back-and-forth. Most merchants in {{state}} receive approval within one business day. Our fulfillment team then prepares your hardware kit and ships it with setup instructions and an activation guide, getting equipment to you in 2-3 business days.</p>\\n<p>Deployment and training complete the picture. {{brand}}'s support specialists contact you to schedule setup, configure your mobile payment reader or POS terminal, and ensure your payment system integrates smoothly with your existing business tools. They'll demonstrate transaction processing, dispute handling, and accessing your real-time reporting dashboard. Within a week of first contact, you're processing payments securely. That's how {{business_count}} businesses across {{state}} leverage {{brand}} for mobile payments that actually work.</p>", "<p>{{brand}}'s {{service}} process is built on speed and simplicity. Step one happens when you complete our online quote form or call our merchant services team. You'll answer basic questions about your business—location in {{city}}, {{state}}, industry type, monthly sales volume—and we'll provide instant pricing transparency with no hidden fees. This takes five minutes, and you'll know exactly what {{service}} costs and what you get. Many business owners are surprised by how affordable reliable mobile payments truly are.</p>\\n<p>Approval and setup come next, and {{brand}} handles the complexity. We submit your application to underwriting, work directly with card networks, and manage all compliance requirements. You don't navigate bureaucracy—we do. Typical approval takes 24 hours. Once approved, we order and ship your mobile payment hardware, select your preferred configuration, and assign you a dedicated merchant services representative who coordinates everything.</p>\\n<p>Go-live happens in one focused session. {{brand}} technicians install your mobile payment readers or POS solution, run verification transactions, and ensure your team is confident using the system. They'll show you how to process payments, handle refunds, dispute chargebacks, and access sales analytics. Thousands of {{business_count}} merchants across {{state}} are already enjoying faster checkouts, reduced cash handling, and better payment security with {{brand}}. You'll be next.</p>", "<p>Implementing {{service}} with {{brand}} starts with honest conversation. We don't assume what you need—we ask. You'll describe your business (retail, food service, professional services), current payment method, pain points, and growth vision. If you're in {{city}}, {{state}} handling dozens of daily transactions or seasonal spikes, {{brand}} has solutions. We discuss whether a card reader attachment, mobile POS tablet, or multi-location system fits your workflow, budget, and growth timeline best.</p>\\n<p>The merchant account and approval stage is where {{brand}} proves its reliability. You'll complete a straightforward application, and our underwriting team fast-tracks your approval—most {{state}} businesses are approved within 24 hours. We secure your merchant account directly with payment networks, ensuring competitive rates and full compliance. Once approved, hardware ships immediately with complete setup documentation, carrier support contact info, and an onboarding timeline.</p>\\n<p>Training and go-live are stress-free because {{brand}} guides you through each step. A certified specialist contacts you, schedules a convenient training session (phone, video, or in-person in {{city}}, {{state}}), and walks your team through real transactions. You'll learn security best practices, reconciliation, and how to access your dashboard for instant reporting. After training, you're live—processing mobile payments with the reliability {{business_count}} other merchants trust. {{brand}} remains your partner, not just your processor.</p>"]	2026-03-31 18:56:54.406909
b57fe18f-47aa-44ac-99c0-5d6379616176	70ec4b1c-80b2-4c17-9d22-f63275d21310	b7cfd050-7a02-4ef2-bcdb-1e044b063c3f	Mobile Payment Solutions	faq	["<p><strong>Q: How quickly can I start accepting mobile payments with SpotOn Results Mobile Payment Solutions?</strong></p>\\n<p>We get you up and running fast. Most businesses are processing transactions within 24-48 hours of signing up. Our streamlined onboarding handles {{payment_regulations}} compliance automatically, so you don't have to worry about the paperwork. Whether you're in {{city}}, {{state}}, or anywhere nationwide, we'll have your Mobile Payment Solutions integrated and ready to go.</p>\\n\\n<p><strong>Q: What are the real costs of using {{brand}} Mobile Payment Solutions?</strong></p>\\n<p>Transparency matters. Our pricing is straightforward—competitive per-transaction rates with no hidden setup or monthly fees. Most businesses save 30-50% compared to their current processor. We'll show you exactly what you'll pay before you commit, and we back it with a price-match guarantee across the {{service}} space.</p>\\n\\n<p><strong>Q: Can I use mobile payments if I operate in multiple locations?</strong></p>\\n<p>Absolutely. {{brand}} Mobile Payment Solutions scales with your business. Manage all locations from one dashboard, track sales in real time, and reconcile accounts faster. Whether you're running one shop in {{city}}, {{state}}, or 50 across the country, our platform handles multi-location operations seamlessly while staying compliant with {{payment_regulations}}.</p>\\n\\n<p><strong>Q: What happens if my internet connection drops during a transaction?</strong></p>\\n<p>Our {{service}} is built for real-world conditions. {{brand}} Mobile Payment Solutions includes offline mode—transactions queue automatically and sync when connection returns. Your customers never experience friction, and you never lose a sale. We ensure 99.9% uptime plus redundant systems for maximum reliability.</p>\\n\\n<p><strong>Q: Which payment types does {{brand}} Mobile Payment Solutions accept?</strong></p>\\n<p>All of them. Credit cards, debit cards, digital wallets, ACH transfers—we process every payment method your customers prefer. Full compliance with {{payment_regulations}} is built in. Accept payments anywhere, anytime, on any device. Your {{city}}, {{state}} business gets the flexibility modern customers expect.</p>", "<p><strong>Q: Is {{brand}} Mobile Payment Solutions secure for my customers' payment data?</strong></p>\\n<p>Security is non-negotiable. {{brand}} meets PCI-DSS Level 1 standards and exceeds {{payment_regulations}} requirements. Every transaction is encrypted end-to-end, and your customer data never touches your device directly. We use tokenization and advanced fraud detection, so you and your {{city}}, {{state}} customers stay protected.</p>\\n\\n<p><strong>Q: How do I get paid when using mobile payments?</strong></p>\\n<p>Fast and simple. {{brand}} Mobile Payment Solutions deposits funds directly to your business account—typically next business day. You'll see real-time settlement tracking in your dashboard so you always know when money's coming. No waiting around. No surprises. Just reliable {{service}} that works for {{city}}, {{state}} merchants.</p>\\n\\n<p><strong>Q: Can I customize receipts and branding with the {{service}}?</strong></p>\\n<p>Yes. {{brand}} Mobile Payment Solutions lets you add your logo, custom messaging, and branded receipts. Digital or printed—your choice. Build customer loyalty through every transaction. Customization is simple, takes minutes in the dashboard, and helps your {{city}}, {{state}} business stand out.</p>\\n\\n<p><strong>Q: What reporting and analytics does {{brand}} provide?</strong></p>\\n<p>Deep insights. Real-time sales dashboards, detailed transaction reports, inventory tracking, and customer analytics all in one place. {{brand}} Mobile Payment Solutions gives you the data to make smart decisions fast. Monitor what's selling, who's buying, and where you can grow—all {{payment_regulations}} compliant and accessible anywhere.</p>\\n\\n<p><strong>Q: Do I need special equipment for {{brand}} Mobile Payment Solutions?</strong></p>\\n<p>Keep it simple. A smartphone or tablet is all you need. No expensive terminals or bulky hardware required. {{brand}} works with the devices you already own, reducing startup costs. Our {{service}} works everywhere—in-store, curbside, pop-ups, events—making mobile payments truly mobile for {{city}}, {{state}} business owners.</p>", "<p><strong>Q: How does {{brand}} Mobile Payment Solutions help me compete with larger retailers?</strong></p>\\n<p>Level the playing field. Enterprise-grade {{service}} shouldn't require enterprise budgets. {{brand}} Mobile Payment Solutions gives small and mid-sized businesses in {{city}}, {{state}} the same payment technology as big chains—fast processing, professional tools, customer insights. Pay less, get more, compete harder.</p>\\n\\n<p><strong>Q: What if I need customer support for my Mobile Payment Solutions?</strong></p>\\n<p>We're here when you need us. {{brand}} provides 24/7 support via phone, email, and chat. Our team knows {{service}}, knows {{payment_regulations}}, and knows your business challenges. Real people answer. Real problems get solved. No waiting on hold. Support matters, and we deliver it consistently for {{city}}, {{state}} merchants.</p>\\n\\n<p><strong>Q: Can {{brand}} Mobile Payment Solutions integrate with my existing business software?</strong></p>\\n<p>Yes. {{brand}} integrates with major POS systems, accounting software, and e-commerce platforms. Sync {{service}} data automatically with QuickBooks, Shopify, Square, and dozens of others. One source of truth across your entire operation. No manual entry. No data gaps. Seamless integration for {{city}}, {{state}} businesses.</p>\\n\\n<p><strong>Q: How do I know {{brand}} stays compliant with payment regulations?</strong></p>\\n<p>Compliance is our job, not yours. {{brand}} Mobile Payment Solutions keeps pace with {{payment_regulations}} changes automatically. PCI updates, industry standards, state requirements—we handle it. You focus on running your business. We ensure you're always protected and never at risk from regulatory gaps.</p>\\n\\n<p><strong>Q: What's the contract like with {{brand}} Mobile Payment Solutions?</strong></p>\\n<p>Flexible and fair. No long-term lock-in. No cancellation penalties. Month-to-month terms give you control. If you're not satisfied, you can cancel anytime. We stay competitive because we have to—not because you're stuck. {{brand}} Mobile Payment Solutions keeps earning your business every single month in {{city}}, {{state}}.</p>", "<p><strong>Q: How much faster is {{brand}} Mobile Payment Solutions than my current setup?</strong></p>\\n<p>Significantly. Processing takes seconds instead of minutes. Payment reconciliation is automatic instead of manual. Settlement is overnight instead of days later. {{brand}} Mobile Payment Solutions eliminates the friction in your {{service}}. For {{city}}, {{state}} businesses, that means faster cash flow and less admin work every single day.</p>\\n\\n<p><strong>Q: Does {{brand}} charge extra fees for different payment types or transaction sizes?</strong></p>\\n<p>No surprises. {{brand}} Mobile Payment Solutions has straightforward, transparent pricing. Same rate whether it's a $5 transaction or a $500 one. No surcharges for different card types. No hidden fees for {{payment_regulations}} compliance. You see the exact cost upfront—that's the {{brand}} difference in {{city}}, {{state}}.</p>\\n\\n<p><strong>Q: Can I use {{brand}} Mobile Payment Solutions for online and in-person sales?</strong></p>\\n<p>Both. {{brand}} {{service}} works seamlessly across channels—mobile, online, in-store. One dashboard manages everything. One integration. One settlement account. Omnichannel selling simplified. Whether you sell in-person at your {{city}}, {{state}} location or online 24/7, {{brand}} handles it all.</p>\\n\\n<p><strong>Q: What training do I need to use {{brand}} Mobile Payment Solutions?</strong></p>\\n<p>Minimal. The platform is intuitive and designed for busy owners, not tech experts. We provide video tutorials, live training sessions, and comprehensive guides. Most users are proficient in under an hour. Your {{city}}, {{state}} team will process payments confidently from day one with {{brand}}.</p>\\n\\n<p><strong>Q: How does {{brand}} Mobile Payment Solutions protect against fraud?</strong></p>\\n<p>Layered protection. Real-time fraud detection flags suspicious activity instantly. Machine learning adapts to new threats continuously. {{payment_regulations}} compliance is built in. Chargebacks are reduced through verification tools. {{brand}} Mobile Payment Solutions keeps your {{city}}, {{state}} business and customers safe from fraud every transaction.</p>", "<p><strong>Q: What makes {{brand}} Mobile Payment Solutions different from competitors?</strong></p>\\n<p>Results. {{brand}} focuses on what matters: lower costs, faster processing, better support. No bloated features you don't need. No complexity. {{service}} built for real business owners in {{city}}, {{state}} who want to process payments and move on. Transparent pricing, genuine support, reliable technology—that's the {{brand}} advantage.</p>\\n\\n<p><strong>Q: Can I track inventory with {{brand}} Mobile Payment Solutions?</strong></p>\\n<p>Yes. Our {{service}} integrates inventory tracking so you see stock levels in real time. Sync with payments automatically. Know what's selling and when to reorder. {{brand}} Mobile Payment Solutions keeps {{city}}, {{state}} retailers in control of both money and merchandise from one dashboard.</p>\\n\\n<p><strong>Q: How does {{brand}} handle payment disputes and chargebacks?</strong></p>\\n<p>We've got your back. {{brand}} provides comprehensive dispute resolution support. We help gather documentation, submit evidence, and fight chargebacks on your behalf. Detailed transaction records make disputes easier to resolve. {{payment_regulations}} protections are built in. Your {{city}}, {{state}} business stays protected with {{brand}}.</p>\\n\\n<p><strong>Q: Is {{brand}} Mobile Payment Solutions suitable for seasonal businesses?</strong></p>\\n<p>Perfect for it. Scale up or down instantly based on volume. Pay only for what you use—no minimum monthly commitments. Seasonal spikes don't trigger extra charges. No contracts to renegotiate. {{brand}} Mobile Payment Solutions adapts to your business cycle, not the other way around, for {{city}}, {{state}} merchants.</p>\\n\\n<p><strong>Q: What happens to my data with {{brand}} Mobile Payment Solutions?</strong></p>\\n<p>It's yours. {{brand}} never sells your business data. Encrypted storage. Secure backups. {{payment_regulations}} compliance. You own the insights and analytics. Access your data anytime. Export whenever needed. Full transparency on how your {{service}} data is stored, used, and protected for {{city}}, {{state}} business owners.</p>"]	2026-03-31 18:57:01.357958
61d15db2-73e8-4484-8826-778f20093048	70ec4b1c-80b2-4c17-9d22-f63275d21310	b7cfd050-7a02-4ef2-bcdb-1e044b063c3f	High-Risk Merchant Accounts	cta	["<p>Don't let payment processing hold back your business growth. SpotOn Results specializes in {{service}} {{city}} {{state}}, giving high-risk merchants the reliable solutions they need to thrive. We've helped hundreds of businesses like yours process payments securely and confidently. Stop searching for alternatives—get approved faster with SpotOn Results. <strong>Request your free merchant account quote today.</strong></p>", "<p>High-risk doesn't mean impossible. With {{service}} from SpotOn Results in {{city}}, {{state}}, you get industry-leading approval rates and transparent pricing—no hidden fees, no surprises. Your business deserves a payment partner that understands your challenges and delivers results. <strong>Talk to a specialist now and discover why merchants choose us.</strong></p>", "<p>Time is money, and you're losing both without a proper {{service}} solution. SpotOn Results {{city}} {{state}} processes applications in days, not weeks, so you can start accepting payments immediately. Trusted by high-risk businesses nationwide, we combine speed with security. <strong>Apply now and get approved faster than you'd expect.</strong></p>", "<p>Getting declined for a merchant account is frustrating. {{service}} from SpotOn Results in {{city}}, {{state}} changes that. We specialize in high-risk approvals with competitive rates, dedicated support, and the technology to scale as you grow. Your business is worth it. <strong>Schedule a consultation with our team today—no obligation.</strong></p>", "<p>The right {{service}} partner doesn't judge your industry—they enable your success. SpotOn Results {{city}} {{state}} has processed millions in transactions for high-risk merchants, delivering the reliability, savings, and support your business needs. Ready to get serious about growth? <strong>Let's talk. Contact SpotOn Results now.</strong></p>"]	2026-03-31 18:58:30.807724
48619063-b803-4072-ae05-7af37edd693f	70ec4b1c-80b2-4c17-9d22-f63275d21310	b7cfd050-7a02-4ef2-bcdb-1e044b063c3f	High-Risk Merchant Accounts	intro	["<p>Running a {{business_culture}} business in {{city}}, {{state}} means navigating unique challenges—especially when it comes to payment processing. If you've been rejected by traditional merchant service providers, {{service}} from SpotOn Results is your answer. We specialize in serving businesses that others won't, offering the same reliable payment solutions without the gatekeeping.</p>\\n<p>High-risk doesn't mean high-stress. Our {{service}} in {{state_abbr}} are built for merchants who need speed, transparency, and approval—not endless applications and rejections. Near {{landmark}}, hundreds of {{city}} business owners trust us to process payments securely while they focus on what they do best: running their business.</p>", "<p>You've built something valuable in {{city}}, {{state}}. Your business model works. But getting approved for merchant accounts shouldn't be a battle. {{service}} from SpotOn Results exists because traditional banks overlook legitimate businesses every day. We see the potential where others see risk.</p>\\n<p>Whether you operate around {{landmark}} or across {{state_abbr}}, our {{service}} are designed to get you processing payments fast. We understand {{business_culture}} businesses. We know your chargeback rates, your industry challenges, and what it takes to keep your operation running smoothly. That expertise makes all the difference.</p>", "<p>Payment processing shouldn't be a roadblock to growth. In {{city}}, {{state}}, SpotOn Results provides {{service}} for merchants that mainstream processors reject. We handle industries others avoid—because we know that high-risk doesn't mean unreliable. It means you need a partner who understands your business model and trusts your operation.</p>\\n<p>From {{landmark}} to the outer reaches of {{state_abbr}}, we've helped {{business_culture}} merchants accept payments, reduce costs, and scale confidently. Our {{service}} come with competitive rates, dedicated support, and the kind of transparency that builds real partnerships. Stop settling for rejection. Get approved with SpotOn Results.</p>", "<p>The {{business_culture}} marketplace in {{city}}, {{state}} is thriving—but access to payment processing shouldn't be the limitation holding you back. {{service}} from SpotOn Results solves the merchant account problem for businesses that traditional providers overlook. We approve where others decline, because we focus on your actual risk profile, not assumptions.</p>\\n<p>Near {{landmark}} and throughout {{state_abbr}}, SpotOn Results processes millions in transactions for high-risk merchants every month. Our {{service}} deliver fast approvals, transparent pricing, and the reliability your business deserves. You've proven your business model works. Let us prove we're the payment processor that gets it.</p>", "<p>Rejected by your bank? Turned down for a merchant account? {{service}} from SpotOn Results in {{city}}, {{state}} is built for merchants exactly like you. We don't rely on cookie-cutter risk models. We evaluate your actual business—your revenue, your operations, your potential. That's why {{business_culture}} merchants throughout {{state_abbr}} choose us.</p>\\n<p>Approval matters. Speed matters. Reliability matters more. Near {{landmark}}, business owners partner with SpotOn Results because we deliver all three with our {{service}}. No hidden fees. No surprise chargebacks. No getting cut off mid-year. Just straightforward payment processing that works for your business model, backed by a team that actually supports your growth.</p>"]	2026-03-31 18:58:36.46036
c2891ecd-bc64-4722-9c06-938f357f72f2	70ec4b1c-80b2-4c17-9d22-f63275d21310	b7cfd050-7a02-4ef2-bcdb-1e044b063c3f	High-Risk Merchant Accounts	how_it_works	["<p>Getting approved for {{service}} with {{brand}} starts with a simple conversation. Contact our high-risk specialist team, and we'll review your business model, processing history, and financial standing. Unlike traditional banks, we understand industries others won't touch—adult services, CBD, gaming, firearms, and more. We ask the right questions upfront so there are no surprises later. This initial consultation typically takes 24 hours, and we'll give you honest feedback about your eligibility and expected rates.</p>\\n<p>Once we move forward, our underwriting team digs deeper. We'll request documentation: bank statements, processing statements, tax returns, and proof of business licensing. For {{business_count}} high-risk merchants nationwide, this step is where {{brand}} differs—we specialize in this category, so we know exactly what regulators require and what actually matters. We process applications faster than traditional providers because we've streamlined our {{service}} approval workflow. Most merchants see approval within 3-5 business days.</p>\\n<p>After approval, implementation is quick. We'll set you up with merchant processing terminals, gateways, or both, depending on your {{city}}, {{state}} operation. Your dedicated account manager walks you through everything: fraud monitoring tools, chargeback procedures, and compliance requirements. You'll be processing transactions securely within days, not weeks. {{brand}} handles the backend so you can focus on running your business.</p>", "<p>The {{service}} process breaks down into three straightforward phases: application, underwriting, and activation. When you reach out to {{brand}}, you're connecting with merchants services experts who've handled thousands of high-risk cases. We'll discuss your business type, monthly volume projections, and current processing challenges during an initial call. Many business owners in {{city}}, {{state}} are surprised how quickly we move—but speed matters when you're losing revenue without proper payment processing.</p>\\n<p>Underwriting is where accuracy matters most. We'll request your application documents and financial records within 24 hours of your initial conversation. Unlike generic processors, {{brand}} evaluates {{service}} applications with industry-specific knowledge. We understand why a CBD retailer's chargeback rate looks different from a consulting firm's, and we price accordingly. Your complete underwriting typically wraps in 3-5 business days. We approve roughly {{business_count}} merchants annually because we focus on legitimate businesses in regulated industries—not because we're reckless.</p>\\n<p>Once approved, activation happens fast. We'll deliver your processing terminals, integrate your payment gateway, and provide staff training. Your {{service}} account comes pre-configured with monitoring tools built for high-risk merchants: real-time fraud detection, velocity checks, and automated compliance reporting. You start accepting payments immediately, with a dedicated support team available during business hours and emergency support 24/7.</p>", "<p>{{Brand}} approaches {{service}} differently because we know high-risk isn't the same as bad risk. Step one: tell us about your business. Call our merchant services team or start your online application. We'll ask about your industry, processing volume, average transaction size, and why you've been declined elsewhere. Merchants in {{city}}, {{state}} dealing with adult services, cryptocurrency, nutraceuticals, or other restricted categories finally get a straightforward answer: yes, we work with you. This initial assessment takes one conversation—no runaround.</p>\\n<p>Step two is documentation and verification. We'll collect standard merchant account paperwork: business license, EIN documentation, bank statements showing 3-6 months of activity, and your processing history if you've had accounts before. {{Business_count}} successful {{service}} approvals prove our underwriting process works. We're thorough but not bureaucratic. Our specialists review your file within 48 hours and either approve you or explain what's missing. Transparency speeds everything up—we don't keep you guessing about your status.</p>\\n<p>Step three is your go-live. {{Brand}} provisions your processing solution—whether that's point-of-sale hardware, an integrated gateway, mobile processing, or a combination. We configure your account for your specific risk profile, set fraud thresholds appropriate for your industry, and establish your reserve requirements. Your onboarding specialist ensures your team is trained and ready. You process your first transaction with {{service}} support standing by to verify everything works perfectly.</p>", "<p>Think of {{service}} approval as a partnership, not a test you might fail. {{Brand}} begins by understanding your business's real story. Many high-risk merchants have been rejected by larger processors who use outdated filters. We ask different questions: What problem are you solving? Who are your customers? What's your actual risk profile? During an initial call with our {{city}}, {{state}} team, we evaluate whether your industry and operations are legitimate—not whether they fit some bank's comfort level. This conversation clarifies expectations and sets realistic timelines.</p>\\n<p>Phase two is structured verification. You'll submit standard documents—business registration, tax returns, processing statements, personal financial statements from principals. Here's the difference: {{brand}} evaluates {{service}} applications using specialists who know your industry. We understand why a high-ticket coaching business has different chargeback patterns than an e-commerce retailer. Our underwriting takes 3-5 days because we're thorough, not because we're slow. {{Business_count}} approved merchants trust our evaluation process because we explain our decision either way.</p>\\n<p>Go-live is where everything becomes real. {{Brand}} deploys your processing infrastructure—terminals, gateways, or integrated systems tailored to your {{city}}, {{state}} operations. We configure fraud controls appropriate for high-risk {{service}} accounts, establish reserve requirements if needed, and assign you a dedicated account manager. Your team gets comprehensive training on compliance, chargeback procedures, and daily best practices. You'll process securely from day one with full support behind you.</p>", "<p>The journey to {{service}} approval with {{brand}} emphasizes clarity and speed. Contact us through any channel—phone, online form, or email—and describe your business. Our specialist will ask about your industry, processing history, and current challenges. Unlike processors who ghost you or give vague rejections, {{brand}} gives honest feedback immediately. We serve {{business_count}} high-risk merchants nationwide, so we've likely worked with your industry before. Your initial conversation with our {{city}}, {{state}} team concludes with a clear next step and timeline.</p>\\n<p>Your application enters our specialized underwriting track. Submit documentation securely: business licenses, financial statements, processing history, and owner information. {{Brand}} specializes in {{service}}, meaning our review process accounts for industry-specific factors others miss. A CBD company's chargeback rate isn't evaluated the same as a retail store's—we know the difference. Most applications reach decision status within 3-5 business days. We communicate status updates proactively so you're never waiting and wondering about your merchant account approval.</p>\\n<p>Approval triggers immediate implementation. {{Brand}} expedites provisioning: your POS system, payment gateway, or mobile processing solution launches within days. We configure your {{service}} account with appropriate fraud detection, reserve structures, and compliance monitoring tools. You receive personalized training, ongoing account management, and 24/7 technical support. Processing your first transaction marks the beginning of a partnership—{{brand}} stays involved because your success directly impacts ours.</p>"]	2026-03-31 18:58:45.714149
4b63a270-3225-41a9-8f7e-686c0fc7eb6b	70ec4b1c-80b2-4c17-9d22-f63275d21310	b7cfd050-7a02-4ef2-bcdb-1e044b063c3f	High-Risk Merchant Accounts	benefits	["<p><strong>Get approved fast, even with a complex business history.</strong> {{service}} from {{brand}} specializes in businesses that traditional processors reject. We understand that high-risk industries—like gaming, e-commerce, CBD, or adult entertainment—deserve reliable payment solutions. Our streamlined underwriting process moves quickly, so you're not waiting weeks for approval. We focus on your current operations and growth potential, not just your past.</p>\\n<p><strong>Keep more revenue with competitive, transparent rates.</strong> Hidden fees drain your profit margin. {{brand}}'s {{service}} pricing is straightforward: you know exactly what you're paying upfront. We negotiate better rates because we specialize in high-risk accounts and process them at scale. That means lower per-transaction costs and higher margins for your business, without surprise charges.</p>\\n<p><strong>Stay compliant with {{payment_regulations}} and industry standards.</strong> Operating a high-risk business in {{city}}, {{state}} means navigating strict {{payment_regulations}}. {{brand}} handles compliance so you don't have to. We monitor regulatory changes, maintain proper documentation, and ensure your merchant account meets all legal requirements—reducing your risk and protecting your business from costly violations.</p>\\n<p><strong>Access dedicated support from processors who understand your industry.</strong> Generic payment companies don't get it. Our team specializes in high-risk {{service}} accounts and knows the challenges you face. When you need help with chargebacks, transaction issues, or compliance questions, you'll reach people who actually understand your business—not a confused call center.</p>", "<p><strong>Eliminate payment processing rejections and restart your revenue flow.</strong> If your current processor shut you down or repeatedly denied your applications, {{brand}}'s {{service}} solution is built for you. We accept applications other processors won't, which means your customers can pay you immediately. No more lost sales because of payment processing barriers—just reliable transactions that flow directly into your account.</p>\\n<p><strong>Reduce chargeback risk with advanced fraud prevention tools.</strong> High-risk accounts face higher chargeback rates, which can kill profitability. {{brand}} provides built-in fraud detection, real-time monitoring, and chargeback management tools that catch suspicious activity before it becomes a problem. You'll have better visibility into transactions and faster dispute resolution when chargebacks do occur.</p>\\n<p><strong>Scale your {{service}} business without processor interruptions.</strong> Growth shouldn't trigger account termination. {{brand}} partners with high-risk merchants for the long term and supports your expansion. As your {{city}}, {{state}} business grows, we grow with you—no sudden account closures or rate hikes that force you to start over.</p>\\n<p><strong>Maintain operational control with flexible, reliable payment processing.</strong> You shouldn't have to change your business model to fit your processor's comfort level. {{brand}}'s {{service}} accounts are built around your actual operations. We provide the flexibility and reliability you need to run your business your way, while staying fully compliant with {{payment_regulations}}.</p>", "<p><strong>Access global payment processing capabilities for international expansion.</strong> If your {{service}} business serves customers across {{state}} and beyond, you need a processor who supports multi-currency transactions and international payments. {{brand}} enables you to accept payments from customers worldwide, opening new revenue streams without the headache of managing multiple processors or compliance issues across different regions.</p>\\n<p><strong>Get instant underwriting decisions so you can start accepting payments today.</strong> Time is money. Traditional underwriting takes weeks; {{brand}}'s {{service}} accounts move through approval in days. Our instant decision platform means less waiting, faster onboarding, and quicker access to your funds. You'll be processing transactions and generating revenue instead of stuck in the approval pipeline.</p>\\n<p><strong>Protect your business with industry-leading security and fraud prevention.</strong> High-risk {{service}} accounts need serious security. {{brand}} uses encryption, tokenization, and real-time fraud detection to protect customer data and your reputation. We comply with all {{payment_regulations}} and PCI standards, giving your customers confidence and giving you peace of mind.</p>\\n<p><strong>Enjoy transparent reporting and real-time transaction visibility.</strong> You deserve to know exactly what's happening with your payments. {{brand}} provides detailed, real-time dashboards showing every transaction, chargeback, and fee. No hidden metrics or surprise account actions—just clear data that helps you manage cash flow and make smarter business decisions in {{city}}, {{state}}.</p>", "<p><strong>Stop losing customers because your processor won't approve your industry.</strong> {{service}} businesses in {{city}}, {{state}} often face rejection from mainstream payment processors. {{brand}}'s high-risk {{service}} accounts exist specifically for industries that others avoid. Your business model isn't a liability with us—it's exactly what we specialize in. Start converting customers to revenue instead of losing them at checkout.</p>\\n<p><strong>Lower your overall processing costs with volume-based pricing.</strong> High transaction volume doesn't have to mean high costs. {{brand}} offers {{service}} accounts with rates that improve as your business scales. Because we process thousands of high-risk accounts, we've optimized pricing to pass savings to you. More volume = lower per-transaction fees and better margins across the board.</p>\\n<p><strong>Avoid forced reserves and restrictive account terms.</strong> Some processors drain your cash flow with 30-50% rolling reserves. {{brand}}'s {{service}} accounts feature flexible reserve requirements that don't suffocate your operating capital. You'll have faster access to your funds and more control over your cash—essential for businesses operating in competitive {{state}} markets.</p>\\n<p><strong>Experience stability with a processor committed to your success.</strong> {{Brand}} doesn't treat {{service}} accounts as temporary or risky. We've built our entire business model around serving merchants that others won't. That means long-term partnership, consistent support, and a processor that's invested in your success and fully compliant with {{payment_regulations}}.</p>", "<p><strong>Reclaim control of your payment processing from restrictive legacy systems.</strong> Old processors with outdated underwriting criteria don't belong in today's business landscape. {{Brand}}'s {{service}} accounts use modern risk assessment that looks at your actual performance, not outdated industry stereotypes. If you've been unfairly rejected or limited elsewhere, we'll reset your payment processing on a platform that actually works for {{city}}, {{state}} businesses.</p>\\n<p><strong>Integrate seamlessly with your existing POS, e-commerce, and business tools.</strong> {{Service}} from {{brand}} connects easily to your current systems—no ripping and replacing your entire infrastructure. We support all major platforms and custom integrations, so your team stays productive and your operations run smoothly without disruption.</p>\\n<p><strong>Benefit from expertise in {{payment_regulations}} and high-risk compliance.</strong> Regulatory requirements change constantly, and mistakes are expensive. {{Brand}} stays on top of {{payment_regulations}} updates so you don't have to. Our compliance team proactively adjusts your account and alerts you to changes affecting your {{service}} business. You're protected by processors who understand the rules inside and out.</p>\\n<p><strong>Grow faster with payment solutions built specifically for your business type.</strong> One-size-fits-all processors fail high-risk merchants. {{Brand}}'s {{service}} account features—from transaction limits to chargeback procedures—are designed by people who've processed thousands of accounts like yours. You get a solution optimized for your business, not a generic account shoehorned into an unsuitable system.</p>"]	2026-03-31 18:58:45.914619
3f38851e-1f1c-4d44-8c0b-aa0cf4a521ee	70ec4b1c-80b2-4c17-9d22-f63275d21310	b7cfd050-7a02-4ef2-bcdb-1e044b063c3f	High-Risk Merchant Accounts	faq	["<p><strong>Q: What makes my business classified as high-risk for payment processing?</strong></p>\\n<p>High-risk classifications typically apply to industries with higher chargeback rates, regulatory scrutiny, or upfront payment models. This includes e-commerce, CBD/cannabis, adult services, travel, gaming, and subscription-based businesses. {{brand}} evaluates your specific business model and {{payment_regulations}} compliance history to determine classification. Being flagged as high-risk doesn't mean you can't process payments—it just means you'll work with specialized merchant account providers like us who understand your industry's unique challenges and requirements.</p>\\n\\n<p><strong>Q: Will {{brand}} approve my high-risk {{service}} {{city}}, {{state}} account quickly?</strong></p>\\n<p>Yes. We've streamlined our underwriting process specifically for high-risk businesses. Most applications are reviewed within 24-48 hours. We understand you need to start accepting payments fast. Our team works directly with you to gather required documentation and answer questions about {{payment_regulations}} compliance upfront, eliminating back-and-forth delays common with traditional processors.</p>\\n\\n<p><strong>Q: What documentation do I need to apply for a high-risk merchant account?</strong></p>\\n<p>We'll typically request business licensing, proof of address, bank statements (usually 3-6 months), processing statements from previous providers if applicable, and your business plan. For {{payment_regulations}} compliance, we may ask about fraud prevention procedures and chargeback management practices. {{brand}} keeps this process straightforward—we'll tell you exactly what we need upfront so there are no surprises.</p>\\n\\n<p><strong>Q: How much will my processing rates be as a high-risk merchant?</strong></p>\\n<p>Rates vary based on your industry, sales volume, average ticket size, and chargeback history. High-risk accounts typically see slightly higher rates than standard merchants, but {{brand}} works to keep them competitive. We're transparent about pricing—no hidden fees. Request a custom quote for {{service}} {{city}}, {{state}}, and we'll show you exactly what you'll pay.</p>\\n\\n<p><strong>Q: What happens if my chargebacks exceed certain thresholds?</strong></p>\\n<p>Most merchant accounts include chargeback limits (typically 0.5-1% of transaction volume). Exceeding thresholds may result in reserve requirements, increased fees, or account suspension. {{brand}} helps you stay compliant with {{payment_regulations}} and provides chargeback prevention tools and reporting. We monitor your account proactively and work with you to reduce disputes before they become problems.</p>", "<p><strong>Q: Can {{brand}} process payments for my CBD/cannabis business in {{city}}, {{state}}?</strong></p>\\n<p>Yes, we specialize in high-risk merchant accounts for industries others won't touch. While CBD and cannabis businesses face unique {{payment_regulations}} challenges, {{brand}} provides compliant {{service}} solutions. We verify your licensing, ensure state and federal compliance, and set up accounts that work with your operational model. Many traditional processors decline these industries entirely—we don't.</p>\\n\\n<p><strong>Q: Why was I declined by other payment processors for my high-risk {{service}}?</strong></p>\\n<p>Standard payment processors often use automated risk assessment tools that automatically decline entire industries. They lack expertise in navigating {{payment_regulations}} for specialized businesses. {{brand}} takes a different approach—we evaluate your specific business practices, compliance measures, and operating history. Many businesses we approve were rejected elsewhere simply because they didn't fit a template.</p>\\n\\n<p><strong>Q: Do high-risk merchant accounts require personal guarantees?</strong></p>\\n<p>Most high-risk accounts, including {{brand}}'s {{service}} offerings in {{city}}, {{state}}, require personal guarantees from business owners. This is standard industry practice under {{payment_regulations}} and protects the processor against losses. We're transparent about this requirement from the start. It's also common for reserves to be held (typically 5-10% of monthly processing volume) for high-risk classifications.</p>\\n\\n<p><strong>Q: What if my business model involves recurring billing or subscriptions?</strong></p>\\n<p>Subscription and recurring billing models are inherently higher-risk due to involuntary transaction patterns and higher chargeback potential. {{brand}} handles this regularly. We set up accounts with appropriate monitoring, implement clear billing descriptor practices to reduce disputes, and ensure {{payment_regulations}} compliance with consent and cancellation procedures. This is a core strength of our high-risk merchant expertise.</p>\\n\\n<p><strong>Q: How often will {{brand}} review my high-risk merchant account?</strong></p>\\n<p>We conduct quarterly reviews as standard practice for high-risk {{service}} accounts. These reviews examine transaction patterns, chargeback ratios, and {{payment_regulations}} compliance to ensure your account remains in good standing. Regular monitoring actually protects you by catching issues early. If we see red flags, we'll work with you to resolve them rather than surprise you with account closure.</p>", "<p><strong>Q: What's the difference between high-risk and standard merchant accounts?</strong></p>\\n<p>High-risk accounts involve industries or business models with elevated chargeback rates, regulatory complexity, or reputational concerns. {{brand}}'s high-risk {{service}} in {{city}}, {{state}} includes stricter underwriting, potentially higher rates, reserve requirements, and more frequent monitoring. Standard accounts skip much of this. The trade-off is worth it—we approve businesses others won't, and we handle {{payment_regulations}} compliance so you don't have to worry.</p>\\n\\n<p><strong>Q: Can I scale my payment processing as my business grows with {{brand}}?</strong></p>\\n<p>Absolutely. {{brand}} supports high-risk businesses at every growth stage. As your sales volume increases, we adjust your account accordingly—optimizing rates, raising processing limits, and adding features. Whether you're processing $10,000 or $1,000,000 monthly, we scale with you. Our infrastructure and {{payment_regulations}} expertise ensure you won't outgrow our services.</p>\\n\\n<p><strong>Q: What chargeback management tools does {{brand}} provide?</strong></p>\\n<p>We offer real-time transaction monitoring, detailed chargeback reports, and best-practice guidance specific to your industry. Our {{service}} includes fraud detection, velocity checking, and AVS/CVV verification. We also provide templates for clear billing descriptors, refund policies, and customer communication that reduce disputes. {{payment_regulations}} compliance is built into every tool.</p>\\n\\n<p><strong>Q: Will opening a high-risk account affect my personal credit?</strong></p>\\n<p>{{brand}} will conduct a personal credit check as part of underwriting—this appears as a hard inquiry and may slightly impact your score temporarily. However, we're not running traditional credit analysis like a bank would. We're evaluating your business history and responsibility as an owner. Most business owners see minimal impact, and the inquiry is worth it when you gain access to reliable payment processing.</p>\\n\\n<p><strong>Q: What if my industry becomes less risky over time—will my rates decrease?</strong></p>\\n<p>Yes. As your business matures, demonstrates low chargeback rates, and builds positive processing history, you may qualify for better rates. {{brand}} reviews account performance regularly. If your metrics improve and {{payment_regulations}} risk profile decreases, we'll work to improve your pricing. We want to grow with you and reward demonstrated responsibility.</p>", "<p><strong>Q: How does {{brand}} ensure {{payment_regulations}} compliance for high-risk {{service}} in {{city}}, {{state}}?</strong></p>\\n<p>Compliance is non-negotiable. {{brand}} stays current on federal regulations (ACH, Dodd-Frank, AML), state-specific requirements, and industry guidelines. Our underwriting process validates that your business operations meet regulatory standards. We monitor transactions for suspicious activity, maintain detailed records, and provide compliance documentation. You get expert-level regulatory support without the headache—that's the {{brand}} advantage.</p>\\n\\n<p><strong>Q: What happens if I experience unexpected chargebacks?</strong></p>\\n<p>Chargebacks happen, even with best practices. {{brand}} provides a structured dispute resolution process. We help you gather evidence, submit compelling representment documents, and track outcomes. Our chargeback experts understand {{payment_regulations}} and dispute procedures across major card networks. We'll fight chargebacks on your behalf and help you understand root causes to prevent future issues.</p>\\n\\n<p><strong>Q: Are there industries {{brand}} absolutely won't work with?</strong></p>\\n<p>We work with most high-risk industries, but we do decline some—anything illegal, unlicensed, or involving exploitation. {{brand}} maintains high ethical standards. We'll be upfront during application review if your business falls outside our parameters. For legitimate high-risk {{service}} businesses, though, we're here to help navigate {{payment_regulations}} and set up reliable payment processing.</p>\\n\\n<p><strong>Q: Can I switch to {{brand}} if I already have a high-risk merchant account elsewhere?</strong></p>\\n<p>Yes. Many businesses switch to {{brand}} seeking better rates, improved support, or easier compliance. We handle the transition smoothly. Notify your current processor, we'll submit the application with your existing history, and we'll coordinate the technical switchover. High-risk accounts require careful transition planning—that's exactly what {{brand}} specializes in.</p>\\n\\n<p><strong>Q: What support does {{brand}} provide after my account opens?</strong></p>\\n<p>Ongoing support is built in. You'll have access to a dedicated account manager familiar with high-risk {{service}} and {{payment_regulations}}. We provide monthly reporting, proactive monitoring, chargeback alerts, and regulatory updates. If issues arise—chargebacks spike, disputes emerge, or regulations change—we're available to help. You're not just a ticket number; you're a valued business partner.</p>", "<p><strong>Q: How quickly can I start accepting payments after approval with {{brand}}?</strong></p>\\n<p>Once approved, {{brand}} activates high-risk merchant accounts within 24-48 hours. For some businesses, we can go live same-day. Setup includes POS integration, payment gateway configuration, and {{payment_regulations}} documentation. We handle the technical heavy lifting so you can focus on your business. Compare this to standard processors—we're significantly faster for {{service}} in {{city}}, {{state}}.</p>\\n\\n<p><strong>Q: What payment methods can I accept with a high-risk merchant account?</strong></p>\\n<p>{{brand}}'s {{service}} supports credit cards (Visa, Mastercard, Amex, Discover), debit cards, ACH, and digital wallets. Availability depends on your specific industry classification. We'll detail what's available in your account agreement. Some high-risk categories have restrictions on certain payment types for {{payment_regulations}} reasons, but we'll maximize your options within compliance requirements.</p>\\n\\n<p><strong>Q: Are there monthly minimums or long-term contracts with {{brand}}?</strong></p>\\n<p>{{Brand}} offers flexible terms. Most high-risk merchant accounts have no monthly minimum processing requirements. Contract terms vary—we provide month-to-month options for qualified businesses. We're confident in our service and {{payment_regulations}} expertise, so we don't need long-term locks. You can stay with us because we're delivering value, not because you can't leave.</p>\\n\\n<p><strong>Q: What happens during a regulatory audit or investigation?</strong></p>\\n<p>{{Brand}} maintains meticulous records and audit trails required by {{payment_regulations}}. If you're audited by regulators or card networks, we provide documentation and support your compliance demonstration. Our underwriting and monitoring practices mean you'll have strong documentation. We also help you understand regulatory requests and respond appropriately.</p>\\n\\n<p><strong>Q: How does {{brand}} price its high-risk {{service}} compared to competitors?</strong></p>\\n<p>{{Brand}} pricing is competitive and transparent. You'll pay slightly more than standard merchants (typical high-risk premium is 0.5-1.5%), but less than many specialized processors. We don't have hidden fees or surprise charges. Request a quote for {{city}}, {{state}}, and we'll show exact costs. Most businesses find {{brand}}'s combination of reliable service, compliance support, and fair pricing unbeatable.</p>"]	2026-03-31 18:58:55.038426
beaaf850-c186-4270-8b9c-dc23df2d4691	70ec4b1c-80b2-4c17-9d22-f63275d21310	b7cfd050-7a02-4ef2-bcdb-1e044b063c3f	Credit Card Processing	intro	["<p>Every transaction matters. When customers reach for their credit cards at your {{city}}, {{state}} location, you need {{service}} that processes fast, settles accurately, and doesn't drain your margins with hidden fees. SpotOn Results delivers payment processing built for businesses like yours—companies that can't afford downtime or surprises.</p>\\n<p>We understand the {{business_culture}} of {{state_abbr}}. Local business owners need reliable partners who speak plainly, keep costs low, and put results first. That's why hundreds of {{city}} merchants trust us to handle their {{service}}. We're not here to complicate your operations—we're here to streamline them.</p>", "<p>Slow payment processing costs you twice: once in transaction fees, and again in the time your team spends troubleshooting systems. {{service}} in {{city}}, {{state}} should be invisible—working flawlessly while you focus on running your business. SpotOn Results makes that possible.</p>\\n<p>Our {{service}} solutions are purpose-built for {{business_culture}} merchants who demand speed, transparency, and support they can actually reach. Whether you're near {{landmark}} or anywhere across {{state_abbr}}, you get the same reliable processing, competitive rates, and dedicated service that's helped local businesses increase their bottom line.</p>", "<p>Your payment processor should work as hard as you do. In {{city}}, {{state}}, businesses face real challenges: margin pressure, customer expectations, and the constant need to streamline operations. {{service}} from SpotOn Results solves these problems with technology that's fast, secure, and built to scale with your growth.</p>\\n<p>We've partnered with {{business_culture}} business owners throughout {{state_abbr}} who were tired of overpaying for {{service}} and tired of dealing with unresponsive support. Our approach is different: transparent pricing, instant settlement options, and a team that treats your success like it's our own.</p>", "<p>Credit card processing isn't complex—it shouldn't be. Yet most {{city}}, {{state}} merchants overpay because they don't have clear visibility into what they're actually spending. SpotOn Results changes that. We provide straightforward {{service}} with no surprises, no jargon, and no games.</p>\\n<p>The {{business_culture}} of {{state_abbr}} values honest partnerships and measurable results. That's what you get with us. From {{landmark}} to every corner of {{city}}, local businesses rely on SpotOn Results to process payments faster, keep more of their revenue, and get support when they need it.</p>", "<p>Growth requires the right foundation. {{Service}} is one of the most critical systems in your {{city}}, {{state}} business, yet most companies settle for generic, overpriced solutions. SpotOn Results offers something better: payment processing engineered specifically for merchants who refuse to compromise on speed or savings.</p>\\n<p>{{Business_culture}} business owners deserve more than standard service. We deliver competitive rates, instant access to your funds, advanced fraud protection, and a genuine partnership approach. Operating near {{landmark}} or anywhere in {{state_abbr}}, your {{service}} works harder when it works smarter—and that's what SpotOn Results provides.</p>"]	2026-04-10 19:56:42.116322
fa45d199-a9f3-4703-be03-b8cd8c5c3cbb	70ec4b1c-80b2-4c17-9d22-f63275d21310	b7cfd050-7a02-4ef2-bcdb-1e044b063c3f	Credit Card Processing	how_it_works	["<p>Getting started with {{brand}} {{service}} is straightforward. We begin with a quick consultation to understand your business needs, transaction volume, and current payment challenges. Our team reviews your requirements and presents a customized processing solution designed to reduce costs and improve cash flow. This initial assessment typically takes just 15 minutes and requires basic information about your business.</p>\\n<p>Once you've selected your {{service}} plan, we handle the technical setup. Our implementation specialists configure your payment terminals, integrate our system with your existing point-of-sale software, and ensure all security protocols are in place. We test every connection to guarantee your transactions process smoothly from day one. Most businesses in {{city}}, {{state}} are fully operational within 24-48 hours.</p>\\n<p>After go-live, {{brand}} provides ongoing support and optimization. We monitor your account, flag opportunities to lower processing fees, and ensure you're maximizing every transaction. Our dedicated merchant services team is available to answer questions and make adjustments as your business grows. Thousands of businesses nationwide trust {{brand}} to handle their {{service}} reliably.</p>", "<p>{{brand}} simplifies {{service}} through a three-phase onboarding process. Phase one focuses on discovery: we learn about your sales channels, average transaction sizes, and industry-specific needs. Whether you operate a retail storefront, e-commerce platform, or service-based business, we tailor our approach. Our team uses this information to recommend the right processing solution with competitive rates and minimal fees.</p>\\n<p>Phase two is activation. We process your merchant account application, conduct necessary underwriting, and prepare your equipment. {{brand}} arranges equipment delivery or provides cloud-based processing options depending on your setup. Our technical team configures your systems, runs test transactions, and trains your staff on payment acceptance best practices. This phase typically completes within 2-3 business days in {{city}}, {{state}}.</p>\\n<p>Phase three is partnership. We don't disappear after launch—{{brand}} monitors your {{service}} performance, identifies savings opportunities, and scales your solution as transaction volume increases. Our merchant services experts review your statements, ensure you're receiving the best rates, and add features like advanced reporting or multi-location management. {{business_count}} businesses already benefit from our proactive support approach.</p>", "<p>The {{brand}} {{service}} journey starts when you contact us with your business details. We conduct a free rate analysis comparing your current processing costs against what {{brand}} can deliver. This transparent evaluation shows exactly how much you'll save on interchange fees, monthly charges, and per-transaction costs. No hidden fees—just real numbers that demonstrate your bottom-line impact.</p>\\n<p>Once you decide to move forward, our merchant services team immediately initiates your account setup. We submit your application, obtain approvals from our processing network, and schedule equipment delivery or digital platform access. During setup, our specialists work directly with your team to integrate {{service}} into your workflow. We ensure compatibility with your existing systems and provide comprehensive training so your staff confidently accepts all payment types.</p>\\n<p>Within days, you're processing transactions at lower costs with faster settlement. {{brand}} continues delivering value through quarterly business reviews, fee optimization, and new feature recommendations. Our goal is to become your trusted payment processing partner in {{city}}, {{state}}, eliminating payment friction so you can focus on growing revenue. We've helped {{business_count}} merchants nationwide achieve this.</p>", "<p>{{service}} with {{brand}} begins with a simple conversation. Call our team, share details about your business type and current payment processing situation, and we'll explain how our solution works. We discuss your sales volume, average transaction amounts, and any specific challenges you face—slow processing, unexpected fees, or integration difficulties. This consultation is free and takes about 20 minutes.</p>\\n<p>Next comes the technical implementation. {{brand}} provides your merchant account, configures your payment processing terminals or point-of-sale software, and establishes secure connections to our processing network. Our technical team handles all backend setup so you don't have to. We run multiple security checks, ensure PCI compliance, and verify every connection works perfectly. Your team receives hands-on training covering payment acceptance, refunds, and reporting features.</p>\\n<p>Launch day arrives, and you're accepting credit cards, debit cards, and digital payments immediately. {{brand}} provides 24/7 customer support and real-time monitoring of your transactions. As your business grows in {{city}}, {{state}}, we scale your solution—adding terminals, increasing processing limits, or integrating new payment methods. Our merchant services team proactively reaches out with insights on your {{service}} performance and opportunities to optimize further.</p>", "<p>{{brand}} streamlines {{service}} setup into five essential steps. First, we qualify your business by reviewing your industry, transaction patterns, and processing history. We ask about your current provider's limitations and identify specific pain points. This discovery phase ensures we recommend the perfect solution for your unique situation, whether you need mobile processing, e-commerce integration, or in-person payment terminals.</p>\\n<p>Steps two and three focus on paperwork and configuration. We complete your merchant account application with fast underwriting, then deploy your processing infrastructure. {{brand}} ships equipment, provisions your online dashboard, and integrates with your accounting or POS system. Our integration specialists ensure seamless connection—no compatibility issues or data gaps. We test everything and verify you're ready for production in {{city}}, {{state}}.</p>\\n<p>Steps four and five are activation and optimization. You begin processing payments immediately with competitive rates locked in. {{brand}} monitors your activity, reviews your statements for accuracy, and identifies cost-saving opportunities. We remain your dedicated partner, providing quarterly check-ins, adding new features as your business evolves, and ensuring {{service}} continuously supports your growth. Thousands of businesses nationwide rely on {{brand}} for this complete, hassle-free approach.</p>"]	2026-04-10 19:56:57.009723
5234700f-16f1-4e8c-8513-21768780c2da	70ec4b1c-80b2-4c17-9d22-f63275d21310	b7cfd050-7a02-4ef2-bcdb-1e044b063c3f	Credit Card Processing	benefits	["<p><strong>Lower processing costs mean more money stays in your pocket.</strong> {{brand}}'s {{service}} in {{city}}, {{state}} is built to reduce your transaction fees without sacrificing quality or security. We negotiate rates on your behalf so you're not overpaying for every card swipe. Competitive pricing is our standard, not a promotional offer—it's how we help businesses like yours improve margins from day one.</p>\\n<p><strong>Instant settlement gets you paid faster.</strong> With {{service}} through {{brand}}, funds hit your account in as little as one business day. Cash flow matters when you're running a business, and waiting five days for deposits slows growth. Faster payments mean faster reinvestment in inventory, staff, or expansion—giving you a real competitive edge in {{city}}, {{state}}.</p>\\n<p><strong>Compliance with {{payment_regulations}} is built in, not bolted on.</strong> {{brand}} stays current with every regulatory requirement so you don't have to worry about violations or hidden penalties. Our {{service}} infrastructure handles PCI-DSS standards and industry rules automatically. You focus on selling; we handle the legal heavy lifting to keep your business protected and audit-ready.</p>\\n<p><strong>Seamless integration with your existing systems saves setup time.</strong> Whether you use a POS system, e-commerce platform, or accounting software, {{brand}}'s {{service}} connects without disruption. No painful migrations or IT headaches. Your team gets up and running in hours, not weeks, so you start processing payments and seeing results immediately in {{city}}, {{state}}.</p>", "<p><strong>Accept every payment type your customers want to use.</strong> {{brand}}'s {{service}} processes credit cards, debit cards, digital wallets, and emerging payment methods all through one unified system. Your customers in {{city}}, {{state}} expect flexibility, and we deliver it. One platform, multiple payment options, zero friction—that's how you maximize conversion rates and reduce abandoned transactions.</p>\\n<p><strong>Real-time reporting gives you visibility into every transaction.</strong> {{service}} from {{brand}} includes detailed dashboards that show sales trends, customer patterns, and processing performance instantly. You're not guessing at numbers or waiting for monthly statements. Access your data anytime, anywhere in {{city}}, {{state}}—making smarter business decisions based on facts, not feelings.</p>\\n<p><strong>Industry-leading security protects your customers and your reputation.</strong> {{brand}} invests heavily in fraud detection, encryption, and tokenization to keep sensitive data safe. Compliance with {{payment_regulations}} is non-negotiable for us. Your customers trust you with their payment information, and our {{service}} ensures that trust is never broken, building long-term loyalty in {{city}}, {{state}}.</p>\\n<p><strong>Dedicated support means you're never stuck troubleshooting alone.</strong> {{brand}}'s team is available when you need help—not just during business hours. Questions about {{service}}? Issues with processing? Our specialists in {{city}}, {{state}} understand merchant services and your business challenges. Real support, real answers, real solutions.</p>", "<p><strong>Transparent pricing with no hidden fees or surprise charges.</strong> {{brand}} believes in straightforward costs. With {{service}}, you see exactly what you're paying and why. No setup surprises, no mysterious monthly charges, no pressure to upgrade features you don't need. Pricing clarity builds trust, and that's how we do business in {{city}}, {{state}}.</p>\\n<p><strong>Scalability that grows with your business, not against it.</strong> Whether you're processing $10,000 or $100,000 monthly, {{brand}}'s {{service}} handles volume increases without slowing down or raising rates unfairly. As you expand in {{city}}, {{state}}, our infrastructure scales with you. No outgrowing your processor—we're built to support businesses at every stage of growth.</p>\\n<p><strong>Fraud protection and chargeback management reduce financial risk.</strong> {{service}} from {{brand}} includes smart monitoring that flags suspicious activity before it costs you. We help manage chargebacks efficiently, so disputes don't drain time or money. {{payment_regulations}} compliance combined with proactive fraud tools keeps your bottom line safe.</p>\\n<p><strong>Mobile and in-person processing flexibility for every business type.</strong> Run a retail shop, restaurant, salon, or service business in {{city}}, {{state}}? {{brand}}'s {{service}} works on countertops, tablets, and phones. One solution for in-person, online, and phone transactions. Your customers pay however they want; you process it all seamlessly.</p>", "<p><strong>Faster approval process gets you accepting payments sooner.</strong> {{brand}}'s {{service}} application and underwriting in {{city}}, {{state}} is streamlined to get you live in days, not weeks. We understand you need to start processing quickly. Less waiting, more selling—that's our commitment to new merchants and growing businesses alike.</p>\\n<p><strong>Detailed transaction history and dispute tools save hours of work.</strong> Every {{service}} transaction through {{brand}} is logged and searchable. Need to find a specific payment? Resolve a customer dispute? Our system keeps perfect records and gives you the tools to investigate and respond fast. Record-keeping that actually works for busy owners.</p>\\n<p><strong>Multi-location support from one account simplifies management.</strong> Running multiple storefronts or branches in {{city}}, {{state}}? {{brand}}'s {{service}} lets you manage all locations from one dashboard. Consolidated reporting, unified billing, consistent processing standards across every location. Complexity disappears; control remains.</p>\\n<p><strong>Expertise in your industry means better solutions and smarter advice.</strong> {{brand}} doesn't treat all businesses the same. We understand the specific payment challenges facing retailers, restaurants, service providers, and online sellers. Our {{service}} experts in {{city}}, {{state}} recommend configurations and features tailored to your industry—not generic, one-size-fits-all setups.</p>", "<p><strong>Reduce your total cost of ownership with all-in-one processing.</strong> Stop paying separate vendors for payments, inventory, and accounting. {{brand}}'s {{service}} integrates with your business tools, eliminating redundant software fees. One platform, lower overall costs, better efficiency in {{city}}, {{state}}. Smart consolidation saves money and sanity.</p>\\n<p><strong>PCI compliance made simple so you stay audit-ready always.</strong> Meeting {{payment_regulations}} requirements sounds complex, but {{brand}} handles it. Our {{service}} infrastructure, security updates, and compliance monitoring keep you protected and ready for any audit. One less thing to worry about; one less liability hanging over your business.</p>\\n<p><strong>Chargeback prevention tools reduce disputes before they happen.</strong> {{service}} from {{brand}} includes analysis and alerts that help you identify and stop problematic transactions early. Fewer chargebacks mean lower fees, less stress, and better cash flow in {{city}}, {{state}}. Prevention is always cheaper than resolution.</p>\\n<p><strong>Flexible contract terms without long-term lock-in traps.</strong> {{Brand}}'s {{service}} is confident enough to offer fair terms without punishing early exits. Month-to-month options available for businesses that want flexibility. We earn your business daily, not lock you in with penalties. That's the {{brand}} difference in {{city}}, {{state}}.</p>"]	2026-04-10 19:57:15.917334
7243d161-100c-4cac-b7b4-743a47098724	70ec4b1c-80b2-4c17-9d22-f63275d21310	b7cfd050-7a02-4ef2-bcdb-1e044b063c3f	Credit Card Processing	faq	["<p><strong>Q: How quickly can I start accepting credit cards with {{brand}}?</strong></p>\\n<p>We understand that time is money. {{brand}} gets you processing in as little as 24 hours. Our streamlined onboarding process eliminates unnecessary delays so you can start accepting payments immediately. Whether you're in {{city}}, {{state}} or anywhere across the nation, our {{service}} platform is ready to go live fast. No lengthy paperwork. No waiting weeks. Just quick setup and immediate revenue acceptance.</p>\\n\\n<p><strong>Q: What are your {{service}} rates and fees?</strong></p>\\n<p>{{brand}} offers transparent, competitive pricing with no hidden fees. Our {{service}} rates are among the lowest in the industry, and we provide a clear breakdown of every charge upfront. We believe you deserve to know exactly what you're paying and why. Rates vary based on your business type and processing volume, but we work with merchants of all sizes to find a solution that fits your budget and maximizes your savings.</p>\\n\\n<p><strong>Q: Is {{service}} in {{city}}, {{state}} compliant with {{payment_regulations}}?</strong></p>\\n<p>Absolutely. {{brand}} maintains full compliance with {{payment_regulations}} and all applicable payment industry standards. Your customer data is protected by industry-leading security protocols, tokenization, and encryption. We take {{payment_regulations}} compliance seriously because your reputation and your customers' trust depend on it. You can confidently process payments knowing you're protected by the highest security standards available.</p>\\n\\n<p><strong>Q: Can I process credit cards offline with {{brand}}?</strong></p>\\n<p>Yes. {{brand}} {{service}} includes offline processing capabilities so you never lose a sale due to connectivity issues. Transactions are securely stored and automatically batch when your connection is restored. Whether your internet goes down for minutes or hours, your payment processing continues seamlessly. This reliability is especially valuable for businesses in {{city}}, {{state}} that operate in environments where connectivity can be unpredictable.</p>\\n\\n<p><strong>Q: What types of credit cards does {{brand}} {{service}} accept?</strong></p>\\n<p>{{Brand}} processes all major credit and debit cards including Visa, Mastercard, American Express, and Discover. We also support digital wallets and emerging payment methods so you're never left behind. Our comprehensive {{service}} solution ensures you can accept payment from virtually any customer, regardless of their preferred payment method. This flexibility drives higher conversion rates and customer satisfaction.</p>", "<p><strong>Q: How does {{brand}}'s {{service}} reduce my processing costs?</strong></p>\\n<p>{{Brand}} saves merchants money through competitive interchange rates, volume-based discounts, and transparent pricing. Unlike competitors who hide fees in fine print, we show you exactly where your money goes. Many {{city}}, {{state}} business owners save 15-30% annually by switching to {{brand}}. Our dedicated team also reviews your account quarterly to ensure you're on the best rate structure for your business mix and transaction volume.</p>\\n\\n<p><strong>Q: What support is available if something goes wrong with my {{service}}?</strong></p>\\n<p>{{Brand}} provides 24/7 customer support through phone, email, and chat. Our merchant success team isn't outsourced—they're knowledgeable specialists who understand the {{service}} landscape and can troubleshoot quickly. Whether you have a technical issue, question about a transaction, or need guidance on optimization, we're here. Fast response times and real solutions are part of our commitment to keeping your business running smoothly.</p>\\n\\n<p><strong>Q: Do I need special equipment to use {{brand}} {{service}}?</strong></p>\\n<p>{{Brand}} works with the equipment you already have or provides affordable, modern hardware options. Our {{service}} platform is compatible with most POS systems, and we offer integrated solutions that work seamlessly together. Whether you run a small shop in {{city}}, {{state}} or multiple locations, we have flexible hardware options—from countertop terminals to mobile readers—that fit your operation.</p>\\n\\n<p><strong>Q: How does {{brand}} handle {{payment_regulations}} for my business?</strong></p>\\n<p>{{Payment_regulations}} compliance is built into every {{service}} transaction we process. Our system handles encryption, tokenization, and data security automatically so you don't have to manage it manually. We stay updated on all regulatory changes so your business remains compliant as standards evolve. This gives you peace of mind and protects you from costly compliance violations or security breaches.</p>\\n\\n<p><strong>Q: Can {{brand}} integrate {{service}} with my current accounting software?</strong></p>\\n<p>Yes. {{Brand}} {{service}} integrates with QuickBooks, Xero, Wave, and dozens of other accounting platforms. Transactions sync automatically, eliminating manual entry and reducing errors. This integration saves you hours each week and gives you real-time visibility into your finances. For {{city}}, {{state}} merchants managing cash flow closely, this automation is invaluable.</p>", "<p><strong>Q: What makes {{brand}} {{service}} different from other processors?</strong></p>\\n<p>{{Brand}} combines competitive rates, fast setup, and genuine support. We're not just a faceless corporation processing transactions—we're partners invested in your success. Our {{service}} platform includes built-in analytics, reporting tools, and optimization features that help you understand your payment data and identify growth opportunities. Plus, we're transparent about pricing and committed to saving you money month after month.</p>\\n\\n<p><strong>Q: How secure is {{brand}} {{service}} against fraud?</strong></p>\\n<p>{{Brand}} employs advanced fraud detection, AVS verification, CVV checks, and real-time monitoring. Our system flags suspicious transactions automatically and protects both you and your customers. We maintain {{payment_regulations}} compliance and use industry-leading encryption for all data. In {{city}}, {{state}} and nationwide, merchants trust {{brand}} to keep fraudulent transactions to a minimum while maintaining smooth customer checkout experiences.</p>\\n\\n<p><strong>Q: Can I get detailed reports on my {{service}} transactions?</strong></p>\\n<p>Absolutely. {{Brand}} provides customizable dashboards and detailed reporting so you see exactly what's happening with your payments. Filter by date, transaction type, payment method, or customer. Export reports for accounting or business analysis. Real-time visibility helps you spot trends, optimize your operations, and make data-driven decisions. Our reporting tools are designed for busy merchants who need answers fast.</p>\\n\\n<p><strong>Q: Does {{brand}} {{service}} work with mobile payments and digital wallets?</strong></p>\\n<p>Yes. {{Brand}} {{service}} accepts Apple Pay, Google Pay, Samsung Pay, and other contactless payment methods. Digital wallets are increasingly popular with customers, especially in {{city}}, {{state}}, and accepting them boosts conversion rates and customer satisfaction. Our platform seamlessly handles all digital payment formats alongside traditional credit cards, so you're future-ready.</p>\\n\\n<p><strong>Q: What happens if I have questions about {{payment_regulations}} for my industry?</strong></p>\\n<p>Our team can help. {{Brand}} works with businesses across industries and understands the specific {{payment_regulations}} requirements for restaurants, retail, e-commerce, services, and more. While we're not legal advisors, we provide guidance based on our expertise and can point you toward resources specific to your business type. We're here to help you stay compliant and confident.</p>", "<p><strong>Q: How does {{brand}} handle chargebacks and disputes?</strong></p>\\n<p>{{Brand}} provides chargeback management tools and support throughout the dispute process. Our team helps you gather evidence, submit responses, and protect your revenue. We also offer guidance on reducing chargebacks through better practices. When disputes arise—whether in {{city}}, {{state}} or elsewhere—you'll have expert support navigating the {{payment_regulations}} and issuing bank requirements.</p>\\n\\n<p><strong>Q: Is there a contract requirement with {{brand}} {{service}}?</strong></p>\\n<p>{{Brand}} offers flexible terms. We're confident enough in our service that we don't lock you into lengthy contracts. You can cancel with proper notice if you're unsatisfied. Our goal is to earn your business every month through reliable service, competitive pricing, and genuine support. We believe merchants deserve flexibility and the option to leave if a competitor offers better value—though we work hard to ensure that never happens.</p>\\n\\n<p><strong>Q: How does {{service}} from {{brand}} handle high-volume days?</strong></p>\\n<p>{{Brand}} infrastructure scales automatically to handle peak traffic without slowdowns. Whether you're a {{city}}, {{state}} restaurant on a busy weekend, a retail location during holiday sales, or an e-commerce business during flash sales, our {{service}} platform processes transactions reliably. No speed degradation. No failed transactions. Just consistent, fast processing regardless of volume spikes.</p>\\n\\n<p><strong>Q: What about {{payment_regulations}} for online transactions with {{brand}}?</strong></p>\\n<p>{{Brand}} handles {{payment_regulations}} requirements for online {{service}} including SSL encryption, secure tokenization, and PCI-DSS compliance. Whether you sell through your website, email invoices, or a shopping cart, we ensure all transactions meet regulatory standards. This protects you from liability and gives customers confidence in the security of their payment information.</p>\\n\\n<p><strong>Q: Can {{brand}} help me reduce my payment processing fees?</strong></p>\\n<p>Yes. Our merchant success team reviews your account and identifies optimization opportunities. We analyze your transaction mix, volume, and rate structure to ensure you're getting the best possible pricing. Sometimes adjusting how you capture card data or batch transactions can lower fees. Other times we simply negotiate better rates based on your growth. Many {{city}}, {{state}} merchants discover they're overpaying and appreciate our proactive approach to cost reduction.</p>", "<p><strong>Q: Does {{brand}} {{service}} provide analytics to help me understand sales trends?</strong></p>\\n<p>{{Brand}} delivers comprehensive analytics and reporting that shows you transaction patterns, peak sales times, popular payment methods, and customer behavior. These insights help you optimize staffing, inventory, and marketing. Understand what drives revenue in your {{city}}, {{state}} location. Make smarter business decisions backed by data. Our analytics tools are built for merchants who want to grow, not just process payments.</p>\\n\\n<p><strong>Q: How does {{brand}} ensure {{payment_regulations}} doesn't slow down my checkout?</strong></p>\\n<p>{{Brand}} built security and compliance directly into the {{service}} experience. {{Payment_regulations}} protections happen in the background without slowing customer checkout."]	2026-04-10 19:57:39.718605
f2ab6ae9-1455-452e-bbf4-1934ccca3460	70ec4b1c-80b2-4c17-9d22-f63275d21310	b7cfd050-7a02-4ef2-bcdb-1e044b063c3f	Credit Card Processing	cta	["<p>Don't let payment processing slow you down. {{brand}} delivers fast, reliable {{service}} designed for busy business owners in {{city}}, {{state}} who need results now. Accept payments seamlessly, reduce fees, and focus on growth. Your competitors are already moving faster. <strong>Get a free quote today and see how much you can save.</strong></p>", "<p>Thousands of businesses in {{city}}, {{state}} trust {{brand}} for their {{service}} needs because we deliver what matters: speed, security, and savings. Stop overpaying for payment processing. Our solutions integrate instantly and work exactly how your business needs them to. <strong>Start your free consultation with our team right now.</strong></p>", "<p>Every transaction counts. {{brand}}'s {{service}} gives {{city}}, {{state}} businesses transparent pricing, zero hidden fees, and processing that actually works. Whether you're running one location or ten, we scale with you. Ready to cut costs and boost efficiency? <strong>Request your personalized savings analysis in under two minutes.</strong></p>", "<p>The right payment solution should be simple. {{brand}} makes {{service}} effortless for business owners throughout {{city}}, {{state}}—from setup to daily operations. Trusted by thousands, built for speed, designed for your success. <strong>Let's show you exactly how we can improve your bottom line. Contact us today.</strong></p>", "<p>Your business deserves payment processing that works as hard as you do. {{brand}}'s {{service}} in {{city}}, {{state}} means faster deposits, lower costs, and one less thing to worry about. See real results in real time. <strong>Schedule your free demo now and take control of your payments.</strong></p>"]	2026-04-10 19:57:44.31035
ecf3e26e-47e4-47c5-ac93-b7f243851a4f	70ec4b1c-80b2-4c17-9d22-f63275d21310	b7cfd050-7a02-4ef2-bcdb-1e044b063c3f	Credit Card Processing	local_context	["<p>With {{business_count}} businesses operating across {{city}}, {{state}}, the demand for reliable {{service}} has never been higher. {{business_culture}} entrepreneurs understand that payment processing speed directly impacts cash flow and customer satisfaction. SpotOn Results delivers the processing power your {{city}}, {{state_abbr}} business needs to stay competitive and keep money moving.</p>", "<p>{{city}}, {{state}} is experiencing rapid business growth, and {{business_culture}} companies are expanding their payment capabilities to match. Modern {{service}} isn't just about accepting cards—it's about gaining real-time insights into sales and reducing operational friction. Our solutions help {{business_count}} local businesses process transactions faster and more securely than ever before.</p>", "<p>The {{business_culture}} economy in {{city}}, {{state_abbr}} thrives on efficiency and trust. Whether you're managing {{business_count}} competitors or building your market share, {{service}} reliability directly affects your bottom line. SpotOn Results gives {{city}}-based businesses the transparent pricing and dependable processing that keeps customers returning.</p>", "<p>{{city}}, {{state}} merchants face intense competition, and {{business_culture}} business owners know that payment experience matters. With {{business_count}} active businesses in the area, standing out requires seamless transactions and fast settlement times. Our {{service}} platform empowers local businesses to process payments with speed and confidence.</p>", "<p>Payment processing is foundational to growth in {{city}}, {{state}}, where {{business_culture}} entrepreneurs are scaling operations daily. {{business_count}} businesses in {{state_abbr}} need a processing partner that understands local market demands and delivers results. SpotOn Results provides the reliable {{service}} infrastructure that helps you capture every sale and reduce costly downtime.</p>"]	2026-04-10 19:57:49.308045
fc7274ca-9820-4a77-8562-66dad307e991	70ec4b1c-80b2-4c17-9d22-f63275d21310	b7cfd050-7a02-4ef2-bcdb-1e044b063c3f	Credit Card Processing	use_case	["<p>Our restaurant in {{city}}, {{state}} was losing money every time a customer wanted to pay with a card. We were using an outdated payment system that charged us excessive fees and processed transactions slower than our competitors. The checkout experience was clunky, and we were hemorrhaging customers who expected fast, seamless payments. We knew we needed a better solution, but switching processors seemed complicated and risky during peak season.</p>\\n<p>{{brand}} changed everything for us. Their {{service}} solution reduced our processing fees by nearly 30% while cutting transaction times from minutes to seconds. Our staff spent less time troubleshooting payment issues and more time serving customers. The {{business_culture}} at {{brand}} meant they didn't just hand us a system—they trained our team and stayed available when we had questions. Within three months, our card transaction volume increased 40% because customers actually wanted to pay with us now.</p>", "<p>Running a boutique fitness studio in {{city}}, {{state}} meant juggling multiple payment methods and manual reconciliation every single day. We accepted cash, checks, and cards through a fragmented system that made it impossible to track real revenue or manage our finances strategically. Class bookings required phone calls and email confirmations because our payment infrastructure couldn't handle recurring memberships reliably. We were stuck in a cycle of administrative work instead of focusing on growing our business.</p>\\n<p>{{brand}}'s {{service}} gave us the integrated payment processing we desperately needed. We now accept all major cards with automatic membership billing that runs like clockwork. Their platform syncs perfectly with our scheduling software, eliminating double-entry and reducing errors to almost zero. The {{business_culture}} of {{brand}} prioritizes flexibility, so they customized our setup to match our unique membership model. Today, our billing runs automatically, and we have real-time visibility into our cash flow—letting us invest back into our studio with confidence.</p>", "<p>As an e-commerce business owner in {{city}}, {{state}}, we were growing too fast for our payment processor to keep up. During our peak sales periods, transactions would fail or take hours to settle, costing us thousands in lost revenue. Our fraud protection was either too strict (blocking legitimate customers) or too loose (exposing us to chargebacks). We were trapped between growth and risk, unsure if we could scale without a complete infrastructure overhaul.</p>\\n<p>{{brand}} delivered enterprise-grade {{service}} without enterprise-level complexity or pricing. Their system handles our peak traffic seamlessly, with settlement times that get money into our account within 24 hours. Advanced fraud detection protects us while keeping customer friction minimal—our cart abandonment rates dropped immediately. The {{business_culture}} at {{brand}} means they treat our growth as their priority too. We've scaled from 500 to 5,000 daily transactions, and {{brand}}'s {{service}} has grown with us every step of the way.</p>", "<p>Our medical practice in {{city}}, {{state}} struggled with HIPAA-compliant payment processing that actually worked. Most processors either didn't understand healthcare requirements or charged us premium rates for basic compliance features. Patient payments came through unreliable channels, and insurance claim reconciliation was a nightmare. We were spending more time managing payments than caring for patients, and that directly impacted our practice's reputation and revenue.</p>\\n<p>{{brand}} understands healthcare's unique demands and built {{service}} with those needs in mind. Their platform is fully HIPAA-compliant, secure, and integrates with our practice management software so payments reconcile automatically with insurance claims. We eliminated manual follow-up on unpaid invoices, and patients appreciate the simple payment options at checkout. The {{business_culture}} at {{brand}} values our mission—they don't just process payments, they understand that every dollar we save on payment friction goes directly back into patient care quality.</p>", "<p>Our nonprofit organization in {{city}}, {{state}} relied heavily on donations, but our {{service}} infrastructure was costing us 5-6% in processing fees—money that should have gone directly to our mission. We couldn't afford the high rates typical payment processors charged nonprofits, and managing multiple donation channels created accounting nightmares. Donors wanted modern, secure giving options, but every payment method we added increased our overhead and complexity without adding real value.</p>\\n<p>{{brand}} offers nonprofit pricing on their {{service}} solution, slashing our processing costs to under 2% and delivering the modern donation experience our supporters expect. One integrated platform handles online giving, in-person events, recurring memberships, and grant payments—all automatically reconciled to our accounting system. The {{business_culture}} at {{brand}} includes genuine commitment to supporting nonprofits; they've helped us recover thousands annually in fees we were unnecessarily bleeding. Today, when someone donates to our cause, we know nearly every dollar goes to impact, not payments.</p>"]	2026-04-10 19:58:03.366921
7a16c351-a8ad-494b-b87a-58ced76572b6	70ec4b1c-80b2-4c17-9d22-f63275d21310	b7cfd050-7a02-4ef2-bcdb-1e044b063c3f	Credit Card Processing	proof_trust	["<p>Thousands of businesses across {{state}} trust {{brand}} for {{service}} that actually works. Our clients report processing transactions 40% faster than their previous providers, with zero unexpected fees or hidden charges. When you're running a busy operation, speed matters—and {{service}} from {{brand}} in {{city}} delivers the reliability you need without the headaches.</p>\\n<p>Business owners choose {{brand}} because we've spent over 15 years perfecting {{service}} for merchants just like you. We don't just process payments; we optimize your entire transaction flow. Our {{city}}, {{state}} clients see measurable improvements in cash flow, reduced payment disputes, and better financial visibility—all backed by our commitment to transparent, straightforward service.</p>", "<p>{{brand}}'s {{service}} solution in {{city}}, {{state}} is PCI-DSS Level 1 certified, meaning your customer data and transactions receive the highest security standards in the industry. We undergo continuous third-party audits and maintain compliance with all major payment networks. For merchants handling sensitive payment information daily, this level of certification provides the peace of mind you deserve.</p>\\n<p>Security isn't just a feature—it's our foundation. Businesses in {{state}} depend on {{brand}} to protect their reputation and their customers' trust. Our {{service}} infrastructure is built on enterprise-grade encryption and fraud detection, with 99.99% uptime guarantees. When payment processing fails, your business stops. We make sure that doesn't happen.</p>", "<p>In {{city}}, {{state}}, {{brand}} has earned recognition as a top merchant services provider, consistently ranked for customer satisfaction and competitive pricing. Our {{service}} clients save an average of $2,400 annually compared to national chain processors through transparent pricing and zero contract lock-ins. That's real money back in your pocket—money you can reinvest in growth.</p>\\n<p>Don't take our word for it. {{state}} business owners have given {{brand}} an average rating of 4.8 out of 5 stars for our {{service}} solution. From retail shops to restaurants to e-commerce operations, merchants in {{city}} praise our fast onboarding, responsive support, and rates that stay competitive. We've built our reputation on delivering results, not promises.</p>", "<p>{{brand}}'s {{service}} comes with an ironclad guarantee: if you're not saving money and seeing faster processing within 90 days, we'll refund your setup fees. We're that confident in our solution. Thousands of {{state}} merchants have taken us up on this offer—and almost none have asked for their money back. In {{city}}, businesses know they're protected when they choose {{brand}}.</p>\\n<p>This guarantee reflects how we do business. We succeed when you succeed. Our {{service}} in {{city}}, {{state}} includes dedicated account management, 24/7 support, and proactive optimization to keep your rates competitive. You're not just getting a payment processor; you're getting a partner who's invested in your bottom line.</p>", "<p>{{brand}} powers {{service}} for over 50,000 merchants nationwide, processing billions in transactions annually with zero major security breaches. Our {{city}}, {{state}} clients benefit from the same infrastructure trusted by enterprise-level businesses, without enterprise-level complexity or pricing. You get institutional-grade reliability with small-business-friendly support.</p>\\n<p>From first-time merchants to multi-location operators, {{state}} businesses rely on {{brand}}'s proven {{service}} platform. Our average client retention rate exceeds 94%—the highest in the industry—because we deliver consistent value, transparent communication, and results that matter. When you partner with {{brand}} in {{city}}, you're joining thousands of merchants who've made the smart choice.</p>"]	2026-04-10 19:58:13.160175
749d8141-4714-46b9-9f8d-065d837fdf05	70ec4b1c-80b2-4c17-9d22-f63275d21310	b7cfd050-7a02-4ef2-bcdb-1e044b063c3f	Credit Card Processing	pain_point	["<p>Without reliable {{service}} in {{city}}, {{state}}, you're hemorrhaging money to outdated processing systems and hidden fees. Every transaction delays eat into your margins, and unclear pricing structures mean you never know what you're actually paying. {{brand}} understands that processing costs directly impact your bottom line—and most business owners are overpaying by thousands annually without realizing it. Slow settlement times mean cash flow problems, and manual payment handling creates administrative overhead that pulls your team away from growing the business.</p>\\n<p>The real cost goes beyond transaction fees. When your {{service}} infrastructure is clunky, you lose revenue to abandoned carts, payment failures, and frustrated customers who choose competitors. {{brand}} eliminates these hidden drains by delivering fast, transparent processing that keeps money moving and customers happy. Your business deserves a partner that prioritizes your profitability, not one that buries costs in fine print.</p>", "<p>{{payment_regulations}} compliance isn't optional—it's mandatory. Without proper {{service}} infrastructure in {{city}}, {{state}}, your business faces serious legal and financial exposure. Data breaches, non-compliant payment handling, and audit failures can result in devastating fines, liability lawsuits, and reputational damage. Many business owners don't realize they're operating in a regulatory gray area until it's too late. {{brand}} knows that cutting corners on payment processing security isn't savings—it's a liability waiting to happen.</p>\\n<p>The stakes are real: non-compliance can cost you tens of thousands in penalties, not to mention the operational chaos of dealing with investigations and remediation. Your customers trust you with their financial information, and that trust is your most valuable asset. {{brand}}'s {{service}} solutions are built with {{payment_regulations}} compliance built in, so you can process payments confidently knowing your business and customers are protected.</p>", "<p>Running {{service}} manually or with fragmented systems is costing you operational efficiency and sanity. In {{city}}, {{state}}, business owners waste countless hours reconciling payments, chasing down declined transactions, and managing multiple vendor relationships. Your team is drowning in administrative work instead of focusing on customer service and growth. {{brand}} recognizes that inefficient payment processing creates bottlenecks throughout your entire operation—from accounting to customer support—and those bottlenecks cascade into lost time and lost revenue.</p>\\n<p>When your {{service}} system doesn't talk to your other business tools, you're managing data in silos, creating errors and delays. Modern businesses need integration, automation, and visibility. {{brand}} streamlines your entire payment workflow, eliminating manual steps and giving you real-time insights into your transactions. The time and resources you free up can finally go toward what matters: building your business and serving your customers better.</p>", "<p>Your competitors in {{city}}, {{state}} are already offering faster checkout experiences, multiple payment options, and seamless transactions. If your {{service}} capabilities lag behind, you're losing customers to businesses that make paying easier and more secure. Today's buyers expect frictionless payment experiences—and they'll go elsewhere if you don't deliver. {{brand}} understands that payment processing is no longer a back-office function; it's a critical part of your customer experience and competitive advantage.</p>\\n<p>Every moment of friction in checkout is a lost sale. Customers who encounter slow processing, limited payment methods, or confusing payment flows simply abandon their carts and never come back. Your {{service}} infrastructure directly impacts your conversion rates and customer loyalty. {{brand}} helps you stay ahead by offering modern, fast, flexible payment solutions that make your business the easy choice for customers choosing between you and your competition.</p>", "<p>When {{service}} processing fails or slows down, your customers notice—and they remember. In {{city}}, {{state}}, every declined transaction, every delayed payment confirmation, and every clunky checkout experience damages your reputation and erodes customer trust. {{brand}} knows that customer satisfaction isn't just about your product or service; it's about making every interaction smooth and reliable. Poor payment processing puts you at odds with your own customers, creating frustration at the exact moment when you want to build loyalty.</p>\\n<p>Bad payment experiences lead to support tickets, chargebacks, refund requests, and negative reviews that take months to recover from. Your customers don't want to think about payment processing—they want it to work flawlessly, every time. {{brand}}'s {{service}} solutions are engineered for reliability and transparency, ensuring every transaction builds customer confidence instead of eroding it. When payments work perfectly, your customers focus on what they love about your business, not on payment problems.</p>\\n====END===="]	2026-04-10 19:58:25.281923
300c32b3-bda4-40eb-9215-a06e6635a6a9	70ec4b1c-80b2-4c17-9d22-f63275d21310	b7cfd050-7a02-4ef2-bcdb-1e044b063c3f	Credit Card Processing	local_stat	["<p>{{service}} adoption across {{city}}, {{state}} has grown significantly, with over 78% of {{business_count}} local businesses now accepting card payments as a primary transaction method. This shift reflects a nationwide trend where contactless and digital payments dominate consumer preferences. Businesses that modernize their payment infrastructure see faster checkout times, reduced cash handling costs, and improved customer satisfaction. SpotOn Results helps {{city}} merchants tap into this growth by offering seamless {{service}} solutions designed for today's payment landscape.</p>", "<p>In {{state_abbr}}, businesses using modern {{service}} solutions report an average 12-15% increase in sales within the first year of implementation. With {{business_count}} enterprises across {{city}} competing for customer loyalty, reliable payment processing has become a competitive necessity. Merchants who upgrade their systems experience fewer transaction failures, faster settlement times, and lower operational overhead. SpotOn Results delivers the speed and reliability {{city}}, {{state}} business owners need to convert more sales and keep customers coming back.</p>", "<p>{{business_count}} businesses in {{city}}, {{state}} currently process over $2.3 billion in card transactions annually—a market that continues to expand. The average {{service}} provider in {{state_abbr}} handles transaction volumes that grow 8-11% year-over-year, driven by e-commerce integration and omnichannel retail strategies. Merchants who partner with a trusted processor like SpotOn Results gain access to advanced fraud protection, real-time reporting, and flexible fee structures that directly impact their bottom line.</p>", "<p>Small to mid-sized businesses in {{city}}, {{state}} currently overpay an estimated $15-25 million annually in processing fees through outdated or inflexible merchant agreements. With {{business_count}} local enterprises seeking better rates, businesses that switch to transparent, competitive {{service}} pricing save an average of 18-22% on annual processing costs. SpotOn Results specializes in helping {{city}} merchants renegotiate their payment terms, eliminate hidden fees, and reinvest savings into growth and operations.</p>", "<p>Across {{state}}, merchant adoption of integrated {{service}} and business management tools has jumped to 64% among {{business_count}} mid-market companies in {{city}}. This integration trend—combining payments, inventory, and customer data—enables smarter decision-making and faster scaling. Businesses that unify their payment processing with operational insights report 30% faster financial reporting and improved cash flow visibility. SpotOn Results provides {{city}}, {{state}} merchants with unified payment solutions that connect payments to real business intelligence.</p>"]	2026-04-10 19:58:32.177597
\.


--
-- Data for Name: demotion_logs; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.demotion_logs (id, website_id, page_id, from_tier, to_tier, reason, created_at) FROM stdin;
\.


--
-- Data for Name: fallback_hit_logs; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.fallback_hit_logs (id, website_id, slug, hit_count, first_seen_at, last_seen_at, promoted, promoted_at) FROM stdin;
0070fb7e-ab02-4dbe-a192-3cb8a561a11a	b7cfd050-7a02-4ef2-bcdb-1e044b063c3f	merchant-services-in-dallas-texas	3	2026-04-10 20:33:53.362834	2026-04-10 20:34:57.273761	f	\N
9348f648-4579-49d2-a48e-728e8008d474	e0f209ba-8fac-4f08-8b34-2ce78c0cc810	local-seo-performance-dashboards-in-montana	1	2026-04-14 21:55:58.370459	2026-04-14 21:55:58.370459	f	\N
\.


--
-- Data for Name: generation_jobs; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.generation_jobs (id, account_id, website_id, blueprint_id, name, status, total_pages, processed_pages, passed_pages, failed_pages, error_log, settings, started_at, completed_at, created_at) FROM stdin;
ac499d30-462b-4420-b1a3-c3e8e67946e1	4d7ba690-ac0a-4654-9f41-1c773d6e8f92	e0f209ba-8fac-4f08-8b34-2ce78c0cc810	\N	Bulk Generate — 3 service(s)	completed	30	0	0	0	[]	{"mode": "specific_states", "states": ["AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA"], "progress": [{"errors": 0, "status": "no-bank", "created": 0, "service": "8fabb4a8-f6ac-4067-bdd3-4f0d2c581bb3", "skipped": 0, "updated": 0}, {"errors": 0, "status": "no-bank", "created": 0, "service": "6a00ee27-5ca7-4651-82d8-4cf95cdbf02d", "skipped": 0, "updated": 0}, {"errors": 0, "status": "no-bank", "created": 0, "service": "bb6bb79f-81e4-49c1-afc8-7314c1576efd", "skipped": 0, "updated": 0}], "services": ["8fabb4a8-f6ac-4067-bdd3-4f0d2c581bb3", "6a00ee27-5ca7-4651-82d8-4cf95cdbf02d", "bb6bb79f-81e4-49c1-afc8-7314c1576efd"], "overwrite": false, "clusterCount": 1}	2026-04-19 21:53:39.6	2026-04-19 21:53:39.649	2026-04-19 21:53:39.583783
97488ca9-93ac-4d6c-93fe-c9c51f065a3d	4d7ba690-ac0a-4654-9f41-1c773d6e8f92	e0f209ba-8fac-4f08-8b34-2ce78c0cc810	\N	Bulk Blueprint Generate (1 blueprints)	completed	1	1	1	0	[]	{"type": "blueprint_bulk", "combos": [{"service": "Test Service", "pageType": "service_city"}], "industry": "Merchant Services", "progress": [{"status": "done", "service": "Test Service", "pageType": "service_city"}], "businessName": "SpotOn Nexus"}	2026-04-11 05:36:29.419	2026-04-11 05:36:36.941	2026-04-11 05:36:29.412808
f9568073-f77f-4085-b66f-635d459acede	4d7ba690-ac0a-4654-9f41-1c773d6e8f92	e0f209ba-8fac-4f08-8b34-2ce78c0cc810	\N	Auto-Score: spotonnexus.com	completed	1	0	0	0	[]	{"type": "auto_scoring"}	2026-04-19 21:53:39.718	2026-04-19 21:53:39.732	2026-04-19 21:53:39.714086
\.


--
-- Data for Name: hub_pages; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.hub_pages (id, website_id, account_id, hub_type, name, slug, tier, quality_score, status, created_at, updated_at, content, parent_slug, max_child_links, meta_description) FROM stdin;
\.


--
-- Data for Name: industries; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.industries (id, account_id, name, slug, description, naics_code, created_at) FROM stdin;
162e8a3d-e35a-48e7-8e6f-8e0e1e001943	70ec4b1c-80b2-4c17-9d22-f63275d21310	Merchant Services	merchant-services	Payment processing, POS systems, and merchant account services for businesses	522320	2026-03-29 06:37:24.776392
a994b16e-9210-4daa-a974-c3c08e20fac1	4d7ba690-ac0a-4654-9f41-1c773d6e8f92	Merchant Services	merchant-services	Payment processing, POS systems, and merchant account services	522320	2026-04-11 02:33:08.387877
\.


--
-- Data for Name: internal_links; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.internal_links (id, website_id, from_page_id, to_page_id, anchor_text, link_type, created_at) FROM stdin;
\.


--
-- Data for Name: launch_health_scores; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.launch_health_scores (id, website_id, score, max_score, breakdown, calculated_at) FROM stdin;
\.


--
-- Data for Name: leads; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.leads (id, website_id, page_id, page_slug, name, business_name, email, phone, message, created_at) FROM stdin;
\.


--
-- Data for Name: locations; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.locations (id, account_id, type, name, slug, state_code, state_name, population, lat, lng, parent_id, metadata, created_at, city_tier) FROM stdin;
5e35b164-da97-4032-bb55-825a3b7aa413	70ec4b1c-80b2-4c17-9d22-f63275d21310	state	Alabama	alabama	AL	Alabama	\N	\N	\N	\N	{}	2026-03-29 06:37:24.801065	\N
d76a20d1-248f-4cdd-ad35-3aac8745df0e	70ec4b1c-80b2-4c17-9d22-f63275d21310	state	Alaska	alaska	AK	Alaska	\N	\N	\N	\N	{}	2026-03-29 06:37:24.805283	\N
422ad80e-87d6-43a8-a2a9-29eee81c9853	70ec4b1c-80b2-4c17-9d22-f63275d21310	state	Arizona	arizona	AZ	Arizona	\N	\N	\N	\N	{}	2026-03-29 06:37:24.807697	\N
5a805ec5-40c4-4409-8d0c-555a25fd2575	70ec4b1c-80b2-4c17-9d22-f63275d21310	state	Arkansas	arkansas	AR	Arkansas	\N	\N	\N	\N	{}	2026-03-29 06:37:24.810724	\N
0f15fe90-4236-45aa-8e36-558ebf25c45f	70ec4b1c-80b2-4c17-9d22-f63275d21310	state	California	california	CA	California	\N	\N	\N	\N	{}	2026-03-29 06:37:24.813589	\N
7ed3823e-d329-47b5-8315-21a4840b1e34	70ec4b1c-80b2-4c17-9d22-f63275d21310	state	Colorado	colorado	CO	Colorado	\N	\N	\N	\N	{}	2026-03-29 06:37:24.816188	\N
20a6bfad-4562-41b0-913d-991739fd0d33	70ec4b1c-80b2-4c17-9d22-f63275d21310	state	Connecticut	connecticut	CT	Connecticut	\N	\N	\N	\N	{}	2026-03-29 06:37:24.818584	\N
06584b2c-fd10-45af-afea-93ef35cdd2c9	70ec4b1c-80b2-4c17-9d22-f63275d21310	state	Delaware	delaware	DE	Delaware	\N	\N	\N	\N	{}	2026-03-29 06:37:24.821721	\N
99feb986-091d-49d1-b7f3-da1d0c36882a	70ec4b1c-80b2-4c17-9d22-f63275d21310	state	Florida	florida	FL	Florida	\N	\N	\N	\N	{}	2026-03-29 06:37:24.824369	\N
0cdb8cd3-570c-44ad-8279-438752f5bdc9	70ec4b1c-80b2-4c17-9d22-f63275d21310	state	Georgia	georgia	GA	Georgia	\N	\N	\N	\N	{}	2026-03-29 06:37:24.827223	\N
35fbe8d7-4804-46b3-a1de-bfde67852ad8	70ec4b1c-80b2-4c17-9d22-f63275d21310	state	Hawaii	hawaii	HI	Hawaii	\N	\N	\N	\N	{}	2026-03-29 06:37:24.830252	\N
fed33981-ab85-49f7-9777-56b036a96674	70ec4b1c-80b2-4c17-9d22-f63275d21310	state	Idaho	idaho	ID	Idaho	\N	\N	\N	\N	{}	2026-03-29 06:37:24.832628	\N
e993f188-7e8a-476c-8595-4d6b7a583722	70ec4b1c-80b2-4c17-9d22-f63275d21310	state	Illinois	illinois	IL	Illinois	\N	\N	\N	\N	{}	2026-03-29 06:37:24.835512	\N
503a72b4-5561-449b-baf9-55ef53985d6a	70ec4b1c-80b2-4c17-9d22-f63275d21310	state	Indiana	indiana	IN	Indiana	\N	\N	\N	\N	{}	2026-03-29 06:37:24.839422	\N
01c4dd7d-aa0e-4170-bef7-bf2577d823f9	70ec4b1c-80b2-4c17-9d22-f63275d21310	state	Iowa	iowa	IA	Iowa	\N	\N	\N	\N	{}	2026-03-29 06:37:24.842396	\N
e1650ebb-e4d3-4c1a-b528-f4a5a6bf7d5a	70ec4b1c-80b2-4c17-9d22-f63275d21310	state	Kansas	kansas	KS	Kansas	\N	\N	\N	\N	{}	2026-03-29 06:37:24.844541	\N
be2e88d9-6fdf-4868-a52d-23e2d668a72f	70ec4b1c-80b2-4c17-9d22-f63275d21310	state	Kentucky	kentucky	KY	Kentucky	\N	\N	\N	\N	{}	2026-03-29 06:37:24.847006	\N
06826935-7557-4c2f-9ffa-01d8330044dd	70ec4b1c-80b2-4c17-9d22-f63275d21310	state	Louisiana	louisiana	LA	Louisiana	\N	\N	\N	\N	{}	2026-03-29 06:37:24.849877	\N
9d1b5551-a4d2-4233-85cc-76fbab8029cb	70ec4b1c-80b2-4c17-9d22-f63275d21310	state	Maine	maine	ME	Maine	\N	\N	\N	\N	{}	2026-03-29 06:37:24.853484	\N
54ad9f89-761f-42bb-aa11-b0a87c78675c	70ec4b1c-80b2-4c17-9d22-f63275d21310	state	Maryland	maryland	MD	Maryland	\N	\N	\N	\N	{}	2026-03-29 06:37:24.856112	\N
e06f8929-3124-41f7-97f0-54e79291440a	70ec4b1c-80b2-4c17-9d22-f63275d21310	state	Massachusetts	massachusetts	MA	Massachusetts	\N	\N	\N	\N	{}	2026-03-29 06:37:24.859014	\N
c00ed638-1184-4165-87a7-89c5492e55a3	70ec4b1c-80b2-4c17-9d22-f63275d21310	state	Michigan	michigan	MI	Michigan	\N	\N	\N	\N	{}	2026-03-29 06:37:24.861434	\N
7a4f4faf-018b-4d37-8ceb-95336b62c203	70ec4b1c-80b2-4c17-9d22-f63275d21310	state	Minnesota	minnesota	MN	Minnesota	\N	\N	\N	\N	{}	2026-03-29 06:37:24.863761	\N
6fff8c23-7094-4ca7-b5c2-a2ec0371cc7d	70ec4b1c-80b2-4c17-9d22-f63275d21310	state	Mississippi	mississippi	MS	Mississippi	\N	\N	\N	\N	{}	2026-03-29 06:37:24.865786	\N
d2126af5-cf7e-4af9-bb1f-41d4e989468f	70ec4b1c-80b2-4c17-9d22-f63275d21310	state	Missouri	missouri	MO	Missouri	\N	\N	\N	\N	{}	2026-03-29 06:37:24.868509	\N
641b86a7-1e62-41c0-b489-151a59d612a5	70ec4b1c-80b2-4c17-9d22-f63275d21310	state	Montana	montana	MT	Montana	\N	\N	\N	\N	{}	2026-03-29 06:37:24.871277	\N
3cb39083-94f8-4ef2-a5e8-4d3419836ca4	70ec4b1c-80b2-4c17-9d22-f63275d21310	state	Nebraska	nebraska	NE	Nebraska	\N	\N	\N	\N	{}	2026-03-29 06:37:24.873505	\N
ca51af47-d5a3-420d-baf2-57cb8ab83a60	70ec4b1c-80b2-4c17-9d22-f63275d21310	state	Nevada	nevada	NV	Nevada	\N	\N	\N	\N	{}	2026-03-29 06:37:24.875701	\N
76a19761-8fa4-4187-aff7-a015609f2b7a	70ec4b1c-80b2-4c17-9d22-f63275d21310	state	New Hampshire	new-hampshire	NH	New Hampshire	\N	\N	\N	\N	{}	2026-03-29 06:37:24.878508	\N
4853837b-8caf-414c-b7f2-55a46fb0fdbf	70ec4b1c-80b2-4c17-9d22-f63275d21310	state	New Jersey	new-jersey	NJ	New Jersey	\N	\N	\N	\N	{}	2026-03-29 06:37:24.881414	\N
7a3a32f8-5823-4630-8c9d-252ec39a4c9e	70ec4b1c-80b2-4c17-9d22-f63275d21310	state	New Mexico	new-mexico	NM	New Mexico	\N	\N	\N	\N	{}	2026-03-29 06:37:24.885382	\N
4b97854d-1a22-4a6e-a5ec-12b3945930ab	70ec4b1c-80b2-4c17-9d22-f63275d21310	state	New York	new-york	NY	New York	\N	\N	\N	\N	{}	2026-03-29 06:37:24.88835	\N
ca9d4541-7e66-493a-9478-1ce7c7a83365	70ec4b1c-80b2-4c17-9d22-f63275d21310	state	North Carolina	north-carolina	NC	North Carolina	\N	\N	\N	\N	{}	2026-03-29 06:37:24.89126	\N
42ef435c-7253-4c50-8835-e75589aff037	70ec4b1c-80b2-4c17-9d22-f63275d21310	state	North Dakota	north-dakota	ND	North Dakota	\N	\N	\N	\N	{}	2026-03-29 06:37:24.893659	\N
61295e13-49f4-46d8-b79a-cf99db6dfdff	70ec4b1c-80b2-4c17-9d22-f63275d21310	state	Ohio	ohio	OH	Ohio	\N	\N	\N	\N	{}	2026-03-29 06:37:24.895731	\N
8aa3b75f-9c6f-4942-9ef2-81611d222823	70ec4b1c-80b2-4c17-9d22-f63275d21310	state	Oklahoma	oklahoma	OK	Oklahoma	\N	\N	\N	\N	{}	2026-03-29 06:37:24.898024	\N
b879b7e4-9d0b-471b-a8aa-3037d014e8f2	70ec4b1c-80b2-4c17-9d22-f63275d21310	state	Oregon	oregon	OR	Oregon	\N	\N	\N	\N	{}	2026-03-29 06:37:24.901098	\N
edda4e7d-8822-45f2-91bd-34e9274b4032	70ec4b1c-80b2-4c17-9d22-f63275d21310	state	Pennsylvania	pennsylvania	PA	Pennsylvania	\N	\N	\N	\N	{}	2026-03-29 06:37:24.903885	\N
153bc145-574f-4b7e-ad44-4300efd607c3	70ec4b1c-80b2-4c17-9d22-f63275d21310	state	Rhode Island	rhode-island	RI	Rhode Island	\N	\N	\N	\N	{}	2026-03-29 06:37:24.905897	\N
1bac0cdc-f11c-4365-bbf4-56d5a353daa4	70ec4b1c-80b2-4c17-9d22-f63275d21310	state	South Carolina	south-carolina	SC	South Carolina	\N	\N	\N	\N	{}	2026-03-29 06:37:24.908863	\N
21cb3422-7dd2-4976-9bf9-ef6927c8f6c6	70ec4b1c-80b2-4c17-9d22-f63275d21310	state	South Dakota	south-dakota	SD	South Dakota	\N	\N	\N	\N	{}	2026-03-29 06:37:24.91109	\N
eae80afa-799d-4a38-97d5-11d6e67d2e9a	70ec4b1c-80b2-4c17-9d22-f63275d21310	state	Tennessee	tennessee	TN	Tennessee	\N	\N	\N	\N	{}	2026-03-29 06:37:24.913331	\N
91eaf671-e022-45d7-ab2a-fe14e225d124	70ec4b1c-80b2-4c17-9d22-f63275d21310	state	Texas	texas	TX	Texas	\N	\N	\N	\N	{}	2026-03-29 06:37:24.916373	\N
aec17f59-2570-442e-ad29-3e831656150b	70ec4b1c-80b2-4c17-9d22-f63275d21310	state	Utah	utah	UT	Utah	\N	\N	\N	\N	{}	2026-03-29 06:37:24.9196	\N
e83a6036-f535-4e6c-be52-84a117e17ce6	70ec4b1c-80b2-4c17-9d22-f63275d21310	state	Vermont	vermont	VT	Vermont	\N	\N	\N	\N	{}	2026-03-29 06:37:24.921708	\N
da3d8b02-9b92-478f-89b8-f0c623acc727	70ec4b1c-80b2-4c17-9d22-f63275d21310	state	Virginia	virginia	VA	Virginia	\N	\N	\N	\N	{}	2026-03-29 06:37:24.923713	\N
d7ee5582-878e-4b84-a701-403d45f5f0ec	70ec4b1c-80b2-4c17-9d22-f63275d21310	state	Washington	washington	WA	Washington	\N	\N	\N	\N	{}	2026-03-29 06:37:24.925696	\N
66bdc2e0-74cc-4578-a5f3-c0f715024afa	70ec4b1c-80b2-4c17-9d22-f63275d21310	state	West Virginia	west-virginia	WV	West Virginia	\N	\N	\N	\N	{}	2026-03-29 06:37:24.92835	\N
425937d5-02b5-4b70-b64e-fba004684cd2	70ec4b1c-80b2-4c17-9d22-f63275d21310	state	Wisconsin	wisconsin	WI	Wisconsin	\N	\N	\N	\N	{}	2026-03-29 06:37:24.930556	\N
474e3f44-4a7a-4674-b937-5beba846c45e	70ec4b1c-80b2-4c17-9d22-f63275d21310	state	Wyoming	wyoming	WY	Wyoming	\N	\N	\N	\N	{}	2026-03-29 06:37:24.932895	\N
d04e21ed-bb24-4d7e-a85f-b2ba3ad96616	70ec4b1c-80b2-4c17-9d22-f63275d21310	city	New York City	new-york-city	NY	New York	8258035	\N	\N	\N	{}	2026-03-29 06:37:24.935185	1
82467e58-f937-45e0-98fa-3a8ebe1ac812	70ec4b1c-80b2-4c17-9d22-f63275d21310	city	Los Angeles	los-angeles	CA	California	3820914	\N	\N	\N	{}	2026-03-29 06:37:24.938006	1
4322e4e6-db57-45b4-852d-d27342d9c05c	70ec4b1c-80b2-4c17-9d22-f63275d21310	city	Chicago	chicago	IL	Illinois	2664452	\N	\N	\N	{}	2026-03-29 06:37:24.940564	1
63a97a6c-2731-4243-936f-6be80ef8f3a4	70ec4b1c-80b2-4c17-9d22-f63275d21310	city	Houston	houston	TX	Texas	2384075	\N	\N	\N	{}	2026-03-29 06:37:24.942905	1
3931459d-a5a7-4435-906e-808e11cf4d77	70ec4b1c-80b2-4c17-9d22-f63275d21310	city	Phoenix	phoenix	AZ	Arizona	1716498	\N	\N	\N	{}	2026-03-29 06:37:24.945411	1
8aedbf48-99b2-442e-8ff6-018ec9ae3c69	70ec4b1c-80b2-4c17-9d22-f63275d21310	city	Philadelphia	philadelphia	PA	Pennsylvania	1550542	\N	\N	\N	{}	2026-03-29 06:37:24.947883	1
5ff573b5-3fa7-453d-9db0-204802bcc714	70ec4b1c-80b2-4c17-9d22-f63275d21310	city	San Antonio	san-antonio	TX	Texas	1524436	\N	\N	\N	{}	2026-03-29 06:37:24.950109	1
e5260b5f-dcc7-4af8-8195-b82dbece4024	70ec4b1c-80b2-4c17-9d22-f63275d21310	city	San Diego	san-diego	CA	California	1415325	\N	\N	\N	{}	2026-03-29 06:37:24.952393	1
025465b9-7089-4bb1-ab61-e0c5cf34a877	70ec4b1c-80b2-4c17-9d22-f63275d21310	city	Dallas	dallas	TX	Texas	1330612	\N	\N	\N	{}	2026-03-29 06:37:24.954565	1
ac296234-827b-456b-b601-f1615a5b76a3	70ec4b1c-80b2-4c17-9d22-f63275d21310	city	San Jose	san-jose	CA	California	1042094	\N	\N	\N	{}	2026-03-29 06:37:24.957051	1
1d8cddb6-f9ed-4d91-af2e-3cf48282104e	70ec4b1c-80b2-4c17-9d22-f63275d21310	city	Jacksonville	jacksonville	FL	Florida	1026514	\N	\N	\N	{}	2026-03-29 06:37:24.961677	1
0bb52e0f-f529-4a43-817f-b3e79d3a6e38	70ec4b1c-80b2-4c17-9d22-f63275d21310	city	Austin	austin-tx	TX	Texas	1003197	\N	\N	\N	{}	2026-03-30 00:41:25.009564	1
8ea5f91e-c650-4379-ab30-8ef1eee7c85b	70ec4b1c-80b2-4c17-9d22-f63275d21310	city	Fort Worth	fort-worth	TX	Texas	1003065	\N	\N	\N	{}	2026-03-29 06:37:24.963902	1
ea046633-788d-486c-9a6c-76af2ba92c1d	70ec4b1c-80b2-4c17-9d22-f63275d21310	city	Charlotte	charlotte	NC	North Carolina	929219	\N	\N	\N	{}	2026-03-29 06:37:24.970189	1
d77bb3db-1ece-4c99-b907-fc892b2bd0ed	70ec4b1c-80b2-4c17-9d22-f63275d21310	city	Columbus	columbus	OH	Ohio	924482	\N	\N	\N	{}	2026-03-29 06:37:24.967177	1
3a51745e-48f0-464e-a211-265307ad2b61	70ec4b1c-80b2-4c17-9d22-f63275d21310	city	Indianapolis	indianapolis	IN	Indiana	905895	\N	\N	\N	{}	2026-03-29 06:37:24.972443	1
2658ef36-ad86-4b10-873c-5221ee939ad4	70ec4b1c-80b2-4c17-9d22-f63275d21310	city	San Francisco	san-francisco	CA	California	827526	\N	\N	\N	{}	2026-03-29 06:37:24.974995	1
e2986309-5198-46a8-891a-d7996932c0e7	70ec4b1c-80b2-4c17-9d22-f63275d21310	city	Seattle	seattle	WA	Washington	762503	\N	\N	\N	{}	2026-03-29 06:37:24.978314	1
7364bb61-8eea-41a7-b6cf-84efe1b7abb1	70ec4b1c-80b2-4c17-9d22-f63275d21310	city	Denver	denver	CO	Colorado	748461	\N	\N	\N	{}	2026-03-29 06:37:24.980961	1
b65ff7b0-172b-41e8-9dcf-de7ee12bc1f9	70ec4b1c-80b2-4c17-9d22-f63275d21310	city	Nashville	nashville	TN	Tennessee	730224	\N	\N	\N	{}	2026-03-29 06:37:24.983278	1
e0eb02f1-ddbc-47d1-8d5d-1d9905fd618b	70ec4b1c-80b2-4c17-9d22-f63275d21310	city	El Paso	el-paso	TX	Texas	706424	\N	\N	\N	{}	2026-03-29 06:37:24.987572	1
a1380269-9976-4ee4-b3ac-f46f910c4cb9	70ec4b1c-80b2-4c17-9d22-f63275d21310	city	Oklahoma City	oklahoma-city	OK	Oklahoma	699818	\N	\N	\N	{}	2026-03-29 06:37:24.985256	1
55830da3-deaf-4f4c-a4b6-ebc735f31136	70ec4b1c-80b2-4c17-9d22-f63275d21310	city	Washington DC	washington-dc	DC	Washington DC	692683	\N	\N	\N	{}	2026-03-29 06:37:24.989777	1
139d671f-a464-4aad-ac4a-2a2e1c49f535	70ec4b1c-80b2-4c17-9d22-f63275d21310	city	Las Vegas	las-vegas	NV	Nevada	675847	\N	\N	\N	{}	2026-03-29 06:37:24.991802	1
4f996113-65c4-4655-94b5-e828312fb696	70ec4b1c-80b2-4c17-9d22-f63275d21310	city	Louisville	louisville	KY	Kentucky	641022	\N	\N	\N	{}	2026-03-29 06:37:24.993812	1
9446ee6e-dbf9-41ef-a229-8671699ed8bc	70ec4b1c-80b2-4c17-9d22-f63275d21310	city	Portland	portland	OR	Oregon	631444	\N	\N	\N	{}	2026-03-29 06:37:24.998408	1
bf249169-5789-4001-b6c5-1c3507907977	70ec4b1c-80b2-4c17-9d22-f63275d21310	city	Memphis	memphis	TN	Tennessee	618636	\N	\N	\N	{}	2026-03-29 06:37:24.996348	1
0c10badd-5ad2-45da-b32e-408dc2de36c9	70ec4b1c-80b2-4c17-9d22-f63275d21310	city	Atlanta	atlanta	GA	Georgia	524067	\N	\N	\N	{}	2026-03-29 06:37:25.000451	1
ba889aba-62cb-4993-8b01-42d3b2b7649c	70ec4b1c-80b2-4c17-9d22-f63275d21310	city	Miami	miami	FL	Florida	456413	\N	\N	\N	{}	2026-03-29 06:37:25.002822	2
2fb014db-6c42-4e2d-9d5b-c94d0f62fa3c	70ec4b1c-80b2-4c17-9d22-f63275d21310	city	Minneapolis	minneapolis	MN	Minnesota	424651	\N	\N	\N	{}	2026-03-29 06:37:25.005416	2
6511fae4-25c2-4f3c-bc01-30304aabbb33	4d7ba690-ac0a-4654-9f41-1c773d6e8f92	state	Alabama	alabama	AL	Alabama	\N	\N	\N	\N	{}	2026-04-11 02:33:08.424067	\N
b8a2d8b7-bda5-40e6-9866-dc83bc728052	4d7ba690-ac0a-4654-9f41-1c773d6e8f92	state	Alaska	alaska	AK	Alaska	\N	\N	\N	\N	{}	2026-04-11 02:33:08.428018	\N
131c774f-0899-4bab-896d-b5c8b675ff1e	4d7ba690-ac0a-4654-9f41-1c773d6e8f92	state	Arizona	arizona	AZ	Arizona	\N	\N	\N	\N	{}	2026-04-11 02:33:08.431375	\N
5a80dc5b-33cb-463a-a7d1-fb671307c89e	4d7ba690-ac0a-4654-9f41-1c773d6e8f92	state	Arkansas	arkansas	AR	Arkansas	\N	\N	\N	\N	{}	2026-04-11 02:33:08.435031	\N
fe9cba6a-3737-4248-81a2-a3223abb3d52	4d7ba690-ac0a-4654-9f41-1c773d6e8f92	state	California	california	CA	California	\N	\N	\N	\N	{}	2026-04-11 02:33:08.438754	\N
f00b7b08-b425-4056-a4e1-b0520cfcd364	4d7ba690-ac0a-4654-9f41-1c773d6e8f92	state	Colorado	colorado	CO	Colorado	\N	\N	\N	\N	{}	2026-04-11 02:33:08.442069	\N
1161f5d7-bbae-4a05-9ea3-ffe55448069b	4d7ba690-ac0a-4654-9f41-1c773d6e8f92	state	Connecticut	connecticut	CT	Connecticut	\N	\N	\N	\N	{}	2026-04-11 02:33:08.444698	\N
3b646c16-d5f1-4c78-acb3-897cc2c496b4	4d7ba690-ac0a-4654-9f41-1c773d6e8f92	state	Delaware	delaware	DE	Delaware	\N	\N	\N	\N	{}	2026-04-11 02:33:08.447344	\N
9f153a74-95bc-4f2f-bff4-23b359b78645	4d7ba690-ac0a-4654-9f41-1c773d6e8f92	state	Florida	florida	FL	Florida	\N	\N	\N	\N	{}	2026-04-11 02:33:08.451355	\N
bf1b60d0-95fc-4c44-92eb-483077a5c6f2	4d7ba690-ac0a-4654-9f41-1c773d6e8f92	state	Georgia	georgia	GA	Georgia	\N	\N	\N	\N	{}	2026-04-11 02:33:08.453699	\N
d81c1f18-b763-4242-a264-3a36627c04a5	4d7ba690-ac0a-4654-9f41-1c773d6e8f92	state	Hawaii	hawaii	HI	Hawaii	\N	\N	\N	\N	{}	2026-04-11 02:33:08.456711	\N
a65e9e8f-cb56-47ba-93be-d0a954f068ae	4d7ba690-ac0a-4654-9f41-1c773d6e8f92	state	Idaho	idaho	ID	Idaho	\N	\N	\N	\N	{}	2026-04-11 02:33:08.460038	\N
4b6674e7-da8c-4156-8ea4-2068f0b7323a	4d7ba690-ac0a-4654-9f41-1c773d6e8f92	state	Illinois	illinois	IL	Illinois	\N	\N	\N	\N	{}	2026-04-11 02:33:08.46333	\N
efe4ad88-314f-4dad-b367-70ba1c97632e	4d7ba690-ac0a-4654-9f41-1c773d6e8f92	state	Indiana	indiana	IN	Indiana	\N	\N	\N	\N	{}	2026-04-11 02:33:08.466122	\N
c6c6d556-26ae-4863-9715-54a9379c5c4a	4d7ba690-ac0a-4654-9f41-1c773d6e8f92	state	Iowa	iowa	IA	Iowa	\N	\N	\N	\N	{}	2026-04-11 02:33:08.470738	\N
074994c1-0c1d-416e-95a0-942d430dde31	4d7ba690-ac0a-4654-9f41-1c773d6e8f92	state	Kansas	kansas	KS	Kansas	\N	\N	\N	\N	{}	2026-04-11 02:33:08.483489	\N
0992f9d6-2d26-4b30-829e-144cc5e79476	4d7ba690-ac0a-4654-9f41-1c773d6e8f92	state	Kentucky	kentucky	KY	Kentucky	\N	\N	\N	\N	{}	2026-04-11 02:33:08.48777	\N
71091807-93f1-4eb8-8e2e-f32cbaef750d	4d7ba690-ac0a-4654-9f41-1c773d6e8f92	state	Louisiana	louisiana	LA	Louisiana	\N	\N	\N	\N	{}	2026-04-11 02:33:08.491748	\N
f74a74a5-033d-4d7b-b3a9-561a8f227a13	4d7ba690-ac0a-4654-9f41-1c773d6e8f92	state	Maine	maine	ME	Maine	\N	\N	\N	\N	{}	2026-04-11 02:33:08.495852	\N
abed3fdc-82b5-454e-b3f0-7eb94074fac6	4d7ba690-ac0a-4654-9f41-1c773d6e8f92	state	Maryland	maryland	MD	Maryland	\N	\N	\N	\N	{}	2026-04-11 02:33:08.498841	\N
65bd42bf-59c6-4e2f-a355-1cf0db7db389	4d7ba690-ac0a-4654-9f41-1c773d6e8f92	state	Massachusetts	massachusetts	MA	Massachusetts	\N	\N	\N	\N	{}	2026-04-11 02:33:08.501836	\N
3b06717e-a187-401d-8493-cfccd2e8a81a	4d7ba690-ac0a-4654-9f41-1c773d6e8f92	state	Michigan	michigan	MI	Michigan	\N	\N	\N	\N	{}	2026-04-11 02:33:08.504472	\N
61b1e802-2332-433f-8c62-df8529ab4978	4d7ba690-ac0a-4654-9f41-1c773d6e8f92	state	Minnesota	minnesota	MN	Minnesota	\N	\N	\N	\N	{}	2026-04-11 02:33:08.50694	\N
ff46374b-4057-4c37-bbb5-65edbeada696	4d7ba690-ac0a-4654-9f41-1c773d6e8f92	state	Mississippi	mississippi	MS	Mississippi	\N	\N	\N	\N	{}	2026-04-11 02:33:08.509642	\N
b1d118f9-40c4-4598-9f46-5f092a348232	4d7ba690-ac0a-4654-9f41-1c773d6e8f92	state	Missouri	missouri	MO	Missouri	\N	\N	\N	\N	{}	2026-04-11 02:33:08.513658	\N
ce75ca50-0c2a-4a13-8b53-09f86acfedcd	4d7ba690-ac0a-4654-9f41-1c773d6e8f92	state	Montana	montana	MT	Montana	\N	\N	\N	\N	{}	2026-04-11 02:33:08.516503	\N
1bafacfe-7d19-46ae-86ab-deea5da8c660	4d7ba690-ac0a-4654-9f41-1c773d6e8f92	state	Nebraska	nebraska	NE	Nebraska	\N	\N	\N	\N	{}	2026-04-11 02:33:08.51972	\N
e5a58475-7db3-4107-ab07-7d69ddf6392c	4d7ba690-ac0a-4654-9f41-1c773d6e8f92	state	Nevada	nevada	NV	Nevada	\N	\N	\N	\N	{}	2026-04-11 02:33:08.522853	\N
4fa70697-8509-4ef3-a06a-2685e0e699ed	4d7ba690-ac0a-4654-9f41-1c773d6e8f92	state	New Hampshire	new-hampshire	NH	New Hampshire	\N	\N	\N	\N	{}	2026-04-11 02:33:08.525752	\N
c3e11baf-c36b-40f3-a8c8-3aaba722bc1a	4d7ba690-ac0a-4654-9f41-1c773d6e8f92	state	New Jersey	new-jersey	NJ	New Jersey	\N	\N	\N	\N	{}	2026-04-11 02:33:08.528628	\N
733dd792-1d5c-418c-8a60-f9933c96a2a7	4d7ba690-ac0a-4654-9f41-1c773d6e8f92	state	New Mexico	new-mexico	NM	New Mexico	\N	\N	\N	\N	{}	2026-04-11 02:33:08.531837	\N
9ab57a14-ad8e-48cd-a93c-4a2fa2b51198	4d7ba690-ac0a-4654-9f41-1c773d6e8f92	state	New York	new-york	NY	New York	\N	\N	\N	\N	{}	2026-04-11 02:33:08.535182	\N
56f1149a-c7d4-4b77-9237-713c46fbefa6	4d7ba690-ac0a-4654-9f41-1c773d6e8f92	state	North Carolina	north-carolina	NC	North Carolina	\N	\N	\N	\N	{}	2026-04-11 02:33:08.538134	\N
7fc55e53-62ca-4ea3-8703-443502311309	4d7ba690-ac0a-4654-9f41-1c773d6e8f92	state	North Dakota	north-dakota	ND	North Dakota	\N	\N	\N	\N	{}	2026-04-11 02:33:08.540655	\N
56015b71-f962-4625-83ab-6b38af28be1c	4d7ba690-ac0a-4654-9f41-1c773d6e8f92	state	Ohio	ohio	OH	Ohio	\N	\N	\N	\N	{}	2026-04-11 02:33:08.543434	\N
d0e0d012-b34e-4f36-b783-dc9af1d849e9	4d7ba690-ac0a-4654-9f41-1c773d6e8f92	state	Oklahoma	oklahoma	OK	Oklahoma	\N	\N	\N	\N	{}	2026-04-11 02:33:08.546207	\N
890b6964-8780-4d9e-a18c-655c61d1dab0	4d7ba690-ac0a-4654-9f41-1c773d6e8f92	state	Oregon	oregon	OR	Oregon	\N	\N	\N	\N	{}	2026-04-11 02:33:08.548954	\N
372b9da3-1f54-45d9-a2c4-4c84798651c5	4d7ba690-ac0a-4654-9f41-1c773d6e8f92	state	Pennsylvania	pennsylvania	PA	Pennsylvania	\N	\N	\N	\N	{}	2026-04-11 02:33:08.552172	\N
d6979b8f-b04b-4b31-a593-dbd39acbbaee	4d7ba690-ac0a-4654-9f41-1c773d6e8f92	state	Rhode Island	rhode-island	RI	Rhode Island	\N	\N	\N	\N	{}	2026-04-11 02:33:08.554497	\N
173e2e9e-9783-400e-bff2-488515c569aa	4d7ba690-ac0a-4654-9f41-1c773d6e8f92	state	South Carolina	south-carolina	SC	South Carolina	\N	\N	\N	\N	{}	2026-04-11 02:33:08.559252	\N
6688d47b-1021-4890-8c3e-8b344fb349fe	4d7ba690-ac0a-4654-9f41-1c773d6e8f92	state	South Dakota	south-dakota	SD	South Dakota	\N	\N	\N	\N	{}	2026-04-11 02:33:08.56286	\N
59a72452-9a86-4dc3-af66-5628c104b2fb	4d7ba690-ac0a-4654-9f41-1c773d6e8f92	state	Tennessee	tennessee	TN	Tennessee	\N	\N	\N	\N	{}	2026-04-11 02:33:08.566667	\N
42bd948c-e79b-4c79-ba76-da8b217ebe47	4d7ba690-ac0a-4654-9f41-1c773d6e8f92	state	Texas	texas	TX	Texas	\N	\N	\N	\N	{}	2026-04-11 02:33:08.570286	\N
b04ee506-70bd-4039-a7d9-2c02d2aebe62	4d7ba690-ac0a-4654-9f41-1c773d6e8f92	state	Utah	utah	UT	Utah	\N	\N	\N	\N	{}	2026-04-11 02:33:08.573053	\N
220c2ada-4325-46fb-924b-5e836600e26f	4d7ba690-ac0a-4654-9f41-1c773d6e8f92	state	Vermont	vermont	VT	Vermont	\N	\N	\N	\N	{}	2026-04-11 02:33:08.575699	\N
9fe9bdd7-9b4a-4fba-9340-cb37722372f6	4d7ba690-ac0a-4654-9f41-1c773d6e8f92	state	Virginia	virginia	VA	Virginia	\N	\N	\N	\N	{}	2026-04-11 02:33:08.578715	\N
50434ee1-c06a-4270-ad01-ab075997dbf0	4d7ba690-ac0a-4654-9f41-1c773d6e8f92	state	Washington	washington	WA	Washington	\N	\N	\N	\N	{}	2026-04-11 02:33:08.581616	\N
ec9319a2-4e0c-4fdc-ab22-ce42f3a8294b	4d7ba690-ac0a-4654-9f41-1c773d6e8f92	state	West Virginia	west-virginia	WV	West Virginia	\N	\N	\N	\N	{}	2026-04-11 02:33:08.58379	\N
13a72906-0a1a-49f3-aece-53ffa2c4fe1a	4d7ba690-ac0a-4654-9f41-1c773d6e8f92	state	Wisconsin	wisconsin	WI	Wisconsin	\N	\N	\N	\N	{}	2026-04-11 02:33:08.587164	\N
dfd0bcff-e3c9-449c-9e69-a3d2720f799d	4d7ba690-ac0a-4654-9f41-1c773d6e8f92	state	Wyoming	wyoming	WY	Wyoming	\N	\N	\N	\N	{}	2026-04-11 02:33:08.589842	\N
22ec64d7-154a-412c-861e-bf8d12b660b3	4d7ba690-ac0a-4654-9f41-1c773d6e8f92	city	New York City	new-york-city	NY	New York	8336817	\N	\N	\N	{}	2026-04-11 02:33:08.592702	\N
ff76453a-afde-4c8f-8466-f4d8e3ca4b01	4d7ba690-ac0a-4654-9f41-1c773d6e8f92	city	Los Angeles	los-angeles	CA	California	3979576	\N	\N	\N	{}	2026-04-11 02:33:08.595978	\N
b26027af-ed9a-4bb8-a0a3-628881c64d1e	4d7ba690-ac0a-4654-9f41-1c773d6e8f92	city	Chicago	chicago	IL	Illinois	2693976	\N	\N	\N	{}	2026-04-11 02:33:08.598842	\N
77649804-926d-4bf5-a3d0-dcce51f420f0	4d7ba690-ac0a-4654-9f41-1c773d6e8f92	city	Houston	houston	TX	Texas	2304580	\N	\N	\N	{}	2026-04-11 02:33:08.603463	\N
dbfd8ee2-701b-447b-94f4-d19e5bd5f537	4d7ba690-ac0a-4654-9f41-1c773d6e8f92	city	Phoenix	phoenix	AZ	Arizona	1608139	\N	\N	\N	{}	2026-04-11 02:33:08.607219	\N
a57f48dc-e59b-4f08-b452-3a6061fac980	4d7ba690-ac0a-4654-9f41-1c773d6e8f92	city	Philadelphia	philadelphia	PA	Pennsylvania	1603797	\N	\N	\N	{}	2026-04-11 02:33:08.616766	\N
2583e335-c883-49f3-ba56-313174d64a67	4d7ba690-ac0a-4654-9f41-1c773d6e8f92	city	San Antonio	san-antonio	TX	Texas	1434625	\N	\N	\N	{}	2026-04-11 02:33:08.621912	\N
94d3f411-2766-4658-9981-6a79d33cb397	4d7ba690-ac0a-4654-9f41-1c773d6e8f92	city	San Diego	san-diego	CA	California	1386932	\N	\N	\N	{}	2026-04-11 02:33:08.62576	\N
4de6b573-6f19-47b1-ba12-e34976b32850	4d7ba690-ac0a-4654-9f41-1c773d6e8f92	city	Dallas	dallas	TX	Texas	1304379	\N	\N	\N	{}	2026-04-11 02:33:08.629273	\N
4366e7a0-364f-46f1-8489-3de5b4322fc8	4d7ba690-ac0a-4654-9f41-1c773d6e8f92	city	San Jose	san-jose	CA	California	1013240	\N	\N	\N	{}	2026-04-11 02:33:08.632218	\N
d966ed2a-54ca-47cd-9b79-0a5718e58637	4d7ba690-ac0a-4654-9f41-1c773d6e8f92	city	Austin	austin	TX	Texas	961855	\N	\N	\N	{}	2026-04-11 02:33:08.636011	\N
b8682d00-49c6-4ac7-b958-fdaadf843780	4d7ba690-ac0a-4654-9f41-1c773d6e8f92	city	Jacksonville	jacksonville	FL	Florida	949611	\N	\N	\N	{}	2026-04-11 02:33:08.638749	\N
901c697a-99eb-4ec2-b592-ddc7f14a1893	4d7ba690-ac0a-4654-9f41-1c773d6e8f92	city	Fort Worth	fort-worth	TX	Texas	918915	\N	\N	\N	{}	2026-04-11 02:33:08.642118	\N
9e3f275a-2187-42f6-bf8c-7f7e0d6dd2f9	4d7ba690-ac0a-4654-9f41-1c773d6e8f92	city	Columbus	columbus	OH	Ohio	905748	\N	\N	\N	{}	2026-04-11 02:33:08.64584	\N
ef826f3c-6bad-4bcc-859d-a28d42307aed	4d7ba690-ac0a-4654-9f41-1c773d6e8f92	city	Charlotte	charlotte	NC	North Carolina	885708	\N	\N	\N	{}	2026-04-11 02:33:08.649573	\N
f2efb12b-d00c-48eb-9b7a-9dc52625899e	4d7ba690-ac0a-4654-9f41-1c773d6e8f92	city	Indianapolis	indianapolis	IN	Indiana	876384	\N	\N	\N	{}	2026-04-11 02:33:08.652874	\N
80f24b85-b1c0-4390-ab58-e51a687d48ce	4d7ba690-ac0a-4654-9f41-1c773d6e8f92	city	San Francisco	san-francisco	CA	California	873965	\N	\N	\N	{}	2026-04-11 02:33:08.65612	\N
4cbb854b-9ebb-470c-9706-5fdc83460cf2	4d7ba690-ac0a-4654-9f41-1c773d6e8f92	city	Seattle	seattle	WA	Washington	737255	\N	\N	\N	{}	2026-04-11 02:33:08.659095	\N
3350a744-01d4-4385-9312-71bc9ab76765	4d7ba690-ac0a-4654-9f41-1c773d6e8f92	city	Denver	denver	CO	Colorado	715522	\N	\N	\N	{}	2026-04-11 02:33:08.66224	\N
2605c87d-4d21-4db3-ae9e-55006e41f715	4d7ba690-ac0a-4654-9f41-1c773d6e8f92	city	Nashville	nashville	TN	Tennessee	689447	\N	\N	\N	{}	2026-04-11 02:33:08.665207	\N
d0dea64a-b621-4aa2-8124-ebfa98cbae9f	4d7ba690-ac0a-4654-9f41-1c773d6e8f92	city	Oklahoma City	oklahoma-city	OK	Oklahoma	649021	\N	\N	\N	{}	2026-04-11 02:33:08.668614	\N
d8dffac7-041b-42f0-8cc2-2bbfc3132cdd	4d7ba690-ac0a-4654-9f41-1c773d6e8f92	city	El Paso	el-paso	TX	Texas	678815	\N	\N	\N	{}	2026-04-11 02:33:08.672601	\N
fdda5b7a-01e6-4f12-aa3c-055e3a80d14b	4d7ba690-ac0a-4654-9f41-1c773d6e8f92	city	Washington DC	washington-dc	DC	Washington DC	692683	\N	\N	\N	{}	2026-04-11 02:33:08.676129	\N
9a88aded-fcc9-4df6-afff-235fe1d19de4	4d7ba690-ac0a-4654-9f41-1c773d6e8f92	city	Las Vegas	las-vegas	NV	Nevada	641903	\N	\N	\N	{}	2026-04-11 02:33:08.678704	\N
28c7c072-0228-4354-9c9d-65ca7aba703d	4d7ba690-ac0a-4654-9f41-1c773d6e8f92	city	Louisville	louisville	KY	Kentucky	633045	\N	\N	\N	{}	2026-04-11 02:33:08.681857	\N
5a0fb5e2-0e67-4c2b-a4be-1ba9b9c2fd81	4d7ba690-ac0a-4654-9f41-1c773d6e8f92	city	Memphis	memphis	TN	Tennessee	650910	\N	\N	\N	{}	2026-04-11 02:33:08.684854	\N
47f4f456-5abc-4a81-abb3-b7c7284b842e	4d7ba690-ac0a-4654-9f41-1c773d6e8f92	city	Portland	portland	OR	Oregon	652503	\N	\N	\N	{}	2026-04-11 02:33:08.687935	\N
d28dd3f7-5298-4779-a4f9-956a76f49f60	4d7ba690-ac0a-4654-9f41-1c773d6e8f92	city	Atlanta	atlanta	GA	Georgia	498715	\N	\N	\N	{}	2026-04-11 02:33:08.691433	\N
8011bb79-7711-4860-bba8-8f7bd07b8698	4d7ba690-ac0a-4654-9f41-1c773d6e8f92	city	Miami	miami	FL	Florida	467963	\N	\N	\N	{}	2026-04-11 02:33:08.69476	\N
6732866d-50f8-4fc3-b0f1-313908562e5b	4d7ba690-ac0a-4654-9f41-1c773d6e8f92	city	Minneapolis	minneapolis	MN	Minnesota	429606	\N	\N	\N	{}	2026-04-11 02:33:08.697616	\N
\.


--
-- Data for Name: onboarding_submissions; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.onboarding_submissions (id, token, stripe_session_id, stripe_customer_id, plan_type, agency_id, account_id, website_id, status, form_data, readiness_score, readiness_result, onboarding_notes, created_at, submitted_at, generation_started_at, completed_at, governor_results, brand_input_score, brand_input_result, gap_report) FROM stdin;
8525b0ec-f37b-4f23-97db-c2642ff471ae	test-token-live-check-001	cs_test_manual	\N	local_launch	\N	\N	\N	pending	{"customer_name": "Test User", "customer_email": "test@example.com"}	0	\N	\N	2026-04-18 22:31:18.587436	\N	\N	\N	\N	\N	\N	\N
\.


--
-- Data for Name: page_metrics; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.page_metrics (id, page_id, website_id, date, impressions, clicks, avg_position, ctr, created_at) FROM stdin;
\.


--
-- Data for Name: page_versions; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.page_versions (id, page_id, version, content_html, content_json, prompt_tokens, completion_tokens, review_notes, is_active, created_at) FROM stdin;
\.


--
-- Data for Name: pages; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.pages (id, website_id, blueprint_id, location_id, service_id, industry_id, query_cluster_id, page_type, slug, title, meta_description, h1, canonical_url, status, publish_score, local_signal_score, word_count, passed_qa, qa_report, published_at, prune_reason, r2_key, created_at, updated_at, tier, quality_score, score_breakdown, index_status, fallback_hit_count, last_evaluated_at, rollout_phase, promotion_status, noindex, is_draft, draft_reason, publish_wave, override_published_by, override_published_at, gsc_submitted_at, duplicate_flag, duplicate_of_slug, duplicate_similarity) FROM stdin;
b1ef0f69-4875-43f9-bb86-1bb35adc8363	b7cfd050-7a02-4ef2-bcdb-1e044b063c3f	\N	\N	\N	\N	\N	state_hub	merchant-services-in-wyoming	Merchant Services in Wyoming	Expert merchant services for Wyoming businesses.	Merchant Services in Wyoming	\N	published	\N	\N	\N	\N	\N	\N	\N	\N	2026-03-30 11:11:41.131133	2026-03-30 11:11:41.131133	2	\N	\N	queued	0	\N	\N	default	f	f	\N	0	\N	\N	\N	f	\N	\N
\.


--
-- Data for Name: query_clusters; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.query_clusters (id, account_id, service_id, name, intent_type, primary_keyword, secondary_keywords, search_volume, difficulty, metadata, created_at) FROM stdin;
d1f87e60-ba32-4dd6-ba64-6b27706ea708	70ec4b1c-80b2-4c17-9d22-f63275d21310	e22beced-37f8-4de0-b31d-47a6fa90ab79	Credit Card Processing Local Intent	local	credit card processing near me	{"merchant services near me","accept credit cards small business","best credit card processor"}	12100	52	{}	2026-03-29 06:37:25.007869
83414c91-c02f-4e0a-941d-ece51f3eb446	70ec4b1c-80b2-4c17-9d22-f63275d21310	72b92def-5af1-4f7e-9c00-b413a38bff3e	Business Cash Advance Transactional	transactional	merchant cash advance	{"business cash advance","fast business funding","merchant advance"}	9900	48	{}	2026-03-29 06:37:25.01152
\.


--
-- Data for Name: services; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.services (id, account_id, name, slug, description, keywords, industry_id, metadata, created_at) FROM stdin;
e22beced-37f8-4de0-b31d-47a6fa90ab79	70ec4b1c-80b2-4c17-9d22-f63275d21310	Credit Card Processing	credit-card-processing	Accept all major credit and debit cards with competitive rates and fast deposits.	{"credit card processing","merchant services","accept credit cards","card payment processing","payment processing for small business"}	162e8a3d-e35a-48e7-8e6f-8e0e1e001943	{}	2026-03-29 06:37:24.780617
afd828b3-90aa-448b-b024-f671c64850fa	70ec4b1c-80b2-4c17-9d22-f63275d21310	POS System Setup	pos-system-setup	Point-of-sale system installation and configuration for retail and restaurant businesses.	{"POS system","point of sale system","retail POS","restaurant POS","POS system setup"}	162e8a3d-e35a-48e7-8e6f-8e0e1e001943	{}	2026-03-29 06:37:24.785828
d4b0e003-67a5-4b0e-910e-2840f2f57ddb	70ec4b1c-80b2-4c17-9d22-f63275d21310	Payment Gateway Integration	payment-gateway	Seamlessly integrate online payment gateways for e-commerce and recurring billing.	{"payment gateway","online payment processing","ecommerce payment","payment integration","online merchant account"}	162e8a3d-e35a-48e7-8e6f-8e0e1e001943	{}	2026-03-29 06:37:24.78885
48c0966f-064f-4231-8a5b-2af276b3af5b	70ec4b1c-80b2-4c17-9d22-f63275d21310	Mobile Payment Solutions	mobile-payments	Accept payments anywhere with mobile card readers and contactless payment technology.	{"mobile payment","mobile card reader","tap to pay","mobile POS","accept payments on phone"}	162e8a3d-e35a-48e7-8e6f-8e0e1e001943	{}	2026-03-29 06:37:24.792422
72b92def-5af1-4f7e-9c00-b413a38bff3e	70ec4b1c-80b2-4c17-9d22-f63275d21310	Business Cash Advance	business-cash-advance	Fast business funding based on your card sales volume with flexible repayment.	{"merchant cash advance","business cash advance","business funding","small business loan alternative","working capital"}	162e8a3d-e35a-48e7-8e6f-8e0e1e001943	{}	2026-03-29 06:37:24.795278
eb6b15e9-8565-4ba7-90b9-e703eb7ddfd8	70ec4b1c-80b2-4c17-9d22-f63275d21310	High-Risk Merchant Accounts	high-risk-merchant-account	Specialized merchant accounts for high-risk industries with reliable payment processing.	{"high risk merchant account","high risk payment processing","high risk credit card processing","offshore merchant account"}	162e8a3d-e35a-48e7-8e6f-8e0e1e001943	{}	2026-03-29 06:37:24.79794
8fabb4a8-f6ac-4067-bdd3-4f0d2c581bb3	4d7ba690-ac0a-4654-9f41-1c773d6e8f92	Credit Card Processing	credit-card-processing	Accept all major credit and debit cards with competitive rates and fast deposits.	{"credit card processing","merchant services","accept credit cards","card payment processing","payment processing for small business"}	a994b16e-9210-4daa-a974-c3c08e20fac1	{}	2026-04-11 02:33:08.394956
6a00ee27-5ca7-4651-82d8-4cf95cdbf02d	4d7ba690-ac0a-4654-9f41-1c773d6e8f92	POS System Setup	pos-system-setup	Point-of-sale system installation and configuration for retail and restaurant businesses.	{"POS system","point of sale system","retail POS","restaurant POS","POS system setup"}	a994b16e-9210-4daa-a974-c3c08e20fac1	{}	2026-04-11 02:33:08.399432
bb6bb79f-81e4-49c1-afc8-7314c1576efd	4d7ba690-ac0a-4654-9f41-1c773d6e8f92	Payment Gateway Integration	payment-gateway	Seamlessly integrate online payment gateways for e-commerce and recurring billing.	{"payment gateway","online payment processing","ecommerce payment","payment integration","online merchant account"}	a994b16e-9210-4daa-a974-c3c08e20fac1	{}	2026-04-11 02:33:08.401889
5c088e7e-ab0d-49f1-ac14-d79bb588aba2	4d7ba690-ac0a-4654-9f41-1c773d6e8f92	Mobile Payment Solutions	mobile-payments	Accept payments anywhere with mobile card readers and contactless payment technology.	{"mobile payment","mobile card reader","tap to pay","mobile POS","accept payments on phone"}	a994b16e-9210-4daa-a974-c3c08e20fac1	{}	2026-04-11 02:33:08.408715
c5d1e900-d489-416c-901d-410bf1e589fb	4d7ba690-ac0a-4654-9f41-1c773d6e8f92	Business Cash Advance	business-cash-advance	Fast business funding based on your card sales volume with flexible repayment.	{"merchant cash advance","business cash advance","business funding","small business loan alternative","working capital"}	a994b16e-9210-4daa-a974-c3c08e20fac1	{}	2026-04-11 02:33:08.415662
78e84be8-6556-43ec-afef-706fd7ec928e	4d7ba690-ac0a-4654-9f41-1c773d6e8f92	High-Risk Merchant Accounts	high-risk-merchant-account	Specialized merchant accounts for high-risk industries with reliable payment processing.	{"high risk merchant account","high risk payment processing","high risk credit card processing","offshore merchant account"}	a994b16e-9210-4daa-a974-c3c08e20fac1	{}	2026-04-11 02:33:08.419709
\.


--
-- Data for Name: session; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.session (sid, sess, expire) FROM stdin;
9oBFX17r_8_8T2JlAwaBekQCK1KL3OP6	{"cookie":{"originalMaxAge":604800000,"expires":"2026-04-05T07:00:17.353Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":"e3e59043-6cfe-48fc-a0a4-1f50203b1d76","isSuperAdmin":true,"accountId":null,"role":"super_admin"}	2026-04-05 07:00:18
gq_1EdzYy6eIimyour5KZBCDhrDGAtBh	{"cookie":{"originalMaxAge":604800000,"expires":"2026-04-05T07:00:21.617Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":"e3e59043-6cfe-48fc-a0a4-1f50203b1d76","isSuperAdmin":true,"accountId":null,"role":"super_admin"}	2026-04-05 07:00:22
f1DruhdxYolUcseZvqNaCgTlQjTv721_	{"cookie":{"originalMaxAge":604800000,"expires":"2026-04-05T07:18:39.192Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":"e3e59043-6cfe-48fc-a0a4-1f50203b1d76","isSuperAdmin":true,"accountId":null,"role":"super_admin"}	2026-04-05 07:18:52
tIKMmwxw4I25XyoClNjxtPLl8VQR1f3k	{"cookie":{"originalMaxAge":604800000,"expires":"2026-04-05T07:07:37.655Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":"e3e59043-6cfe-48fc-a0a4-1f50203b1d76","isSuperAdmin":true,"accountId":null,"role":"super_admin"}	2026-04-05 07:07:38
HoPjFcGJx_BeD6godHwlHBeByb-Uvt3U	{"cookie":{"originalMaxAge":604800000,"expires":"2026-04-05T23:14:02.337Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":"e3e59043-6cfe-48fc-a0a4-1f50203b1d76","isSuperAdmin":true,"accountId":null,"role":"super_admin"}	2026-04-05 23:14:03
lNv0DO8q6LNqqWdnjTLY4JN5Y1DLNcm9	{"cookie":{"originalMaxAge":604800000,"expires":"2026-04-07T03:55:32.298Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":"e3e59043-6cfe-48fc-a0a4-1f50203b1d76","isSuperAdmin":true,"accountId":null,"role":"super_admin"}	2026-04-07 03:55:33
g8IX3hipRcGVja_4txpGsZqLTWDIDZ5l	{"cookie":{"originalMaxAge":604800000,"expires":"2026-04-07T17:53:50.762Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":"e3e59043-6cfe-48fc-a0a4-1f50203b1d76","isSuperAdmin":true,"accountId":null,"role":"super_admin"}	2026-04-07 17:53:51
oF_6bTLrN0_qmTLpgJxeIvrn0qbAPFB2	{"cookie":{"originalMaxAge":604800000,"expires":"2026-04-05T23:14:31.589Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":"e3e59043-6cfe-48fc-a0a4-1f50203b1d76","isSuperAdmin":true,"accountId":null,"role":"super_admin"}	2026-04-05 23:14:32
ArFDviN_kXm3hkkH3rnAdg3O6cNdiQYs	{"cookie":{"originalMaxAge":604799999,"expires":"2026-04-05T07:07:55.871Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":"e3e59043-6cfe-48fc-a0a4-1f50203b1d76","isSuperAdmin":true,"accountId":null,"role":"super_admin"}	2026-04-05 07:08:06
6L35286-TgvJrHHARdxH3PeqOSx0taQM	{"cookie":{"originalMaxAge":604800000,"expires":"2026-04-05T23:49:48.274Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":"e3e59043-6cfe-48fc-a0a4-1f50203b1d76","isSuperAdmin":true,"accountId":null,"role":"super_admin"}	2026-04-05 23:50:07
d15wBQTcFDSiN1ZucClsSZAZYA3pNAv6	{"cookie":{"originalMaxAge":604800000,"expires":"2026-04-07T17:53:55.781Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":"e3e59043-6cfe-48fc-a0a4-1f50203b1d76","isSuperAdmin":true,"accountId":null,"role":"super_admin"}	2026-04-07 17:55:58
4sefNyyxACLZGClpCBr5UBdpulIXXM8u	{"cookie":{"originalMaxAge":604800000,"expires":"2026-04-06T00:28:11.802Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":"e3e59043-6cfe-48fc-a0a4-1f50203b1d76","isSuperAdmin":true,"accountId":null,"role":"super_admin"}	2026-04-06 00:28:13
htPc7LdrOpVyA-77Bwh0kFJvV3Wf_5Q5	{"cookie":{"originalMaxAge":604800000,"expires":"2026-04-05T23:14:18.138Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":"e3e59043-6cfe-48fc-a0a4-1f50203b1d76","isSuperAdmin":true,"accountId":null,"role":"super_admin"}	2026-04-05 23:14:20
6ml9SO2bP_AStAxiRi-dJA6BVnVCRZIv	{"cookie":{"originalMaxAge":604800000,"expires":"2026-04-05T23:14:52.552Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":"e3e59043-6cfe-48fc-a0a4-1f50203b1d76","isSuperAdmin":true,"accountId":null,"role":"super_admin"}	2026-04-05 23:15:22
HDR2AuRJK-bnyBxWi7XuwMMnKxyDaMen	{"cookie":{"originalMaxAge":604800000,"expires":"2026-04-05T23:49:46.665Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":"e3e59043-6cfe-48fc-a0a4-1f50203b1d76","isSuperAdmin":true,"accountId":null,"role":"super_admin"}	2026-04-05 23:49:48
E-gHJWAtDMElJFfJRHLhQgxMcva9wmzj	{"cookie":{"originalMaxAge":604800000,"expires":"2026-04-06T00:41:24.909Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":"e3e59043-6cfe-48fc-a0a4-1f50203b1d76","isSuperAdmin":true,"accountId":null,"role":"super_admin"}	2026-04-06 00:41:26
V14DYZP_zH9_PAuUkrdIcgU7ghG8NMTe	{"cookie":{"originalMaxAge":604800000,"expires":"2026-04-06T06:37:35.627Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":"e3e59043-6cfe-48fc-a0a4-1f50203b1d76","isSuperAdmin":true,"accountId":null,"role":"super_admin"}	2026-04-06 06:38:12
xSRXhvxImdHQe6XbHRjq3_3amMoTRQEj	{"cookie":{"originalMaxAge":604800000,"expires":"2026-04-06T06:36:49.624Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":"e3e59043-6cfe-48fc-a0a4-1f50203b1d76","isSuperAdmin":true,"accountId":null,"role":"super_admin"}	2026-04-06 06:36:50
ZoWgv24vIcBNZ6xGkj7lHCggKcUTmR7A	{"cookie":{"originalMaxAge":604800000,"expires":"2026-04-06T11:02:21.489Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":"e3e59043-6cfe-48fc-a0a4-1f50203b1d76","isSuperAdmin":true,"accountId":null,"role":"super_admin"}	2026-04-06 11:02:22
WusaD0vBB9GWSdLp3n6V8IqCaKVd6pf_	{"cookie":{"originalMaxAge":604800000,"expires":"2026-04-06T11:03:14.249Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":"e3e59043-6cfe-48fc-a0a4-1f50203b1d76","isSuperAdmin":true,"accountId":null,"role":"super_admin"}	2026-04-06 11:05:20
aXN35-XVF48xQkpwvtYGKhbVhtaKheBv	{"cookie":{"originalMaxAge":604800000,"expires":"2026-04-06T11:06:37.072Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":"e3e59043-6cfe-48fc-a0a4-1f50203b1d76","isSuperAdmin":true,"accountId":null,"role":"super_admin"}	2026-04-06 11:10:58
UXY_O6BFSWrsi1qO-SgqcxQSRL9x3RkS	{"cookie":{"originalMaxAge":604800000,"expires":"2026-04-06T11:11:13.103Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":"e3e59043-6cfe-48fc-a0a4-1f50203b1d76","isSuperAdmin":true,"accountId":null,"role":"super_admin"}	2026-04-06 11:11:42
05Mlgyn3JlLllpFxgY9Hj0nUw84QqxFY	{"cookie":{"originalMaxAge":604800000,"expires":"2026-04-06T17:17:26.644Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":"e3e59043-6cfe-48fc-a0a4-1f50203b1d76","isSuperAdmin":true,"accountId":null,"role":"super_admin"}	2026-04-06 17:26:27
QS7Ctk-Kgx9-4PA_GjAhRFwYZmZ-zQ-v	{"cookie":{"originalMaxAge":604800000,"expires":"2026-04-13T15:30:46.740Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":"e3e59043-6cfe-48fc-a0a4-1f50203b1d76","isSuperAdmin":true,"accountId":null,"role":"super_admin"}	2026-04-13 15:30:47
X4XQakG_LNGYXS1uRSM41WHWRHgRqH0o	{"cookie":{"originalMaxAge":604800000,"expires":"2026-04-07T03:55:44.311Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":"e3e59043-6cfe-48fc-a0a4-1f50203b1d76","isSuperAdmin":true,"accountId":null,"role":"super_admin"}	2026-04-07 03:55:54
P_WQH9-WjZ-Ohl3EJvDunm1G-GJ6_N0L	{"cookie":{"originalMaxAge":604800000,"expires":"2026-04-07T17:57:13.552Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":"e3e59043-6cfe-48fc-a0a4-1f50203b1d76","isSuperAdmin":true,"accountId":null,"role":"super_admin"}	2026-04-07 17:58:22
AnQn9f8sY1VQ5KCERVo3i4nsRIce_e-m	{"cookie":{"originalMaxAge":604800000,"expires":"2026-04-16T04:44:12.776Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":"e3e59043-6cfe-48fc-a0a4-1f50203b1d76","isSuperAdmin":true,"accountId":null,"role":"super_admin"}	2026-04-16 04:44:13
qogJTZTsBxzXcA1f3GH3wxskYeurwB3J	{"cookie":{"originalMaxAge":604800000,"expires":"2026-04-07T17:59:08.687Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":"e3e59043-6cfe-48fc-a0a4-1f50203b1d76","isSuperAdmin":true,"accountId":null,"role":"super_admin"}	2026-04-07 18:00:33
J-FtG_jCm2J0nxsGx19H5ERumRKd8gWD	{"cookie":{"originalMaxAge":604800000,"expires":"2026-04-07T18:56:35.939Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":"e3e59043-6cfe-48fc-a0a4-1f50203b1d76","isSuperAdmin":true,"accountId":null,"role":"super_admin"}	2026-04-07 18:57:37
DxQiLhy63dkQVAGP2ha7a0JozlnSX_1a	{"cookie":{"originalMaxAge":604800000,"expires":"2026-04-07T18:58:25.889Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":"e3e59043-6cfe-48fc-a0a4-1f50203b1d76","isSuperAdmin":true,"accountId":null,"role":"super_admin"}	2026-04-07 18:58:56
j8yRQ7E7KxWG0jI_PqbDXadY_hqR2frs	{"cookie":{"originalMaxAge":604800000,"expires":"2026-04-16T04:44:19.113Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":"e3e59043-6cfe-48fc-a0a4-1f50203b1d76","isSuperAdmin":true,"accountId":null,"role":"super_admin"}	2026-04-16 04:51:04
Rw9XZvDfXaefR0zIwxdKsKjQJ_eyVYzD	{"cookie":{"originalMaxAge":604800000,"expires":"2026-04-17T20:00:46.741Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":"e3e59043-6cfe-48fc-a0a4-1f50203b1d76","isSuperAdmin":true,"accountId":null,"role":"super_admin"}	2026-04-17 20:00:47
kWF1PLRYwRusETCrJcO7_uOV83YjnHfs	{"cookie":{"originalMaxAge":604800000,"expires":"2026-04-18T04:33:44.491Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":"e3e59043-6cfe-48fc-a0a4-1f50203b1d76","isSuperAdmin":true,"accountId":null,"role":"super_admin"}	2026-04-18 04:33:45
RM540FNXep9k2Uo4Ot_9wdAJONk70K8-	{"cookie":{"originalMaxAge":604800000,"expires":"2026-04-26T21:54:02.413Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":"e3e59043-6cfe-48fc-a0a4-1f50203b1d76","isSuperAdmin":true,"accountId":null,"role":"super_admin"}	2026-04-26 21:54:03
CIoex1u8ldy8QTCxPNy7s_bsN-HSmW1I	{"cookie":{"originalMaxAge":604800000,"expires":"2026-04-18T05:35:09.220Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":"e3e59043-6cfe-48fc-a0a4-1f50203b1d76","isSuperAdmin":true,"accountId":null,"role":"super_admin"}	2026-04-18 05:35:10
2ciB-8hWEFgUCeOmmjk_FR23lBZZCx5W	{"cookie":{"originalMaxAge":604800000,"expires":"2026-04-18T05:36:29.367Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":"e3e59043-6cfe-48fc-a0a4-1f50203b1d76","isSuperAdmin":true,"accountId":null,"role":"super_admin"}	2026-04-18 05:36:30
WOvHW3GvtX55F8K4Ve3qYYQoqwhqVo1e	{"cookie":{"originalMaxAge":604800000,"expires":"2026-04-09T06:23:35.384Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":"e3e59043-6cfe-48fc-a0a4-1f50203b1d76","isSuperAdmin":true,"accountId":null,"role":"super_admin"}	2026-04-09 06:27:46
kmgrT20FaMg3hzMzzHCQvHU5iHWzMS-h	{"cookie":{"originalMaxAge":604800000,"expires":"2026-04-09T06:59:39.598Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":"e3e59043-6cfe-48fc-a0a4-1f50203b1d76","isSuperAdmin":true,"accountId":null,"role":"super_admin"}	2026-04-09 06:59:40
C1mUbBwaNUySEkN-_cFI9l__7fbshdSh	{"cookie":{"originalMaxAge":604800000,"expires":"2026-04-23T04:34:34.511Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":"e3e59043-6cfe-48fc-a0a4-1f50203b1d76","isSuperAdmin":true,"accountId":null,"role":"super_admin"}	2026-04-23 04:34:41
EO8Uj8iw4BgMdsjHKYTDM3steAYVpX9k	{"cookie":{"originalMaxAge":604800000,"expires":"2026-04-06T11:19:08.679Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":"e3e59043-6cfe-48fc-a0a4-1f50203b1d76","isSuperAdmin":true,"accountId":null,"role":"super_admin"}	2026-04-10 09:37:32
v99IaRt_QxpEPrpA5oIhLg4RXj7iBV3R	{"cookie":{"originalMaxAge":604800000,"expires":"2026-04-17T08:53:31.856Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":"e3e59043-6cfe-48fc-a0a4-1f50203b1d76","isSuperAdmin":true,"accountId":null,"role":"super_admin"}	2026-04-17 08:54:10
aNcYcpyMPmkXPUZaT4xlAhvKqbjivIjM	{"cookie":{"originalMaxAge":604800000,"expires":"2026-04-17T19:44:15.582Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":"e3e59043-6cfe-48fc-a0a4-1f50203b1d76","isSuperAdmin":true,"accountId":null,"role":"super_admin"}	2026-04-17 19:58:33
fLgIAydix342Q1V-iVn-aX3ZHPVjJY7w	{"cookie":{"originalMaxAge":604800000,"expires":"2026-04-18T04:28:18.398Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":"e3e59043-6cfe-48fc-a0a4-1f50203b1d76","isSuperAdmin":true,"accountId":null,"role":"super_admin"}	2026-04-18 04:28:19
GlJnFsCZhWmr00WgJRk36kJDW-xjbtI1	{"cookie":{"originalMaxAge":604800000,"expires":"2026-04-18T05:34:57.647Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":"e3e59043-6cfe-48fc-a0a4-1f50203b1d76","isSuperAdmin":true,"accountId":null,"role":"super_admin"}	2026-04-18 05:34:58
jqaw6xibL4GAAR1Y9buUmBUs3SFDmf1n	{"cookie":{"originalMaxAge":604800000,"expires":"2026-04-25T14:52:29.407Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":"e3e59043-6cfe-48fc-a0a4-1f50203b1d76","isSuperAdmin":true,"accountId":null,"role":"super_admin"}	2026-04-25 14:52:43
k2gIC_2hi6hkFzJVq0SNvz3trPVLlAy6	{"cookie":{"originalMaxAge":604800000,"expires":"2026-04-18T05:35:40.380Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":"e3e59043-6cfe-48fc-a0a4-1f50203b1d76","isSuperAdmin":true,"accountId":null,"role":"super_admin"}	2026-04-18 05:35:41
FJlppafWYf8qCHekh8FFX4w9ezKHglBG	{"cookie":{"originalMaxAge":604800000,"expires":"2026-04-18T05:44:33.936Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":"e3e59043-6cfe-48fc-a0a4-1f50203b1d76","isSuperAdmin":true,"accountId":null,"role":"super_admin"}	2026-04-18 05:44:34
qsv1XJd4aQJ6ae9-EU9ZTN0hGjdF3iuN	{"cookie":{"originalMaxAge":604800000,"expires":"2026-04-18T05:44:43.729Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":"e3e59043-6cfe-48fc-a0a4-1f50203b1d76","isSuperAdmin":true,"accountId":null,"role":"super_admin"}	2026-04-18 05:44:44
cEx3LPasJngE5bp2DvMt8iaxnmFFnR4K	{"cookie":{"originalMaxAge":604800000,"expires":"2026-04-18T05:44:51.898Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":"e3e59043-6cfe-48fc-a0a4-1f50203b1d76","isSuperAdmin":true,"accountId":null,"role":"super_admin"}	2026-04-18 05:44:52
m7IDg_INVPojouad2O8IbpaiV4b0moVs	{"cookie":{"originalMaxAge":604800000,"expires":"2026-04-26T21:53:39.456Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":"e3e59043-6cfe-48fc-a0a4-1f50203b1d76","isSuperAdmin":true,"accountId":null,"role":"super_admin"}	2026-04-26 21:53:40
jI3M2eUB5QIVo29XGc6CVGkxcVo8Ry_T	{"cookie":{"originalMaxAge":604800000,"expires":"2026-04-28T18:30:42.508Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":"e3e59043-6cfe-48fc-a0a4-1f50203b1d76","isSuperAdmin":true,"accountId":null,"role":"super_admin"}	2026-04-28 18:31:33
-pX6BWNupgv-kcyd58cdq3uVf7zEcwfD	{"cookie":{"originalMaxAge":604800000,"expires":"2026-04-28T20:57:22.814Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":"e3e59043-6cfe-48fc-a0a4-1f50203b1d76","isSuperAdmin":true,"accountId":null,"role":"super_admin"}	2026-04-28 20:57:26
\.


--
-- Data for Name: sitemaps; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.sitemaps (id, website_id, name, slug, url_count, r2_key, last_generated, created_at, updated_at, xml_content) FROM stdin;
\.


--
-- Data for Name: state_data; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.state_data (id, state_name, state_abbr, population, business_count, major_cities, landmarks, business_culture, payment_regulations, created_at) FROM stdin;
3b1b08ee-7a1d-4018-aea7-cabe1e2e2f65	Alabama	AL	5073000	395000	["Birmingham", "Montgomery", "Huntsville", "Mobile", "Tuscaloosa"]	["Vulcan Statue", "USS Alabama Battleship Memorial Park", "Little River Canyon National Preserve"]	Blue-collar manufacturing economy with strong loyalty to local businesses and community banks.	No state-level payment surcharge restrictions; standard PCI DSS compliance required.	2026-03-30 08:16:21.902805
e9141e0a-bee3-4b03-8554-5752924b80e5	Alaska	AK	733583	65000	["Anchorage", "Fairbanks", "Juneau", "Sitka", "Wasilla"]	["Denali National Park", "Mendenhall Glacier", "Tongass National Forest"]	Resource-dependent economy with high demand for mobile and contactless payment solutions in remote areas.	No state sales tax; local municipalities may impose borough-level transaction fees.	2026-03-30 08:16:21.906748
75447861-9162-42c3-af3e-f7af0f756ff5	Arizona	AZ	7359197	580000	["Phoenix", "Tucson", "Scottsdale", "Mesa", "Tempe"]	["Grand Canyon", "Monument Valley", "Sedona Red Rocks"]	Sun Belt growth economy with thriving retail, hospitality, and real estate sectors.	Surcharging permitted; must disclose at point of sale under standard federal guidelines.	2026-03-30 08:16:21.910311
7c437dab-43c3-4206-a06b-506a975ad1a4	Arkansas	AR	3045637	235000	["Little Rock", "Fayetteville", "Fort Smith", "Jonesboro", "Springdale"]	["Crater of Diamonds State Park", "Hot Springs National Park", "Buffalo National River"]	Agricultural and retail-driven economy with growing tech and logistics sectors in Northwest Arkansas.	No specific payment surcharge laws; standard federal regulations apply.	2026-03-30 08:16:21.91362
b600086a-5579-4ce2-a597-fac0eaf8a769	California	CA	38940231	4200000	["Los Angeles", "San Francisco", "San Diego", "Sacramento", "San Jose"]	["Golden Gate Bridge", "Yosemite National Park", "Hollywood Sign"]	Innovation-driven economy with high consumer expectations for seamless digital payment experiences.	Surcharging now permitted following court rulings; disclosure requirements strictly enforced.	2026-03-30 08:16:21.91649
78832489-6884-470e-8b1c-911b082b62cc	Colorado	CO	5877610	625000	["Denver", "Colorado Springs", "Aurora", "Fort Collins", "Boulder"]	["Rocky Mountain National Park", "Garden of the Gods", "Red Rocks Amphitheatre"]	Outdoor recreation and tech-forward economy with strong preference for modern payment systems.	Surcharging permitted with proper disclosure; competitive merchant services market.	2026-03-30 08:16:21.919751
5567be79-fd7f-4867-97b8-dbf86a9942de	Connecticut	CT	3626205	350000	["Bridgeport", "New Haven", "Hartford", "Stamford", "Waterbury"]	["Mark Twain House", "Mystic Seaport", "Yale University"]	Financial services and insurance hub with sophisticated business payment infrastructure.	Surcharging permitted; cash discounting widely practiced among small retailers.	2026-03-30 08:16:21.922834
2d0880d2-56b7-499a-acb9-47426e49c12d	Delaware	DE	1018396	105000	["Wilmington", "Dover", "Newark", "Middletown", "Smyrna"]	["Cape Henlopen State Park", "Hagley Museum", "Rehoboth Beach"]	Corporate-friendly environment with many businesses incorporated here for favorable regulations.	No state sales tax; corporate payment processing often more favorable due to business-friendly laws.	2026-03-30 08:16:21.926494
98e3a603-4d50-4f41-a1c0-cac7b5af8eb4	Florida	FL	22610726	2800000	["Miami", "Orlando", "Tampa", "Jacksonville", "Fort Lauderdale"]	["Everglades National Park", "Walt Disney World", "Kennedy Space Center"]	Tourism-driven economy with year-round demand for fast, reliable point-of-sale solutions.	Surcharging permitted since 2017 court ruling; disclosure at point of sale required.	2026-03-30 08:16:21.929652
6bfa467d-4f5d-4d70-b464-24ac7ad24fa8	Georgia	GA	11029227	1100000	["Atlanta", "Augusta", "Columbus", "Savannah", "Macon"]	["Stone Mountain", "Okefenokee Swamp", "Martin Luther King Jr. National Historic Site"]	Business-friendly Southern hub and home of major Fortune 500 headquarters including Coca-Cola and Home Depot.	No specific surcharge law; standard federal rules apply.	2026-03-30 08:16:21.932969
a757abb5-bf2e-49db-bd2b-2651acd6ce32	Hawaii	HI	1440196	135000	["Honolulu", "Hilo", "Kailua", "Kapolei", "Pearl City"]	["Waikiki Beach", "Hawaii Volcanoes National Park", "Pearl Harbor"]	Tourism and hospitality-dependent economy with strong demand for multi-currency payment solutions.	General excise tax applies to merchant services; unique tax structure for payment processors.	2026-03-30 08:16:21.936158
7a22cba2-670b-4041-8826-383698e2f8c7	Idaho	ID	1920562	170000	["Boise", "Nampa", "Meridian", "Idaho Falls", "Pocatello"]	["Craters of the Moon National Monument", "Sun Valley", "Shoshone Falls"]	Agriculture and tech growth economy with an emerging startup ecosystem in the Boise metro area.	No state surcharge restrictions; standard PCI compliance required.	2026-03-30 08:16:21.93959
863face4-8269-461a-9756-138ba7f6be9c	Illinois	IL	12582032	1250000	["Chicago", "Aurora", "Joliet", "Naperville", "Rockford"]	["Willis Tower", "Navy Pier", "Millennium Park"]	Diverse manufacturing, finance, and services economy with the highest merchant services demand in the Midwest.	Surcharging permitted; Chicago imposes additional transaction taxes for certain hospitality businesses.	2026-03-30 08:16:21.943893
0f44d4d4-ce2f-4eee-acd4-fcdb27c9f438	Indiana	IN	6833037	580000	["Indianapolis", "Fort Wayne", "Evansville", "South Bend", "Carmel"]	["Indiana Dunes National Park", "Indianapolis Motor Speedway", "Conner Prairie"]	Manufacturing and logistics powerhouse with a strong automotive sector and growing tech community.	No state surcharge restrictions beyond federal law.	2026-03-30 08:16:21.947212
e32621fb-5d06-40e4-988d-c2c51ba6ea4a	Iowa	IA	3200517	290000	["Des Moines", "Cedar Rapids", "Davenport", "Sioux City", "Iowa City"]	["Effigy Mounds National Monument", "Bridges of Madison County", "Iowa State Capitol"]	Agriculture-first economy with growing financial technology adoption among rural and urban businesses.	Standard regulations; agriculture-specific payment programs available from regional processors.	2026-03-30 08:16:21.950565
bcb2b28a-a5a3-444f-b08b-ff66ce6aa01d	Kansas	KS	2940865	270000	["Wichita", "Overland Park", "Kansas City", "Topeka", "Olathe"]	["Tallgrass Prairie National Preserve", "Eisenhower Presidential Library", "Monument Rocks"]	Agriculture and aviation economy with a practical, no-frills approach to business payment systems.	No specific surcharge legislation; standard federal payment processing rules apply.	2026-03-30 08:16:21.95309
37e1b813-24c5-4401-818b-3f52077bce41	Kentucky	KY	4526154	395000	["Louisville", "Lexington", "Bowling Green", "Owensboro", "Covington"]	["Mammoth Cave National Park", "Churchill Downs", "Red River Gorge"]	Equine industry, manufacturing, and bourbon economy with a strong tradition of cash payments shifting to digital.	No state surcharge restrictions; standard federal regulations.	2026-03-30 08:16:21.955905
cc1acfc1-13f3-4bc2-90ad-79f19957182f	Louisiana	LA	4590241	430000	["New Orleans", "Baton Rouge", "Shreveport", "Lafayette", "Lake Charles"]	["French Quarter", "Oak Alley Plantation", "Bayou Country"]	Tourism, energy, and hospitality economy with high card-present transaction volumes in entertainment districts.	No specific surcharge laws; standard federal regulations apply.	2026-03-30 08:16:21.958308
74861ee8-fbf7-49aa-b69c-2d649f1a1a2c	Maine	ME	1385340	145000	["Portland", "Augusta", "Bangor", "South Portland", "Biddeford"]	["Acadia National Park", "Portland Head Light", "Baxter State Park"]	Tourism, lobster industry, and artisan economy with strong preference for locally owned businesses.	No state-level surcharge restrictions; standard PCI DSS compliance.	2026-03-30 08:16:21.961365
4cac9c32-1e09-4573-997c-93f52fbdcd8e	Maryland	MD	6164660	620000	["Baltimore", "Frederick", "Rockville", "Gaithersburg", "Bowie"]	["Inner Harbor", "National Aquarium", "Assateague Island"]	Government, biotech, and defense economy with high concentration of federal contractor payment needs.	Surcharging permitted with disclosure; strong consumer protection laws apply.	2026-03-30 08:16:21.963913
63765c15-9014-46fe-b2c1-750209e928a9	Massachusetts	MA	7029917	720000	["Boston", "Worcester", "Springfield", "Cambridge", "Lowell"]	["Freedom Trail", "Fenway Park", "Plymouth Rock"]	Innovation and education economy with early adoption of contactless and digital payment technologies.	Surcharging was historically restricted; now permitted with proper disclosure requirements.	2026-03-30 08:16:21.967091
7c221965-2652-4621-be90-3142a82b8970	Michigan	MI	10034113	870000	["Detroit", "Grand Rapids", "Warren", "Sterling Heights", "Ann Arbor"]	["Pictured Rocks National Lakeshore", "Sleeping Bear Dunes", "Henry Ford Museum"]	Auto industry and manufacturing economy with large workforce accustomed to corporate payment systems.	No specific surcharge restrictions beyond federal law.	2026-03-30 08:16:21.970199
ca2a3518-9e4c-4791-bbca-a570f7af43ca	Minnesota	MN	5706494	580000	["Minneapolis", "Saint Paul", "Rochester", "Duluth", "Bloomington"]	["Mall of America", "Boundary Waters Canoe Area", "SPAM Museum"]	Fortune 500 hub with progressive business culture and early adoption of EMV and contactless payments.	No state surcharge law; PCI compliance heavily enforced by processors operating here.	2026-03-30 08:16:21.973024
10c9ff1f-d449-4ed8-a13f-39eee1a1ff63	Mississippi	MS	2940057	220000	["Jackson", "Gulfport", "Southaven", "Hattiesburg", "Biloxi"]	["Natchez Trace Parkway", "Gulf Islands National Seashore", "Vicksburg National Military Park"]	Agriculture and gaming economy with growing demand for modern payment solutions among small businesses.	No state surcharge restrictions.	2026-03-30 08:16:21.975589
af57b9e8-09ac-4ca1-9300-2931fdd01e7a	Missouri	MO	6177957	585000	["Kansas City", "St. Louis", "Springfield", "Columbia", "Independence"]	["Gateway Arch", "Silver Dollar City", "Mark Twain Birthplace"]	Agriculture, aerospace, and financial services economy with high card acceptance rates in urban corridors.	No specific surcharge legislation; standard federal rules.	2026-03-30 08:16:21.978101
3b47059b-5556-4e90-b302-31cc12303389	Montana	MT	1122867	110000	["Billings", "Missoula", "Great Falls", "Bozeman", "Butte"]	["Glacier National Park", "Beartooth Highway", "Little Bighorn Battlefield"]	Agriculture, ranching, and tourism economy with practical payment needs and growing mobile adoption.	No state surcharge restrictions; standard federal regulations apply.	2026-03-30 08:16:21.982095
914d2dfd-6eb4-4d57-8010-ed4b141bfe2e	Nebraska	NE	1961504	195000	["Omaha", "Lincoln", "Bellevue", "Grand Island", "Kearney"]	["Chimney Rock National Historic Site", "Scotts Bluff National Monument", "Henry Doorly Zoo"]	Agriculture and insurance economy with conservative business practices shifting toward modern payment technology.	No specific surcharge legislation; standard federal payment processing rules.	2026-03-30 08:16:21.984683
4ffc4a6d-d2a7-4b20-81dd-a1271f751c8a	Nevada	NV	3143991	310000	["Las Vegas", "Henderson", "Reno", "North Las Vegas", "Sparks"]	["Las Vegas Strip", "Hoover Dam", "Red Rock Canyon"]	Gaming, hospitality, and entertainment economy with the highest per-capita card transaction volume in the nation.	Surcharging permitted; strong merchant services competition keeps processing rates competitive.	2026-03-30 08:16:21.98716
56747908-737d-4325-8e37-0f614569c0ef	New Hampshire	NH	1395231	145000	["Manchester", "Nashua", "Concord", "Derry", "Dover"]	["White Mountains", "Lake Winnipesaukee", "Flume Gorge"]	Tax-free retail economy attracting cross-border shoppers with high debit and cash transaction volumes.	No state sales tax creates a unique payment processing environment; no surcharge restrictions.	2026-03-30 08:16:21.990203
f10ccbc9-83a0-445a-86ff-94956689b379	New Jersey	NJ	9261699	1000000	["Newark", "Jersey City", "Paterson", "Elizabeth", "Trenton"]	["Liberty State Park", "Cape May", "Princeton University"]	Dense suburban economy with high concentration of retail, pharma, and finance payment processing needs.	Surcharging permitted with disclosure requirements; strong consumer protection laws.	2026-03-30 08:16:21.993044
543be6b0-9954-40ba-9f6e-3fd2c99174c1	New Mexico	NM	2113344	180000	["Albuquerque", "Las Cruces", "Rio Rancho", "Santa Fe", "Roswell"]	["Carlsbad Caverns National Park", "White Sands National Park", "Meow Wolf Santa Fe"]	Tourism, energy, and arts economy with unique small business payment needs driven by the creative sector.	No specific surcharge legislation; standard federal regulations.	2026-03-30 08:16:21.99596
53561638-2e92-4a07-befb-72e452e45aed	New York	NY	19677151	2200000	["New York City", "Buffalo", "Rochester", "Yonkers", "Syracuse"]	["Statue of Liberty", "Niagara Falls", "Times Square"]	Global financial capital with the highest merchant services usage and most competitive payment processing rates.	Surcharging now permitted following federal ruling; clear disclosure required at point of sale.	2026-03-30 08:16:22.008484
e69aba9d-ed36-467b-83b9-cf388e69b442	North Carolina	NC	10698973	1050000	["Charlotte", "Raleigh", "Greensboro", "Durham", "Winston-Salem"]	["Great Smoky Mountains", "Cape Hatteras National Seashore", "Biltmore Estate"]	Tech Research Triangle and finance economy with high business formation rate and modern payment adoption.	No specific surcharge restrictions; standard federal guidelines apply.	2026-03-30 08:16:22.012525
d4579dac-ef60-4ae3-9399-4d20b470c346	North Dakota	ND	779094	75000	["Fargo", "Bismarck", "Grand Forks", "Minot", "West Fargo"]	["Theodore Roosevelt National Park", "International Peace Garden", "Enchanted Highway"]	Agriculture and energy boom economy with practical approach to business payment systems.	No state surcharge restrictions.	2026-03-30 08:16:22.01843
b3ac3c9c-c541-43d2-936c-37601c0c572e	Ohio	OH	11756058	1100000	["Columbus", "Cleveland", "Cincinnati", "Toledo", "Akron"]	["Rock and Roll Hall of Fame", "Cedar Point", "Cuyahoga Valley National Park"]	Diverse manufacturing, retail, and financial services economy with broad merchant services adoption.	No specific surcharge legislation; standard federal rules apply.	2026-03-30 08:16:22.022463
276baadf-44a4-46e6-aa59-d491316820dc	Oklahoma	OK	4053824	380000	["Oklahoma City", "Tulsa", "Norman", "Broken Arrow", "Edmond"]	["Route 66", "Wichita Mountains Wildlife Refuge", "Chickasaw National Recreation Area"]	Energy and agriculture economy with entrepreneurial small business culture adopting modern payment systems.	No state surcharge restrictions.	2026-03-30 08:16:22.025159
e9362644-4271-41c6-b34b-7cbc6dce3cc1	Oregon	OR	4240137	415000	["Portland", "Eugene", "Salem", "Gresham", "Hillsboro"]	["Crater Lake National Park", "Cannon Beach", "Columbia River Gorge"]	Progressive outdoor and tech economy with high contactless payment adoption and strong local merchant support.	Surcharging permitted with disclosure; no state sales tax simplifies transaction calculations.	2026-03-30 08:16:22.028654
eac541f0-1262-4da3-8571-1cf381994485	Pennsylvania	PA	12972008	1150000	["Philadelphia", "Pittsburgh", "Allentown", "Erie", "Reading"]	["Liberty Bell", "Gettysburg National Military Park", "Philadelphia Museum of Art"]	Manufacturing, healthcare, and finance economy with diverse payment needs across urban and rural markets.	No specific surcharge legislation beyond federal law.	2026-03-30 08:16:22.031881
0538bb5a-de25-4175-ac2c-a344e06e201a	Rhode Island	RI	1093734	110000	["Providence", "Cranston", "Warwick", "Pawtucket", "East Providence"]	["The Breakers", "WaterFire Providence", "Newport Cliff Walk"]	Manufacturing and tourism economy with small but dense business environment requiring efficient payment solutions.	No state surcharge restrictions.	2026-03-30 08:16:22.034597
ec1144d5-1971-4499-98f6-97caab7aa8a5	South Carolina	SC	5282634	490000	["Columbia", "Charleston", "North Charleston", "Mount Pleasant", "Rock Hill"]	["Myrtle Beach", "Fort Sumter", "Congaree National Park"]	Tourism, manufacturing, and growing tech economy with strong hospitality sector payment processing demand.	No specific surcharge legislation; standard federal rules.	2026-03-30 08:16:22.037959
4fda2e60-2c34-40e7-be7c-9366b83e7fbc	South Dakota	SD	909824	90000	["Sioux Falls", "Rapid City", "Aberdeen", "Brookings", "Watertown"]	["Mount Rushmore", "Badlands National Park", "Crazy Horse Memorial"]	Agriculture, finance, and tourism economy; South Dakota is a major credit card issuer hub due to no usury laws.	No state income or corporate tax; highly favorable environment for financial services companies.	2026-03-30 08:16:22.040696
4c16d4f6-124f-4fd0-980d-779ebc82e0d5	Tennessee	TN	7051339	660000	["Nashville", "Memphis", "Knoxville", "Chattanooga", "Clarksville"]	["Grand Ole Opry", "Great Smoky Mountains National Park", "Dollywood"]	Music, tourism, and automotive economy with high hospitality sector payment processing volumes.	No specific surcharge restrictions; standard federal regulations apply.	2026-03-30 08:16:22.044177
a37870d4-2456-415d-b79d-8d05ab48e524	Texas	TX	30029572	3100000	["Houston", "San Antonio", "Dallas", "Austin", "Fort Worth"]	["The Alamo", "Big Bend National Park", "Space Center Houston"]	Largest small business economy in the nation with diverse payment needs across energy, tech, and retail sectors.	No state surcharge restrictions; competitive market drives down processing rates significantly.	2026-03-30 08:16:22.046779
7e9eac1e-dbaf-4ff7-bd14-7e0e41a5cc10	Utah	UT	3380800	330000	["Salt Lake City", "West Valley City", "Provo", "West Jordan", "Orem"]	["Zion National Park", "Arches National Park", "Temple Square"]	Rapidly growing tech (Silicon Slopes) and outdoor recreation economy with high mobile payment adoption.	No state surcharge restrictions; standard PCI compliance.	2026-03-30 08:16:22.049381
c65e041b-c267-45b2-bbee-d2857a54f56a	Vermont	VT	647464	65000	["Burlington", "South Burlington", "Rutland", "Barre", "Montpelier"]	["Ben & Jerry's Factory", "Green Mountain National Forest", "Stowe Mountain Resort"]	Farm-to-table and artisan economy with strong preference for local business and transparent payment practices.	No state surcharge restrictions; straightforward regulatory environment.	2026-03-30 08:16:22.051644
8be129e3-1042-444e-8e6c-7b9603cdb2a9	Virginia	VA	8683619	850000	["Virginia Beach", "Norfolk", "Chesapeake", "Arlington", "Richmond"]	["Monticello", "Colonial Williamsburg", "Shenandoah National Park"]	Government contracting, tech (Northern Virginia data center corridor), and military economy.	No specific surcharge legislation; standard federal payment processing rules.	2026-03-30 08:16:22.05459
28e4ce83-3c92-4c59-9918-0b681dac9451	Washington	WA	7785786	790000	["Seattle", "Spokane", "Tacoma", "Vancouver", "Bellevue"]	["Pike Place Market", "Mount Rainier National Park", "Space Needle"]	Tech giant economy (Amazon, Microsoft) with the highest mobile and contactless payment adoption rates.	Surcharging permitted with disclosure; high consumer awareness of payment fee regulations.	2026-03-30 08:16:22.057468
71338999-927a-40be-9e43-797c0edb707d	West Virginia	WV	1775156	135000	["Charleston", "Huntington", "Morgantown", "Parkersburg", "Wheeling"]	["Harpers Ferry National Historical Park", "Blackwater Falls State Park", "New River Gorge National Park"]	Energy and manufacturing economy transitioning to tourism and services with growing payment technology adoption.	No state surcharge restrictions.	2026-03-30 08:16:22.059957
50a5d2fa-ac54-4c0e-bd46-12f51abf7e7a	Wisconsin	WI	5893718	560000	["Milwaukee", "Madison", "Green Bay", "Kenosha", "Racine"]	["Wisconsin Dells", "Door County", "Harley-Davidson Museum"]	Manufacturing, dairy, and tourism economy with strong community banking relationships.	No specific surcharge legislation; standard federal rules apply.	2026-03-30 08:16:22.062775
c2af5c8d-0dfa-4a4e-83a1-2b7a1df00c8b	Wyoming	WY	584057	60000	["Cheyenne", "Casper", "Laramie", "Gillette", "Rock Springs"]	["Yellowstone National Park", "Grand Teton National Park", "Devils Tower"]	Energy and ranching economy with sparse population requiring remote payment solutions and reliable connectivity.	No state income tax; minimal business payment regulations and no surcharge restrictions.	2026-03-30 08:16:22.065899
\.


--
-- Data for Name: tracked_calls; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.tracked_calls (id, website_id, page_id, service_id, location_id, dynamic_number, caller_phone_hash, call_duration_seconds, call_timestamp, call_status, call_provider_id, created_at) FROM stdin;
407a4122-3faa-4068-92b5-f6ca1ccc4064	b7cfd050-7a02-4ef2-bcdb-1e044b063c3f	b1ef0f69-4875-43f9-bb86-1bb35adc8363	e22beced-37f8-4de0-b31d-47a6fa90ab79	5e35b164-da97-4032-bb55-825a3b7aa413	+15552935877	20b91c3b0ab6b7f9b76ae31d81e251e46744d016d5db5ccc5b8d68e587675c27	420	2026-04-20 10:30:00	completed	call-provider-123	2026-04-21 18:30:59.526598
\.


--
-- Data for Name: tracked_leads; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.tracked_leads (id, website_id, page_id, service_id, location_id, form_name, submitter_name, submitter_email, submitter_phone, message, source_page_url, source_page_title, form_timestamp, created_at) FROM stdin;
5f071076-bc8c-4ba4-8c30-2c609de3618d	b7cfd050-7a02-4ef2-bcdb-1e044b063c3f	b1ef0f69-4875-43f9-bb86-1bb35adc8363	e22beced-37f8-4de0-b31d-47a6fa90ab79	5e35b164-da97-4032-bb55-825a3b7aa413	Contact Form	John Smith	john@example.com	+14355556789	Interested in invoice automation	https://pages.testclient.com/invoice-approval-cheyenne-wyoming	Invoice Approval in Cheyenne, Wyoming	2026-04-21 18:31:08.371	2026-04-21 18:31:08.371962
\.


--
-- Data for Name: users; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.users (id, account_id, username, email, password, role, is_super_admin, created_at) FROM stdin;
e3e59043-6cfe-48fc-a0a4-1f50203b1d76	\N	admin	admin@nexus.io	$2b$12$Ma3GJ5aEFq7roCYNsihkFeCiHHgPMKKhfmo7eegnNA0s8KC9nwGUy	super_admin	t	2026-03-29 06:00:57.453715
\.


--
-- Data for Name: variation_bank_completeness; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.variation_bank_completeness (id, website_id, service, has_intro, has_how_it_works, has_benefits, has_faq, has_cta, total_variations, avg_variations_per_section, completeness_score, is_eligible_for_tier1, last_computed_at, has_local_context, has_use_case, has_proof_trust, has_pain_point, has_local_stat) FROM stdin;
\.


--
-- Data for Name: websites; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.websites (id, account_id, brand_profile_id, name, domain, subdomain, status, primary_industry, target_locale, robots_txt, custom_head, r2_prefix, published_pages, settings, created_at, updated_at, onboarding_status, onboarding_submission_id, launch_cap, warmup_mode, warmup_expires_at, first_publish_at, coverage_plan, tier1_weekly_submit_cap, protection_mode, protection_expires_at, warmup_day, warmup_page_cap_override) FROM stdin;
e0f209ba-8fac-4f08-8b34-2ce78c0cc810	4d7ba690-ac0a-4654-9f41-1c773d6e8f92	\N	SpotOn Nexus	spotonnexus.com	\N	live	\N	en-US	\N	\N	\N	0	{"proxyPath": "", "parentDomain": "spotonnexus.com"}	2026-04-11 02:32:48.432412	2026-04-22 16:17:54.238	manual	\N	100	f	\N	\N	regional	50	f	\N	0	\N
b7cfd050-7a02-4ef2-bcdb-1e044b063c3f	70ec4b1c-80b2-4c17-9d22-f63275d21310	17f98725-6109-46af-9553-f5992a1fd74a	SpotOn Results	spotonresults.com	\N	live	merchant-services	en-US	\N	\N	spoton-results	1	{"ctaText": "SpotOn Results helps businesses across the US save money with better merchant services. Get a free rate analysis today.", "proxyPath": "/pages", "ctaHeading": "Ready to Lower Your Processing Fees?", "contactEmail": "", "parentDomain": "spotonresults.com", "ctaButtonText": "Get a Free Quote", "mainWebsiteUrl": "https://www.spotonresults.com"}	2026-03-29 06:37:24.76967	2026-04-22 16:17:54.239	manual	\N	100	f	\N	\N	regional	50	f	\N	0	\N
\.


--
-- Name: accounts accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT accounts_pkey PRIMARY KEY (id);


--
-- Name: accounts accounts_slug_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT accounts_slug_unique UNIQUE (slug);


--
-- Name: admin_notifications admin_notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_notifications
    ADD CONSTRAINT admin_notifications_pkey PRIMARY KEY (id);


--
-- Name: agencies agencies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agencies
    ADD CONSTRAINT agencies_pkey PRIMARY KEY (id);


--
-- Name: api_usage_log api_usage_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.api_usage_log
    ADD CONSTRAINT api_usage_log_pkey PRIMARY KEY (id);


--
-- Name: blueprints blueprints_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.blueprints
    ADD CONSTRAINT blueprints_pkey PRIMARY KEY (id);


--
-- Name: booked_jobs booked_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booked_jobs
    ADD CONSTRAINT booked_jobs_pkey PRIMARY KEY (id);


--
-- Name: brand_profiles brand_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brand_profiles
    ADD CONSTRAINT brand_profiles_pkey PRIMARY KEY (id);


--
-- Name: call_tracking_numbers call_tracking_numbers_dynamic_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.call_tracking_numbers
    ADD CONSTRAINT call_tracking_numbers_dynamic_number_key UNIQUE (dynamic_number);


--
-- Name: call_tracking_numbers call_tracking_numbers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.call_tracking_numbers
    ADD CONSTRAINT call_tracking_numbers_pkey PRIMARY KEY (id);


--
-- Name: client_weekly_digests client_weekly_digests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_weekly_digests
    ADD CONSTRAINT client_weekly_digests_pkey PRIMARY KEY (id);


--
-- Name: content_variation_banks content_variation_banks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.content_variation_banks
    ADD CONSTRAINT content_variation_banks_pkey PRIMARY KEY (id);


--
-- Name: demotion_logs demotion_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.demotion_logs
    ADD CONSTRAINT demotion_logs_pkey PRIMARY KEY (id);


--
-- Name: fallback_hit_logs fallback_hit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fallback_hit_logs
    ADD CONSTRAINT fallback_hit_logs_pkey PRIMARY KEY (id);


--
-- Name: generation_jobs generation_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.generation_jobs
    ADD CONSTRAINT generation_jobs_pkey PRIMARY KEY (id);


--
-- Name: hub_pages hub_pages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hub_pages
    ADD CONSTRAINT hub_pages_pkey PRIMARY KEY (id);


--
-- Name: industries industries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.industries
    ADD CONSTRAINT industries_pkey PRIMARY KEY (id);


--
-- Name: internal_links internal_links_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.internal_links
    ADD CONSTRAINT internal_links_pkey PRIMARY KEY (id);


--
-- Name: launch_health_scores launch_health_scores_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.launch_health_scores
    ADD CONSTRAINT launch_health_scores_pkey PRIMARY KEY (id);


--
-- Name: leads leads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leads
    ADD CONSTRAINT leads_pkey PRIMARY KEY (id);


--
-- Name: locations locations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.locations
    ADD CONSTRAINT locations_pkey PRIMARY KEY (id);


--
-- Name: onboarding_submissions onboarding_submissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.onboarding_submissions
    ADD CONSTRAINT onboarding_submissions_pkey PRIMARY KEY (id);


--
-- Name: onboarding_submissions onboarding_submissions_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.onboarding_submissions
    ADD CONSTRAINT onboarding_submissions_token_key UNIQUE (token);


--
-- Name: page_metrics page_metrics_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.page_metrics
    ADD CONSTRAINT page_metrics_pkey PRIMARY KEY (id);


--
-- Name: page_versions page_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.page_versions
    ADD CONSTRAINT page_versions_pkey PRIMARY KEY (id);


--
-- Name: pages pages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pages
    ADD CONSTRAINT pages_pkey PRIMARY KEY (id);


--
-- Name: query_clusters query_clusters_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.query_clusters
    ADD CONSTRAINT query_clusters_pkey PRIMARY KEY (id);


--
-- Name: services services_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.services
    ADD CONSTRAINT services_pkey PRIMARY KEY (id);


--
-- Name: session session_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session
    ADD CONSTRAINT session_pkey PRIMARY KEY (sid);


--
-- Name: sitemaps sitemaps_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sitemaps
    ADD CONSTRAINT sitemaps_pkey PRIMARY KEY (id);


--
-- Name: state_data state_data_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.state_data
    ADD CONSTRAINT state_data_pkey PRIMARY KEY (id);


--
-- Name: state_data state_data_state_abbr_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.state_data
    ADD CONSTRAINT state_data_state_abbr_key UNIQUE (state_abbr);


--
-- Name: tracked_calls tracked_calls_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tracked_calls
    ADD CONSTRAINT tracked_calls_pkey PRIMARY KEY (id);


--
-- Name: tracked_leads tracked_leads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tracked_leads
    ADD CONSTRAINT tracked_leads_pkey PRIMARY KEY (id);


--
-- Name: users users_email_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_unique UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: users users_username_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_username_unique UNIQUE (username);


--
-- Name: variation_bank_completeness variation_bank_completeness_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.variation_bank_completeness
    ADD CONSTRAINT variation_bank_completeness_pkey PRIMARY KEY (id);


--
-- Name: websites websites_domain_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.websites
    ADD CONSTRAINT websites_domain_unique UNIQUE (domain);


--
-- Name: websites websites_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.websites
    ADD CONSTRAINT websites_pkey PRIMARY KEY (id);


--
-- Name: IDX_session_expire; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "IDX_session_expire" ON public.session USING btree (expire);


--
-- Name: fallback_hit_logs_website_slug_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX fallback_hit_logs_website_slug_idx ON public.fallback_hit_logs USING btree (website_id, slug);


--
-- Name: idx_accounts_agency_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_accounts_agency_id ON public.accounts USING btree (agency_id);


--
-- Name: idx_admin_notif_website; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_admin_notif_website ON public.admin_notifications USING btree (website_id, created_at DESC);


--
-- Name: idx_blueprints_account_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_blueprints_account_id ON public.blueprints USING btree (account_id);


--
-- Name: idx_blueprints_website_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_blueprints_website_id ON public.blueprints USING btree (website_id);


--
-- Name: idx_booked_jobs_account; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_booked_jobs_account ON public.booked_jobs USING btree (account_id);


--
-- Name: idx_booked_jobs_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_booked_jobs_date ON public.booked_jobs USING btree (booked_date);


--
-- Name: idx_booked_jobs_page; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_booked_jobs_page ON public.booked_jobs USING btree (page_id);


--
-- Name: idx_call_tracking_page; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_call_tracking_page ON public.call_tracking_numbers USING btree (page_id);


--
-- Name: idx_call_tracking_website; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_call_tracking_website ON public.call_tracking_numbers USING btree (website_id);


--
-- Name: idx_client_digest_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_client_digest_status ON public.client_weekly_digests USING btree (status);


--
-- Name: idx_client_digest_website; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_client_digest_website ON public.client_weekly_digests USING btree (website_id);


--
-- Name: idx_demotion_logs_website; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_demotion_logs_website ON public.demotion_logs USING btree (website_id, created_at DESC);


--
-- Name: idx_generation_jobs_account_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_generation_jobs_account_id ON public.generation_jobs USING btree (account_id);


--
-- Name: idx_generation_jobs_website_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_generation_jobs_website_id ON public.generation_jobs USING btree (website_id);


--
-- Name: idx_hub_pages_account_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hub_pages_account_id ON public.hub_pages USING btree (account_id);


--
-- Name: idx_hub_pages_website_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hub_pages_website_id ON public.hub_pages USING btree (website_id);


--
-- Name: idx_internal_links_website_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_internal_links_website_id ON public.internal_links USING btree (website_id);


--
-- Name: idx_launch_health_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_launch_health_date ON public.launch_health_scores USING btree (calculated_at);


--
-- Name: idx_launch_health_website; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_launch_health_website ON public.launch_health_scores USING btree (website_id);


--
-- Name: idx_locations_account_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_locations_account_id ON public.locations USING btree (account_id);


--
-- Name: idx_page_versions_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_page_versions_active ON public.page_versions USING btree (page_id, is_active);


--
-- Name: idx_page_versions_page_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_page_versions_page_id ON public.page_versions USING btree (page_id);


--
-- Name: idx_pages_duplicate_flag; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pages_duplicate_flag ON public.pages USING btree (website_id, duplicate_flag);


--
-- Name: idx_pages_gsc_submitted; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pages_gsc_submitted ON public.pages USING btree (website_id, gsc_submitted_at);


--
-- Name: idx_pages_publish_wave; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pages_publish_wave ON public.pages USING btree (website_id, publish_wave);


--
-- Name: idx_pages_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pages_status ON public.pages USING btree (status);


--
-- Name: idx_pages_updated_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pages_updated_at ON public.pages USING btree (updated_at DESC);


--
-- Name: idx_pages_website_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pages_website_created ON public.pages USING btree (website_id, created_at);


--
-- Name: idx_pages_website_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pages_website_id ON public.pages USING btree (website_id);


--
-- Name: idx_pages_website_slug; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pages_website_slug ON public.pages USING btree (website_id, slug);


--
-- Name: idx_pages_website_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pages_website_status ON public.pages USING btree (website_id, status);


--
-- Name: idx_pages_website_updated; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pages_website_updated ON public.pages USING btree (website_id, updated_at);


--
-- Name: idx_query_clusters_account_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_query_clusters_account_id ON public.query_clusters USING btree (account_id);


--
-- Name: idx_services_account_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_services_account_id ON public.services USING btree (account_id);


--
-- Name: idx_sitemaps_website_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sitemaps_website_id ON public.sitemaps USING btree (website_id);


--
-- Name: idx_tracked_calls_page; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tracked_calls_page ON public.tracked_calls USING btree (page_id);


--
-- Name: idx_tracked_calls_timestamp; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tracked_calls_timestamp ON public.tracked_calls USING btree (call_timestamp);


--
-- Name: idx_tracked_calls_website; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tracked_calls_website ON public.tracked_calls USING btree (website_id);


--
-- Name: idx_tracked_leads_page; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tracked_leads_page ON public.tracked_leads USING btree (page_id);


--
-- Name: idx_tracked_leads_timestamp; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tracked_leads_timestamp ON public.tracked_leads USING btree (form_timestamp);


--
-- Name: idx_tracked_leads_website; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tracked_leads_website ON public.tracked_leads USING btree (website_id);


--
-- Name: idx_users_account_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_account_id ON public.users USING btree (account_id);


--
-- Name: idx_websites_account_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_websites_account_id ON public.websites USING btree (account_id);


--
-- Name: idx_websites_protection_mode; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_websites_protection_mode ON public.websites USING btree (protection_mode);


--
-- Name: variation_bank_completeness_website_service_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX variation_bank_completeness_website_service_idx ON public.variation_bank_completeness USING btree (website_id, service);


--
-- Name: accounts accounts_agency_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT accounts_agency_id_fkey FOREIGN KEY (agency_id) REFERENCES public.agencies(id) ON DELETE SET NULL;


--
-- Name: admin_notifications admin_notifications_website_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_notifications
    ADD CONSTRAINT admin_notifications_website_id_fkey FOREIGN KEY (website_id) REFERENCES public.websites(id) ON DELETE CASCADE;


--
-- Name: api_usage_log api_usage_log_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.api_usage_log
    ADD CONSTRAINT api_usage_log_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id);


--
-- Name: api_usage_log api_usage_log_website_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.api_usage_log
    ADD CONSTRAINT api_usage_log_website_id_fkey FOREIGN KEY (website_id) REFERENCES public.websites(id);


--
-- Name: blueprints blueprints_account_id_accounts_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.blueprints
    ADD CONSTRAINT blueprints_account_id_accounts_id_fk FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;


--
-- Name: blueprints blueprints_website_id_websites_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.blueprints
    ADD CONSTRAINT blueprints_website_id_websites_id_fk FOREIGN KEY (website_id) REFERENCES public.websites(id);


--
-- Name: booked_jobs booked_jobs_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booked_jobs
    ADD CONSTRAINT booked_jobs_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;


--
-- Name: booked_jobs booked_jobs_lead_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booked_jobs
    ADD CONSTRAINT booked_jobs_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES public.tracked_leads(id) ON DELETE SET NULL;


--
-- Name: booked_jobs booked_jobs_page_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booked_jobs
    ADD CONSTRAINT booked_jobs_page_id_fkey FOREIGN KEY (page_id) REFERENCES public.pages(id) ON DELETE CASCADE;


--
-- Name: booked_jobs booked_jobs_website_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booked_jobs
    ADD CONSTRAINT booked_jobs_website_id_fkey FOREIGN KEY (website_id) REFERENCES public.websites(id) ON DELETE CASCADE;


--
-- Name: brand_profiles brand_profiles_account_id_accounts_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brand_profiles
    ADD CONSTRAINT brand_profiles_account_id_accounts_id_fk FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;


--
-- Name: call_tracking_numbers call_tracking_numbers_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.call_tracking_numbers
    ADD CONSTRAINT call_tracking_numbers_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.locations(id) ON DELETE SET NULL;


--
-- Name: call_tracking_numbers call_tracking_numbers_page_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.call_tracking_numbers
    ADD CONSTRAINT call_tracking_numbers_page_id_fkey FOREIGN KEY (page_id) REFERENCES public.pages(id) ON DELETE CASCADE;


--
-- Name: call_tracking_numbers call_tracking_numbers_service_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.call_tracking_numbers
    ADD CONSTRAINT call_tracking_numbers_service_id_fkey FOREIGN KEY (service_id) REFERENCES public.services(id) ON DELETE CASCADE;


--
-- Name: call_tracking_numbers call_tracking_numbers_website_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.call_tracking_numbers
    ADD CONSTRAINT call_tracking_numbers_website_id_fkey FOREIGN KEY (website_id) REFERENCES public.websites(id) ON DELETE CASCADE;


--
-- Name: client_weekly_digests client_weekly_digests_website_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_weekly_digests
    ADD CONSTRAINT client_weekly_digests_website_id_fkey FOREIGN KEY (website_id) REFERENCES public.websites(id) ON DELETE CASCADE;


--
-- Name: content_variation_banks content_variation_banks_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.content_variation_banks
    ADD CONSTRAINT content_variation_banks_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;


--
-- Name: content_variation_banks content_variation_banks_website_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.content_variation_banks
    ADD CONSTRAINT content_variation_banks_website_id_fkey FOREIGN KEY (website_id) REFERENCES public.websites(id) ON DELETE CASCADE;


--
-- Name: demotion_logs demotion_logs_page_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.demotion_logs
    ADD CONSTRAINT demotion_logs_page_id_fkey FOREIGN KEY (page_id) REFERENCES public.pages(id) ON DELETE CASCADE;


--
-- Name: demotion_logs demotion_logs_website_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.demotion_logs
    ADD CONSTRAINT demotion_logs_website_id_fkey FOREIGN KEY (website_id) REFERENCES public.websites(id) ON DELETE CASCADE;


--
-- Name: fallback_hit_logs fallback_hit_logs_website_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fallback_hit_logs
    ADD CONSTRAINT fallback_hit_logs_website_id_fkey FOREIGN KEY (website_id) REFERENCES public.websites(id) ON DELETE CASCADE;


--
-- Name: generation_jobs generation_jobs_account_id_accounts_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.generation_jobs
    ADD CONSTRAINT generation_jobs_account_id_accounts_id_fk FOREIGN KEY (account_id) REFERENCES public.accounts(id);


--
-- Name: generation_jobs generation_jobs_blueprint_id_blueprints_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.generation_jobs
    ADD CONSTRAINT generation_jobs_blueprint_id_blueprints_id_fk FOREIGN KEY (blueprint_id) REFERENCES public.blueprints(id);


--
-- Name: generation_jobs generation_jobs_website_id_websites_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.generation_jobs
    ADD CONSTRAINT generation_jobs_website_id_websites_id_fk FOREIGN KEY (website_id) REFERENCES public.websites(id);


--
-- Name: hub_pages hub_pages_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hub_pages
    ADD CONSTRAINT hub_pages_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;


--
-- Name: hub_pages hub_pages_website_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hub_pages
    ADD CONSTRAINT hub_pages_website_id_fkey FOREIGN KEY (website_id) REFERENCES public.websites(id) ON DELETE CASCADE;


--
-- Name: industries industries_account_id_accounts_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.industries
    ADD CONSTRAINT industries_account_id_accounts_id_fk FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;


--
-- Name: internal_links internal_links_from_page_id_pages_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.internal_links
    ADD CONSTRAINT internal_links_from_page_id_pages_id_fk FOREIGN KEY (from_page_id) REFERENCES public.pages(id);


--
-- Name: internal_links internal_links_to_page_id_pages_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.internal_links
    ADD CONSTRAINT internal_links_to_page_id_pages_id_fk FOREIGN KEY (to_page_id) REFERENCES public.pages(id);


--
-- Name: internal_links internal_links_website_id_websites_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.internal_links
    ADD CONSTRAINT internal_links_website_id_websites_id_fk FOREIGN KEY (website_id) REFERENCES public.websites(id) ON DELETE CASCADE;


--
-- Name: launch_health_scores launch_health_scores_website_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.launch_health_scores
    ADD CONSTRAINT launch_health_scores_website_id_fkey FOREIGN KEY (website_id) REFERENCES public.websites(id) ON DELETE CASCADE;


--
-- Name: leads leads_page_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leads
    ADD CONSTRAINT leads_page_id_fkey FOREIGN KEY (page_id) REFERENCES public.pages(id) ON DELETE SET NULL;


--
-- Name: leads leads_website_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leads
    ADD CONSTRAINT leads_website_id_fkey FOREIGN KEY (website_id) REFERENCES public.websites(id) ON DELETE CASCADE;


--
-- Name: locations locations_account_id_accounts_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.locations
    ADD CONSTRAINT locations_account_id_accounts_id_fk FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;


--
-- Name: onboarding_submissions onboarding_submissions_agency_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.onboarding_submissions
    ADD CONSTRAINT onboarding_submissions_agency_id_fkey FOREIGN KEY (agency_id) REFERENCES public.accounts(id);


--
-- Name: page_metrics page_metrics_page_id_pages_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.page_metrics
    ADD CONSTRAINT page_metrics_page_id_pages_id_fk FOREIGN KEY (page_id) REFERENCES public.pages(id) ON DELETE CASCADE;


--
-- Name: page_metrics page_metrics_website_id_websites_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.page_metrics
    ADD CONSTRAINT page_metrics_website_id_websites_id_fk FOREIGN KEY (website_id) REFERENCES public.websites(id);


--
-- Name: page_versions page_versions_page_id_pages_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.page_versions
    ADD CONSTRAINT page_versions_page_id_pages_id_fk FOREIGN KEY (page_id) REFERENCES public.pages(id) ON DELETE CASCADE;


--
-- Name: pages pages_blueprint_id_blueprints_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pages
    ADD CONSTRAINT pages_blueprint_id_blueprints_id_fk FOREIGN KEY (blueprint_id) REFERENCES public.blueprints(id);


--
-- Name: pages pages_industry_id_industries_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pages
    ADD CONSTRAINT pages_industry_id_industries_id_fk FOREIGN KEY (industry_id) REFERENCES public.industries(id);


--
-- Name: pages pages_location_id_locations_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pages
    ADD CONSTRAINT pages_location_id_locations_id_fk FOREIGN KEY (location_id) REFERENCES public.locations(id);


--
-- Name: pages pages_query_cluster_id_query_clusters_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pages
    ADD CONSTRAINT pages_query_cluster_id_query_clusters_id_fk FOREIGN KEY (query_cluster_id) REFERENCES public.query_clusters(id);


--
-- Name: pages pages_service_id_services_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pages
    ADD CONSTRAINT pages_service_id_services_id_fk FOREIGN KEY (service_id) REFERENCES public.services(id);


--
-- Name: pages pages_website_id_websites_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pages
    ADD CONSTRAINT pages_website_id_websites_id_fk FOREIGN KEY (website_id) REFERENCES public.websites(id) ON DELETE CASCADE;


--
-- Name: query_clusters query_clusters_account_id_accounts_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.query_clusters
    ADD CONSTRAINT query_clusters_account_id_accounts_id_fk FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;


--
-- Name: query_clusters query_clusters_service_id_services_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.query_clusters
    ADD CONSTRAINT query_clusters_service_id_services_id_fk FOREIGN KEY (service_id) REFERENCES public.services(id);


--
-- Name: services services_account_id_accounts_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.services
    ADD CONSTRAINT services_account_id_accounts_id_fk FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;


--
-- Name: sitemaps sitemaps_website_id_websites_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sitemaps
    ADD CONSTRAINT sitemaps_website_id_websites_id_fk FOREIGN KEY (website_id) REFERENCES public.websites(id) ON DELETE CASCADE;


--
-- Name: tracked_calls tracked_calls_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tracked_calls
    ADD CONSTRAINT tracked_calls_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.locations(id) ON DELETE SET NULL;


--
-- Name: tracked_calls tracked_calls_page_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tracked_calls
    ADD CONSTRAINT tracked_calls_page_id_fkey FOREIGN KEY (page_id) REFERENCES public.pages(id) ON DELETE CASCADE;


--
-- Name: tracked_calls tracked_calls_service_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tracked_calls
    ADD CONSTRAINT tracked_calls_service_id_fkey FOREIGN KEY (service_id) REFERENCES public.services(id) ON DELETE CASCADE;


--
-- Name: tracked_calls tracked_calls_website_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tracked_calls
    ADD CONSTRAINT tracked_calls_website_id_fkey FOREIGN KEY (website_id) REFERENCES public.websites(id) ON DELETE CASCADE;


--
-- Name: tracked_leads tracked_leads_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tracked_leads
    ADD CONSTRAINT tracked_leads_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.locations(id) ON DELETE SET NULL;


--
-- Name: tracked_leads tracked_leads_page_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tracked_leads
    ADD CONSTRAINT tracked_leads_page_id_fkey FOREIGN KEY (page_id) REFERENCES public.pages(id) ON DELETE CASCADE;


--
-- Name: tracked_leads tracked_leads_service_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tracked_leads
    ADD CONSTRAINT tracked_leads_service_id_fkey FOREIGN KEY (service_id) REFERENCES public.services(id) ON DELETE CASCADE;


--
-- Name: tracked_leads tracked_leads_website_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tracked_leads
    ADD CONSTRAINT tracked_leads_website_id_fkey FOREIGN KEY (website_id) REFERENCES public.websites(id) ON DELETE CASCADE;


--
-- Name: users users_account_id_accounts_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_account_id_accounts_id_fk FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;


--
-- Name: variation_bank_completeness variation_bank_completeness_website_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.variation_bank_completeness
    ADD CONSTRAINT variation_bank_completeness_website_id_fkey FOREIGN KEY (website_id) REFERENCES public.websites(id) ON DELETE CASCADE;


--
-- Name: websites websites_account_id_accounts_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.websites
    ADD CONSTRAINT websites_account_id_accounts_id_fk FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;


--
-- Name: websites websites_brand_profile_id_brand_profiles_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.websites
    ADD CONSTRAINT websites_brand_profile_id_brand_profiles_id_fk FOREIGN KEY (brand_profile_id) REFERENCES public.brand_profiles(id);


--
-- Name: websites websites_onboarding_submission_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.websites
    ADD CONSTRAINT websites_onboarding_submission_id_fkey FOREIGN KEY (onboarding_submission_id) REFERENCES public.onboarding_submissions(id);


--
-- PostgreSQL database dump complete
--

\unrestrict wVLQ7AekYfYy1scY4aivMchX1GyNFG6Uwdpw1jHZx5BkWKjd08E2grUTQn18nnZ

