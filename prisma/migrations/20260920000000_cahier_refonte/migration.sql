-- Refonte NanaPay -> NanoPay alignee sur "NanoPay - Cahier de construction BACKEND".
--
-- ATTENTION : migration DESTRUCTIVE. Le modele de donnees est entierement remplace
-- (commande centrale, Coffre, profil/demande de credit, paiements, QR, reglements...).
-- Les anciennes tables et leurs donnees sont supprimees ; la table _prisma_migrations est
-- conservee. A n'appliquer que sur une base sans donnees a conserver (developpement,
-- staging, ou production avant lancement).

DROP TABLE IF EXISTS "order_deliveries" CASCADE;
DROP TABLE IF EXISTS "merchant_payouts" CASCADE;
DROP TABLE IF EXISTS "bank_credits" CASCADE;
DROP TABLE IF EXISTS "savings_deposits" CASCADE;
DROP TABLE IF EXISTS "savings_plans" CASCADE;
DROP TABLE IF EXISTS "orders" CASCADE;
DROP TABLE IF EXISTS "product_media" CASCADE;
DROP TABLE IF EXISTS "products" CASCADE;
DROP TABLE IF EXISTS "shops" CASCADE;
DROP TABLE IF EXISTS "merchants" CASCADE;
DROP TABLE IF EXISTS "clients" CASCADE;
DROP TABLE IF EXISTS "notifications" CASCADE;
DROP TABLE IF EXISTS "audit_logs" CASCADE;
DROP TABLE IF EXISTS "refresh_tokens" CASCADE;
DROP TABLE IF EXISTS "idempotency_keys" CASCADE;
DROP TABLE IF EXISTS "users" CASCADE;

DROP TYPE IF EXISTS "DeliveryVerificationStatus" CASCADE;
DROP TYPE IF EXISTS "MobileMoneyOperator" CASCADE;
DROP TYPE IF EXISTS "TransferStatus" CASCADE;
DROP TYPE IF EXISTS "ApprovalStatus" CASCADE;
DROP TYPE IF EXISTS "DepositStatus" CASCADE;
DROP TYPE IF EXISTS "BankDossierStatus" CASCADE;
DROP TYPE IF EXISTS "AccountStatus" CASCADE;
DROP TYPE IF EXISTS "PaymentMode" CASCADE;
DROP TYPE IF EXISTS "OrderStatus" CASCADE;
DROP TYPE IF EXISTS "MediaType" CASCADE;
DROP TYPE IF EXISTS "PayoutChannel" CASCADE;
DROP TYPE IF EXISTS "UserRole" CASCADE;

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('CLIENT', 'MERCHANT', 'BANK', 'ADMIN');

-- CreateEnum
CREATE TYPE "ClientStatus" AS ENUM ('ACTIF', 'SUSPENDU');

-- CreateEnum
CREATE TYPE "MerchantStatus" AS ENUM ('EN_ATTENTE', 'VALIDE', 'SUSPENDU');

-- CreateEnum
CREATE TYPE "CreditProfileStatus" AS ENUM ('NON_CONFIGURE', 'EN_ANALYSE', 'VALIDE', 'REFUSE');

-- CreateEnum
CREATE TYPE "CreditRequestStatus" AS ENUM ('BROUILLON', 'ENVOYEE', 'EN_ANALYSE', 'ACCEPTEE', 'REFUSEE');

-- CreateEnum
CREATE TYPE "CreditStatus" AS ENUM ('ACCEPTE', 'EN_ATTENTE_DE_VIREMENT', 'FINANCE', 'TERMINE');

-- CreateEnum
CREATE TYPE "SavingsStatus" AS ENUM ('EN_COURS', 'PROLONGATION', 'ATTEINTE', 'ECHOUEE', 'REMBOURSEE');

-- CreateEnum
CREATE TYPE "VaultStatus" AS ENUM ('PROGRAMME', 'PRELEVEMENT_EN_COURS', 'OBJECTIF_ATTEINT', 'UTILISE', 'BASCULE_VERS_CREDIT');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('INITIE', 'EN_ATTENTE', 'CONFIRME', 'ECHOUE');

-- CreateEnum
CREATE TYPE "PaymentKind" AS ENUM ('SAVINGS_DEPOSIT', 'VAULT_DEBIT', 'SAVINGS_REFUND', 'BANK_TRANSFER', 'MERCHANT_PAYOUT');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('CREEE', 'FINANCEMENT_EN_COURS', 'FINANCEE', 'PRETE_A_LIVRER', 'LIVREE', 'TERMINEE');

-- CreateEnum
CREATE TYPE "FinancingMode" AS ENUM ('SAVINGS', 'VAULT', 'CREDIT');

-- CreateEnum
CREATE TYPE "QrStatus" AS ENUM ('GENERE', 'UTILISE', 'EXPIRE');

-- CreateEnum
CREATE TYPE "SettlementStatus" AS ENUM ('EN_ATTENTE', 'PAYE');

-- CreateEnum
CREATE TYPE "PayoutChannel" AS ENUM ('ORANGE_MONEY', 'CORIS_MONEY', 'VIREMENT_BANCAIRE');

-- CreateEnum
CREATE TYPE "MediaType" AS ENUM ('PHOTO', 'SPOT_PUB');

-- CreateEnum
CREATE TYPE "WebhookEventResult" AS ENUM ('APPLIED', 'IGNORED', 'REJECTED');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clients" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "phone_number" TEXT NOT NULL,
    "cnib_recto_url" TEXT NOT NULL,
    "cnib_verso_url" TEXT NOT NULL,
    "city_id" TEXT,
    "commune_id" TEXT,
    "status" "ClientStatus" NOT NULL DEFAULT 'ACTIF',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "merchants" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "cnib_recto_url" TEXT NOT NULL,
    "cnib_verso_url" TEXT NOT NULL,
    "ifu_rccm_number" TEXT NOT NULL,
    "orange_money_number" TEXT,
    "coris_money_number" TEXT,
    "default_payout_channel" "PayoutChannel" NOT NULL,
    "status" "MerchantStatus" NOT NULL DEFAULT 'EN_ATTENTE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "merchants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "banks" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "banks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cities" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "cities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "communes" (
    "id" TEXT NOT NULL,
    "city_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "communes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stores" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "city_id" TEXT NOT NULL,
    "commune_id" TEXT NOT NULL,
    "address_description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "price" INTEGER NOT NULL,
    "stock" INTEGER NOT NULL,
    "is_published" BOOLEAN NOT NULL DEFAULT true,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_media" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "media_url" TEXT NOT NULL,
    "media_type" "MediaType" NOT NULL,

    CONSTRAINT "product_media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" TEXT NOT NULL,
    "order_number" TEXT NOT NULL,
    "order_seq" SERIAL NOT NULL,
    "client_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "financing_mode" "FinancingMode",
    "status" "OrderStatus" NOT NULL DEFAULT 'CREEE',
    "cancelled_at" TIMESTAMP(3),
    "cancel_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "savings" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "target_amount" INTEGER NOT NULL,
    "saved_amount" INTEGER NOT NULL DEFAULT 0,
    "min_installment" INTEGER NOT NULL,
    "duration_months" INTEGER NOT NULL,
    "extension_months" INTEGER NOT NULL DEFAULT 0,
    "started_at" TIMESTAMP(3),
    "due_date" TIMESTAMP(3),
    "status" "SavingsStatus" NOT NULL DEFAULT 'EN_COURS',
    "penalty_amount" INTEGER NOT NULL DEFAULT 0,
    "refund_amount" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "savings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vaults" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "target_amount" INTEGER NOT NULL,
    "collected_amount" INTEGER NOT NULL DEFAULT 0,
    "monthly_amount" INTEGER NOT NULL,
    "duration_months" INTEGER NOT NULL,
    "salary_debit_authorization_url" TEXT,
    "status" "VaultStatus" NOT NULL DEFAULT 'PROGRAMME',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vaults_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_profiles" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "bank_id" TEXT,
    "employer" TEXT,
    "registration_number" TEXT,
    "bank_authorization_url" TEXT,
    "pay_slips_url" TEXT,
    "status" "CreditProfileStatus" NOT NULL DEFAULT 'NON_CONFIGURE',
    "decision_reason" TEXT,
    "decided_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "credit_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_requests" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "bank_id" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "duration_months" INTEGER NOT NULL,
    "monthly_installment" INTEGER NOT NULL,
    "bank_fee_amount" INTEGER NOT NULL,
    "total_amount_to_wire" INTEGER NOT NULL,
    "status" "CreditRequestStatus" NOT NULL DEFAULT 'ENVOYEE',
    "decision_reason" TEXT,
    "decided_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credit_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credits" (
    "id" TEXT NOT NULL,
    "credit_request_id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "duration_months" INTEGER NOT NULL,
    "monthly_installment" INTEGER NOT NULL,
    "total_amount_to_wire" INTEGER NOT NULL,
    "status" "CreditStatus" NOT NULL DEFAULT 'ACCEPTE',
    "transfer_reference" TEXT,
    "transfer_noted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "savings_id" TEXT,
    "vault_id" TEXT,
    "kind" "PaymentKind" NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'XOF',
    "provider" TEXT,
    "provider_transaction_id" TEXT,
    "payer_reference" TEXT,
    "status" "PaymentStatus" NOT NULL DEFAULT 'INITIE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmed_at" TIMESTAMP(3),

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_events" (
    "id" TEXT NOT NULL,
    "provider_transaction_id" TEXT NOT NULL,
    "order_id" TEXT,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "result" "WebhookEventResult" NOT NULL,
    "reason" TEXT,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qr_tokens" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "status" "QrStatus" NOT NULL DEFAULT 'GENERE',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "qr_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "withdrawals" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "qr_token_id" TEXT NOT NULL,
    "confirmed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "withdrawals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "merchant_settlements" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "gross_amount" INTEGER NOT NULL,
    "commission_rate" DECIMAL(6,4) NOT NULL,
    "commission_amount" INTEGER NOT NULL,
    "net_amount" INTEGER NOT NULL,
    "channel" "PayoutChannel" NOT NULL,
    "payout_reference" TEXT,
    "status" "SettlementStatus" NOT NULL DEFAULT 'EN_ATTENTE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paid_at" TIMESTAMP(3),

    CONSTRAINT "merchant_settlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "actor_role" TEXT,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT,
    "amount" INTEGER,
    "status" TEXT,
    "metadata" JSONB,
    "ip_address" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updated_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "response_body" JSONB,
    "status_code" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "clients_user_id_key" ON "clients"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "merchants_user_id_key" ON "merchants"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "banks_user_id_key" ON "banks"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "cities_name_key" ON "cities"("name");

-- CreateIndex
CREATE UNIQUE INDEX "communes_city_id_name_key" ON "communes"("city_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "stores_merchant_id_key" ON "stores"("merchant_id");

-- CreateIndex
CREATE INDEX "stores_city_id_commune_id_idx" ON "stores"("city_id", "commune_id");

-- CreateIndex
CREATE INDEX "products_store_id_idx" ON "products"("store_id");

-- CreateIndex
CREATE UNIQUE INDEX "orders_order_number_key" ON "orders"("order_number");

-- CreateIndex
CREATE UNIQUE INDEX "orders_order_seq_key" ON "orders"("order_seq");

-- CreateIndex
CREATE INDEX "orders_client_id_idx" ON "orders"("client_id");

-- CreateIndex
CREATE INDEX "orders_store_id_idx" ON "orders"("store_id");

-- CreateIndex
CREATE UNIQUE INDEX "savings_order_id_key" ON "savings"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "vaults_order_id_key" ON "vaults"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "credit_profiles_client_id_key" ON "credit_profiles"("client_id");

-- CreateIndex
CREATE UNIQUE INDEX "credit_requests_order_id_key" ON "credit_requests"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "credits_credit_request_id_key" ON "credits"("credit_request_id");

-- CreateIndex
CREATE UNIQUE INDEX "credits_order_id_key" ON "credits"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_provider_transaction_id_key" ON "payments"("provider_transaction_id");

-- CreateIndex
CREATE INDEX "payments_order_id_idx" ON "payments"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_events_provider_transaction_id_key" ON "payment_events"("provider_transaction_id");

-- CreateIndex
CREATE UNIQUE INDEX "qr_tokens_token_key" ON "qr_tokens"("token");

-- CreateIndex
CREATE INDEX "qr_tokens_order_id_idx" ON "qr_tokens"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "withdrawals_order_id_key" ON "withdrawals"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "merchant_settlements_order_id_key" ON "merchant_settlements"("order_id");

-- CreateIndex
CREATE INDEX "notifications_user_id_created_at_idx" ON "notifications"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_keys_key_key" ON "idempotency_keys"("key");

-- AddForeignKey
ALTER TABLE "clients" ADD CONSTRAINT "clients_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clients" ADD CONSTRAINT "clients_city_id_fkey" FOREIGN KEY ("city_id") REFERENCES "cities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clients" ADD CONSTRAINT "clients_commune_id_fkey" FOREIGN KEY ("commune_id") REFERENCES "communes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchants" ADD CONSTRAINT "merchants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "banks" ADD CONSTRAINT "banks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communes" ADD CONSTRAINT "communes_city_id_fkey" FOREIGN KEY ("city_id") REFERENCES "cities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stores" ADD CONSTRAINT "stores_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stores" ADD CONSTRAINT "stores_city_id_fkey" FOREIGN KEY ("city_id") REFERENCES "cities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stores" ADD CONSTRAINT "stores_commune_id_fkey" FOREIGN KEY ("commune_id") REFERENCES "communes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_media" ADD CONSTRAINT "product_media_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "savings" ADD CONSTRAINT "savings_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vaults" ADD CONSTRAINT "vaults_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_profiles" ADD CONSTRAINT "credit_profiles_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_profiles" ADD CONSTRAINT "credit_profiles_bank_id_fkey" FOREIGN KEY ("bank_id") REFERENCES "banks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_requests" ADD CONSTRAINT "credit_requests_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_requests" ADD CONSTRAINT "credit_requests_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_requests" ADD CONSTRAINT "credit_requests_bank_id_fkey" FOREIGN KEY ("bank_id") REFERENCES "banks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credits" ADD CONSTRAINT "credits_credit_request_id_fkey" FOREIGN KEY ("credit_request_id") REFERENCES "credit_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credits" ADD CONSTRAINT "credits_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_savings_id_fkey" FOREIGN KEY ("savings_id") REFERENCES "savings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_vault_id_fkey" FOREIGN KEY ("vault_id") REFERENCES "vaults"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qr_tokens" ADD CONSTRAINT "qr_tokens_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchant_settlements" ADD CONSTRAINT "merchant_settlements_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchant_settlements" ADD CONSTRAINT "merchant_settlements_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

