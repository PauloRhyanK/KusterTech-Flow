-- CreateTable
CREATE TABLE "FonteDaFabrica" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revogadaEm" TIMESTAMP(3),
    "criadaPorId" TEXT NOT NULL,
    "ultimoUsoEm" TIMESTAMP(3),

    CONSTRAINT "FonteDaFabrica_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RetratoDaFabrica" (
    "fonteId" TEXT NOT NULL,
    "geradoEm" TIMESTAMP(3) NOT NULL,
    "recebidoEm" TIMESTAMP(3) NOT NULL,
    "conteudo" JSONB NOT NULL,

    CONSTRAINT "RetratoDaFabrica_pkey" PRIMARY KEY ("fonteId")
);

-- CreateIndex
CREATE UNIQUE INDEX "FonteDaFabrica_tokenHash_key" ON "FonteDaFabrica"("tokenHash");

-- AddForeignKey
ALTER TABLE "FonteDaFabrica" ADD CONSTRAINT "FonteDaFabrica_criadaPorId_fkey" FOREIGN KEY ("criadaPorId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetratoDaFabrica" ADD CONSTRAINT "RetratoDaFabrica_fonteId_fkey" FOREIGN KEY ("fonteId") REFERENCES "FonteDaFabrica"("id") ON DELETE CASCADE ON UPDATE CASCADE;

