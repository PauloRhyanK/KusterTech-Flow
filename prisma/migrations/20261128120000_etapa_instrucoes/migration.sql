-- Fábrica 2.0 (M2): o brief da etapa vai ao worker.
ALTER TABLE "EtapaOperacional" ADD COLUMN "instrucoes" TEXT NOT NULL DEFAULT '';
