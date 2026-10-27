-- CreateEnum
CREATE TYPE "OrigemVinculoMilestone" AS ENUM ('MANUAL', 'HERANCA_CORRECAO');

-- CreateTable
CREATE TABLE "Milestone" (
    "id" TEXT NOT NULL,
    "projetoId" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "tituloNormalizado" TEXT NOT NULL,
    "descricao" TEXT,
    "prazo" DATE,
    "arquivadaEm" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Milestone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MilestoneCliente" (
    "milestoneId" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MilestoneCliente_pkey" PRIMARY KEY ("milestoneId","clienteId")
);

-- CreateTable
CREATE TABLE "MilestoneIssue" (
    "milestoneId" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "origem" "OrigemVinculoMilestone" NOT NULL,
    "foraDoEscopo" BOOLEAN NOT NULL DEFAULT false,
    "justificativaForaDoEscopo" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MilestoneIssue_pkey" PRIMARY KEY ("milestoneId","issueId")
);

-- CreateTable
CREATE TABLE "IssueVinculo" (
    "id" TEXT NOT NULL,
    "issueOriginalId" TEXT NOT NULL,
    "issueCorrecaoId" TEXT NOT NULL,
    "criadoPorId" TEXT NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IssueVinculo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Milestone_projetoId_tituloNormalizado_key" ON "Milestone"("projetoId", "tituloNormalizado");

-- CreateIndex
CREATE INDEX "MilestoneCliente_clienteId_idx" ON "MilestoneCliente"("clienteId");

-- CreateIndex
CREATE INDEX "MilestoneIssue_issueId_idx" ON "MilestoneIssue"("issueId");

-- CreateIndex
CREATE INDEX "IssueVinculo_issueCorrecaoId_idx" ON "IssueVinculo"("issueCorrecaoId");

-- CreateIndex
CREATE UNIQUE INDEX "IssueVinculo_issueOriginalId_issueCorrecaoId_key" ON "IssueVinculo"("issueOriginalId", "issueCorrecaoId");

-- AddForeignKey
ALTER TABLE "Milestone" ADD CONSTRAINT "Milestone_projetoId_fkey" FOREIGN KEY ("projetoId") REFERENCES "Projeto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MilestoneCliente" ADD CONSTRAINT "MilestoneCliente_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "Milestone"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MilestoneCliente" ADD CONSTRAINT "MilestoneCliente_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MilestoneIssue" ADD CONSTRAINT "MilestoneIssue_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "Milestone"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MilestoneIssue" ADD CONSTRAINT "MilestoneIssue_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "IssueGitHub"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueVinculo" ADD CONSTRAINT "IssueVinculo_issueOriginalId_fkey" FOREIGN KEY ("issueOriginalId") REFERENCES "IssueGitHub"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueVinculo" ADD CONSTRAINT "IssueVinculo_issueCorrecaoId_fkey" FOREIGN KEY ("issueCorrecaoId") REFERENCES "IssueGitHub"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueVinculo" ADD CONSTRAINT "IssueVinculo_criadoPorId_fkey" FOREIGN KEY ("criadoPorId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

