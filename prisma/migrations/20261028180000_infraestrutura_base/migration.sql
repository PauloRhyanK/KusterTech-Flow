-- CreateEnum
CREATE TYPE "TipoRecurso" AS ENUM ('SERVIDOR', 'CONTAINER', 'BANCO', 'STORAGE', 'OUTRO');

-- CreateEnum
CREATE TYPE "EstadoAlerta" AS ENUM ('ATIVO', 'RECONHECIDO', 'RESOLVIDO_NA_ORIGEM');

-- CreateEnum
CREATE TYPE "OrigemAlerta" AS ENUM ('WEBHOOK', 'MANUAL');

-- CreateEnum
CREATE TYPE "SeveridadeAlerta" AS ENUM ('CRITICA', 'ALTA', 'MEDIA', 'BAIXA');

-- CreateEnum
CREATE TYPE "TipoEventoAlerta" AS ENUM ('CRIADO', 'RECONHECIDO', 'RESOLVIDO', 'REABERTO');

-- CreateTable
CREATE TABLE "Recurso" (
    "id" TEXT NOT NULL,
    "tipo" "TipoRecurso" NOT NULL,
    "nome" TEXT NOT NULL,
    "nomeNormalizado" TEXT NOT NULL,
    "identificadorExterno" TEXT,
    "descricao" TEXT,
    "urlBeszel" TEXT,
    "urlGlitchTip" TEXT,
    "urlHostDocker" TEXT,
    "hospedadoEmId" TEXT,
    "arquivadoEm" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Recurso_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecursoProjeto" (
    "recursoId" TEXT NOT NULL,
    "projetoId" TEXT NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecursoProjeto_pkey" PRIMARY KEY ("recursoId","projetoId")
);

-- CreateTable
CREATE TABLE "FonteDeAlertas" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revogadaEm" TIMESTAMP(3),
    "criadaPorId" TEXT NOT NULL,
    "ultimoUsoEm" TIMESTAMP(3),

    CONSTRAINT "FonteDeAlertas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Alerta" (
    "id" TEXT NOT NULL,
    "chaveDedupe" TEXT NOT NULL,
    "origem" "OrigemAlerta" NOT NULL,
    "titulo" TEXT NOT NULL,
    "severidade" "SeveridadeAlerta" NOT NULL,
    "estado" "EstadoAlerta" NOT NULL,
    "recursoId" TEXT,
    "projetoId" TEXT,
    "primeiraOcorrenciaEm" TIMESTAMP(3) NOT NULL,
    "ultimaOcorrenciaEm" TIMESTAMP(3) NOT NULL,
    "ocorrencias" INTEGER NOT NULL,
    "reconhecidoPorId" TEXT,
    "reconhecidoEm" TIMESTAMP(3),
    "resolvidoEm" TIMESTAMP(3),
    "detalhe" TEXT,
    "fonteId" TEXT,
    "criadoPorId" TEXT,
    "resolvidoPorId" TEXT,

    CONSTRAINT "Alerta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventoDeAlerta" (
    "id" TEXT NOT NULL,
    "alertaId" TEXT NOT NULL,
    "tipo" "TipoEventoAlerta" NOT NULL,
    "autorId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventoDeAlerta_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Recurso_nomeNormalizado_key" ON "Recurso"("nomeNormalizado");

-- CreateIndex
CREATE UNIQUE INDEX "Recurso_identificadorExterno_key" ON "Recurso"("identificadorExterno");

-- CreateIndex
CREATE INDEX "Recurso_tipo_idx" ON "Recurso"("tipo");

-- CreateIndex
CREATE INDEX "Recurso_hospedadoEmId_idx" ON "Recurso"("hospedadoEmId");

-- CreateIndex
CREATE INDEX "RecursoProjeto_projetoId_idx" ON "RecursoProjeto"("projetoId");

-- CreateIndex
CREATE UNIQUE INDEX "FonteDeAlertas_tokenHash_key" ON "FonteDeAlertas"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "Alerta_chaveDedupe_key" ON "Alerta"("chaveDedupe");

-- CreateIndex
CREATE INDEX "Alerta_estado_severidade_idx" ON "Alerta"("estado", "severidade");

-- CreateIndex
CREATE INDEX "Alerta_recursoId_idx" ON "Alerta"("recursoId");

-- CreateIndex
CREATE INDEX "Alerta_projetoId_idx" ON "Alerta"("projetoId");

-- CreateIndex
CREATE INDEX "EventoDeAlerta_alertaId_criadoEm_idx" ON "EventoDeAlerta"("alertaId", "criadoEm");

-- AddForeignKey
ALTER TABLE "Recurso" ADD CONSTRAINT "Recurso_hospedadoEmId_fkey" FOREIGN KEY ("hospedadoEmId") REFERENCES "Recurso"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecursoProjeto" ADD CONSTRAINT "RecursoProjeto_recursoId_fkey" FOREIGN KEY ("recursoId") REFERENCES "Recurso"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecursoProjeto" ADD CONSTRAINT "RecursoProjeto_projetoId_fkey" FOREIGN KEY ("projetoId") REFERENCES "Projeto"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FonteDeAlertas" ADD CONSTRAINT "FonteDeAlertas_criadaPorId_fkey" FOREIGN KEY ("criadaPorId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alerta" ADD CONSTRAINT "Alerta_recursoId_fkey" FOREIGN KEY ("recursoId") REFERENCES "Recurso"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alerta" ADD CONSTRAINT "Alerta_projetoId_fkey" FOREIGN KEY ("projetoId") REFERENCES "Projeto"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alerta" ADD CONSTRAINT "Alerta_reconhecidoPorId_fkey" FOREIGN KEY ("reconhecidoPorId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alerta" ADD CONSTRAINT "Alerta_fonteId_fkey" FOREIGN KEY ("fonteId") REFERENCES "FonteDeAlertas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alerta" ADD CONSTRAINT "Alerta_criadoPorId_fkey" FOREIGN KEY ("criadoPorId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alerta" ADD CONSTRAINT "Alerta_resolvidoPorId_fkey" FOREIGN KEY ("resolvidoPorId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventoDeAlerta" ADD CONSTRAINT "EventoDeAlerta_alertaId_fkey" FOREIGN KEY ("alertaId") REFERENCES "Alerta"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventoDeAlerta" ADD CONSTRAINT "EventoDeAlerta_autorId_fkey" FOREIGN KEY ("autorId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

