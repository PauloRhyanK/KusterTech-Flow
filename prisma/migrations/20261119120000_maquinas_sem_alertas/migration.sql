-- Sai a fila de alertas e o cadastro da máquina ganha quatro campos opcionais.
-- Destrutiva de propósito: o app nunca foi publicado e não há dados de produção.

-- DropTable
DROP TABLE "EventoDeAlerta";

-- DropTable
DROP TABLE "Alerta";

-- DropTable
DROP TABLE "FonteDeAlertas";

-- DropEnum
DROP TYPE "TipoEventoAlerta";

-- DropEnum
DROP TYPE "EstadoAlerta";

-- DropEnum
DROP TYPE "OrigemAlerta";

-- DropEnum
DROP TYPE "SeveridadeAlerta";

-- AlterTable
ALTER TABLE "Recurso" DROP COLUMN "urlBeszel",
DROP COLUMN "urlGlitchTip",
DROP COLUMN "urlHostDocker",
ADD COLUMN "provedor" TEXT,
ADD COLUMN "endereco" TEXT,
ADD COLUMN "especificacao" TEXT,
ADD COLUMN "custoMensal" DECIMAL(10,2);
