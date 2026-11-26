-- Erros do GlitchTip viram demandas (D81).
ALTER TYPE "OrigemDaDemanda" ADD VALUE 'GLITCHTIP';

-- CreateTable
CREATE TABLE "ErroDoGlitchTip" (
    "id" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "projetoGlitchTip" TEXT NOT NULL,
    "repositorioId" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "onde" TEXT,
    "nivel" TEXT NOT NULL,
    "link" TEXT NOT NULL,
    "eventos" INTEGER NOT NULL,
    "usuarios" INTEGER NOT NULL,
    "primeiroEm" TIMESTAMP(3) NOT NULL,
    "ultimoEm" TIMESTAMP(3) NOT NULL,
    "resolvidoEm" TIMESTAMP(3),
    "demandaId" TEXT,
    "demandaAnteriorId" TEXT,
    "esperaDesde" TIMESTAMP(3),
    "serie" JSONB NOT NULL DEFAULT '[]',
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ErroDoGlitchTip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeituraDoGlitchTip" (
    "projetoGlitchTip" TEXT NOT NULL,
    "ultimoSucessoEm" TIMESTAMP(3),
    "ultimaFalhaEm" TIMESTAMP(3),
    "motivo" TEXT,

    CONSTRAINT "LeituraDoGlitchTip_pkey" PRIMARY KEY ("projetoGlitchTip")
);

-- CreateIndex
CREATE UNIQUE INDEX "ErroDoGlitchTip_issueId_key" ON "ErroDoGlitchTip"("issueId");

-- CreateIndex
CREATE INDEX "ErroDoGlitchTip_projetoGlitchTip_resolvidoEm_idx" ON "ErroDoGlitchTip"("projetoGlitchTip", "resolvidoEm");

-- CreateIndex
CREATE INDEX "ErroDoGlitchTip_demandaId_idx" ON "ErroDoGlitchTip"("demandaId");

-- AddForeignKey
ALTER TABLE "ErroDoGlitchTip" ADD CONSTRAINT "ErroDoGlitchTip_repositorioId_fkey" FOREIGN KEY ("repositorioId") REFERENCES "RepositorioGitHub"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErroDoGlitchTip" ADD CONSTRAINT "ErroDoGlitchTip_demandaId_fkey" FOREIGN KEY ("demandaId") REFERENCES "Demanda"("id") ON DELETE SET NULL ON UPDATE CASCADE;
