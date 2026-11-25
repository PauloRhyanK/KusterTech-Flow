-- AlterTable
ALTER TABLE "ConfiguracaoDePublicacao" ADD COLUMN     "urlDaVersao" TEXT,
ADD COLUMN     "versaoConferidaEm" TIMESTAMP(3),
ADD COLUMN     "versaoNoAr" TEXT;

-- AlterTable
ALTER TABLE "PedidoDePublicacao" ADD COLUMN     "conferindoDesde" TIMESTAMP(3);
