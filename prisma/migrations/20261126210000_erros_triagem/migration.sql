-- Triagem dos erros do GlitchTip (spec 2026-11-26-erros-triagem): grupo de erros parecidos e o
-- momento em que cada projeto passou a ser lido.
ALTER TABLE "ErroDoGlitchTip" ADD COLUMN "grupo" TEXT NOT NULL DEFAULT '';
CREATE INDEX "ErroDoGlitchTip_projetoGlitchTip_grupo_idx" ON "ErroDoGlitchTip"("projetoGlitchTip", "grupo");
ALTER TABLE "LeituraDoGlitchTip" ADD COLUMN "ligadaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
