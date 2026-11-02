import { randomUUID } from "crypto";

/**
 * Gateways de pagamento EXTERNOS simulados (sem rede). Cada um fala o
 * "dialeto" do provedor real: unidades monetarias, nomes de campos e
 * codigos de status diferentes. Sao os adaptees do padrao Adapter.
 */

function novoId(prefixo: string): string {
  return `${prefixo}${randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

/** Estilo Stripe: valores inteiros em centavos, moeda explicita, status textuais. */
export type StatusStripe = "succeeded" | "canceled" | "processing" | "requires_payment_method";

export class ClienteStripeSimulado {
  private readonly intents = new Map<string, { amount: number; status: StatusStripe }>();

  readonly paymentIntents = {
    create: async (params: {
      amount: number;
      currency: string;
      source: string;
      destination: string;
    }): Promise<{ id: string; status: StatusStripe }> => {
      if (!Number.isInteger(params.amount) || params.amount <= 0) {
        throw new Error("Stripe parameter_invalid_integer: amount deve ser inteiro positivo (centavos).");
      }
      if (!params.source || !params.destination) {
        throw new Error("Stripe parameter_missing: source e destination sao obrigatorios.");
      }
      const id = novoId("pi_");
      this.intents.set(id, { amount: params.amount, status: "succeeded" });
      return { id, status: "succeeded" };
    },

    retrieve: async (id: string): Promise<{ id: string; status: StatusStripe }> => {
      const intent = this.intents.get(id);
      if (!intent) throw new Error(`Stripe resource_missing: ${id}`);
      return { id, status: intent.status };
    },
  };

  readonly refunds = {
    create: async (params: { payment_intent: string }): Promise<{ status: "succeeded" | "failed" }> => {
      const intent = this.intents.get(params.payment_intent);
      if (!intent) throw new Error(`Stripe resource_missing: ${params.payment_intent}`);
      if (intent.status !== "succeeded") return { status: "failed" };
      intent.status = "canceled";
      return { status: "succeeded" };
    },
  };
}

/** Estilo PagSeguro: valor como texto "0.00" e situacao numerica (1 aguardando, 3 paga, 7 cancelada). */
export class ClientePagSeguroSimulado {
  private readonly transacoes = new Map<string, { valor: number; situacao: number }>();

  async criarCobranca(params: {
    valor: string;
    pagador: string;
    recebedor: string;
  }): Promise<{ codigo: string; situacao: number }> {
    if (!/^\d+\.\d{2}$/.test(params.valor) || Number(params.valor) <= 0) {
      throw new Error(`PagSeguro 11013: valor invalido (${params.valor}).`);
    }
    if (!params.pagador || !params.recebedor) {
      throw new Error("PagSeguro 53004: pagador e recebedor sao obrigatorios.");
    }
    const codigo = novoId("PS-");
    this.transacoes.set(codigo, { valor: Number(params.valor), situacao: 3 });
    return { codigo, situacao: 3 };
  }

  async cancelar(codigo: string): Promise<{ sucesso: boolean }> {
    const transacao = this.transacoes.get(codigo);
    if (!transacao) throw new Error(`PagSeguro 404: transacao ${codigo} nao encontrada.`);
    if (transacao.situacao !== 3) return { sucesso: false };
    transacao.situacao = 7;
    return { sucesso: true };
  }

  async consultarTransacao(codigo: string): Promise<{ situacao: number }> {
    const transacao = this.transacoes.get(codigo);
    if (!transacao) throw new Error(`PagSeguro 404: transacao ${codigo} nao encontrada.`);
    return { situacao: transacao.situacao };
  }
}

/** Estilo PayPal Orders API: valor em texto e status em maiusculas. */
export class ClientePayPalSimulado {
  private readonly ordens = new Map<string, { status: string }>();

  readonly orders = {
    create: async (params: {
      purchase_units: {
        amount: { currency_code: string; value: string };
        payee: { merchant_id: string };
      }[];
      payer: { payer_id: string };
    }): Promise<{ id: string; status: string }> => {
      const unidade = params.purchase_units[0];
      if (!unidade || !/^\d+\.\d{2}$/.test(unidade.amount.value) || Number(unidade.amount.value) <= 0) {
        throw new Error("PayPal INVALID_REQUEST: amount.value invalido.");
      }
      if (!unidade.payee.merchant_id || !params.payer.payer_id) {
        throw new Error("PayPal INVALID_REQUEST: payer e payee sao obrigatorios.");
      }
      const id = novoId("PAYID-");
      this.ordens.set(id, { status: "COMPLETED" });
      return { id, status: "COMPLETED" };
    },

    refund: async (id: string): Promise<{ status: "COMPLETED" | "FAILED" }> => {
      const ordem = this.ordens.get(id);
      if (!ordem) throw new Error(`PayPal RESOURCE_NOT_FOUND: ${id}`);
      if (ordem.status !== "COMPLETED") return { status: "FAILED" };
      ordem.status = "VOIDED";
      return { status: "COMPLETED" };
    },

    get: async (id: string): Promise<{ id: string; status: string }> => {
      const ordem = this.ordens.get(id);
      if (!ordem) throw new Error(`PayPal RESOURCE_NOT_FOUND: ${id}`);
      return { id, status: ordem.status };
    },
  };
}
