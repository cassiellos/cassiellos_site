-- =============================================================================
-- Mini CRM Cassiellos — Migração 0001: estrutura inicial do schema "crm"
-- -----------------------------------------------------------------------------
-- Fonte da verdade (somente leitura, extraída em 2026-10-28):
--   Neon projeto  : cassiellos-crm (rough-cloud-13370615)
--   Banco         : cassiellos_crm
--   Branch        : preview (br-solitary-darkness-b67vm982)
--   PostgreSQL    : 18.6
--
-- Conteúdo: 1 schema, 10 tabelas, 21 CHECK, 16 PRIMARY KEY/UNIQUE,
--           14 índices e 18 chaves estrangeiras.
--
-- Uso: aplicar somente em banco VAZIO. A migração falha de propósito
--      (e nada é aplicado) se o schema "crm" já existir, para nunca
--      alterar uma estrutura existente.
-- Não define OWNER nem GRANT: os objetos pertencem ao role que executar.
-- Requisito: PostgreSQL 13+ (gen_random_uuid() nativo, sem extensões).
-- =============================================================================

BEGIN;

CREATE SCHEMA crm;

-- -----------------------------------------------------------------------------
-- Tabelas (mesma ordem de colunas do banco de origem)
-- -----------------------------------------------------------------------------

CREATE TABLE crm.visitors (
    id              uuid DEFAULT gen_random_uuid() NOT NULL,
    visitor_key     uuid DEFAULT gen_random_uuid() NOT NULL,
    first_seen_at   timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at    timestamp with time zone DEFAULT now() NOT NULL,
    landing_url     text,
    referrer_url    text,
    utm_source      text,
    utm_medium      text,
    utm_campaign    text,
    utm_content     text,
    utm_term        text,
    fbclid          text,
    fbc             text,
    fbp             text,
    user_agent      text,
    client_ip       inet,
    CONSTRAINT visitors_pkey PRIMARY KEY (id),
    CONSTRAINT visitors_visitor_key_key UNIQUE (visitor_key)
);

CREATE TABLE crm.leads (
    id               uuid DEFAULT gen_random_uuid() NOT NULL,
    visitor_id       uuid,
    full_name        text NOT NULL,
    email            text,
    whatsapp         text,
    company          text,
    segment          text,
    service_interest text,
    stage            text DEFAULT 'new' NOT NULL,
    notes            text,
    created_at       timestamp with time zone DEFAULT now() NOT NULL,
    updated_at       timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT leads_pkey PRIMARY KEY (id),
    CONSTRAINT leads_stage_check
        CHECK (stage IN ('new', 'contacted', 'qualified', 'disqualified', 'customer'))
);

CREATE TABLE crm.appointments (
    id                uuid DEFAULT gen_random_uuid() NOT NULL,
    lead_id           uuid NOT NULL,
    calendar_id       text DEFAULT 'cassiellos' NOT NULL,
    starts_at         timestamp with time zone NOT NULL,
    ends_at           timestamp with time zone NOT NULL,
    status            text DEFAULT 'pending' NOT NULL,
    calendar_event_id text,
    meeting_url       text,
    confirmed_at      timestamp with time zone,
    completed_at      timestamp with time zone,
    cancelled_at      timestamp with time zone,
    created_at        timestamp with time zone DEFAULT now() NOT NULL,
    updated_at        timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT appointments_pkey PRIMARY KEY (id),
    CONSTRAINT appointments_calendar_event_id_key UNIQUE (calendar_event_id),
    CONSTRAINT appointments_status_check
        CHECK (status IN ('pending', 'confirmed', 'completed', 'no_show', 'cancelled', 'rescheduled')),
    CONSTRAINT appointments_valid_interval CHECK (ends_at > starts_at),
    CONSTRAINT appointments_confirmed_timestamp
        CHECK (status <> 'confirmed' OR confirmed_at IS NOT NULL),
    CONSTRAINT appointments_completed_timestamp
        CHECK (status <> 'completed' OR completed_at IS NOT NULL)
);

CREATE TABLE crm.deals (
    id                 uuid DEFAULT gen_random_uuid() NOT NULL,
    lead_id            uuid NOT NULL,
    appointment_id     uuid,
    status             text DEFAULT 'open' NOT NULL,
    description        text,
    contract_reference text,
    amount             numeric(14,2),
    currency           character(3) DEFAULT 'BRL' NOT NULL,
    closed_at          timestamp with time zone,
    created_at         timestamp with time zone DEFAULT now() NOT NULL,
    updated_at         timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT deals_pkey PRIMARY KEY (id),
    CONSTRAINT deals_status_check CHECK (status IN ('open', 'won', 'lost')),
    CONSTRAINT deals_amount_check CHECK (amount >= 0),
    CONSTRAINT deals_won_timestamp CHECK (status <> 'won' OR closed_at IS NOT NULL)
);

CREATE TABLE crm.form_submissions (
    id              uuid DEFAULT gen_random_uuid() NOT NULL,
    lead_id         uuid NOT NULL,
    visitor_id      uuid,
    form_version    text,
    answers         jsonb DEFAULT '{}' NOT NULL,
    idempotency_key text NOT NULL,
    status          text DEFAULT 'submitted' NOT NULL,
    submitted_at    timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT form_submissions_pkey PRIMARY KEY (id),
    CONSTRAINT form_submissions_idempotency_key_key UNIQUE (idempotency_key),
    CONSTRAINT form_submissions_status_check
        CHECK (status IN ('submitted', 'validated', 'rejected'))
);

CREATE TABLE crm.consents (
    id             uuid DEFAULT gen_random_uuid() NOT NULL,
    visitor_id     uuid,
    lead_id        uuid,
    purpose        text NOT NULL,
    legal_basis    text,
    granted        boolean NOT NULL,
    policy_version text NOT NULL,
    recorded_at    timestamp with time zone DEFAULT now() NOT NULL,
    revoked_at     timestamp with time zone,
    CONSTRAINT consents_pkey PRIMARY KEY (id),
    CONSTRAINT consents_subject_required
        CHECK (visitor_id IS NOT NULL OR lead_id IS NOT NULL)
);

CREATE TABLE crm.lead_activities (
    id             uuid DEFAULT gen_random_uuid() NOT NULL,
    lead_id        uuid NOT NULL,
    appointment_id uuid,
    deal_id        uuid,
    activity_kind  text NOT NULL,
    performed_by   text,
    details        jsonb DEFAULT '{}' NOT NULL,
    created_at     timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT lead_activities_pkey PRIMARY KEY (id)
);

CREATE TABLE crm.tracking_events (
    id               uuid DEFAULT gen_random_uuid() NOT NULL,
    visitor_id       uuid,
    lead_id          uuid,
    appointment_id   uuid,
    deal_id          uuid,
    event_id         text NOT NULL,
    event_name       text NOT NULL,
    source_category  text NOT NULL,
    event_source_url text,
    action_source    text DEFAULT 'website' NOT NULL,
    occurred_at      timestamp with time zone DEFAULT now() NOT NULL,
    value            numeric(14,2),
    currency         character(3),
    metadata         jsonb DEFAULT '{}' NOT NULL,
    created_at       timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT tracking_events_pkey PRIMARY KEY (id),
    CONSTRAINT tracking_events_event_id_key UNIQUE (event_id),
    CONSTRAINT tracking_events_source_category_check
        CHECK (source_category IN ('browser', 'server', 'crm')),
    CONSTRAINT tracking_events_value_check CHECK (value >= 0),
    CONSTRAINT tracking_value_currency CHECK (value IS NULL OR currency IS NOT NULL),
    CONSTRAINT tracking_purchase_requires_deal
        CHECK (event_name <> 'Purchase' OR deal_id IS NOT NULL),
    CONSTRAINT tracking_schedule_requires_appointment
        CHECK (event_name <> 'Chronos_Scheduled' OR appointment_id IS NOT NULL)
);

CREATE TABLE crm.meta_deliveries (
    id                uuid DEFAULT gen_random_uuid() NOT NULL,
    tracking_event_id uuid NOT NULL,
    payload           jsonb DEFAULT '{}' NOT NULL,
    status            text DEFAULT 'pending' NOT NULL,
    attempts          integer DEFAULT 0 NOT NULL,
    next_attempt_at   timestamp with time zone DEFAULT now() NOT NULL,
    last_attempt_at   timestamp with time zone,
    accepted_at       timestamp with time zone,
    last_http_status  integer,
    last_error        text,
    created_at        timestamp with time zone DEFAULT now() NOT NULL,
    updated_at        timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT meta_deliveries_pkey PRIMARY KEY (id),
    CONSTRAINT meta_deliveries_tracking_event_id_key UNIQUE (tracking_event_id),
    CONSTRAINT meta_deliveries_status_check
        CHECK (status IN ('pending', 'retry', 'accepted', 'rejected', 'abandoned')),
    CONSTRAINT meta_deliveries_attempts_check CHECK (attempts >= 0)
);

CREATE TABLE crm.notification_deliveries (
    id              uuid DEFAULT gen_random_uuid() NOT NULL,
    appointment_id  uuid NOT NULL,
    lead_id         uuid NOT NULL,
    channel         text NOT NULL,
    recipient_type  text NOT NULL,
    message_kind    text NOT NULL,
    recipient       text,
    dedupe_key      text NOT NULL,
    status          text DEFAULT 'pending' NOT NULL,
    attempts        integer DEFAULT 0 NOT NULL,
    scheduled_for   timestamp with time zone DEFAULT now() NOT NULL,
    last_attempt_at timestamp with time zone,
    sent_at         timestamp with time zone,
    last_error      text,
    created_at      timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT notification_deliveries_pkey PRIMARY KEY (id),
    CONSTRAINT notification_deliveries_dedupe_key_key UNIQUE (dedupe_key),
    CONSTRAINT notification_deliveries_channel_check
        CHECK (channel IN ('telegram', 'email', 'calendar')),
    CONSTRAINT notification_deliveries_recipient_type_check
        CHECK (recipient_type IN ('owner', 'lead')),
    CONSTRAINT notification_deliveries_status_check
        CHECK (status IN ('pending', 'sent', 'failed', 'cancelled')),
    CONSTRAINT notification_deliveries_attempts_check CHECK (attempts >= 0)
);

-- -----------------------------------------------------------------------------
-- Índices
-- -----------------------------------------------------------------------------

CREATE INDEX idx_crm_visitors_fbclid
    ON crm.visitors USING btree (fbclid) WHERE (fbclid IS NOT NULL);

CREATE INDEX idx_crm_leads_email
    ON crm.leads USING btree (lower(email)) WHERE (email IS NOT NULL);
CREATE INDEX idx_crm_leads_stage_created
    ON crm.leads USING btree (stage, created_at DESC);

CREATE INDEX idx_crm_appointments_lead_starts
    ON crm.appointments USING btree (lead_id, starts_at DESC);
CREATE INDEX idx_crm_appointments_status_starts
    ON crm.appointments USING btree (status, starts_at);
CREATE UNIQUE INDEX uq_crm_appointments_calendar_start_active
    ON crm.appointments USING btree (calendar_id, starts_at)
    WHERE (status IN ('pending', 'confirmed'));

CREATE INDEX idx_crm_deals_lead_status
    ON crm.deals USING btree (lead_id, status);

CREATE INDEX idx_crm_submissions_lead_time
    ON crm.form_submissions USING btree (lead_id, submitted_at DESC);

CREATE INDEX idx_crm_consents_lead_time
    ON crm.consents USING btree (lead_id, recorded_at DESC);

CREATE INDEX idx_crm_activities_lead_time
    ON crm.lead_activities USING btree (lead_id, created_at DESC);

CREATE INDEX idx_crm_tracking_events_lead_time
    ON crm.tracking_events USING btree (lead_id, occurred_at DESC);
CREATE INDEX idx_crm_tracking_events_name_time
    ON crm.tracking_events USING btree (event_name, occurred_at DESC);

CREATE INDEX idx_crm_meta_outbox_due
    ON crm.meta_deliveries USING btree (next_attempt_at, created_at)
    WHERE (status IN ('pending', 'retry'));

CREATE INDEX idx_crm_notifications_due
    ON crm.notification_deliveries USING btree (scheduled_for, created_at)
    WHERE (status IN ('pending', 'failed'));

-- -----------------------------------------------------------------------------
-- Chaves estrangeiras (sem ON DELETE/ON UPDATE, igual à origem: NO ACTION)
-- -----------------------------------------------------------------------------

ALTER TABLE crm.leads
    ADD CONSTRAINT leads_visitor_id_fkey
    FOREIGN KEY (visitor_id) REFERENCES crm.visitors(id);

ALTER TABLE crm.appointments
    ADD CONSTRAINT appointments_lead_id_fkey
    FOREIGN KEY (lead_id) REFERENCES crm.leads(id);

ALTER TABLE crm.deals
    ADD CONSTRAINT deals_lead_id_fkey
    FOREIGN KEY (lead_id) REFERENCES crm.leads(id);
ALTER TABLE crm.deals
    ADD CONSTRAINT deals_appointment_id_fkey
    FOREIGN KEY (appointment_id) REFERENCES crm.appointments(id);

ALTER TABLE crm.form_submissions
    ADD CONSTRAINT form_submissions_lead_id_fkey
    FOREIGN KEY (lead_id) REFERENCES crm.leads(id);
ALTER TABLE crm.form_submissions
    ADD CONSTRAINT form_submissions_visitor_id_fkey
    FOREIGN KEY (visitor_id) REFERENCES crm.visitors(id);

ALTER TABLE crm.consents
    ADD CONSTRAINT consents_lead_id_fkey
    FOREIGN KEY (lead_id) REFERENCES crm.leads(id);
ALTER TABLE crm.consents
    ADD CONSTRAINT consents_visitor_id_fkey
    FOREIGN KEY (visitor_id) REFERENCES crm.visitors(id);

ALTER TABLE crm.lead_activities
    ADD CONSTRAINT lead_activities_lead_id_fkey
    FOREIGN KEY (lead_id) REFERENCES crm.leads(id);
ALTER TABLE crm.lead_activities
    ADD CONSTRAINT lead_activities_appointment_id_fkey
    FOREIGN KEY (appointment_id) REFERENCES crm.appointments(id);
ALTER TABLE crm.lead_activities
    ADD CONSTRAINT lead_activities_deal_id_fkey
    FOREIGN KEY (deal_id) REFERENCES crm.deals(id);

ALTER TABLE crm.tracking_events
    ADD CONSTRAINT tracking_events_visitor_id_fkey
    FOREIGN KEY (visitor_id) REFERENCES crm.visitors(id);
ALTER TABLE crm.tracking_events
    ADD CONSTRAINT tracking_events_lead_id_fkey
    FOREIGN KEY (lead_id) REFERENCES crm.leads(id);
ALTER TABLE crm.tracking_events
    ADD CONSTRAINT tracking_events_appointment_id_fkey
    FOREIGN KEY (appointment_id) REFERENCES crm.appointments(id);
ALTER TABLE crm.tracking_events
    ADD CONSTRAINT tracking_events_deal_id_fkey
    FOREIGN KEY (deal_id) REFERENCES crm.deals(id);

ALTER TABLE crm.meta_deliveries
    ADD CONSTRAINT meta_deliveries_tracking_event_id_fkey
    FOREIGN KEY (tracking_event_id) REFERENCES crm.tracking_events(id);

ALTER TABLE crm.notification_deliveries
    ADD CONSTRAINT notification_deliveries_appointment_id_fkey
    FOREIGN KEY (appointment_id) REFERENCES crm.appointments(id);
ALTER TABLE crm.notification_deliveries
    ADD CONSTRAINT notification_deliveries_lead_id_fkey
    FOREIGN KEY (lead_id) REFERENCES crm.leads(id);

COMMIT;
