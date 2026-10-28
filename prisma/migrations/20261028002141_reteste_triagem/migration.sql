-- CreateEnum
CREATE TYPE "TipoTarefaGitHub" AS ENUM ('REABRIR_ISSUE', 'CRIAR_ISSUE');

-- CreateEnum
CREATE TYPE "EstadoTarefaGitHub" AS ENUM ('PENDENTE', 'CONCLUIDA', 'FALHOU');

-- AlterTable
ALTER TABLE "Homologacao" ADD COLUMN     "aprovadaEm" TIMESTAMP(3),
ADD COLUMN     "aprovadaPorId" TEXT,
ADD COLUMN     "versoesAprovadasIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "SolicitacaoDeCorrecao" ADD COLUMN     "resolvidaEm" TIMESTAMP(3),
ADD COLUMN     "triadaEm" TIMESTAMP(3),
ADD COLUMN     "triadaPorId" TEXT,
ADD COLUMN     "versaoDaResolucaoId" TEXT;

-- CreateTable
CREATE TABLE "TarefaGitHub" (
    "id" TEXT NOT NULL,
    "tipo" "TipoTarefaGitHub" NOT NULL,
    "repositorioId" TEXT NOT NULL,
    "dados" JSONB NOT NULL,
    "estado" "EstadoTarefaGitHub" NOT NULL DEFAULT 'PENDENTE',
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "resultado" JSONB,
    "falhaMotivo" TEXT,
    "solicitadaPorId" TEXT NOT NULL,
    "criadaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "concluidaEm" TIMESTAMP(3),
    "solicitacaoId" TEXT,
    "iniciadaEm" TIMESTAMP(3),
    "proximaTentativaEm" TIMESTAMP(3),

    CONSTRAINT "TarefaGitHub_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TarefaGitHub_estado_proximaTentativaEm_idx" ON "TarefaGitHub"("estado", "proximaTentativaEm");

-- CreateIndex
CREATE INDEX "TarefaGitHub_solicitacaoId_idx" ON "TarefaGitHub"("solicitacaoId");

-- AddForeignKey
ALTER TABLE "Homologacao" ADD CONSTRAINT "Homologacao_aprovadaPorId_fkey" FOREIGN KEY ("aprovadaPorId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SolicitacaoDeCorrecao" ADD CONSTRAINT "SolicitacaoDeCorrecao_triadaPorId_fkey" FOREIGN KEY ("triadaPorId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SolicitacaoDeCorrecao" ADD CONSTRAINT "SolicitacaoDeCorrecao_versaoDaResolucaoId_fkey" FOREIGN KEY ("versaoDaResolucaoId") REFERENCES "Versao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TarefaGitHub" ADD CONSTRAINT "TarefaGitHub_repositorioId_fkey" FOREIGN KEY ("repositorioId") REFERENCES "RepositorioGitHub"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TarefaGitHub" ADD CONSTRAINT "TarefaGitHub_solicitadaPorId_fkey" FOREIGN KEY ("solicitadaPorId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TarefaGitHub" ADD CONSTRAINT "TarefaGitHub_solicitacaoId_fkey" FOREIGN KEY ("solicitacaoId") REFERENCES "SolicitacaoDeCorrecao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
