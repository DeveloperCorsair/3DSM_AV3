import { EventEmitter } from "events";

/**
 * Nomes de eventos de dominio emitidos pelo microsservico.
 * Mantidos em um enum de strings para facilitar a futura migracao
 * para um sistema de filas (ex.: RabbitMQ) sem alterar a logica de negocio:
 * o "topico" da fila poderia mapear 1:1 para estes nomes.
 */
export enum NomeEvento {
  RECOMENDACAO_GERADA = "recomendacao.gerada",
  PAPEL_SUBSTITUIDO = "recomendacao.papel_substituido",
  CONVITE_ENVIADO = "convite.enviado",
  CONVITE_ACEITO = "convite.aceito",
  CONVITE_RECUSADO = "convite.recusado",
  EQUIPE_CONSENSUAL = "equipe.consensual",
  EQUIPE_REGISTRADA = "equipe.registrada",
}

export interface EventoDominio<T = unknown> {
  nome: NomeEvento;
  ocorridoEm: Date;
  payload: T;
}

/**
 * Wrapper fino sobre o EventEmitter nativo do Node.js.
 * A camada de negocio depende apenas desta interface (Barramento),
 * o que permite substituir a implementacao por um cliente de fila
 * (RabbitMQ, Kafka, etc.) sem alterar quem publica ou assina eventos.
 */
export interface Barramento {
  publicar<T>(nome: NomeEvento, payload: T): void;
  assinar<T>(nome: NomeEvento, ouvinte: (evento: EventoDominio<T>) => void): void;
}

export class BarramentoEmMemoria implements Barramento {
  private readonly emissor = new EventEmitter();

  constructor() {
    // Suporta muitos observadores simultaneos (notificacoes, auditoria, etc.)
    this.emissor.setMaxListeners(50);
  }

  publicar<T>(nome: NomeEvento, payload: T): void {
    const evento: EventoDominio<T> = { nome, ocorridoEm: new Date(), payload };
    this.emissor.emit(nome, evento);
  }

  assinar<T>(nome: NomeEvento, ouvinte: (evento: EventoDominio<T>) => void): void {
    this.emissor.on(nome, ouvinte);
  }
}
