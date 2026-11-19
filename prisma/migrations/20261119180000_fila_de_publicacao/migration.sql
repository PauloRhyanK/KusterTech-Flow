-- CreateEnum
CREATE TYPE "ModoDePublicacao" AS ENUM ('IMEDIATO', 'LOTE');

-- CreateEnum
CREATE TYPE "EstadoDoPedidoDePublicacao" AS ENUM ('NA_FILA', 'VERIFICANDO', 'PUBLICANDO', 'PUBLICADO', 'RECUSADO', 'DISPENSADO', 'FALHOU', 'CANCELADO');

-- CreateEnum
CREATE TYPE "SituacaoDaFilaDePublicacao" AS ENUM ('NORMAL', 'CONSERTANDO', 'PARADO');

-- CreateEnum
CREATE TYPE "EstadoDoPedidoDeConserto" AS ENUM ('ABERTO', 'EM_CURSO', 'COM_PR', 'RESOLVIDO', 'DESISTIU');

-- CreateTable
CREATE TABLE "ConfiguracaoDePublicacao" (
    "repositorioId" TEXT NOT NULL,
    "workflow" TEXT NOT NULL,
    "entradaDoCommit" TEXT NOT NULL DEFAULT 'commit',
    "horaDoLote" TEXT NOT NULL DEFAULT '22:00',
    "modoPadrao" "ModoDePublicacao" NOT NULL DEFAULT 'IMEDIATO',
    "automatico" BOOLEAN NOT NULL DEFAULT true,
    "pausado" BOOLEAN NOT NULL DEFAULT false,
    "situacao" "SituacaoDaFilaDePublicacao" NOT NULL DEFAULT 'NORMAL',
    "situacaoDesde" TIMESTAMP(3),
    "situacaoMotivo" TEXT,
    "ultimoLoteEm" TIMESTAMP(3),
    "baseRedefinidaEm" TIMESTAMP(3),
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConfiguracaoDePublicacao_pkey" PRIMARY KEY ("repositorioId")
);

-- CreateTable
CREATE TABLE "PausaGeralDePublicacao" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "pausadaEm" TIMESTAMP(3),
    "pausadaPorId" TEXT,

    CONSTRAINT "PausaGeralDePublicacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FonteDePublicacao" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revogadaEm" TIMESTAMP(3),
    "criadaPorId" TEXT NOT NULL,
    "ultimoUsoEm" TIMESTAMP(3),

    CONSTRAINT "FonteDePublicacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PedidoDePublicacao" (
    "id" TEXT NOT NULL,
    "repositorioId" TEXT NOT NULL,
    "commit" TEXT,
    "modo" "ModoDePublicacao" NOT NULL,
    "descricao" TEXT,
    "fonteId" TEXT,
    "usuarioId" TEXT,
    "consertoId" TEXT,
    "estado" "EstadoDoPedidoDePublicacao" NOT NULL DEFAULT 'NA_FILA',
    "motivo" TEXT,
    "atendidoPorId" TEXT,
    "verificadoContra" TEXT,
    "execucaoId" BIGINT,
    "execucaoUrl" TEXT,
    "disparoTentadoEm" TIMESTAMP(3),
    "checks" "ResumoDeChecks",
    "loteEm" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verificandoDesde" TIMESTAMP(3),
    "iniciadoEm" TIMESTAMP(3),
    "concluidoEm" TIMESTAMP(3),

    CONSTRAINT "PedidoDePublicacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PedidoDeConserto" (
    "id" TEXT NOT NULL,
    "repositorioId" TEXT NOT NULL,
    "pedidoId" TEXT NOT NULL,
    "commit" TEXT NOT NULL,
    "execucaoUrl" TEXT,
    "trechoDoLog" TEXT NOT NULL,
    "estado" "EstadoDoPedidoDeConserto" NOT NULL DEFAULT 'ABERTO',
    "runId" TEXT,
    "prUrl" TEXT,
    "motivo" TEXT,
    "shaDaCorrecao" TEXT,
    "abertoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pegoEm" TIMESTAMP(3),
    "encerradoEm" TIMESTAMP(3),

    CONSTRAINT "PedidoDeConserto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FonteDePublicacao_tokenHash_key" ON "FonteDePublicacao"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "PedidoDePublicacao_consertoId_key" ON "PedidoDePublicacao"("consertoId");

-- CreateIndex
CREATE INDEX "PedidoDePublicacao_repositorioId_estado_idx" ON "PedidoDePublicacao"("repositorioId", "estado");

-- CreateIndex
CREATE UNIQUE INDEX "PedidoDeConserto_pedidoId_key" ON "PedidoDeConserto"("pedidoId");

-- CreateIndex
CREATE INDEX "PedidoDeConserto_estado_idx" ON "PedidoDeConserto"("estado");

-- AddForeignKey
ALTER TABLE "ConfiguracaoDePublicacao" ADD CONSTRAINT "ConfiguracaoDePublicacao_repositorioId_fkey" FOREIGN KEY ("repositorioId") REFERENCES "RepositorioGitHub"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FonteDePublicacao" ADD CONSTRAINT "FonteDePublicacao_criadaPorId_fkey" FOREIGN KEY ("criadaPorId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PedidoDePublicacao" ADD CONSTRAINT "PedidoDePublicacao_repositorioId_fkey" FOREIGN KEY ("repositorioId") REFERENCES "RepositorioGitHub"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PedidoDePublicacao" ADD CONSTRAINT "PedidoDePublicacao_fonteId_fkey" FOREIGN KEY ("fonteId") REFERENCES "FonteDePublicacao"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PedidoDePublicacao" ADD CONSTRAINT "PedidoDePublicacao_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PedidoDeConserto" ADD CONSTRAINT "PedidoDeConserto_repositorioId_fkey" FOREIGN KEY ("repositorioId") REFERENCES "RepositorioGitHub"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PedidoDeConserto" ADD CONSTRAINT "PedidoDeConserto_pedidoId_fkey" FOREIGN KEY ("pedidoId") REFERENCES "PedidoDePublicacao"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Um pedido por vez por repositório: só um candidato VERIFICANDO|PUBLICANDO sem ser atendido por outro.
CREATE UNIQUE INDEX "PedidoDePublicacao_um_por_vez" ON "PedidoDePublicacao" ("repositorioId") WHERE "estado" IN ('VERIFICANDO','PUBLICANDO') AND "atendidoPorId" IS NULL;
