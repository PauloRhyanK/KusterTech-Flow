-- CreateEnum
CREATE TYPE "TipoAmbiente" AS ENUM ('DEV', 'QA', 'PROD');

-- CreateEnum
CREATE TYPE "OrigemEvidencia" AS ENUM ('GITHUB_DEPLOYMENT', 'ENDPOINT', 'MANUAL');

-- CreateEnum
CREATE TYPE "SituacaoEvidencia" AS ENUM ('SUCESSO', 'FALHA', 'EM_ANDAMENTO');

-- CreateEnum
CREATE TYPE "EstadoImplantacao" AS ENUM ('SEM_EVIDENCIA', 'PRESENCA_CONFIRMADA', 'CONFIRMACAO_MANUAL', 'VERIFICACAO_NECESSARIA');

-- AlterTable
ALTER TABLE "RepositorioGitHub" ADD COLUMN     "cursorDeployments" TIMESTAMP(3),
ADD COLUMN     "deploymentsFalhaEm" TIMESTAMP(3),
ADD COLUMN     "deploymentsFalhaMotivo" TEXT,
ADD COLUMN     "deploymentsSincronizadosEm" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "PullRequestGitHub" ADD COLUMN     "shaMerge" TEXT;

-- CreateTable
CREATE TABLE "Ambiente" (
    "id" TEXT NOT NULL,
    "projetoId" TEXT NOT NULL,
    "tipo" "TipoAmbiente" NOT NULL,
    "nomeNoGitHub" TEXT,
    "url" TEXT,
    "tokenEvidenciaHash" TEXT,
    "tokenCriadoEm" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Ambiente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Versao" (
    "id" TEXT NOT NULL,
    "projetoId" TEXT NOT NULL,
    "repositorioId" TEXT NOT NULL,
    "commitSha" TEXT NOT NULL,
    "rotulo" TEXT NOT NULL,
    "criadaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Versao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvidenciaDeploy" (
    "id" TEXT NOT NULL,
    "ambienteId" TEXT NOT NULL,
    "versaoId" TEXT NOT NULL,
    "origem" "OrigemEvidencia" NOT NULL,
    "situacao" "SituacaoEvidencia" NOT NULL,
    "ocorridaEm" TIMESTAMP(3) NOT NULL,
    "registradaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "autorId" TEXT,
    "idExterno" TEXT,
    "detalhe" TEXT,

    CONSTRAINT "EvidenciaDeploy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PresencaIssueVersao" (
    "issueId" TEXT NOT NULL,
    "versaoId" TEXT NOT NULL,
    "estado" "EstadoImplantacao" NOT NULL,
    "motivo" TEXT NOT NULL,
    "confirmadaPorId" TEXT,
    "calculadaEm" TIMESTAMP(3) NOT NULL,
    "assinaturaEntrada" TEXT NOT NULL,

    CONSTRAINT "PresencaIssueVersao_pkey" PRIMARY KEY ("issueId","versaoId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Ambiente_tokenEvidenciaHash_key" ON "Ambiente"("tokenEvidenciaHash");

-- CreateIndex
CREATE UNIQUE INDEX "Ambiente_projetoId_tipo_key" ON "Ambiente"("projetoId", "tipo");

-- CreateIndex
CREATE INDEX "Versao_projetoId_idx" ON "Versao"("projetoId");

-- CreateIndex
CREATE UNIQUE INDEX "Versao_repositorioId_commitSha_key" ON "Versao"("repositorioId", "commitSha");

-- CreateIndex
CREATE INDEX "EvidenciaDeploy_ambienteId_ocorridaEm_idx" ON "EvidenciaDeploy"("ambienteId", "ocorridaEm");

-- CreateIndex
CREATE INDEX "EvidenciaDeploy_versaoId_idx" ON "EvidenciaDeploy"("versaoId");

-- CreateIndex
CREATE UNIQUE INDEX "EvidenciaDeploy_origem_idExterno_key" ON "EvidenciaDeploy"("origem", "idExterno");

-- CreateIndex
CREATE INDEX "PresencaIssueVersao_versaoId_idx" ON "PresencaIssueVersao"("versaoId");

-- AddForeignKey
ALTER TABLE "Ambiente" ADD CONSTRAINT "Ambiente_projetoId_fkey" FOREIGN KEY ("projetoId") REFERENCES "Projeto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Versao" ADD CONSTRAINT "Versao_projetoId_fkey" FOREIGN KEY ("projetoId") REFERENCES "Projeto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Versao" ADD CONSTRAINT "Versao_repositorioId_fkey" FOREIGN KEY ("repositorioId") REFERENCES "RepositorioGitHub"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenciaDeploy" ADD CONSTRAINT "EvidenciaDeploy_ambienteId_fkey" FOREIGN KEY ("ambienteId") REFERENCES "Ambiente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenciaDeploy" ADD CONSTRAINT "EvidenciaDeploy_versaoId_fkey" FOREIGN KEY ("versaoId") REFERENCES "Versao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenciaDeploy" ADD CONSTRAINT "EvidenciaDeploy_autorId_fkey" FOREIGN KEY ("autorId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PresencaIssueVersao" ADD CONSTRAINT "PresencaIssueVersao_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "IssueGitHub"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PresencaIssueVersao" ADD CONSTRAINT "PresencaIssueVersao_versaoId_fkey" FOREIGN KEY ("versaoId") REFERENCES "Versao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PresencaIssueVersao" ADD CONSTRAINT "PresencaIssueVersao_confirmadaPorId_fkey" FOREIGN KEY ("confirmadaPorId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Decisão 11: força a releitura dos PRs para preencher "shaMerge" dos já mergeados.
UPDATE "RepositorioGitHub" SET "cursorPullRequests" = NULL;
