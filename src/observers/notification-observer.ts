import { Convite, Recomendacao } from "../domain/entities";

/**
 * Padrao Observer.
 *
 * `SujeitoRecomendacao` mantem uma lista de observadores e os notifica
 * sempre que uma recomendacao e gerada ou um convite muda de estado.
 * Cada observador concreto reage de forma independente (envio de
 * e-mail, mensagens internas, auditoria), sem que o sujeito precise
 * conhecer os detalhes de cada canal.
 */
export interface ObservadorRecomendacao {
  aoGerarRecomendacao(recomendacao: Recomendacao): void;
  aoAtualizarConvite(convite: Convite): void;
}

export class SujeitoRecomendacao {
  private readonly observadores: ObservadorRecomendacao[] = [];

  inscrever(observador: ObservadorRecomendacao): void {
    this.observadores.push(observador);
  }

  desinscrever(observador: ObservadorRecomendacao): void {
    const indice = this.observadores.indexOf(observador);
    if (indice >= 0) this.observadores.splice(indice, 1);
  }

  notificarRecomendacaoGerada(recomendacao: Recomendacao): void {
    for (const observador of this.observadores) {
      observador.aoGerarRecomendacao(recomendacao);
    }
  }

  notificarConviteAtualizado(convite: Convite): void {
    for (const observador of this.observadores) {
      observador.aoAtualizarConvite(convite);
    }
  }
}

/** Registra o envio de e-mails aos profissionais e ao produtor. */
export class ObservadorEmail implements ObservadorRecomendacao {
  public readonly enviados: string[] = [];

  aoGerarRecomendacao(recomendacao: Recomendacao): void {
    for (const item of recomendacao.listarItens()) {
      this.enviados.push(
        `email:convite:${item.profissional.id}:${item.papel}:${recomendacao.projetoId}`
      );
    }
  }

  aoAtualizarConvite(convite: Convite): void {
    this.enviados.push(`email:status_convite:${convite.id}:${convite.status}`);
  }
}

/** Simula o envio de mensagens internas da plataforma (ex.: notificacoes push/in-app). */
export class ObservadorMensagemInterna implements ObservadorRecomendacao {
  public readonly mensagens: string[] = [];

  aoGerarRecomendacao(recomendacao: Recomendacao): void {
    this.mensagens.push(
      `mensagem:nova_recomendacao:${recomendacao.id}:${recomendacao.projetoId}`
    );
  }

  aoAtualizarConvite(convite: Convite): void {
    this.mensagens.push(
      `mensagem:convite_atualizado:${convite.id}:${convite.status}`
    );
  }
}

/** Registra eventos para fins de auditoria e melhoria continua do algoritmo. */
export interface RegistroAuditoria {
  timestamp: Date;
  tipo: string;
  detalhes: Record<string, unknown>;
}

export class ObservadorAuditoria implements ObservadorRecomendacao {
  public readonly registros: RegistroAuditoria[] = [];

  aoGerarRecomendacao(recomendacao: Recomendacao): void {
    this.registros.push({
      timestamp: new Date(),
      tipo: "recomendacao_gerada",
      detalhes: {
        recomendacaoId: recomendacao.id,
        projetoId: recomendacao.projetoId,
        papeis: recomendacao.papeisPreenchidos(),
      },
    });
  }

  aoAtualizarConvite(convite: Convite): void {
    this.registros.push({
      timestamp: new Date(),
      tipo: "convite_atualizado",
      detalhes: {
        conviteId: convite.id,
        profissionalId: convite.profissionalId,
        status: convite.status,
      },
    });
  }
}
