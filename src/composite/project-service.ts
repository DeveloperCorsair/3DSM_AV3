import { NOMES_PAPEL, NomePapel } from "../domain/entities";

/**
 * Padrao Composite.
 *
 * Um projeto audiovisual nao e uma lista plana de papeis, e sim uma
 * hierarquia de servicos: um pacote (ex.: "pos-producao") contem
 * subpacotes e servicos atomicos (edicao, coloracao, mixagem...).
 * `ServicoProjeto` e a interface comum: quem calcula custo, prazo ou
 * valida a estrutura nao precisa saber se esta diante de uma folha ou de
 * um pacote - a operacao se propaga recursivamente.
 */
export interface ResultadoValidacaoServico {
  valido: boolean;
  erros: string[];
}

export interface ServicoProjeto {
  readonly nome: string;
  /** Custo total do servico (soma recursiva para pacotes). */
  calcularCusto(): number;
  /** Filhos diretos; vazio para servicos atomicos. Devolve copia: a estrutura so muda via PacoteServico.adicionar. */
  listarSubservicos(): ServicoProjeto[];
  /** Prazo em dias corridos (recursivo para pacotes). */
  obterPrazo(): number;
  /** Valida este no e todos os descendentes, acumulando os erros encontrados. */
  validar(): ResultadoValidacaoServico;
}

/** Folha da hierarquia: um servico individual com custo, prazo e papel tecnico associado. */
export class ServicoAtomico implements ServicoProjeto {
  constructor(
    public readonly nome: string,
    private readonly custo: number,
    private readonly prazoDias: number,
    public readonly papel: NomePapel,
    /** Importancia do papel (0 a 1) usada ao derivar os papeis requeridos do projeto. */
    public readonly peso: number = 1
  ) {}

  calcularCusto(): number {
    return this.custo;
  }

  listarSubservicos(): ServicoProjeto[] {
    return [];
  }

  obterPrazo(): number {
    return this.prazoDias;
  }

  validar(): ResultadoValidacaoServico {
    const erros: string[] = [];
    const rotulo = `Servico "${this.nome}"`;

    if (!this.nome || this.nome.trim() === "") {
      erros.push("Servico atomico sem nome.");
    }
    if (!Number.isFinite(this.custo) || this.custo < 0) {
      erros.push(`${rotulo}: custo invalido (${this.custo}).`);
    }
    if (!Number.isFinite(this.prazoDias) || this.prazoDias <= 0) {
      erros.push(`${rotulo}: prazo deve ser maior que zero (${this.prazoDias}).`);
    }
    if (!NOMES_PAPEL.includes(this.papel)) {
      erros.push(`${rotulo}: papel tecnico invalido (${this.papel}).`);
    }
    if (!Number.isFinite(this.peso) || this.peso < 0 || this.peso > 1) {
      erros.push(`${rotulo}: peso do papel deve estar entre 0 e 1 (${this.peso}).`);
    }
    return { valido: erros.length === 0, erros };
  }
}

export type ModoExecucao = "sequencial" | "paralela";

/** No composto: agrupa servicos atomicos e/ou outros pacotes, em qualquer profundidade. */
export class PacoteServico implements ServicoProjeto {
  private readonly filhos: ServicoProjeto[] = [];

  constructor(
    public readonly nome: string,
    /**
     * Como os filhos se encadeiam no tempo: "sequencial" soma os prazos,
     * "paralela" usa o maior deles. Os custos sempre se somam.
     */
    public readonly execucao: ModoExecucao = "sequencial",
    filhos: ServicoProjeto[] = [],
    /** Prazo maximo prometido para o pacote; se o prazo calculado o ultrapassar, a validacao falha. */
    public readonly prazoMaximoDias?: number
  ) {
    filhos.forEach((filho) => this.adicionar(filho));
  }

  adicionar(filho: ServicoProjeto): this {
    if (filho === this || (filho instanceof PacoteServico && filho.contem(this))) {
      throw new Error(`Ciclo detectado: "${filho.nome}" ja contem "${this.nome}".`);
    }
    if (this.filhos.includes(filho)) {
      throw new Error(`"${filho.nome}" ja faz parte do pacote "${this.nome}".`);
    }
    this.filhos.push(filho);
    return this;
  }

  /** Indica se `alvo` aparece em algum nivel abaixo deste pacote. */
  contem(alvo: ServicoProjeto): boolean {
    return this.filhos.some(
      (filho) => filho === alvo || (filho instanceof PacoteServico && filho.contem(alvo))
    );
  }

  calcularCusto(): number {
    return this.filhos.reduce((total, filho) => total + filho.calcularCusto(), 0);
  }

  listarSubservicos(): ServicoProjeto[] {
    return [...this.filhos];
  }

  obterPrazo(): number {
    const prazos = this.filhos.map((filho) => filho.obterPrazo());
    if (prazos.length === 0) return 0;
    return this.execucao === "paralela"
      ? Math.max(...prazos)
      : prazos.reduce((total, prazo) => total + prazo, 0);
  }

  validar(): ResultadoValidacaoServico {
    const erros: string[] = [];
    const rotulo = `Pacote "${this.nome}"`;

    if (!this.nome || this.nome.trim() === "") {
      erros.push("Pacote de servicos sem nome.");
    }
    if (this.filhos.length === 0) {
      erros.push(`${rotulo}: nao possui subservicos.`);
    }
    for (const filho of this.filhos) {
      erros.push(...filho.validar().erros);
    }
    if (this.prazoMaximoDias !== undefined && this.obterPrazo() > this.prazoMaximoDias) {
      erros.push(
        `${rotulo}: prazo calculado (${this.obterPrazo()} dias) excede o prazo maximo (${this.prazoMaximoDias} dias).`
      );
    }
    return { valido: erros.length === 0, erros };
  }
}

/** Percorre a hierarquia e devolve todas as folhas (servicos atomicos), em ordem de profundidade. */
export function coletarServicosAtomicos(raiz: ServicoProjeto): ServicoAtomico[] {
  if (raiz instanceof ServicoAtomico) return [raiz];
  return raiz.listarSubservicos().flatMap((filho) => coletarServicosAtomicos(filho));
}

export interface DescricaoServico {
  tipo: "atomico" | "pacote";
  nome: string;
  custo: number;
  prazoDias: number;
  papel?: NomePapel;
  execucao?: ModoExecucao;
  subservicos?: DescricaoServico[];
}

/** Representacao em objeto simples (JSON) da hierarquia, com custo e prazo ja calculados em cada no. */
export function descreverServico(servico: ServicoProjeto): DescricaoServico {
  const base = {
    nome: servico.nome,
    custo: servico.calcularCusto(),
    prazoDias: servico.obterPrazo(),
  };
  if (servico instanceof ServicoAtomico) {
    return { tipo: "atomico", ...base, papel: servico.papel };
  }
  return {
    tipo: "pacote",
    ...base,
    execucao: servico instanceof PacoteServico ? servico.execucao : undefined,
    subservicos: servico.listarSubservicos().map(descreverServico),
  };
}
