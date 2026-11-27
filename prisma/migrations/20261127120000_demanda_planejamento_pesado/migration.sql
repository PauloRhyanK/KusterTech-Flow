-- Demanda criada no Flow pode pedir o planejador pesado (Fable) ao kit.
ALTER TABLE "Demanda" ADD COLUMN "planejamentoPesado" BOOLEAN NOT NULL DEFAULT false;
