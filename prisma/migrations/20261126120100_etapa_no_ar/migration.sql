-- O valor FLOW do enum só pode ser usado depois do commit da migration anterior.

-- Etapa "No ar" ao fim de todo modelo que ainda não a tem (idempotente)
INSERT INTO "EtapaDoModelo" ("id", "modeloId", "ordem", "chave", "nome", "rotulo", "marco", "quemConclui", "puladaSemTela", "esperaEm")
SELECT gen_random_uuid(), m."id", COALESCE((SELECT MAX(e."ordem") FROM "EtapaDoModelo" e WHERE e."modeloId" = m."id"), 0) + 1,
  'no_ar', 'No ar', 'No ar', 'no_ar', 'FLOW', false, ARRAY[]::"NivelDeAcompanhamento"[]
FROM "ModeloDeEtapas" m
WHERE NOT EXISTS (SELECT 1 FROM "EtapaDoModelo" e WHERE e."modeloId" = m."id" AND e."chave" = 'no_ar');
