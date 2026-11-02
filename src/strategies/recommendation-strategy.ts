import {
  ItemRecomendacao,
  PapelRequerido,
  Profissional,
  Projeto,
} from "../domain/entities";

/**
 * Padrao Strategy: encapsula diferentes algoritmos de recomendacao
 * de profissionais para os papeis de um projeto. Cada estrategia
 * concreta implementa apenas a logica de pontuacao/selecao, mantendo
 * a mesma interface para o orquestrador (Template Method) que a invoca.
 */
export interface EstrategiaRecomendacao {
  /** Nome usado para selecionar a estrategia dinamicamente (ex.: na criacao do projeto). */
  readonly nome: string;

  /**
   * Recomenda, para cada papel requerido, o(s) profissional(is) mais
   * adequado(s) dentre os candidatos elegiveis, respeitando restricoes
   * de orcamento e prazo (ja filtradas previamente pelo orquestrador).
   */
  recomendar(
    projeto: Projeto,
    papel: PapelRequerido,
    candidatos: Profissional[]
  ): ItemRecomendacao[];
}

/** Estrategia baseada em similaridade de cosseno sobre os vetores de competencia. */
export class EstrategiaSimilaridadeCosseno implements EstrategiaRecomendacao {
  readonly nome = "similaridade_cosseno";

  recomendar(
    _projeto: Projeto,
    papel: PapelRequerido,
    candidatos: Profissional[]
  ): ItemRecomendacao[] {
    return candidatos
      .filter((c) => c.atendePapel(papel.nome))
      .map((c) => {
        const base = c.competencias.pesoPara(papel.nome);
        const pontuacao = base * papel.peso;
        return new ItemRecomendacao(papel.nome, c, pontuacao);
      })
      .sort((a, b) => b.pontuacao - a.pontuacao);
  }
}

/** Estrategia baseada em filtragem colaborativa usando avaliacoes historicas. */
export class EstrategiaFiltragemColaborativa implements EstrategiaRecomendacao {
  readonly nome = "filtragem_colaborativa";

  recomendar(
    _projeto: Projeto,
    papel: PapelRequerido,
    candidatos: Profissional[]
  ): ItemRecomendacao[] {
    return candidatos
      .filter((c) => c.atendePapel(papel.nome))
      .map((c) => {
        // Normaliza a nota media (0-5) para 0-1 e pondera pelo peso do papel
        // e pelo volume de historico (profissionais com mais avaliacoes
        // tem maior confianca na pontuacao).
        const notaNormalizada = c.notaMedia() / 5;
        const confianca = Math.min(c.historico.length / 10, 1);
        const pontuacao = notaNormalizada * (0.7 + 0.3 * confianca) * papel.peso;
        return new ItemRecomendacao(papel.nome, c, pontuacao);
      })
      .sort((a, b) => b.pontuacao - a.pontuacao);
  }
}

/** Estrategia baseada em regras de negocio para projetos com orcamento reduzido. */
export class EstrategiaOrcamentoReduzido implements EstrategiaRecomendacao {
  readonly nome = "orcamento_reduzido";

  recomendar(
    projeto: Projeto,
    papel: PapelRequerido,
    candidatos: Profissional[]
  ): ItemRecomendacao[] {
    const orcamentoPorPapel = projeto.orcamentoPorPapel();
    return candidatos
      .filter(
        (c) => c.atendePapel(papel.nome) && c.dentroDoOrcamento(orcamentoPorPapel)
      )
      .map((c) => {
        // Prioriza o menor preco dentro do orcamento, com pequeno ajuste
        // pela nota media, para nao sacrificar totalmente a qualidade.
        const economiaRelativa =
          orcamentoPorPapel > 0
            ? 1 - c.faixaPreco.minimo / orcamentoPorPapel
            : 0;
        const pontuacao =
          Math.max(economiaRelativa, 0) * 0.7 + (c.notaMedia() / 5) * 0.3;
        return new ItemRecomendacao(papel.nome, c, pontuacao * papel.peso);
      })
      .sort((a, b) => b.pontuacao - a.pontuacao);
  }
}

/** Fabrica simples para resolver a estrategia pelo nome (selecao dinamica). */
export class FabricaEstrategiaRecomendacao {
  private static readonly registro = new Map<string, EstrategiaRecomendacao>([
    ["similaridade_cosseno", new EstrategiaSimilaridadeCosseno()],
    ["filtragem_colaborativa", new EstrategiaFiltragemColaborativa()],
    ["orcamento_reduzido", new EstrategiaOrcamentoReduzido()],
  ]);

  static obter(nome: string): EstrategiaRecomendacao {
    const estrategia = this.registro.get(nome);
    if (!estrategia) {
      throw new Error(`Estrategia de recomendacao desconhecida: ${nome}`);
    }
    return estrategia;
  }

  static registrar(estrategia: EstrategiaRecomendacao): void {
    this.registro.set(estrategia.nome, estrategia);
  }
}
