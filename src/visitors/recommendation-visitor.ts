import { PapelRequerido, Projeto, Recomendacao } from "../domain/entities";

/**
 * Permite adicionar novas operacoes sobre a estrutura Projeto/Recomendacao
 * sem poluir essas classes de dominio com logica dispersa. Cada visitante
 * concreto implementa uma operacao transversal distinta (validacao de
 * consistencia, calculo de compatibilidade, geracao de relatorio).
 */
export interface VisitanteRecomendacao<R> {
  visitarProjeto(projeto: Projeto, recomendacao: Recomendacao): R;
}

export interface ResultadoValidacao {
  valido: boolean;
  erros: string[];
}

/** Verifica se todos os papeis obrigatorios estao preenchidos e se o orcamento e suficiente. */
export class VisitanteValidacaoConsistencia
  implements VisitanteRecomendacao<ResultadoValidacao>
{
  visitarProjeto(projeto: Projeto, recomendacao: Recomendacao): ResultadoValidacao {
    const erros: string[] = [];

    for (const papel of projeto.papeisRequeridos) {
      const item = recomendacao.itemDoPapel(papel.nome);
      if (!item) {
        erros.push(`Papel obrigatorio nao preenchido: ${papel.nome}`);
      }
    }

    const custoTotal = recomendacao.custoTotalEstimado();
    if (custoTotal > projeto.orcamentoTotal) {
      erros.push(
        `Orcamento insuficiente: custo estimado ${custoTotal} excede o orcamento total ${projeto.orcamentoTotal}`
      );
    }

    return { valido: erros.length === 0, erros };
  }
}

/** Calcula uma metrica agregada de compatibilidade geral da equipe. */
export class VisitanteCompatibilidadeEquipe
  implements VisitanteRecomendacao<number>
{
  visitarProjeto(projeto: Projeto, recomendacao: Recomendacao): number {
    const pesoPorPapel = new Map<string, number>(
      projeto.papeisRequeridos.map((p: PapelRequerido) => [p.nome, p.peso])
    );

    let somaPonderada = 0;
    let somaPesos = 0;
    for (const item of recomendacao.listarItens()) {
      const peso = pesoPorPapel.get(item.papel) ?? 0;
      somaPonderada += item.pontuacao * peso;
      somaPesos += peso;
    }

    if (somaPesos === 0) return 0;
    return somaPonderada / somaPesos;
  }
}

export interface RelatorioEquipe {
  projetoId: string;
  recomendacaoId: string;
  quantidadePapeis: number;
  papeisPreenchidos: string[];
  custoTotalEstimado: number;
  orcamentoTotal: number;
  margemOrcamentaria: number;
  compatibilidadeMedia: number;
}

/** Gera um relatorio completo da equipe para apresentacao ao produtor. */
export class VisitanteRelatorioEquipe
  implements VisitanteRecomendacao<RelatorioEquipe>
{
  constructor(
    private readonly visitanteCompatibilidade: VisitanteCompatibilidadeEquipe = new VisitanteCompatibilidadeEquipe()
  ) {}

  visitarProjeto(projeto: Projeto, recomendacao: Recomendacao): RelatorioEquipe {
    const custoTotal = recomendacao.custoTotalEstimado();
    return {
      projetoId: projeto.id,
      recomendacaoId: recomendacao.id,
      quantidadePapeis: projeto.papeisRequeridos.length,
      papeisPreenchidos: recomendacao.papeisPreenchidos(),
      custoTotalEstimado: custoTotal,
      orcamentoTotal: projeto.orcamentoTotal,
      margemOrcamentaria: projeto.orcamentoTotal - custoTotal,
      compatibilidadeMedia: this.visitanteCompatibilidade.visitarProjeto(
        projeto,
        recomendacao
      ),
    };
  }
}
