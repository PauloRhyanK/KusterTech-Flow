-- CreateEnum
CREATE TYPE "EstadoComposicao" AS ENUM ('IDENTIFICADA', 'INCERTA');

-- CreateEnum
CREATE TYPE "OrigemDaBase" AS ENUM ('AUTORIZACAO', 'EVIDENCIA_PROD', 'SEM_BASE');

-- CreateEnum
CREATE TYPE "SituacaoItemAutorizacao" AS ENUM ('QA_APROVADO', 'REAPROVEITADO', 'VERIFICADO_POR_HUMANO');

-- CreateTable
CREATE TABLE "ComposicaoDePublicacao" (
    "id" TEXT NOT NULL,
    "projetoId" TEXT NOT NULL,
    "repositorioId" TEXT NOT NULL,
    "versaoAlvoId" TEXT NOT NULL,
    "commitBase" TEXT NOT NULL,
    "commitAlvo" TEXT NOT NULL,
    "origemDaBase" "OrigemDaBase" NOT NULL,
    "hashComposicao" TEXT NOT NULL,
    "estado" "EstadoComposicao" NOT NULL,
    "itens" JSONB NOT NULL,
    "aprovacoesAnteriores" JSONB NOT NULL DEFAULT '[]',
    "calculadaEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComposicaoDePublicacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutorizacaoProd" (
    "id" TEXT NOT NULL,
    "projetoId" TEXT NOT NULL,
    "repositorioId" TEXT NOT NULL,
    "versaoAlvoId" TEXT NOT NULL,
    "composicaoId" TEXT NOT NULL,
    "commitBase" TEXT NOT NULL,
    "hashComposicao" TEXT NOT NULL,
    "autorId" TEXT NOT NULL,
    "justificativa" TEXT,
    "composicaoAutorizada" JSONB NOT NULL,
    "criadaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revogadaEm" TIMESTAMP(3),
    "motivoRevogacao" TEXT,

    CONSTRAINT "AutorizacaoProd_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutorizacaoItem" (
    "autorizacaoId" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "situacao" "SituacaoItemAutorizacao" NOT NULL,

    CONSTRAINT "AutorizacaoItem_pkey" PRIMARY KEY ("autorizacaoId","issueId")
);

-- CreateTable
CREATE TABLE "VerificacaoProd" (
    "id" TEXT NOT NULL,
    "versaoId" TEXT NOT NULL,
    "origem" "OrigemEvidencia" NOT NULL,
    "autorId" TEXT,
    "observacao" TEXT,
    "criadaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VerificacaoProd_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DivergenciaDeDeploy" (
    "id" TEXT NOT NULL,
    "evidenciaId" TEXT NOT NULL,
    "versaoId" TEXT NOT NULL,
    "detectadaEm" TIMESTAMP(3) NOT NULL,
    "reconhecidaPorId" TEXT,
    "reconhecidaEm" TIMESTAMP(3),

    CONSTRAINT "DivergenciaDeDeploy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ComposicaoDePublicacao_repositorioId_calculadaEm_idx" ON "ComposicaoDePublicacao"("repositorioId", "calculadaEm");

-- CreateIndex
CREATE UNIQUE INDEX "ComposicaoDePublicacao_versaoAlvoId_commitBase_key" ON "ComposicaoDePublicacao"("versaoAlvoId", "commitBase");

-- CreateIndex
CREATE INDEX "AutorizacaoProd_composicaoId_idx" ON "AutorizacaoProd"("composicaoId");

-- CreateIndex
CREATE INDEX "AutorizacaoProd_repositorioId_criadaEm_idx" ON "AutorizacaoProd"("repositorioId", "criadaEm");

-- CreateIndex
CREATE INDEX "AutorizacaoProd_versaoAlvoId_idx" ON "AutorizacaoProd"("versaoAlvoId");

-- CreateIndex
CREATE INDEX "AutorizacaoItem_issueId_idx" ON "AutorizacaoItem"("issueId");

-- CreateIndex
CREATE INDEX "VerificacaoProd_versaoId_criadaEm_idx" ON "VerificacaoProd"("versaoId", "criadaEm");

-- CreateIndex
CREATE UNIQUE INDEX "DivergenciaDeDeploy_evidenciaId_key" ON "DivergenciaDeDeploy"("evidenciaId");

-- CreateIndex
CREATE INDEX "DivergenciaDeDeploy_reconhecidaEm_detectadaEm_idx" ON "DivergenciaDeDeploy"("reconhecidaEm", "detectadaEm");

-- CreateIndex
CREATE INDEX "DivergenciaDeDeploy_versaoId_idx" ON "DivergenciaDeDeploy"("versaoId");

-- AddForeignKey
ALTER TABLE "ComposicaoDePublicacao" ADD CONSTRAINT "ComposicaoDePublicacao_projetoId_fkey" FOREIGN KEY ("projetoId") REFERENCES "Projeto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComposicaoDePublicacao" ADD CONSTRAINT "ComposicaoDePublicacao_repositorioId_fkey" FOREIGN KEY ("repositorioId") REFERENCES "RepositorioGitHub"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComposicaoDePublicacao" ADD CONSTRAINT "ComposicaoDePublicacao_versaoAlvoId_fkey" FOREIGN KEY ("versaoAlvoId") REFERENCES "Versao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutorizacaoProd" ADD CONSTRAINT "AutorizacaoProd_projetoId_fkey" FOREIGN KEY ("projetoId") REFERENCES "Projeto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutorizacaoProd" ADD CONSTRAINT "AutorizacaoProd_repositorioId_fkey" FOREIGN KEY ("repositorioId") REFERENCES "RepositorioGitHub"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutorizacaoProd" ADD CONSTRAINT "AutorizacaoProd_composicaoId_fkey" FOREIGN KEY ("composicaoId") REFERENCES "ComposicaoDePublicacao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutorizacaoProd" ADD CONSTRAINT "AutorizacaoProd_versaoAlvoId_fkey" FOREIGN KEY ("versaoAlvoId") REFERENCES "Versao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutorizacaoProd" ADD CONSTRAINT "AutorizacaoProd_autorId_fkey" FOREIGN KEY ("autorId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutorizacaoItem" ADD CONSTRAINT "AutorizacaoItem_autorizacaoId_fkey" FOREIGN KEY ("autorizacaoId") REFERENCES "AutorizacaoProd"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutorizacaoItem" ADD CONSTRAINT "AutorizacaoItem_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "IssueGitHub"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificacaoProd" ADD CONSTRAINT "VerificacaoProd_versaoId_fkey" FOREIGN KEY ("versaoId") REFERENCES "Versao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificacaoProd" ADD CONSTRAINT "VerificacaoProd_autorId_fkey" FOREIGN KEY ("autorId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DivergenciaDeDeploy" ADD CONSTRAINT "DivergenciaDeDeploy_evidenciaId_fkey" FOREIGN KEY ("evidenciaId") REFERENCES "EvidenciaDeploy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DivergenciaDeDeploy" ADD CONSTRAINT "DivergenciaDeDeploy_versaoId_fkey" FOREIGN KEY ("versaoId") REFERENCES "Versao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DivergenciaDeDeploy" ADD CONSTRAINT "DivergenciaDeDeploy_reconhecidaPorId_fkey" FOREIGN KEY ("reconhecidaPorId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

