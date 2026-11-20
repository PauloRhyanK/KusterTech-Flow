-- CreateEnum
CREATE TYPE "NivelDeAcompanhamento" AS ENUM ('PLANEJAR_COMIGO', 'APROVAR_DESENHO', 'VAI_SOZINHO');

-- CreateEnum
CREATE TYPE "DestinoDaDemanda" AS ENUM ('URGENTE', 'LOTE_DA_NOITE', 'FILA_DE_AGENTES', 'DECISAO_DO_PAULO', 'ORIENTADA');

-- CreateEnum
CREATE TYPE "TipoDeDemanda" AS ENUM ('DEFEITO', 'IDEIA', 'AJUSTE', 'FUNCAO_NOVA');

-- CreateEnum
CREATE TYPE "OrigemDaDemanda" AS ENUM ('FLOW', 'SESSAO', 'FABRICA', 'USUARIO');

-- CreateEnum
CREATE TYPE "QuemConcluiEtapa" AS ENUM ('FABRICA', 'PAULO', 'QUALQUER');

-- CreateEnum
CREATE TYPE "TipoDeArquivoDaDemanda" AS ENUM ('ANEXO', 'DESENHO', 'CAPTURA');

-- AlterTable
ALTER TABLE "FonteDaFabrica" ADD COLUMN     "demandasBuscadasEm" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "PedidoDePublicacao" ADD COLUMN     "demandaId" TEXT;

-- AlterTable
ALTER TABLE "Projeto" ADD COLUMN     "modeloDeEtapasId" TEXT,
ADD COLUMN     "nivelPadraoDeDemanda" "NivelDeAcompanhamento" NOT NULL DEFAULT 'APROVAR_DESENHO';

-- CreateTable
CREATE TABLE "ModeloDeEtapas" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "padrao" BOOLEAN NOT NULL DEFAULT false,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModeloDeEtapas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EtapaDoModelo" (
    "id" TEXT NOT NULL,
    "modeloId" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL,
    "chave" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "rotulo" TEXT NOT NULL,
    "marco" TEXT,
    "quemConclui" "QuemConcluiEtapa" NOT NULL,
    "puladaSemTela" BOOLEAN NOT NULL DEFAULT false,
    "esperaEm" "NivelDeAcompanhamento"[],

    CONSTRAINT "EtapaDoModelo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Demanda" (
    "id" TEXT NOT NULL,
    "projetoId" TEXT NOT NULL,
    "repositorioId" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "descricao" TEXT,
    "tipo" "TipoDeDemanda",
    "destino" "DestinoDaDemanda",
    "nivel" "NivelDeAcompanhamento" NOT NULL,
    "temTela" BOOLEAN NOT NULL,
    "origem" "OrigemDaDemanda" NOT NULL,
    "fonteId" TEXT,
    "chaveDaFonte" TEXT,
    "criadaPorId" TEXT,
    "modeloId" TEXT,
    "etapas" JSONB NOT NULL,
    "etapaAtual" TEXT NOT NULL,
    "concluidas" TEXT[],
    "espera" TEXT,
    "esperaMotivo" TEXT,
    "esperaDesde" TIMESTAMP(3),
    "antesDaTrava" JSONB,
    "triagem" JSONB,
    "recusasDoDesenho" INTEGER NOT NULL DEFAULT 0,
    "falhasDoTeste" INTEGER NOT NULL DEFAULT 0,
    "versaoDoDesenho" INTEGER NOT NULL DEFAULT 0,
    "desenhoAprovado" INTEGER,
    "planoCaminho" TEXT,
    "planoPrUrl" TEXT,
    "artefatoUrl" TEXT,
    "prs" TEXT[],
    "encerrada" TEXT,
    "entregueEm" TIMESTAMP(3),
    "criadaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadaEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Demanda_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventoDaDemanda" (
    "seq" BIGSERIAL NOT NULL,
    "idExterno" TEXT NOT NULL,
    "demandaId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "origem" TEXT NOT NULL,
    "usuarioId" TEXT,
    "fonteId" TEXT,
    "dados" JSONB NOT NULL,
    "em" TIMESTAMP(3) NOT NULL,
    "registradoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventoDaDemanda_pkey" PRIMARY KEY ("seq")
);

-- CreateTable
CREATE TABLE "ArquivoDaDemanda" (
    "id" TEXT NOT NULL,
    "demandaId" TEXT NOT NULL,
    "tipo" "TipoDeArquivoDaDemanda" NOT NULL,
    "nome" TEXT NOT NULL,
    "conteudo" TEXT NOT NULL,
    "tamanho" INTEGER NOT NULL,
    "tela" TEXT,
    "versao" INTEGER,
    "enviadoPor" TEXT NOT NULL,
    "fonteId" TEXT,
    "usuarioId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "apagadoEm" TIMESTAMP(3),

    CONSTRAINT "ArquivoDaDemanda_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FonteDeDemandas" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revogadaEm" TIMESTAMP(3),
    "criadaPorId" TEXT NOT NULL,
    "ultimoUsoEm" TIMESTAMP(3),

    CONSTRAINT "FonteDeDemandas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ModeloDeEtapas_nome_key" ON "ModeloDeEtapas"("nome");

-- CreateIndex
CREATE UNIQUE INDEX "EtapaDoModelo_modeloId_ordem_key" ON "EtapaDoModelo"("modeloId", "ordem");

-- CreateIndex
CREATE UNIQUE INDEX "EtapaDoModelo_modeloId_chave_key" ON "EtapaDoModelo"("modeloId", "chave");

-- CreateIndex
CREATE INDEX "Demanda_encerrada_espera_idx" ON "Demanda"("encerrada", "espera");

-- CreateIndex
CREATE INDEX "Demanda_projetoId_criadaEm_idx" ON "Demanda"("projetoId", "criadaEm");

-- CreateIndex
CREATE UNIQUE INDEX "Demanda_fonteId_chaveDaFonte_key" ON "Demanda"("fonteId", "chaveDaFonte");

-- CreateIndex
CREATE UNIQUE INDEX "EventoDaDemanda_idExterno_key" ON "EventoDaDemanda"("idExterno");

-- CreateIndex
CREATE INDEX "EventoDaDemanda_demandaId_seq_idx" ON "EventoDaDemanda"("demandaId", "seq");

-- CreateIndex
CREATE INDEX "ArquivoDaDemanda_demandaId_tipo_idx" ON "ArquivoDaDemanda"("demandaId", "tipo");

-- CreateIndex
CREATE UNIQUE INDEX "FonteDeDemandas_tokenHash_key" ON "FonteDeDemandas"("tokenHash");

-- CreateIndex
CREATE INDEX "PedidoDePublicacao_demandaId_idx" ON "PedidoDePublicacao"("demandaId");

-- AddForeignKey
ALTER TABLE "Projeto" ADD CONSTRAINT "Projeto_modeloDeEtapasId_fkey" FOREIGN KEY ("modeloDeEtapasId") REFERENCES "ModeloDeEtapas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PedidoDePublicacao" ADD CONSTRAINT "PedidoDePublicacao_demandaId_fkey" FOREIGN KEY ("demandaId") REFERENCES "Demanda"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EtapaDoModelo" ADD CONSTRAINT "EtapaDoModelo_modeloId_fkey" FOREIGN KEY ("modeloId") REFERENCES "ModeloDeEtapas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Demanda" ADD CONSTRAINT "Demanda_projetoId_fkey" FOREIGN KEY ("projetoId") REFERENCES "Projeto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Demanda" ADD CONSTRAINT "Demanda_repositorioId_fkey" FOREIGN KEY ("repositorioId") REFERENCES "RepositorioGitHub"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Demanda" ADD CONSTRAINT "Demanda_fonteId_fkey" FOREIGN KEY ("fonteId") REFERENCES "FonteDeDemandas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Demanda" ADD CONSTRAINT "Demanda_criadaPorId_fkey" FOREIGN KEY ("criadaPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventoDaDemanda" ADD CONSTRAINT "EventoDaDemanda_demandaId_fkey" FOREIGN KEY ("demandaId") REFERENCES "Demanda"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArquivoDaDemanda" ADD CONSTRAINT "ArquivoDaDemanda_demandaId_fkey" FOREIGN KEY ("demandaId") REFERENCES "Demanda"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FonteDeDemandas" ADD CONSTRAINT "FonteDeDemandas_criadaPorId_fkey" FOREIGN KEY ("criadaPorId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Modelo padrão (espelha MODELO_PADRAO em src/modules/demandas/model.ts)
INSERT INTO "ModeloDeEtapas" ("id", "nome", "padrao") VALUES ('00000000-0000-4000-8000-000000000001', 'Padrão', true);

INSERT INTO "EtapaDoModelo" ("id", "modeloId", "ordem", "chave", "nome", "rotulo", "marco", "quemConclui", "puladaSemTela", "esperaEm") VALUES
  (gen_random_uuid(), '00000000-0000-4000-8000-000000000001', 1, 'recebida', 'Recebida', 'Recebida', 'recebida', 'FABRICA', false, ARRAY[]::"NivelDeAcompanhamento"[]),
  (gen_random_uuid(), '00000000-0000-4000-8000-000000000001', 2, 'planejada', 'Planejada', 'Planejada', 'planejada', 'QUALQUER', false, ARRAY['PLANEJAR_COMIGO']::"NivelDeAcompanhamento"[]),
  (gen_random_uuid(), '00000000-0000-4000-8000-000000000001', 3, 'desenho', 'Desenho aprovado', 'Desenho', 'desenho', 'PAULO', true, ARRAY['PLANEJAR_COMIGO','APROVAR_DESENHO']::"NivelDeAcompanhamento"[]),
  (gen_random_uuid(), '00000000-0000-4000-8000-000000000001', 4, 'desenvolvida', 'Desenvolvida', 'Desenvolvida', 'desenvolvida', 'FABRICA', false, ARRAY[]::"NivelDeAcompanhamento"[]),
  (gen_random_uuid(), '00000000-0000-4000-8000-000000000001', 5, 'testada', 'Testada no navegador', 'Testada', 'testada', 'FABRICA', true, ARRAY[]::"NivelDeAcompanhamento"[]),
  (gen_random_uuid(), '00000000-0000-4000-8000-000000000001', 6, 'entregue', 'Entregue', 'Entregue', 'entregue', 'FABRICA', false, ARRAY[]::"NivelDeAcompanhamento"[]);

-- No máximo um modelo padrão
CREATE UNIQUE INDEX "ModeloDeEtapas_um_padrao" ON "ModeloDeEtapas" ("padrao") WHERE "padrao";
