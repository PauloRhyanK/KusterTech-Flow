-- CreateEnum
CREATE TYPE "EstadoItemHomologacao" AS ENUM ('AGUARDANDO_DISPONIBILIZACAO', 'PENDENTE_DE_TESTE', 'CORRECAO_SOLICITADA', 'AGUARDANDO_RETESTE', 'APROVADA');

-- CreateEnum
CREATE TYPE "EstadoHomologacaoMilestone" AS ENUM ('EM_ANDAMENTO', 'APROVADA');

-- CreateEnum
CREATE TYPE "TipoEventoTimeline" AS ENUM ('COMENTARIO', 'ENTRADA_NA_FILA', 'DISPONIBILIZACAO', 'APROVACAO', 'SOLICITACAO_CORRECAO', 'RETESTE_DETECTADO', 'RETESTE_CONFIRMADO', 'TRIAGEM', 'APROVACAO_MILESTONE');

-- CreateEnum
CREATE TYPE "VisibilidadeEvento" AS ENUM ('INTERNA', 'COMPARTILHAVEL');

-- CreateEnum
CREATE TYPE "OrigemEvento" AS ENUM ('HUMANO', 'SISTEMA');

-- CreateEnum
CREATE TYPE "EstadoSolicitacaoCorrecao" AS ENUM ('ABERTA', 'REABERTA_NO_GITHUB', 'CORRECAO_CRIADA', 'RESPONDIDA_SEM_TAREFA', 'RESOLVIDA');

-- CreateTable
CREATE TABLE "Homologacao" (
    "id" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "milestoneId" TEXT NOT NULL,
    "estado" "EstadoHomologacaoMilestone" NOT NULL DEFAULT 'EM_ANDAMENTO',
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Homologacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HomologacaoItem" (
    "id" TEXT NOT NULL,
    "homologacaoId" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "estado" "EstadoItemHomologacao" NOT NULL,
    "versaoAvaliadaId" TEXT,
    "ultimoEventoId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HomologacaoItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventoTimeline" (
    "id" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "milestoneId" TEXT NOT NULL,
    "issueId" TEXT,
    "versaoId" TEXT,
    "tipo" "TipoEventoTimeline" NOT NULL,
    "visibilidade" "VisibilidadeEvento" NOT NULL,
    "origem" "OrigemEvento" NOT NULL,
    "autorId" TEXT,
    "texto" TEXT,
    "estadoAnterior" "EstadoItemHomologacao",
    "estadoNovo" "EstadoItemHomologacao",
    "eventoAnteriorId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventoTimeline_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SolicitacaoDeCorrecao" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "eventoId" TEXT NOT NULL,
    "estado" "EstadoSolicitacaoCorrecao" NOT NULL DEFAULT 'ABERTA',
    "foraDoEscopo" BOOLEAN NOT NULL DEFAULT false,
    "justificativa" TEXT,
    "issueCorrecaoId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SolicitacaoDeCorrecao_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Homologacao_milestoneId_idx" ON "Homologacao"("milestoneId");

-- CreateIndex
CREATE UNIQUE INDEX "Homologacao_clienteId_milestoneId_key" ON "Homologacao"("clienteId", "milestoneId");

-- CreateIndex
CREATE INDEX "HomologacaoItem_issueId_idx" ON "HomologacaoItem"("issueId");

-- CreateIndex
CREATE INDEX "HomologacaoItem_estado_idx" ON "HomologacaoItem"("estado");

-- CreateIndex
CREATE UNIQUE INDEX "HomologacaoItem_homologacaoId_issueId_key" ON "HomologacaoItem"("homologacaoId", "issueId");

-- CreateIndex
CREATE INDEX "EventoTimeline_clienteId_milestoneId_issueId_criadoEm_idx" ON "EventoTimeline"("clienteId", "milestoneId", "issueId", "criadoEm");

-- CreateIndex
CREATE UNIQUE INDEX "SolicitacaoDeCorrecao_eventoId_key" ON "SolicitacaoDeCorrecao"("eventoId");

-- CreateIndex
CREATE INDEX "SolicitacaoDeCorrecao_itemId_idx" ON "SolicitacaoDeCorrecao"("itemId");

-- AddForeignKey
ALTER TABLE "Homologacao" ADD CONSTRAINT "Homologacao_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Homologacao" ADD CONSTRAINT "Homologacao_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "Milestone"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HomologacaoItem" ADD CONSTRAINT "HomologacaoItem_homologacaoId_fkey" FOREIGN KEY ("homologacaoId") REFERENCES "Homologacao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HomologacaoItem" ADD CONSTRAINT "HomologacaoItem_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "IssueGitHub"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HomologacaoItem" ADD CONSTRAINT "HomologacaoItem_versaoAvaliadaId_fkey" FOREIGN KEY ("versaoAvaliadaId") REFERENCES "Versao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HomologacaoItem" ADD CONSTRAINT "HomologacaoItem_ultimoEventoId_fkey" FOREIGN KEY ("ultimoEventoId") REFERENCES "EventoTimeline"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventoTimeline" ADD CONSTRAINT "EventoTimeline_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventoTimeline" ADD CONSTRAINT "EventoTimeline_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "Milestone"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventoTimeline" ADD CONSTRAINT "EventoTimeline_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "IssueGitHub"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventoTimeline" ADD CONSTRAINT "EventoTimeline_versaoId_fkey" FOREIGN KEY ("versaoId") REFERENCES "Versao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventoTimeline" ADD CONSTRAINT "EventoTimeline_autorId_fkey" FOREIGN KEY ("autorId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventoTimeline" ADD CONSTRAINT "EventoTimeline_eventoAnteriorId_fkey" FOREIGN KEY ("eventoAnteriorId") REFERENCES "EventoTimeline"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SolicitacaoDeCorrecao" ADD CONSTRAINT "SolicitacaoDeCorrecao_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "HomologacaoItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SolicitacaoDeCorrecao" ADD CONSTRAINT "SolicitacaoDeCorrecao_eventoId_fkey" FOREIGN KEY ("eventoId") REFERENCES "EventoTimeline"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SolicitacaoDeCorrecao" ADD CONSTRAINT "SolicitacaoDeCorrecao_issueCorrecaoId_fkey" FOREIGN KEY ("issueCorrecaoId") REFERENCES "IssueGitHub"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
