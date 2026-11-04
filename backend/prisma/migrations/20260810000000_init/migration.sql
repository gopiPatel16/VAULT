-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "ClientStatus" AS ENUM ('active', 'suspended', 'revoked');

-- CreateEnum
CREATE TYPE "DeviceStatus" AS ENUM ('active', 'revoked');

-- CreateTable
CREATE TABLE "admins" (
    "id" UUID NOT NULL,
    "username" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "totp_secret_enc" BYTEA NOT NULL,
    "totp_enabled" BOOLEAN NOT NULL DEFAULT false,
    "recovery_code_hashes" TEXT[],
    "failed_attempts" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_login_at" TIMESTAMP(3),

    CONSTRAINT "admins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_sessions" (
    "id" UUID NOT NULL,
    "admin_id" UUID NOT NULL,
    "token_hash" BYTEA NOT NULL,
    "issued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "step_up_at" TIMESTAMP(3),
    "ip_hash" TEXT,

    CONSTRAINT "admin_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clients" (
    "id" UUID NOT NULL,
    "display_name" TEXT NOT NULL,
    "login_id" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "status" "ClientStatus" NOT NULL DEFAULT 'active',
    "max_devices" INTEGER NOT NULL DEFAULT 5,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "devices" (
    "id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "public_key" BYTEA NOT NULL,
    "status" "DeviceStatus" NOT NULL DEFAULT 'active',
    "enrolled_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enrollment_codes" (
    "id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "code_hash" BYTEA NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_by_admin" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "enrollment_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "refresh_token_hash" BYTEA NOT NULL,
    "family_id" UUID NOT NULL,
    "issued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "reuse_detected_at" TIMESTAMP(3),

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categories" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "original_filename" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "sha256" BYTEA NOT NULL,
    "category_id" UUID NOT NULL,
    "storage_key" TEXT NOT NULL,
    "enc_dek" BYTEA NOT NULL,
    "enc_dek_nonce" BYTEA NOT NULL,
    "enc_dek_tag" BYTEA NOT NULL,
    "search_text" TEXT NOT NULL,
    "document_date" DATE,
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "uploaded_by" UUID,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tags" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_tags" (
    "document_id" UUID NOT NULL,
    "tag_id" UUID NOT NULL,

    CONSTRAINT "document_tags_pkey" PRIMARY KEY ("document_id","tag_id")
);

-- CreateTable
CREATE TABLE "client_category_access" (
    "client_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "granted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "client_category_access_pkey" PRIMARY KEY ("client_id","category_id")
);

-- CreateTable
CREATE TABLE "client_document_access" (
    "client_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "granted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "client_document_access_pkey" PRIMARY KEY ("client_id","document_id")
);

-- CreateTable
CREATE TABLE "favorites" (
    "client_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "favorites_pkey" PRIMARY KEY ("client_id","document_id")
);

-- CreateTable
CREATE TABLE "vault_secret" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "dmp_hash" TEXT,
    "dmp_version" INTEGER NOT NULL DEFAULT 0,
    "grant_ttl_seconds" INTEGER NOT NULL DEFAULT 300,
    "configured_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),
    "updated_by" UUID,

    CONSTRAINT "vault_secret_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_grants" (
    "id" UUID NOT NULL,
    "token_hash" BYTEA NOT NULL,
    "client_id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "dmp_version" INTEGER NOT NULL,
    "issued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "document_grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dmp_attempts" (
    "id" BIGSERIAL NOT NULL,
    "client_id" UUID,
    "device_id" UUID,
    "ip_hash" TEXT,
    "success" BOOLEAN NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dmp_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" BIGSERIAL NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor_type" TEXT NOT NULL,
    "actor_id" UUID,
    "device_id" UUID,
    "event" TEXT NOT NULL,
    "target_type" TEXT,
    "target_id" TEXT,
    "result" TEXT NOT NULL,
    "ip_hash" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "prev_hash" BYTEA,
    "entry_hash" BYTEA NOT NULL,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "admins_username_key" ON "admins"("username");

-- CreateIndex
CREATE UNIQUE INDEX "admin_sessions_token_hash_key" ON "admin_sessions"("token_hash");

-- CreateIndex
CREATE INDEX "admin_sessions_admin_id_idx" ON "admin_sessions"("admin_id");

-- CreateIndex
CREATE INDEX "admin_sessions_expires_at_idx" ON "admin_sessions"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "clients_login_id_key" ON "clients"("login_id");

-- CreateIndex
CREATE INDEX "devices_client_id_idx" ON "devices"("client_id");

-- CreateIndex
CREATE UNIQUE INDEX "enrollment_codes_code_hash_key" ON "enrollment_codes"("code_hash");

-- CreateIndex
CREATE INDEX "enrollment_codes_client_id_idx" ON "enrollment_codes"("client_id");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_refresh_token_hash_key" ON "sessions"("refresh_token_hash");

-- CreateIndex
CREATE INDEX "sessions_device_id_idx" ON "sessions"("device_id");

-- CreateIndex
CREATE INDEX "sessions_family_id_idx" ON "sessions"("family_id");

-- CreateIndex
CREATE INDEX "sessions_expires_at_idx" ON "sessions"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "categories_slug_key" ON "categories"("slug");

-- CreateIndex
CREATE INDEX "documents_category_id_idx" ON "documents"("category_id");

-- CreateIndex
CREATE INDEX "documents_deleted_at_idx" ON "documents"("deleted_at");

-- CreateIndex
CREATE INDEX "documents_uploaded_at_idx" ON "documents"("uploaded_at");

-- CreateIndex
CREATE UNIQUE INDEX "tags_name_key" ON "tags"("name");

-- CreateIndex
CREATE UNIQUE INDEX "document_grants_token_hash_key" ON "document_grants"("token_hash");

-- CreateIndex
CREATE INDEX "document_grants_expires_at_idx" ON "document_grants"("expires_at");

-- CreateIndex
CREATE INDEX "document_grants_client_id_idx" ON "document_grants"("client_id");

-- CreateIndex
CREATE INDEX "dmp_attempts_at_idx" ON "dmp_attempts"("at");

-- CreateIndex
CREATE INDEX "dmp_attempts_device_id_at_idx" ON "dmp_attempts"("device_id", "at");

-- CreateIndex
CREATE INDEX "audit_log_at_idx" ON "audit_log"("at");

-- CreateIndex
CREATE INDEX "audit_log_event_idx" ON "audit_log"("event");

-- CreateIndex
CREATE INDEX "audit_log_actor_id_idx" ON "audit_log"("actor_id");

-- AddForeignKey
ALTER TABLE "admin_sessions" ADD CONSTRAINT "admin_sessions_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "admins"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollment_codes" ADD CONSTRAINT "enrollment_codes_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollment_codes" ADD CONSTRAINT "enrollment_codes_created_by_admin_fkey" FOREIGN KEY ("created_by_admin") REFERENCES "admins"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_tags" ADD CONSTRAINT "document_tags_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_tags" ADD CONSTRAINT "document_tags_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_category_access" ADD CONSTRAINT "client_category_access_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_category_access" ADD CONSTRAINT "client_category_access_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_document_access" ADD CONSTRAINT "client_document_access_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_document_access" ADD CONSTRAINT "client_document_access_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vault_secret" ADD CONSTRAINT "vault_secret_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_grants" ADD CONSTRAINT "document_grants_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_grants" ADD CONSTRAINT "document_grants_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_grants" ADD CONSTRAINT "document_grants_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ─────────────────────────────────────────────────────────────────────────────
-- Vault-specific constraints and seed data.
-- Hand-written; kept in the initial migration so a fresh deployment is correct
-- from the first `migrate deploy` rather than depending on a seed script.
-- ─────────────────────────────────────────────────────────────────────────────

-- There is exactly one Document Master Password. The database, not the
-- application, is what makes a second one impossible.
ALTER TABLE "vault_secret" ADD CONSTRAINT "vault_secret_single_row" CHECK ("id" = 1);

-- Created unconfigured: dmp_hash IS NULL, version 0. Until an administrator
-- sets a password, every document-content request fails closed.
INSERT INTO "vault_secret" ("id", "dmp_version", "grant_ttl_seconds")
VALUES (1, 0, 300)
ON CONFLICT ("id") DO NOTHING;

-- Substring search over titles, filenames and tags. Postgres full-text
-- (tsvector) is the eventual upgrade for OCR'd content; trigram matching is the
-- right fit today because people search filenames by fragment ("certif").
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX "documents_search_text_trgm_idx"
  ON "documents" USING gin ("search_text" gin_trgm_ops);

-- The fixed category vocabulary from the specification.
INSERT INTO "categories" ("id", "slug", "name", "sort_order") VALUES
  (gen_random_uuid(), 'personal',   'Personal',   10),
  (gen_random_uuid(), 'education',  'Education',  20),
  (gen_random_uuid(), 'work',       'Work',       30),
  (gen_random_uuid(), 'finance',    'Finance',    40),
  (gen_random_uuid(), 'government', 'Government', 50),
  (gen_random_uuid(), 'property',   'Property',   60),
  (gen_random_uuid(), 'vehicle',    'Vehicle',    70),
  (gen_random_uuid(), 'legal',      'Legal',      80),
  (gen_random_uuid(), 'other',      'Other',      90)
ON CONFLICT ("slug") DO NOTHING;
