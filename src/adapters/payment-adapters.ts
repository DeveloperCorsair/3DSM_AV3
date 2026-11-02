import {
  ClientePagSeguroSimulado,
  ClientePayPalSimulado,
  ClienteStripeSimulado,
  StatusStripe,
} from "../external/payment-clients";
import { chamarProvedor, ErroIntegracaoExterna } from "./errors";

/**
 * Padrao Adapter - gateways de pagamento (Stripe, PagSeguro, PayPal).
 *
 * O nucleo trabalha sempre em reais (number) e com o vocabulario de
 * `StatusPagamento`; cada adaptador converte para a unidade, os campos e
 * os codigos de status do seu gateway (e de volta).
 */
export type StatusPagamento = "PENDENTE" | "APROVADO" | "RECUSADO" | "ESTORNADO";

export interface AdaptadorPagamento {
  /** Efetua o pagamento (valor em reais) e devolve o identificador da transacao. */
  efetuarPagamento(valor: number, origem: string, destino: string): Promise<string>;
  /** true se o estorno foi realizado agora; false se a transacao nao podia ser estornada (ex.: ja estornada). */
  cancelarPagamento(id: string): Promise<boolean>;
  verificarPagamento(id: string): Promise<StatusPagamento>;
}

function traduzirStatus(
  provedor: string,
  bruto: string | number,
  tabela: Record<string, StatusPagamento>
): StatusPagamento {
  const status = tabela[String(bruto)];
  if (!status) {
    throw new ErroIntegracaoExterna(provedor, `Status de pagamento desconhecido: ${bruto}`);
  }
  return status;
}

const STATUS_STRIPE: Record<StatusStripe, StatusPagamento> = {
  succeeded: "APROVADO",
  canceled: "ESTORNADO",
  processing: "PENDENTE",
  requires_payment_method: "RECUSADO",
};

/** Stripe trabalha com centavos inteiros e moeda explicita. */
export class AdaptadorStripe implements AdaptadorPagamento {
  constructor(private readonly cliente: ClienteStripeSimulado = new ClienteStripeSimulado()) {}

  async efetuarPagamento(valor: number, origem: string, destino: string): Promise<string> {
    const intent = await chamarProvedor("stripe", () =>
      this.cliente.paymentIntents.create({
        amount: Math.round(valor * 100),
        currency: "brl",
        source: origem,
        destination: destino,
      })
    );
    return intent.id;
  }

  async cancelarPagamento(id: string): Promise<boolean> {
    const reembolso = await chamarProvedor("stripe", () =>
      this.cliente.refunds.create({ payment_intent: id })
    );
    return reembolso.status === "succeeded";
  }

  async verificarPagamento(id: string): Promise<StatusPagamento> {
    const intent = await chamarProvedor("stripe", () => this.cliente.paymentIntents.retrieve(id));
    return traduzirStatus("stripe", intent.status, STATUS_STRIPE);
  }
}

const STATUS_PAGSEGURO: Record<string, StatusPagamento> = {
  "1": "PENDENTE",
  "3": "APROVADO",
  "7": "ESTORNADO",
};

/** PagSeguro recebe o valor como texto com duas casas e devolve situacoes numericas. */
export class AdaptadorPagSeguro implements AdaptadorPagamento {
  constructor(private readonly cliente: ClientePagSeguroSimulado = new ClientePagSeguroSimulado()) {}

  async efetuarPagamento(valor: number, origem: string, destino: string): Promise<string> {
    const cobranca = await chamarProvedor("pagseguro", () =>
      this.cliente.criarCobranca({ valor: valor.toFixed(2), pagador: origem, recebedor: destino })
    );
    return cobranca.codigo;
  }

  async cancelarPagamento(id: string): Promise<boolean> {
    const resposta = await chamarProvedor("pagseguro", () => this.cliente.cancelar(id));
    return resposta.sucesso;
  }

  async verificarPagamento(id: string): Promise<StatusPagamento> {
    const transacao = await chamarProvedor("pagseguro", () => this.cliente.consultarTransacao(id));
    return traduzirStatus("pagseguro", transacao.situacao, STATUS_PAGSEGURO);
  }
}

const STATUS_PAYPAL: Record<string, StatusPagamento> = {
  CREATED: "PENDENTE",
  COMPLETED: "APROVADO",
  DECLINED: "RECUSADO",
  VOIDED: "ESTORNADO",
};

/** PayPal usa a Orders API: unidades de compra aninhadas e valor em texto. */
export class AdaptadorPayPal implements AdaptadorPagamento {
  constructor(private readonly cliente: ClientePayPalSimulado = new ClientePayPalSimulado()) {}

  async efetuarPagamento(valor: number, origem: string, destino: string): Promise<string> {
    const ordem = await chamarProvedor("paypal", () =>
      this.cliente.orders.create({
        purchase_units: [
          { amount: { currency_code: "BRL", value: valor.toFixed(2) }, payee: { merchant_id: destino } },
        ],
        payer: { payer_id: origem },
      })
    );
    return ordem.id;
  }

  async cancelarPagamento(id: string): Promise<boolean> {
    const reembolso = await chamarProvedor("paypal", () => this.cliente.orders.refund(id));
    return reembolso.status === "COMPLETED";
  }

  async verificarPagamento(id: string): Promise<StatusPagamento> {
    const ordem = await chamarProvedor("paypal", () => this.cliente.orders.get(id));
    return traduzirStatus("paypal", ordem.status, STATUS_PAYPAL);
  }
}
