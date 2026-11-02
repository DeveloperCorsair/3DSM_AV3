import { randomUUID } from "crypto";
import {
  Convite,
  NomePapel,
  PapelRequerido,
  Profissional,
  Projeto,
  Recomendacao,
} from "../domain/entities";
import { RepositorioProfissionais } from "../repository/professional-repository";
import {
  EstrategiaRecomendacao,
  FabricaEstrategiaRecomendacao,
} from "../strategies/recommendation-strategy";
import { Adaptadores } from "../adapters/adapter-factory";
import { StatusPagamento } from "../adapters/payment-adapters";
import { ErroIntegracaoExterna } from "../adapters/errors";
import {
  OrquestradorComposicaoEquipe,
  OrquestradorPadrao,
} from "../orchestrator/team-composition-orchestrator";
import { SujeitoRecomendacao } from "../observers/notification-observer";
import {
  ResultadoValidacao,
  VisitanteCompatibilidadeEquipe,
  VisitanteRelatorioEquipe,
  VisitanteValidacaoConsistencia,
  RelatorioEquipe,
} from "../visitors/recommendation-visitor";
import { Barramento, NomeEvento } from "../events/event-bus";

export interface EntradaGerarRecomendacao {
  projeto: Projeto;
  nomeEstrategia?: string;
  /**
   * Estrategia ja montada (ex.: uma pilha de decorators). Tem precedencia
   * sobre `nomeEstrategia`; se nenhuma das duas for informada, usa-se a
   * definida por `definirEstrategia`.
   */
  estrategia?: EstrategiaRecomendacao;
}

export interface SaidaGerarRecomendacao {
  recomendacao: Recomendacao;
  validacao: ResultadoValidacao;
  relatorio: RelatorioEquipe;
  /** Identificador do relatorio salvo no armazenamento configurado. */
  arquivoRelatorioId?: string;
  erroArquivamento?: string;
}

export interface ComprovantePagamento {
  profissionalId: string;
  papel: NomePapel;
  valor: number;
  /** Identificador da transacao no gateway; ausente quando o pagamento foi recusado. */
  idTransacao?: string;
  status: StatusPagamento;
  erro?: string;
}

/**
 * Servico de aplicacao (fachada) que orquestra a colaboracao entre os
 * quatro padroes de projeto exigidos:
 *  - Strategy: escolhe o algoritmo de recomendacao.
 *  - Template Method: executa o fluxo fixo de composicao de equipe.
 *  - Observer: notifica interessados a cada recomendacao/convite.
 *  - Visitor: valida consistencia e gera metricas/relatorios.
 *
 * Tambem e responsavel por publicar eventos de dominio no barramento
 * para os demais microsservicos (gerenciamento de projetos, financeiro).
 */
export class ServicoRecomendacaoEquipe {
  constructor(
    private readonly repositorioProfissionais: RepositorioProfissionais,
    private readonly sujeitoRecomendacao: SujeitoRecomendacao,
    private readonly barramento: Barramento,
    private readonly orquestrador: OrquestradorComposicaoEquipe = new OrquestradorPadrao(),
    private readonly visitanteValidacao: VisitanteValidacaoConsistencia = new VisitanteValidacaoConsistencia(),
    private readonly visitanteRelatorio: VisitanteRelatorioEquipe = new VisitanteRelatorioEquipe(
      new VisitanteCompatibilidadeEquipe()
    ),
    /**
     * Adaptadores de armazenamento, pagamento e fonte de profissionais.
     * O servico depende apenas das interfaces; as implementacoes concretas
     * sao escolhidas fora (composition root) ou trocadas por `configurarAdaptadores`.
     */
    private adaptadores: Adaptadores = {}
  ) {}

  private estrategiaAtual?: EstrategiaRecomendacao;

  /** Define a estrategia usada quando a chamada nao informa nenhuma. */
  definirEstrategia(estrategia: EstrategiaRecomendacao): void {
    this.estrategiaAtual = estrategia;
  }

  /** Troca apenas os adaptadores informados; os demais permanecem como estavam. */
  configurarAdaptadores(novos: Adaptadores): void {
    this.adaptadores = {
      armazenamento: novos.armazenamento ?? this.adaptadores.armazenamento,
      pagamento: novos.pagamento ?? this.adaptadores.pagamento,
      profissional: novos.profissional ?? this.adaptadores.profissional,
    };
  }

  private resolverEstrategia(entrada: EntradaGerarRecomendacao): EstrategiaRecomendacao {
    if (entrada.estrategia) return entrada.estrategia;
    if (entrada.nomeEstrategia) return FabricaEstrategiaRecomendacao.obter(entrada.nomeEstrategia);
    if (this.estrategiaAtual) return this.estrategiaAtual;
    throw new Error("Nenhuma estrategia de recomendacao informada ou configurada.");
  }

  /** Fonte unica de candidatos: o adaptador de profissionais, se houver; senao o repositorio. */
  private async obterProfissionais(papeis: NomePapel[]): Promise<Profissional[]> {
    if (this.adaptadores.profissional) {
      return this.adaptadores.profissional.listarProfissionais({ papeis });
    }
    return this.repositorioProfissionais.buscarTodos();
  }

  async gerarRecomendacao(
    entrada: EntradaGerarRecomendacao
  ): Promise<SaidaGerarRecomendacao> {
    const { projeto } = entrada;
    const estrategia = this.resolverEstrategia(entrada);

    const todosProfissionais = await this.obterProfissionais(
      projeto.papeisRequeridos.map((papel) => papel.nome)
    );
    const candidatosPorPapel = this.agruparCandidatosPorPapel(
      projeto.papeisRequeridos,
      todosProfissionais
    );

    const recomendacao = this.orquestrador.compor(
      projeto,
      candidatosPorPapel,
      estrategia
    );

    this.sujeitoRecomendacao.notificarRecomendacaoGerada(recomendacao);
    this.barramento.publicar(NomeEvento.RECOMENDACAO_GERADA, {
      recomendacaoId: recomendacao.id,
      projetoId: projeto.id,
    });

    for (const item of recomendacao.listarItens()) {
      this.barramento.publicar(NomeEvento.CONVITE_ENVIADO, {
        recomendacaoId: recomendacao.id,
        profissionalId: item.profissional.id,
        papel: item.papel,
      });
    }

    const validacao = this.visitanteValidacao.visitarProjeto(projeto, recomendacao);
    const relatorio = this.visitanteRelatorio.visitarProjeto(projeto, recomendacao);

    const arquivamento = await this.arquivarRelatorio(projeto, recomendacao, validacao, relatorio);

    return {
      recomendacao,
      validacao,
      relatorio,
      arquivoRelatorioId: arquivamento.id,
      erroArquivamento: arquivamento.erro,
    };
  }

  /**
   * Salva o relatorio da equipe no armazenamento configurado. Falha de
   * armazenamento nao derruba a recomendacao: o erro e devolvido na saida.
   */
  private async arquivarRelatorio(
    projeto: Projeto,
    recomendacao: Recomendacao,
    validacao: ResultadoValidacao,
    relatorio: RelatorioEquipe
  ): Promise<{ id?: string; erro?: string }> {
    const armazenamento = this.adaptadores.armazenamento;
    if (!armazenamento) return {};
    try {
      const documento = {
        projetoId: projeto.id,
        recomendacaoId: recomendacao.id,
        geradoEm: new Date().toISOString(),
        itens: recomendacao.listarItens().map((item) => ({
          papel: item.papel,
          profissionalId: item.profissional.id,
          pontuacao: item.pontuacao,
        })),
        validacao,
        relatorio,
      };
      const id = await armazenamento.salvarArquivo(
        Buffer.from(JSON.stringify(documento, null, 2), "utf-8"),
        {
          nome: `relatorio-${recomendacao.id}.json`,
          pasta: `projetos/${projeto.id}`,
          tipoConteudo: "application/json",
        }
      );
      return { id };
    } catch (erro) {
      return { erro: erro instanceof Error ? erro.message : String(erro) };
    }
  }

  /**
   * Paga cada profissional da equipe (valor = menor preco da faixa, o mesmo
   * criterio do custo estimado) pelo gateway configurado. Pagamentos
   * recusados nao interrompem os demais: voltam no comprovante com `erro`.
   */
  async pagarEquipe(
    recomendacao: Recomendacao,
    contaOrigem: string
  ): Promise<ComprovantePagamento[]> {
    const gateway = this.adaptadores.pagamento;
    if (!gateway) throw new Error("Nenhum adaptador de pagamento configurado.");

    const comprovantes: ComprovantePagamento[] = [];
    for (const item of recomendacao.listarItens()) {
      const valor = item.profissional.faixaPreco.minimo;
      const base = { profissionalId: item.profissional.id, papel: item.papel, valor };
      try {
        const idTransacao = await gateway.efetuarPagamento(valor, contaOrigem, item.profissional.id);
        comprovantes.push({
          ...base,
          idTransacao,
          status: await gateway.verificarPagamento(idTransacao),
        });
      } catch (erro) {
        if (!(erro instanceof ErroIntegracaoExterna)) throw erro;
        comprovantes.push({ ...base, status: "RECUSADO", erro: erro.message });
      }
    }
    return comprovantes;
  }

  /**
   * Substitui o membro sugerido para um papel especifico, disparando
   * uma nova rodada de recomendacao apenas para o papel afetado
   * (as demais escolhas permanecem fixas).
   */
  async substituirPapel(
    projeto: Projeto,
    recomendacao: Recomendacao,
    papelAfetado: NomePapel,
    nomeEstrategia: string
  ): Promise<Recomendacao> {
    const papelRequerido = projeto.papeisRequeridos.find(
      (p) => p.nome === papelAfetado
    );
    if (!papelRequerido) {
      throw new Error(`Papel nao pertence ao projeto: ${papelAfetado}`);
    }

    const estrategia = FabricaEstrategiaRecomendacao.obter(nomeEstrategia);
    const todosProfissionais = await this.obterProfissionais([papelAfetado]);

    // Exclui tanto os profissionais ja escolhidos para os demais papeis
    // quanto o profissional atualmente sugerido para o proprio papel
    // afetado, pois uma substituicao busca uma alternativa a ele.
    const profissionalAtualDoPapel = recomendacao.itemDoPapel(papelAfetado)
      ?.profissional.id;
    const idsAExcluir = new Set(
      recomendacao
        .listarItens()
        .filter((i) => i.papel !== papelAfetado)
        .map((i) => i.profissional.id)
    );
    if (profissionalAtualDoPapel) {
      idsAExcluir.add(profissionalAtualDoPapel);
    }

    const candidatos = todosProfissionais.filter(
      (p) => p.atendePapel(papelAfetado) && !idsAExcluir.has(p.id)
    );

    const ranqueados = estrategia.recomendar(projeto, papelRequerido, candidatos);
    const escolhido = ranqueados[0];
    if (escolhido) {
      recomendacao.substituirPapel(escolhido);
    }

    this.barramento.publicar(NomeEvento.PAPEL_SUBSTITUIDO, {
      recomendacaoId: recomendacao.id,
      papel: papelAfetado,
    });

    return recomendacao;
  }

  registrarRespostaConvite(convite: Convite, aceitar: boolean): void {
    if (aceitar) {
      convite.aceitar();
      this.barramento.publicar(NomeEvento.CONVITE_ACEITO, { conviteId: convite.id });
    } else {
      convite.recusar();
      this.barramento.publicar(NomeEvento.CONVITE_RECUSADO, {
        conviteId: convite.id,
      });
    }
    this.sujeitoRecomendacao.notificarConviteAtualizado(convite);
  }

  /**
   * Registra a composicao final da equipe (equipe consensual) e dispara
   * eventos para os microsservicos de gerenciamento de projetos e
   * processamento financeiro, iniciando o fluxo de trabalho seguinte.
   */
  registrarComposicaoFinal(projeto: Projeto, recomendacao: Recomendacao): void {
    recomendacao.marcarConsensual();
    this.barramento.publicar(NomeEvento.EQUIPE_CONSENSUAL, {
      projetoId: projeto.id,
      recomendacaoId: recomendacao.id,
    });

    recomendacao.marcarRegistrada();
    this.barramento.publicar(NomeEvento.EQUIPE_REGISTRADA, {
      projetoId: projeto.id,
      recomendacaoId: recomendacao.id,
      papeis: recomendacao.papeisPreenchidos(),
      custoTotalEstimado: recomendacao.custoTotalEstimado(),
    });
  }

  criarConvitesParaRecomendacao(recomendacao: Recomendacao): Convite[] {
    return recomendacao.listarItens().map(
      (item) =>
        new Convite(randomUUID(), recomendacao.projetoId, item.profissional.id, item.papel)
    );
  }

  private agruparCandidatosPorPapel(
    papeisRequeridos: PapelRequerido[],
    profissionais: Profissional[]
  ): Map<string, Profissional[]> {
    const mapa = new Map<string, Profissional[]>();
    for (const papel of papeisRequeridos) {
      mapa.set(
        papel.nome,
        profissionais.filter((p) => p.atendePapel(papel.nome))
      );
    }
    return mapa;
  }
}

export const SistemaRecomendacao = ServicoRecomendacaoEquipe;
export type SistemaRecomendacao = ServicoRecomendacaoEquipe;
