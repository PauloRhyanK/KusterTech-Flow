-- CreateTable
CREATE TABLE "Cliente" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "nomeNormalizado" TEXT NOT NULL,
    "observacoes" TEXT,
    "arquivadoEm" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Cliente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Projeto" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "nomeNormalizado" TEXT NOT NULL,
    "descricao" TEXT,
    "arquivadoEm" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Projeto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjetoCliente" (
    "projetoId" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjetoCliente_pkey" PRIMARY KEY ("projetoId","clienteId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Cliente_nomeNormalizado_key" ON "Cliente"("nomeNormalizado");

-- CreateIndex
CREATE UNIQUE INDEX "Projeto_nomeNormalizado_key" ON "Projeto"("nomeNormalizado");

-- CreateIndex
CREATE INDEX "ProjetoCliente_clienteId_idx" ON "ProjetoCliente"("clienteId");

-- CreateIndex
CREATE INDEX "UsuarioPapel_clienteId_idx" ON "UsuarioPapel"("clienteId");

-- AddForeignKey
ALTER TABLE "UsuarioPapel" ADD CONSTRAINT "UsuarioPapel_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjetoCliente" ADD CONSTRAINT "ProjetoCliente_projetoId_fkey" FOREIGN KEY ("projetoId") REFERENCES "Projeto"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjetoCliente" ADD CONSTRAINT "ProjetoCliente_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
