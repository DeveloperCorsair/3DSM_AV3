/**
 * Entidades centrais do dominio do microsservico de recomendacao e
 * orquestracao de equipes da plataforma CineBridge.
 *
 * Estas classes representam a "arvore de dados" do projeto sobre a qual
 * os Visitors (ver src/visitors) irao operar, alem de servirem de base
 * para as Strategies de recomendacao (ver src/strategies).
 */

import type { ResultadoValidacaoServico, ServicoProjeto } from "../composite/project-service";

export type TipoCaptacao = "documentario" | "ficcao" | "animacao";

export type NomePapel =
  | "diretor"
  | "diretor_fotografia"
  | "sonoplasta"
  | "editor"
  | "roteirista"
  | "efeitos_visuais";

/** Lista dos papeis validos em tempo de execucao (o tipo NomePapel some apos a compilacao). */
export const NOMES_PAPEL: readonly NomePapel[] = [
  "diretor",
  "diretor_fotografia",
  "sonoplasta",
  "editor",
  "roteirista",
  "efeitos_visuais",
];

/** Papel tecnico obrigatorio exigido por um projeto, com peso de importancia. */
export class PapelRequerido {
  constructor(
    public readonly nome: NomePapel,
    /** Peso relativo de importancia do papel para o sucesso do projeto (0 a 1). */
    public readonly peso: number
  ) {
    if (peso < 0 || peso > 1) {
      throw new Error(`Peso invalido para o papel ${nome}: ${peso}`);
    }
  }
}

export interface Localizacao {
  cidade: string;
  estado: string;
  pais: string;
}

/** Vetor de competencias tecnicas normalizado (0 a 1 por dimensao). */
export class VetorCompetencia {
  constructor(private readonly pesos: Map<NomePapel, number>) {}

  pesoPara(papel: NomePapel): number {
    return this.pesos.get(papel) ?? 0;
  }

  /** Similaridade de cosseno entre este vetor e outro, restrito aos papeis informados. */
  similaridadeCosseno(outro: VetorCompetencia, papeis: NomePapel[]): number {
    let produtoInterno = 0;
    let normaA = 0;
    let normaB = 0;
    for (const papel of papeis) {
      const a = this.pesoPara(papel);
      const b = outro.pesoPara(papel);
      produtoInterno += a * b;
      normaA += a * a;
      normaB += b * b;
    }
    if (normaA === 0 || normaB === 0) return 0;
    return produtoInterno / (Math.sqrt(normaA) * Math.sqrt(normaB));
  }
}

export class Avaliacao {
  constructor(
    public readonly projetoId: string,
    /** Nota de 0 a 5 atribuida ao profissional ao final de um projeto anterior. */
    public readonly nota: number,
    public readonly comentario?: string
  ) {
    if (nota < 0 || nota > 5) {
      throw new Error(`Nota de avaliacao invalida: ${nota}`);
    }
  }
}

export interface FaixaPreco {
  minimo: number;
  maximo: number;
}

export interface PeriodoDisponibilidade {
  inicio: Date;
  fim: Date;
}

export class Profissional {
  constructor(
    public readonly id: string,
    public readonly nome: string,
    public readonly especialidades: NomePapel[],
    public readonly faixaPreco: FaixaPreco,
    public readonly disponibilidade: PeriodoDisponibilidade[],
    public readonly localizacao: Localizacao,
    public readonly competencias: VetorCompetencia,
    public readonly historico: Avaliacao[] = []
  ) {}

  notaMedia(): number {
    if (this.historico.length === 0) return 0;
    const soma = this.historico.reduce((acc, a) => acc + a.nota, 0);
    return soma / this.historico.length;
  }

  atendePapel(papel: NomePapel): boolean {
    return this.especialidades.includes(papel);
  }

  estaDisponivelEntre(inicio: Date, fim: Date): boolean {
    return this.disponibilidade.some(
      (periodo) => periodo.inicio <= inicio && periodo.fim >= fim
    );
  }

  dentroDoOrcamento(valorMaximoPorPapel: number): boolean {
    return this.faixaPreco.minimo <= valorMaximoPorPapel;
  }
}

export class Projeto {
  constructor(
    public readonly id: string,
    public readonly genero: string,
    public readonly duracaoEstimadaMinutos: number,
    public readonly orcamentoTotal: number,
    public readonly dataEntrega: Date,
    public readonly tipoCaptacao: TipoCaptacao,
    public readonly localizacao: Localizacao,
    public readonly papeisRequeridos: PapelRequerido[],
    /**
     * Raiz da hierarquia de servicos (Composite). Opcional para manter
     * compatibilidade com projetos descritos apenas por papeis requeridos.
     */
    public readonly servicoPrincipal?: ServicoProjeto
  ) {}

  /** Custo dos servicos do projeto: delega ao servico principal, que propaga pela hierarquia. */
  calcularCustoTotal(): number {
    return this.servicoPrincipal?.calcularCusto() ?? 0;
  }

  /** Prazo total (em dias) dos servicos do projeto, calculado recursivamente. */
  obterPrazoTotal(): number {
    return this.servicoPrincipal?.obterPrazo() ?? 0;
  }

  /**
   * Valida a estrutura de servicos de forma recursiva (papeis validos,
   * custos e prazos coerentes) e confere se o prazo total cabe ate a entrega.
   */
  validarEstrutura(referencia: Date = new Date()): ResultadoValidacaoServico {
    if (!this.servicoPrincipal) return { valido: true, erros: [] };

    const erros = [...this.servicoPrincipal.validar().erros];
    const prazoTotal = this.servicoPrincipal.obterPrazo();
    const diasDisponiveis = Math.floor(
      (this.dataEntrega.getTime() - referencia.getTime()) / 86_400_000
    );
    if (prazoTotal > diasDisponiveis) {
      erros.push(
        `Prazo total dos servicos (${prazoTotal} dias) excede o tempo ate a entrega (${diasDisponiveis} dias).`
      );
    }
    return { valido: erros.length === 0, erros };
  }

  orcamentoPorPapel(): number {
    const pesoTotal = this.papeisRequeridos.reduce((acc, p) => acc + p.peso, 0);
    if (pesoTotal === 0) return 0;
    return this.orcamentoTotal / this.papeisRequeridos.length;
  }
}

export type StatusConvite = "pendente" | "aceito" | "recusado";

export class Convite {
  public status: StatusConvite = "pendente";

  constructor(
    public readonly id: string,
    public readonly projetoId: string,
    public readonly profissionalId: string,
    public readonly papel: NomePapel
  ) {}

  aceitar(): void {
    this.status = "aceito";
  }

  recusar(): void {
    this.status = "recusado";
  }
}

/** Sugestao de profissional para um papel especifico, com pontuacao do motor de recomendacao. */
export class ItemRecomendacao {
  constructor(
    public readonly papel: NomePapel,
    public readonly profissional: Profissional,
    public readonly pontuacao: number
  ) {}
}

export type StatusRecomendacao =
  | "gerada"
  | "em_ajuste"
  | "consensual"
  | "registrada";

export class Recomendacao {
  public status: StatusRecomendacao = "gerada";
  private itens: Map<NomePapel, ItemRecomendacao>;

  constructor(
    public readonly id: string,
    public readonly projetoId: string,
    itensIniciais: ItemRecomendacao[]
  ) {
    this.itens = new Map(itensIniciais.map((item) => [item.papel, item]));
  }

  listarItens(): ItemRecomendacao[] {
    return Array.from(this.itens.values());
  }

  itemDoPapel(papel: NomePapel): ItemRecomendacao | undefined {
    return this.itens.get(papel);
  }

  substituirPapel(item: ItemRecomendacao): void {
    this.itens.set(item.papel, item);
    this.status = "em_ajuste";
  }

  marcarConsensual(): void {
    this.status = "consensual";
  }

  marcarRegistrada(): void {
    this.status = "registrada";
  }

  papeisPreenchidos(): NomePapel[] {
    return Array.from(this.itens.keys());
  }

  custoTotalEstimado(): number {
    return this.listarItens().reduce(
      (acc, item) => acc + item.profissional.faixaPreco.minimo,
      0
    );
  }
}
