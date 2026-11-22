-- CreateEnum
CREATE TYPE "AutorDaMensagem" AS ENUM ('PAULO', 'AGENTE', 'FLOW');
-- CreateEnum
CREATE TYPE "EstadoDoCartao" AS ENUM ('PROPOSTO', 'CONFIRMANDO', 'CONFIRMADO', 'SUBSTITUIDO');
-- AlterTable
ALTER TABLE "FonteDaFabrica" ADD COLUMN     "conversasBuscadasEm" TIMESTAMP(3);
-- CreateTable
CREATE TABLE "Conversa" (
    "id" TEXT NOT NULL,
    "chave" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "demandaId" TEXT,
    "issueUrl" TEXT,
    "repositorio" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "contexto" JSONB NOT NULL,
    "aguardaAgenteDesde" TIMESTAMP(3),
    "responderA" TEXT,
    "puladaEm" TIMESTAMP(3),
    "adiadaAte" TIMESTAMP(3),
    "guardadaEm" TIMESTAMP(3),
    "encerradaEm" TIMESTAMP(3),
    "encerramento" TEXT,
    "criadaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadaEm" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Conversa_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "Mensagem" (
    "seq" BIGSERIAL NOT NULL,
    "id" TEXT NOT NULL,
    "conversaId" TEXT NOT NULL,
    "autor" "AutorDaMensagem" NOT NULL,
    "texto" TEXT NOT NULL,
    "respostaRapida" TEXT,
    "respostasRapidas" JSONB NOT NULL DEFAULT '[]',
    "emRespostaA" TEXT,
    "impressao" TEXT NOT NULL,
    "usuarioId" TEXT,
    "criadaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Mensagem_pkey" PRIMARY KEY ("seq")
);
-- CreateTable
CREATE TABLE "AnexoDaMensagem" (
    "id" TEXT NOT NULL,
    "conversaId" TEXT NOT NULL,
    "mensagemId" TEXT,
    "nome" TEXT NOT NULL,
    "conteudo" TEXT NOT NULL,
    "tamanho" INTEGER NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AnexoDaMensagem_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "CartaoDeFecho" (
    "id" TEXT NOT NULL,
    "conversaId" TEXT NOT NULL,
    "mensagemSeq" BIGINT,
    "origem" TEXT NOT NULL,
    "conteudo" JSONB NOT NULL,
    "estado" "EstadoDoCartao" NOT NULL DEFAULT 'PROPOSTO',
    "progresso" JSONB NOT NULL DEFAULT '{}',
    "erro" TEXT,
    "confirmandoEm" TIMESTAMP(3),
    "confirmadoEm" TIMESTAMP(3),
    "confirmadoPorId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CartaoDeFecho_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE UNIQUE INDEX "Conversa_chave_key" ON "Conversa"("chave");
-- CreateIndex
CREATE INDEX "Conversa_encerradaEm_aguardaAgenteDesde_idx" ON "Conversa"("encerradaEm", "aguardaAgenteDesde");
-- CreateIndex
CREATE UNIQUE INDEX "Mensagem_id_key" ON "Mensagem"("id");
-- CreateIndex
CREATE INDEX "Mensagem_conversaId_seq_idx" ON "Mensagem"("conversaId", "seq");
-- CreateIndex
CREATE INDEX "AnexoDaMensagem_conversaId_idx" ON "AnexoDaMensagem"("conversaId");
-- CreateIndex
CREATE INDEX "CartaoDeFecho_conversaId_estado_idx" ON "CartaoDeFecho"("conversaId", "estado");
-- AddForeignKey
ALTER TABLE "Conversa" ADD CONSTRAINT "Conversa_demandaId_fkey" FOREIGN KEY ("demandaId") REFERENCES "Demanda"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "Mensagem" ADD CONSTRAINT "Mensagem_conversaId_fkey" FOREIGN KEY ("conversaId") REFERENCES "Conversa"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "Mensagem" ADD CONSTRAINT "Mensagem_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "AnexoDaMensagem" ADD CONSTRAINT "AnexoDaMensagem_conversaId_fkey" FOREIGN KEY ("conversaId") REFERENCES "Conversa"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "CartaoDeFecho" ADD CONSTRAINT "CartaoDeFecho_conversaId_fkey" FOREIGN KEY ("conversaId") REFERENCES "Conversa"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "CartaoDeFecho" ADD CONSTRAINT "CartaoDeFecho_confirmadoPorId_fkey" FOREIGN KEY ("confirmadoPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- No máximo um cartão aberto (PROPOSTO ou CONFIRMANDO) por conversa
CREATE UNIQUE INDEX "CartaoDeFecho_um_aberto_por_conversa" ON "CartaoDeFecho"("conversaId") WHERE "estado" IN ('PROPOSTO', 'CONFIRMANDO');
