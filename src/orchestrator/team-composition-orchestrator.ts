import { randomUUID } from "crypto";
import {
  ItemRecomendacao,
  PapelRequerido,
  Profissional,
  Projeto,
  Recomendacao,
} from "../domain/entities";
import { EstrategiaRecomendacao } from "../strategies/recommendation-strategy";

/**
 * Padrao Template Method.
 *
 * O metodo `compor` define o esqueleto FIXO e imutavel do processo de
 * composicao de equipe: validar restricoes -> normalizar entrada ->
 * gerar recomendacoes por papel (via Strategy) -> pos-processar.
 * As subclasses concretas customizam apenas os "hooks" (etapas
 * especificas), sem poder alterar a ordem/existencia das etapas do
 * fluxo principal - o que torna o fluxo facilmente testavel: um teste
 * pode garantir que a ordem das chamadas nunca muda, independente da
 * subclasse usada.
 */
export abstract class OrquestradorComposicaoEquipe {
  /**
   * Metodo template - NAO deve ser sobrescrito pelas subclasses.
   * Executa as etapas na ordem fixa definida pelo processo de negocio.
   */
  compor(
    projeto: Projeto,
    candidatosPorPapel: Map<string, Profissional[]>,
    estrategia: EstrategiaRecomendacao
  ): Recomendacao {
    this.validarRestricoes(projeto);

    const candidatosNormalizados = this.normalizarEntrada(candidatosPorPapel);

    const itens: ItemRecomendacao[] = [];
    for (const papel of projeto.papeisRequeridos) {
      const candidatos = candidatosNormalizados.get(papel.nome) ?? [];
      const melhoresParaOPapel = estrategia.recomendar(projeto, papel, candidatos);
      const escolhido = this.selecionarMelhorCandidato(papel, melhoresParaOPapel);
      if (escolhido) {
        itens.push(escolhido);
      }
    }

    const recomendacao = new Recomendacao(randomUUID(), projeto.id, itens);
    return this.posProcessar(recomendacao, projeto);
  }

  /**
   * Hook: valida restricoes orcamentarias e de prazo do projeto.
   * Implementacao padrao verifica invariantes minimas; subclasses
   * podem estender com regras adicionais (ex.: restricoes regionais).
   */
  protected validarRestricoes(projeto: Projeto): void {
    if (projeto.orcamentoTotal <= 0) {
      throw new Error("Orcamento total do projeto deve ser maior que zero.");
    }
    if (projeto.papeisRequeridos.length === 0) {
      throw new Error("Projeto deve ter ao menos um papel requerido.");
    }
    if (projeto.dataEntrega.getTime() <= Date.now()) {
      throw new Error("Data de entrega deve estar no futuro.");
    }
    const estrutura = projeto.validarEstrutura();
    if (!estrutura.valido) {
      throw new Error(`Estrutura de servicos invalida: ${estrutura.erros.join("; ")}`);
    }
  }

  /** Hook: normaliza os dados de entrada (ex.: remove duplicados, ordena). */
  protected normalizarEntrada(
    candidatosPorPapel: Map<string, Profissional[]>
  ): Map<string, Profissional[]> {
    const normalizado = new Map<string, Profissional[]>();
    for (const [papel, lista] of candidatosPorPapel.entries()) {
      const idsVistos = new Set<string>();
      const semDuplicados = lista.filter((p) => {
        if (idsVistos.has(p.id)) return false;
        idsVistos.add(p.id);
        return true;
      });
      normalizado.set(papel, semDuplicados);
    }
    return normalizado;
  }

  /** Hook: escolhe o candidato final dentre a lista ranqueada para o papel. */
  protected abstract selecionarMelhorCandidato(
    papel: PapelRequerido,
    ranqueados: ItemRecomendacao[]
  ): ItemRecomendacao | undefined;

  /** Hook: pos-processamento da recomendacao final (ex.: ajustes, marcacao de status). */
  protected abstract posProcessar(
    recomendacao: Recomendacao,
    projeto: Projeto
  ): Recomendacao;
}

/**
 * Implementacao concreta padrao: seleciona sempre o candidato com maior
 * pontuacao e marca a recomendacao como "gerada" ao final.
 */
export class OrquestradorPadrao extends OrquestradorComposicaoEquipe {
  protected selecionarMelhorCandidato(
    _papel: PapelRequerido,
    ranqueados: ItemRecomendacao[]
  ): ItemRecomendacao | undefined {
    return ranqueados[0];
  }

  protected posProcessar(recomendacao: Recomendacao): Recomendacao {
    // Status inicial ja e "gerada" por padrao na construcao da entidade;
    // aqui poderiam ser disparados calculos adicionais de metricas.
    return recomendacao;
  }
}

/**
 * Variante que evita sugerir sempre o mesmo profissional em primeiro
 * lugar quando ha empate tecnico, promovendo diversidade de equipe
 * (ex.: para produtoras que qu [querem] dar oportunidade a novos talentos).
 */
export class OrquestradorComDiversidade extends OrquestradorComposicaoEquipe {
  protected selecionarMelhorCandidato(
    _papel: PapelRequerido,
    ranqueados: ItemRecomendacao[]
  ): ItemRecomendacao | undefined {
    if (ranqueados.length === 0) return undefined;
    const melhorPontuacao = ranqueados[0].pontuacao;
    const empatados = ranqueados.filter(
      (item) => melhorPontuacao - item.pontuacao < 0.01
    );
    const indiceAleatorio = Math.floor(Math.random() * empatados.length);
    return empatados[indiceAleatorio];
  }

  protected posProcessar(recomendacao: Recomendacao): Recomendacao {
    return recomendacao;
  }
}
