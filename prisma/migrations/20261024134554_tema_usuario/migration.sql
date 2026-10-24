-- CreateEnum
CREATE TYPE "Tema" AS ENUM ('SISTEMA', 'CLARO', 'ESCURO');

-- AlterTable
ALTER TABLE "Usuario" ADD COLUMN     "tema" "Tema" NOT NULL DEFAULT 'SISTEMA';
