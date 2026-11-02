import { Profissional } from "../domain/entities";

/**
 * Contrato do repositorio de profissionais.
 * A implementacao real consultaria o PostgreSQL (via TypeORM/Prisma);
 * aqui definimos a interface e uma implementacao em memoria para
 * desenvolvimento/teste, alem de um decorator que adiciona
 * tolerancia a falhas (RNF: retornar recomendacoes parciais/fallback
 * quando o repositorio estiver indisponivel).
 */
export interface RepositorioProfissionais {
  buscarTodos(): Promise<Profissional[]>;
  buscarPorId(id: string): Promise<Profissional | undefined>;
}

export class RepositorioProfissionaisEmMemoria implements RepositorioProfissionais {
  constructor(private readonly profissionais: Profissional[] = []) {}

  async buscarTodos(): Promise<Profissional[]> {
    return this.profissionais;
  }

  async buscarPorId(id: string): Promise<Profissional | undefined> {
    return this.profissionais.find((p) => p.id === id);
  }

  adicionar(profissional: Profissional): void {
    this.profissionais.push(profissional);
  }
}

/**
 * Decorator de tolerancia a falhas: encapsula um repositorio real e,
 * em caso de erro (timeout, indisponibilidade, etc.), retorna um
 * fallback definido (por padrao, lista vazia / undefined) em vez de
 * propagar a excecao, permitindo que o motor de recomendacao degrade
 * graciosamente (recomendacoes parciais).
 */
export class RepositorioProfissionaisTolerranteAFalhas
  implements RepositorioProfissionais
{
  constructor(
    private readonly interno: RepositorioProfissionais,
    private readonly aoFalhar?: (erro: unknown) => void
  ) {}

  async buscarTodos(): Promise<Profissional[]> {
    try {
      return await this.interno.buscarTodos();
    } catch (erro) {
      this.aoFalhar?.(erro);
      return [];
    }
  }

  async buscarPorId(id: string): Promise<Profissional | undefined> {
    try {
      return await this.interno.buscarPorId(id);
    } catch (erro) {
      this.aoFalhar?.(erro);
      return undefined;
    }
  }
}
