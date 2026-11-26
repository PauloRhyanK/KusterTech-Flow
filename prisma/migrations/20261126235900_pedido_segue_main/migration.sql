-- Pedido sem commit segue a cabeça de main até o disparo.
ALTER TABLE "PedidoDePublicacao" ADD COLUMN "segueMain" BOOLEAN NOT NULL DEFAULT false;
