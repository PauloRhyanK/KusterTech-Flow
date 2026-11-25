-- CreateEnum
CREATE TYPE "EstadoDaParte" AS ENUM ('PLANEJANDO', 'EM_CURSO', 'FEITA', 'PUBLICANDO', 'NO_AR', 'NAO_CHEGOU', 'DESCARTADA');

-- CreateEnum
CREATE TYPE "ChegadaAoAr" AS ENUM ('PUBLICACAO', 'VERSAO');

-- AlterEnum
ALTER TYPE "QuemConcluiEtapa" ADD VALUE 'FLOW';

-- AlterTable
ALTER TABLE "Demanda" ADD COLUMN     "naoChegouDesde" TIMESTAMP(3),
ADD COLUMN     "noArEm" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "PedidoDeConserto" ADD COLUMN     "demandaId" TEXT,
ADD COLUMN     "parteId" TEXT;

-- AlterTable
ALTER TABLE "PedidoDePublicacao" ADD COLUMN     "parteId" TEXT;

-- CreateTable
CREATE TABLE "ParteDaDemanda" (
    "id" TEXT NOT NULL,
    "demandaId" TEXT NOT NULL,
    "chave" TEXT NOT NULL,
    "repositorioId" TEXT NOT NULL,
    "objetivo" TEXT,
    "ordem" INTEGER NOT NULL,
    "dependeDe" TEXT[],
    "chegaAoAr" "ChegadaAoAr" NOT NULL DEFAULT 'PUBLICACAO',
    "estado" "EstadoDaParte" NOT NULL DEFAULT 'PLANEJANDO',
    "planoCaminho" TEXT,
    "planoPrUrl" TEXT,
    "prs" JSONB NOT NULL DEFAULT '[]',
    "commitAlvo" TEXT,
    "pedidoId" TEXT,
    "motivo" TEXT,
    "sobeParaVersao" TEXT,
    "feitaEm" TIMESTAMP(3),
    "naoChegouEm" TIMESTAMP(3),
    "noArEm" TIMESTAMP(3),
    "commitNoAr" TEXT,
    "conferidaPorId" TEXT,
    "criadaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadaEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ParteDaDemanda_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ParteDaDemanda_repositorioId_estado_idx" ON "ParteDaDemanda"("repositorioId", "estado");

-- CreateIndex
CREATE UNIQUE INDEX "ParteDaDemanda_demandaId_chave_key" ON "ParteDaDemanda"("demandaId", "chave");

-- CreateIndex
CREATE INDEX "PedidoDePublicacao_parteId_idx" ON "PedidoDePublicacao"("parteId");

-- AddForeignKey
ALTER TABLE "PedidoDePublicacao" ADD CONSTRAINT "PedidoDePublicacao_parteId_fkey" FOREIGN KEY ("parteId") REFERENCES "ParteDaDemanda"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PedidoDeConserto" ADD CONSTRAINT "PedidoDeConserto_demandaId_fkey" FOREIGN KEY ("demandaId") REFERENCES "Demanda"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PedidoDeConserto" ADD CONSTRAINT "PedidoDeConserto_parteId_fkey" FOREIGN KEY ("parteId") REFERENCES "ParteDaDemanda"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParteDaDemanda" ADD CONSTRAINT "ParteDaDemanda_demandaId_fkey" FOREIGN KEY ("demandaId") REFERENCES "Demanda"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParteDaDemanda" ADD CONSTRAINT "ParteDaDemanda_repositorioId_fkey" FOREIGN KEY ("repositorioId") REFERENCES "RepositorioGitHub"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParteDaDemanda" ADD CONSTRAINT "ParteDaDemanda_conferidaPorId_fkey" FOREIGN KEY ("conferidaPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
