-- Store absolute instants, not naive local timestamps.
--
-- Every DateTime column was `timestamp` without time zone: the application
-- wrote UTC, while Postgres `now()` returns local time. The application was
-- self-consistent, but anyone comparing these columns at the database level —
-- an operator running SQL, or a future cleanup job — silently worked with
-- values offset by the machine's UTC offset. On `expires_at` for document
-- grants and sessions that is a security-relevant difference.
--
-- The USING clauses declare that the existing naive values are UTC. Without
-- them Postgres would interpret them as local time and shift every row.

-- AlterTable
ALTER TABLE "admin_sessions" ALTER COLUMN "issued_at" SET DATA TYPE TIMESTAMPTZ(3) USING "issued_at" AT TIME ZONE 'UTC',
ALTER COLUMN "expires_at" SET DATA TYPE TIMESTAMPTZ(3) USING "expires_at" AT TIME ZONE 'UTC',
ALTER COLUMN "revoked_at" SET DATA TYPE TIMESTAMPTZ(3) USING "revoked_at" AT TIME ZONE 'UTC',
ALTER COLUMN "step_up_at" SET DATA TYPE TIMESTAMPTZ(3) USING "step_up_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "admins" ALTER COLUMN "locked_until" SET DATA TYPE TIMESTAMPTZ(3) USING "locked_until" AT TIME ZONE 'UTC',
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE 'UTC',
ALTER COLUMN "last_login_at" SET DATA TYPE TIMESTAMPTZ(3) USING "last_login_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "audit_log" ALTER COLUMN "at" SET DATA TYPE TIMESTAMPTZ(3) USING "at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "categories" ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "client_category_access" ALTER COLUMN "granted_at" SET DATA TYPE TIMESTAMPTZ(3) USING "granted_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "client_document_access" ALTER COLUMN "granted_at" SET DATA TYPE TIMESTAMPTZ(3) USING "granted_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "clients" ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE 'UTC',
ALTER COLUMN "revoked_at" SET DATA TYPE TIMESTAMPTZ(3) USING "revoked_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "devices" ALTER COLUMN "enrolled_at" SET DATA TYPE TIMESTAMPTZ(3) USING "enrolled_at" AT TIME ZONE 'UTC',
ALTER COLUMN "last_seen_at" SET DATA TYPE TIMESTAMPTZ(3) USING "last_seen_at" AT TIME ZONE 'UTC',
ALTER COLUMN "revoked_at" SET DATA TYPE TIMESTAMPTZ(3) USING "revoked_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "dmp_attempts" ALTER COLUMN "at" SET DATA TYPE TIMESTAMPTZ(3) USING "at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "document_grants" ALTER COLUMN "issued_at" SET DATA TYPE TIMESTAMPTZ(3) USING "issued_at" AT TIME ZONE 'UTC',
ALTER COLUMN "expires_at" SET DATA TYPE TIMESTAMPTZ(3) USING "expires_at" AT TIME ZONE 'UTC',
ALTER COLUMN "revoked_at" SET DATA TYPE TIMESTAMPTZ(3) USING "revoked_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "documents" ALTER COLUMN "uploaded_at" SET DATA TYPE TIMESTAMPTZ(3) USING "uploaded_at" AT TIME ZONE 'UTC',
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMPTZ(3) USING "updated_at" AT TIME ZONE 'UTC',
ALTER COLUMN "deleted_at" SET DATA TYPE TIMESTAMPTZ(3) USING "deleted_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "enrollment_codes" ALTER COLUMN "expires_at" SET DATA TYPE TIMESTAMPTZ(3) USING "expires_at" AT TIME ZONE 'UTC',
ALTER COLUMN "used_at" SET DATA TYPE TIMESTAMPTZ(3) USING "used_at" AT TIME ZONE 'UTC',
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "favorites" ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "sessions" ALTER COLUMN "issued_at" SET DATA TYPE TIMESTAMPTZ(3) USING "issued_at" AT TIME ZONE 'UTC',
ALTER COLUMN "expires_at" SET DATA TYPE TIMESTAMPTZ(3) USING "expires_at" AT TIME ZONE 'UTC',
ALTER COLUMN "revoked_at" SET DATA TYPE TIMESTAMPTZ(3) USING "revoked_at" AT TIME ZONE 'UTC',
ALTER COLUMN "reuse_detected_at" SET DATA TYPE TIMESTAMPTZ(3) USING "reuse_detected_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "vault_secret" ALTER COLUMN "configured_at" SET DATA TYPE TIMESTAMPTZ(3) USING "configured_at" AT TIME ZONE 'UTC',
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMPTZ(3) USING "updated_at" AT TIME ZONE 'UTC';

