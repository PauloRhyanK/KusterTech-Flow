-- AlterTable
ALTER TABLE "Demanda" ADD COLUMN     "divididaDeId" TEXT,
ADD COLUMN     "juntadaEmId" TEXT;

-- CreateIndex
CREATE INDEX "Demanda_juntadaEmId_idx" ON "Demanda"("juntadaEmId");

-- CreateIndex
CREATE INDEX "Demanda_divididaDeId_idx" ON "Demanda"("divididaDeId");

-- AddForeignKey
ALTER TABLE "Demanda" ADD CONSTRAINT "Demanda_juntadaEmId_fkey" FOREIGN KEY ("juntadaEmId") REFERENCES "Demanda"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Demanda" ADD CONSTRAINT "Demanda_divididaDeId_fkey" FOREIGN KEY ("divididaDeId") REFERENCES "Demanda"("id") ON DELETE SET NULL ON UPDATE CASCADE;
