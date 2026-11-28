-- Fábrica 2.0 (M3): motor das demandas novas por projeto e repositórios que se publicam sozinhos.
ALTER TABLE "Projeto" ADD COLUMN "motorPadrao" TEXT NOT NULL DEFAULT 'legado';
ALTER TABLE "ConfiguracaoDePublicacao" ADD COLUMN "deployAutomatico" BOOLEAN NOT NULL DEFAULT false;
