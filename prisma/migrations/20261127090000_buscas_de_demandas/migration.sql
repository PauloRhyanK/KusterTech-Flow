-- CreateEnum
CREATE TYPE "EstadoDaBusca" AS ENUM ('PENDENTE', 'EM_CURSO', 'CONCLUIDA', 'FALHOU');

-- CreateTable
CREATE TABLE "BuscaDeDemandas" (
    "id" TEXT NOT NULL,
    "pergunta" TEXT NOT NULL,
    "perguntaNormalizada" TEXT NOT NULL,
    "pedidaPorId" TEXT,
    "loteIds" TEXT[],
    "chaveDoLote" TEXT NOT NULL,
    "tokensDoLote" INTEGER NOT NULL,
    "estado" "EstadoDaBusca" NOT NULL DEFAULT 'PENDENTE',
    "buscadaEm" TIMESTAMP(3),
    "respostaId" TEXT,
    "impressao" TEXT,
    "resumo" TEXT,
    "itens" JSONB NOT NULL DEFAULT '[]',
    "falha" TEXT,
    "modelo" TEXT,
    "tokensEntrada" INTEGER,
    "tokensSaida" INTEGER,
    "custoUsd" DOUBLE PRECISION,
    "criadaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "concluidaEm" TIMESTAMP(3),

    CONSTRAINT "BuscaDeDemandas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BuscaDeDemandas_respostaId_key" ON "BuscaDeDemandas"("respostaId");

-- CreateIndex
CREATE INDEX "BuscaDeDemandas_estado_criadaEm_idx" ON "BuscaDeDemandas"("estado", "criadaEm");

-- CreateIndex
CREATE INDEX "BuscaDeDemandas_perguntaNormalizada_chaveDoLote_criadaEm_idx" ON "BuscaDeDemandas"("perguntaNormalizada", "chaveDoLote", "criadaEm");

-- AddForeignKey
ALTER TABLE "BuscaDeDemandas" ADD CONSTRAINT "BuscaDeDemandas_pedidaPorId_fkey" FOREIGN KEY ("pedidaPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
