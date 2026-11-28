-- Fábrica 2.0 (M2b): evidências de gate por SHA e tarefas de verificar/revisar. Só acréscimos.

-- AlterTable
ALTER TABLE "EtapaOperacional" ADD COLUMN     "headSha" TEXT,
ADD COLUMN     "verificacao" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "ExecucaoOperacional" ADD COLUMN     "finalidade" TEXT NOT NULL DEFAULT 'executar',
ADD COLUMN     "sha" TEXT;

-- CreateTable
CREATE TABLE "EvidenciaDaEtapa" (
    "id" TEXT NOT NULL,
    "etapaId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "sha" TEXT NOT NULL,
    "dados" JSONB NOT NULL,
    "execucaoId" TEXT,
    "criadaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvidenciaDaEtapa_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EvidenciaDaEtapa_etapaId_tipo_sha_key" ON "EvidenciaDaEtapa"("etapaId", "tipo", "sha");

-- AddForeignKey
ALTER TABLE "EvidenciaDaEtapa" ADD CONSTRAINT "EvidenciaDaEtapa_etapaId_fkey" FOREIGN KEY ("etapaId") REFERENCES "EtapaOperacional"("id") ON DELETE CASCADE ON UPDATE CASCADE;

