-- AlterTable
ALTER TABLE "IntegracaoGitHub" ADD COLUMN     "catalogoSolicitadoEm" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "EventoIntegracao" (
    "id" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "evento" TEXT NOT NULL,
    "repositorioGitHubId" BIGINT,
    "recebidoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processadoEm" TIMESTAMP(3),
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "falhaMotivo" TEXT,

    CONSTRAINT "EventoIntegracao_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EventoIntegracao_deliveryId_key" ON "EventoIntegracao"("deliveryId");

-- CreateIndex
CREATE INDEX "EventoIntegracao_processadoEm_recebidoEm_idx" ON "EventoIntegracao"("processadoEm", "recebidoEm");

