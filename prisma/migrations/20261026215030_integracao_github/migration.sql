-- CreateEnum
CREATE TYPE "EstadoIssueGitHub" AS ENUM ('ABERTA', 'FECHADA');

-- CreateEnum
CREATE TYPE "EstadoPullRequestGitHub" AS ENUM ('ABERTO', 'FECHADO', 'MERGEADO');

-- CreateEnum
CREATE TYPE "ResumoDeChecks" AS ENUM ('SUCESSO', 'FALHA', 'PENDENTE', 'SEM_CHECKS');

-- CreateTable
CREATE TABLE "IntegracaoGitHub" (
    "id" TEXT NOT NULL,
    "fonte" TEXT NOT NULL,
    "configurada" BOOLEAN NOT NULL,
    "catalogoSincronizadoEm" TIMESTAMP(3),
    "ultimaFalhaEm" TIMESTAMP(3),
    "ultimaFalhaMotivo" TEXT,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntegracaoGitHub_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RepositorioGitHub" (
    "id" TEXT NOT NULL,
    "githubId" BIGINT NOT NULL,
    "instalacaoId" BIGINT NOT NULL,
    "nomeCompleto" TEXT NOT NULL,
    "urlHtml" TEXT NOT NULL,
    "privado" BOOLEAN NOT NULL,
    "arquivadoNoGitHub" BOOLEAN NOT NULL DEFAULT false,
    "removidoDaInstalacaoEm" TIMESTAMP(3),
    "projetoId" TEXT,
    "vinculadoEm" TIMESTAMP(3),
    "sincronizadoEm" TIMESTAMP(3),
    "sincronizacaoSolicitadaEm" TIMESTAMP(3),
    "ultimaFalhaEm" TIMESTAMP(3),
    "ultimaFalhaMotivo" TEXT,
    "falhasConsecutivas" INTEGER NOT NULL DEFAULT 0,
    "cursorIssues" TIMESTAMP(3),
    "cursorPullRequests" TIMESTAMP(3),
    "catalogadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RepositorioGitHub_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IssueGitHub" (
    "id" TEXT NOT NULL,
    "githubId" BIGINT NOT NULL,
    "repositorioId" TEXT NOT NULL,
    "numero" INTEGER NOT NULL,
    "titulo" TEXT NOT NULL,
    "corpo" TEXT,
    "estado" "EstadoIssueGitHub" NOT NULL,
    "autor" TEXT,
    "responsaveis" TEXT[],
    "rotulos" TEXT[],
    "urlHtml" TEXT NOT NULL,
    "criadaNoGitHub" TIMESTAMP(3) NOT NULL,
    "atualizadaNoGitHub" TIMESTAMP(3) NOT NULL,
    "fechadaNoGitHub" TIMESTAMP(3),
    "sincronizadaEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IssueGitHub_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PullRequestGitHub" (
    "id" TEXT NOT NULL,
    "githubId" BIGINT NOT NULL,
    "repositorioId" TEXT NOT NULL,
    "numero" INTEGER NOT NULL,
    "titulo" TEXT NOT NULL,
    "estado" "EstadoPullRequestGitHub" NOT NULL,
    "rascunho" BOOLEAN NOT NULL,
    "autor" TEXT,
    "urlHtml" TEXT NOT NULL,
    "branch" TEXT NOT NULL,
    "shaHead" TEXT NOT NULL,
    "issuesReferenciadas" INTEGER[],
    "checks" "ResumoDeChecks" NOT NULL DEFAULT 'SEM_CHECKS',
    "checksAtualizadosEm" TIMESTAMP(3),
    "atualizadoNoGitHub" TIMESTAMP(3) NOT NULL,
    "mergeadoNoGitHub" TIMESTAMP(3),
    "sincronizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PullRequestGitHub_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RepositorioGitHub_githubId_key" ON "RepositorioGitHub"("githubId");

-- CreateIndex
CREATE INDEX "RepositorioGitHub_projetoId_idx" ON "RepositorioGitHub"("projetoId");

-- CreateIndex
CREATE UNIQUE INDEX "IssueGitHub_githubId_key" ON "IssueGitHub"("githubId");

-- CreateIndex
CREATE UNIQUE INDEX "IssueGitHub_repositorioId_numero_key" ON "IssueGitHub"("repositorioId", "numero");

-- CreateIndex
CREATE UNIQUE INDEX "PullRequestGitHub_githubId_key" ON "PullRequestGitHub"("githubId");

-- CreateIndex
CREATE UNIQUE INDEX "PullRequestGitHub_repositorioId_numero_key" ON "PullRequestGitHub"("repositorioId", "numero");

-- AddForeignKey
ALTER TABLE "RepositorioGitHub" ADD CONSTRAINT "RepositorioGitHub_projetoId_fkey" FOREIGN KEY ("projetoId") REFERENCES "Projeto"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueGitHub" ADD CONSTRAINT "IssueGitHub_repositorioId_fkey" FOREIGN KEY ("repositorioId") REFERENCES "RepositorioGitHub"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PullRequestGitHub" ADD CONSTRAINT "PullRequestGitHub_repositorioId_fkey" FOREIGN KEY ("repositorioId") REFERENCES "RepositorioGitHub"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
