-- CreateTable
CREATE TABLE "IntervaloDaFabrica" (
    "id" TEXT NOT NULL,
    "fonteId" TEXT,
    "repositorio" TEXT NOT NULL,
    "chave" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "papel" TEXT,
    "etapa" TEXT,
    "inicio" TIMESTAMP(3) NOT NULL,
    "fim" TIMESTAMP(3),
    "custoUsd" DECIMAL(12,4),
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntervaloDaFabrica_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IntervaloDaFabrica_chave_key" ON "IntervaloDaFabrica"("chave");

-- CreateIndex
CREATE INDEX "IntervaloDaFabrica_tipo_papel_idx" ON "IntervaloDaFabrica"("tipo", "papel");
