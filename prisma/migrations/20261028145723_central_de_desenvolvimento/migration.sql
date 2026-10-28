-- CreateEnum
CREATE TYPE "EstadoExecucao" AS ENUM ('NA_FILA', 'AGUARDANDO_CAPACIDADE', 'AGUARDANDO_DEPENDENCIA', 'EXECUTANDO', 'INTERVENCAO_NECESSARIA', 'CONCLUIDA', 'SEM_DADOS');

-- CreateEnum
CREATE TYPE "StatusDeSeed" AS ENUM ('ABERTA', 'EM_ANDAMENTO', 'FECHADA');

-- AlterTable
ALTER TABLE "PullRequestGitHub" ADD COLUMN     "corpo" TEXT,
ADD COLUMN     "criadoNoGitHub" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "RepositorioGitHub" ADD COLUMN     "seedsEncontrado" BOOLEAN,
ADD COLUMN     "seedsLinhasInvalidas" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "warrenFalhaEm" TIMESTAMP(3),
ADD COLUMN     "warrenFalhaMotivo" TEXT,
ADD COLUMN     "warrenLidoEm" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ExecucaoAgente" (
    "id" TEXT NOT NULL,
    "repositorioId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "seedId" TEXT,
    "papel" TEXT,
    "agente" TEXT,
    "estado" "EstadoExecucao" NOT NULL,
    "motivoDoEstado" TEXT NOT NULL,
    "iniciadaEm" TIMESTAMP(3),
    "atualizadaEm" TIMESTAMP(3) NOT NULL,
    "sincronizadaEm" TIMESTAMP(3) NOT NULL,
    "pullRequestId" TEXT,
    "custo" DECIMAL(12,4),
    "fonte" TEXT NOT NULL,

    CONSTRAINT "ExecucaoAgente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SeedDoRepositorio" (
    "id" TEXT NOT NULL,
    "repositorioId" TEXT NOT NULL,
    "seedId" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "status" "StatusDeSeed" NOT NULL,
    "tipo" TEXT NOT NULL,
    "planoId" TEXT,
    "planoNome" TEXT,
    "bloqueadaPor" TEXT[],
    "atualizadaNoSeeds" TIMESTAMP(3),
    "ausenteDesde" TIMESTAMP(3),
    "lidaEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SeedDoRepositorio_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ExecucaoAgente_runId_key" ON "ExecucaoAgente"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "ExecucaoAgente_pullRequestId_key" ON "ExecucaoAgente"("pullRequestId");

-- CreateIndex
CREATE INDEX "ExecucaoAgente_repositorioId_seedId_idx" ON "ExecucaoAgente"("repositorioId", "seedId");

-- CreateIndex
CREATE UNIQUE INDEX "SeedDoRepositorio_repositorioId_seedId_key" ON "SeedDoRepositorio"("repositorioId", "seedId");

-- AddForeignKey
ALTER TABLE "ExecucaoAgente" ADD CONSTRAINT "ExecucaoAgente_repositorioId_fkey" FOREIGN KEY ("repositorioId") REFERENCES "RepositorioGitHub"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExecucaoAgente" ADD CONSTRAINT "ExecucaoAgente_pullRequestId_fkey" FOREIGN KEY ("pullRequestId") REFERENCES "PullRequestGitHub"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeedDoRepositorio" ADD CONSTRAINT "SeedDoRepositorio_repositorioId_fkey" FOREIGN KEY ("repositorioId") REFERENCES "RepositorioGitHub"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
