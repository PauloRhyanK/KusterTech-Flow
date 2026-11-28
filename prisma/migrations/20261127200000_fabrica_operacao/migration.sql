-- Fábrica 2.0 (M1b): estado operacional no Flow. Só acréscimos; o legado não muda.

-- AlterTable
ALTER TABLE "Demanda" ADD COLUMN     "motor" TEXT NOT NULL DEFAULT 'legado';

-- CreateTable
CREATE TABLE "PlanoOperacional" (
    "id" TEXT NOT NULL,
    "demandaId" TEXT NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlanoOperacional_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RevisaoDoPlano" (
    "id" TEXT NOT NULL,
    "planoId" TEXT NOT NULL,
    "numero" INTEGER NOT NULL,
    "conteudo" JSONB NOT NULL,
    "hash" TEXT NOT NULL,
    "aprovadaPorId" TEXT,
    "aprovadaEm" TIMESTAMP(3),
    "criadaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RevisaoDoPlano_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EtapaOperacional" (
    "id" TEXT NOT NULL,
    "revisaoId" TEXT NOT NULL,
    "chave" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "papel" TEXT NOT NULL,
    "repositorioId" TEXT NOT NULL,
    "arquivos" TEXT[],
    "dependeDe" TEXT[],
    "prioridade" INTEGER NOT NULL DEFAULT 0,
    "estado" TEXT NOT NULL DEFAULT 'pendente',
    "falhasTecnicas" INTEGER NOT NULL DEFAULT 0,
    "correcoes" INTEGER NOT NULL DEFAULT 0,
    "prUrl" TEXT,
    "motivo" TEXT,
    "proximaTentativaEm" TIMESTAMP(3),
    "criadaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadaEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EtapaOperacional_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExecucaoOperacional" (
    "id" TEXT NOT NULL,
    "etapaId" TEXT NOT NULL,
    "tentativa" INTEGER NOT NULL,
    "papel" TEXT NOT NULL,
    "workerId" TEXT,
    "geracao" INTEGER NOT NULL DEFAULT 0,
    "reservaExpiraEm" TIMESTAMP(3),
    "sessao" TEXT,
    "resultado" JSONB,
    "iniciadaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "encerradaEm" TIMESTAMP(3),

    CONSTRAINT "ExecucaoOperacional_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkerDaFabrica" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "criadoPorId" TEXT NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ultimoSinalEm" TIMESTAMP(3),
    "pausado" BOOLEAN NOT NULL DEFAULT false,
    "revogadoEm" TIMESTAMP(3),

    CONSTRAINT "WorkerDaFabrica_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventoOperacional" (
    "seq" BIGSERIAL NOT NULL,
    "idExterno" TEXT NOT NULL,
    "entidade" TEXT NOT NULL,
    "entidadeId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "origem" TEXT NOT NULL,
    "dados" JSONB NOT NULL,
    "em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventoOperacional_pkey" PRIMARY KEY ("seq")
);

-- CreateIndex
CREATE UNIQUE INDEX "PlanoOperacional_demandaId_key" ON "PlanoOperacional"("demandaId");

-- CreateIndex
CREATE UNIQUE INDEX "RevisaoDoPlano_planoId_numero_key" ON "RevisaoDoPlano"("planoId", "numero");

-- CreateIndex
CREATE INDEX "EtapaOperacional_estado_proximaTentativaEm_idx" ON "EtapaOperacional"("estado", "proximaTentativaEm");

-- CreateIndex
CREATE UNIQUE INDEX "EtapaOperacional_revisaoId_chave_key" ON "EtapaOperacional"("revisaoId", "chave");

-- CreateIndex
CREATE INDEX "ExecucaoOperacional_encerradaEm_reservaExpiraEm_idx" ON "ExecucaoOperacional"("encerradaEm", "reservaExpiraEm");

-- CreateIndex
CREATE UNIQUE INDEX "ExecucaoOperacional_etapaId_tentativa_key" ON "ExecucaoOperacional"("etapaId", "tentativa");

-- CreateIndex
CREATE UNIQUE INDEX "WorkerDaFabrica_nome_key" ON "WorkerDaFabrica"("nome");

-- CreateIndex
CREATE UNIQUE INDEX "WorkerDaFabrica_tokenHash_key" ON "WorkerDaFabrica"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "EventoOperacional_idExterno_key" ON "EventoOperacional"("idExterno");

-- CreateIndex
CREATE INDEX "EventoOperacional_entidade_entidadeId_seq_idx" ON "EventoOperacional"("entidade", "entidadeId", "seq");

-- AddForeignKey
ALTER TABLE "PlanoOperacional" ADD CONSTRAINT "PlanoOperacional_demandaId_fkey" FOREIGN KEY ("demandaId") REFERENCES "Demanda"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RevisaoDoPlano" ADD CONSTRAINT "RevisaoDoPlano_planoId_fkey" FOREIGN KEY ("planoId") REFERENCES "PlanoOperacional"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RevisaoDoPlano" ADD CONSTRAINT "RevisaoDoPlano_aprovadaPorId_fkey" FOREIGN KEY ("aprovadaPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EtapaOperacional" ADD CONSTRAINT "EtapaOperacional_revisaoId_fkey" FOREIGN KEY ("revisaoId") REFERENCES "RevisaoDoPlano"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EtapaOperacional" ADD CONSTRAINT "EtapaOperacional_repositorioId_fkey" FOREIGN KEY ("repositorioId") REFERENCES "RepositorioGitHub"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExecucaoOperacional" ADD CONSTRAINT "ExecucaoOperacional_etapaId_fkey" FOREIGN KEY ("etapaId") REFERENCES "EtapaOperacional"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExecucaoOperacional" ADD CONSTRAINT "ExecucaoOperacional_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "WorkerDaFabrica"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkerDaFabrica" ADD CONSTRAINT "WorkerDaFabrica_criadoPorId_fkey" FOREIGN KEY ("criadoPorId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- No máximo uma execução aberta por etapa (escrito à mão; o Prisma não modela índice parcial).
CREATE UNIQUE INDEX "ExecucaoOperacional_uma_aberta" ON "ExecucaoOperacional"("etapaId") WHERE "encerradaEm" IS NULL;
