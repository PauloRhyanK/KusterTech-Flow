-- CreateEnum
CREATE TYPE "EstadoDoSistema" AS ENUM ('ATIVO', 'DESCONECTADO', 'REVOGADO');

-- CreateEnum
CREATE TYPE "ResultadoDoRelato" AS ENUM ('SEGUE', 'ORIENTADO');

-- CreateEnum
CREATE TYPE "CanalDoRelato" AS ENUM ('SISTEMA', 'WHATSAPP');

-- CreateEnum
CREATE TYPE "SituacaoDoEnvio" AS ENUM ('PENDENTE', 'ENVIADO', 'DESCARTADO');

-- CreateTable
CREATE TABLE "SistemaConectado" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "projetoId" TEXT NOT NULL,
    "repositorioId" TEXT NOT NULL,
    "tokenCifrado" TEXT,
    "cursor" TEXT,
    "estado" "EstadoDoSistema" NOT NULL DEFAULT 'ATIVO',
    "ultimaTentativaEm" TIMESTAMP(3),
    "ultimaBuscaOkEm" TIMESTAMP(3),
    "ultimoErro" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    "revogadoEm" TIMESTAMP(3),

    CONSTRAINT "SistemaConectado_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Relato" (
    "id" TEXT NOT NULL,
    "sistemaId" TEXT NOT NULL,
    "idExterno" TEXT NOT NULL,
    "ticket" TEXT,
    "resultado" "ResultadoDoRelato" NOT NULL,
    "canal" "CanalDoRelato" NOT NULL,
    "em" TIMESTAMP(3) NOT NULL,
    "autorIdExterno" TEXT NOT NULL,
    "autorNome" TEXT NOT NULL,
    "autorPapel" TEXT NOT NULL,
    "texto" TEXT,
    "transcricao" TEXT,
    "tipoSugerido" TEXT,
    "assunto" TEXT,
    "versao" TEXT,
    "demandaId" TEXT,
    "anexos" JSONB NOT NULL DEFAULT '[]',
    "sinais" JSONB NOT NULL DEFAULT '[]',
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Relato_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EnvioDeAndamento" (
    "id" TEXT NOT NULL,
    "relatoId" TEXT NOT NULL,
    "estado" TEXT NOT NULL,
    "mensagem" TEXT NOT NULL,
    "origem" TEXT NOT NULL,
    "situacao" "SituacaoDoEnvio" NOT NULL DEFAULT 'PENDENTE',
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "proximaTentativaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ultimoErro" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "enviadoEm" TIMESTAMP(3),

    CONSTRAINT "EnvioDeAndamento_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SistemaConectado_estado_ultimaTentativaEm_idx" ON "SistemaConectado"("estado", "ultimaTentativaEm");

-- CreateIndex
CREATE INDEX "Relato_demandaId_idx" ON "Relato"("demandaId");

-- CreateIndex
CREATE INDEX "Relato_resultado_em_idx" ON "Relato"("resultado", "em");

-- CreateIndex
CREATE UNIQUE INDEX "Relato_sistemaId_idExterno_key" ON "Relato"("sistemaId", "idExterno");

-- CreateIndex
CREATE INDEX "EnvioDeAndamento_situacao_proximaTentativaEm_idx" ON "EnvioDeAndamento"("situacao", "proximaTentativaEm");

-- CreateIndex
CREATE UNIQUE INDEX "EnvioDeAndamento_relatoId_estado_key" ON "EnvioDeAndamento"("relatoId", "estado");

-- AddForeignKey
ALTER TABLE "SistemaConectado" ADD CONSTRAINT "SistemaConectado_projetoId_fkey" FOREIGN KEY ("projetoId") REFERENCES "Projeto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SistemaConectado" ADD CONSTRAINT "SistemaConectado_repositorioId_fkey" FOREIGN KEY ("repositorioId") REFERENCES "RepositorioGitHub"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Relato" ADD CONSTRAINT "Relato_sistemaId_fkey" FOREIGN KEY ("sistemaId") REFERENCES "SistemaConectado"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Relato" ADD CONSTRAINT "Relato_demandaId_fkey" FOREIGN KEY ("demandaId") REFERENCES "Demanda"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnvioDeAndamento" ADD CONSTRAINT "EnvioDeAndamento_relatoId_fkey" FOREIGN KEY ("relatoId") REFERENCES "Relato"("id") ON DELETE CASCADE ON UPDATE CASCADE;

