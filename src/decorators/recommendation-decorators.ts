import { gunzipSync, gzipSync } from "zlib";
import { performance } from "perf_hooks";
import {
  ItemRecomendacao,
  NomePapel,
  PapelRequerido,
  Profissional,
  Projeto,
} from "../domain/entities";
import {
  EstrategiaRecomendacao,
  EstrategiaSimilaridadeCosseno,
} from "../strategies/recommendation-strategy";

/**
 * Padrao Decorator.
 *
 * Cada decorator implementa a MESMA interface da estrategia que envolve
 * (`EstrategiaRecomendacao`, chamada de `RecomendacaoStrategy` no
 * enunciado) e delega a chamada ao recomendador interno, acrescentando um
 * comportamento transversal antes e/ou depois. Como todos expoem a mesma
 * interface, podem ser empilhados em qualquer ordem e em qualquer
 * combinacao sem alterar o orquestrador, o servico ou as estrategias.
 */
export type RecomendacaoStrategy = EstrategiaRecomendacao;

/**
 * Componente concreto da atividade: a logica principal de recomendacao
 * (similaridade de cosseno) da primeira atividade. Qualquer outra
 * estrategia (colaborativa, orcamento reduzido) tambem pode ser decorada.
 */
export class RecomendadorBase extends EstrategiaSimilaridadeCosseno {}

/** Base dos decorators: repassa o nome e a chamada ao recomendador interno. */
export abstract class DecoradorRecomendacao implements EstrategiaRecomendacao {
  constructor(protected readonly interno: EstrategiaRecomendacao) {}

  /** O decorator e transparente: usa o nome da estrategia envolvida. */
  get nome(): string {
    return this.interno.nome;
  }

  recomendar(
    projeto: Projeto,
    papel: PapelRequerido,
    candidatos: Profissional[]
  ): ItemRecomendacao[] {
    return this.interno.recomendar(projeto, papel, candidatos);
  }
}

/* Cache */

/** O que e guardado: so identificadores e pontuacoes, nunca os objetos do dominio. */
export type PontuacaoEmCache = { profissionalId: string; pontuacao: number }[];

export interface CacheRecomendacao {
  obter(chave: string): PontuacaoEmCache | undefined;
  guardar(chave: string, valor: PontuacaoEmCache): void;
  limpar(): void;
  tamanho(): number;
}

export interface OpcoesCacheEmMemoria {
  /** Tempo de vida de cada entrada; sem valor, as entradas nao expiram. */
  ttlMs?: number;
  /** Ao exceder, a entrada mais antiga e descartada. */
  maximoEntradas?: number;
  relogio?: () => number;
}

export class CacheEmMemoria implements CacheRecomendacao {
  private readonly entradas = new Map<string, { valor: PontuacaoEmCache; expiraEm?: number }>();
  private readonly ttlMs?: number;
  private readonly maximoEntradas: number;
  private readonly relogio: () => number;

  constructor(opcoes: OpcoesCacheEmMemoria = {}) {
    this.ttlMs = opcoes.ttlMs;
    this.maximoEntradas = opcoes.maximoEntradas ?? 500;
    this.relogio = opcoes.relogio ?? Date.now;
  }

  obter(chave: string): PontuacaoEmCache | undefined {
    const entrada = this.entradas.get(chave);
    if (!entrada) return undefined;
    if (entrada.expiraEm !== undefined && this.relogio() >= entrada.expiraEm) {
      this.entradas.delete(chave);
      return undefined;
    }
    return entrada.valor;
  }

  guardar(chave: string, valor: PontuacaoEmCache): void {
    if (!this.entradas.has(chave) && this.entradas.size >= this.maximoEntradas) {
      const maisAntiga = this.entradas.keys().next().value as string;
      this.entradas.delete(maisAntiga);
    }
    this.entradas.set(chave, {
      valor,
      expiraEm: this.ttlMs === undefined ? undefined : this.relogio() + this.ttlMs,
    });
  }

  limpar(): void {
    this.entradas.clear();
  }

  tamanho(): number {
    return this.entradas.size;
  }
}

/**
 * Chave de cache de uma recomendacao. Reune apenas o que as estrategias
 * leem: o algoritmo, o papel (nome e peso), o orcamento por papel e, de
 * cada candidato, os dados que entram na pontuacao. O id do projeto fica
 * de fora de proposito: projetos DIFERENTES porem equivalentes para o
 * algoritmo ("projetos similares") compartilham o mesmo resultado.
 */
export function gerarChaveCache(
  estrategia: string,
  projeto: Projeto,
  papel: PapelRequerido,
  candidatos: Profissional[]
): string {
  const impressaoDigital = candidatos
    .map((c) => [
      c.id,
      c.atendePapel(papel.nome),
      c.faixaPreco.minimo,
      c.notaMedia(),
      c.historico.length,
      c.competencias.pesoPara(papel.nome),
    ])
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  return JSON.stringify([
    estrategia,
    papel.nome,
    papel.peso,
    projeto.orcamentoPorPapel(),
    impressaoDigital,
  ]);
}

/** Guarda o resultado de recomendacoes ja calculadas e o reutiliza em chamadas equivalentes. */
export class CacheDecorator extends DecoradorRecomendacao {
  private contadorAcertos = 0;
  private contadorFalhas = 0;

  constructor(
    interno: EstrategiaRecomendacao,
    private readonly cache: CacheRecomendacao = new CacheEmMemoria()
  ) {
    super(interno);
  }

  get acertos(): number {
    return this.contadorAcertos;
  }

  get falhas(): number {
    return this.contadorFalhas;
  }

  recomendar(
    projeto: Projeto,
    papel: PapelRequerido,
    candidatos: Profissional[]
  ): ItemRecomendacao[] {
    const chave = gerarChaveCache(this.interno.nome, projeto, papel, candidatos);

    const guardado = this.cache.obter(chave);
    if (guardado) {
      // reidrata com os candidatos ATUAIS, nunca com instancias antigas
      const porId = new Map(candidatos.map((c) => [c.id, c]));
      const itens = guardado.map((g) => {
        const profissional = porId.get(g.profissionalId);
        return profissional ? new ItemRecomendacao(papel.nome, profissional, g.pontuacao) : undefined;
      });
      if (itens.every((item): item is ItemRecomendacao => item !== undefined)) {
        this.contadorAcertos++;
        return itens;
      }
    }

    this.contadorFalhas++;
    const itens = this.interno.recomendar(projeto, papel, candidatos);
    this.cache.guardar(
      chave,
      itens.map((i) => ({ profissionalId: i.profissional.id, pontuacao: i.pontuacao }))
    );
    return itens;
  }
}

/* Auditoria */

export interface RegistroChamadaRecomendacao {
  timestamp: Date;
  estrategia: string;
  papel: NomePapel;
  projetoId: string;
  candidatos: number;
  resultados: number;
  duracaoMs: number;
  sucesso: boolean;
  erro?: string;
}

export interface SorvedouroAuditoria {
  registrar(registro: RegistroChamadaRecomendacao): void;
}

export class SorvedouroAuditoriaEmMemoria implements SorvedouroAuditoria {
  readonly registros: RegistroChamadaRecomendacao[] = [];

  registrar(registro: RegistroChamadaRecomendacao): void {
    this.registros.push(registro);
  }
}

/** Registra cada chamada (quando, quanto tempo levou, se falhou), sem alterar o resultado. */
export class AuditoriaDecorator extends DecoradorRecomendacao {
  constructor(
    interno: EstrategiaRecomendacao,
    private readonly sorvedouro: SorvedouroAuditoria = new SorvedouroAuditoriaEmMemoria(),
    private readonly relogio: () => number = () => performance.now()
  ) {
    super(interno);
  }

  recomendar(
    projeto: Projeto,
    papel: PapelRequerido,
    candidatos: Profissional[]
  ): ItemRecomendacao[] {
    const inicio = this.relogio();
    const base = {
      timestamp: new Date(),
      estrategia: this.interno.nome,
      papel: papel.nome,
      projetoId: projeto.id,
      candidatos: candidatos.length,
    };
    try {
      const itens = this.interno.recomendar(projeto, papel, candidatos);
      this.sorvedouro.registrar({
        ...base,
        resultados: itens.length,
        duracaoMs: this.relogio() - inicio,
        sucesso: true,
      });
      return itens;
    } catch (erro) {
      this.sorvedouro.registrar({
        ...base,
        resultados: 0,
        duracaoMs: this.relogio() - inicio,
        sucesso: false,
        erro: erro instanceof Error ? erro.message : String(erro),
      });
      throw erro;
    }
  }
}

/* Compressao */

export interface MetricasCompressao {
  tamanhoOriginalBytes: number;
  tamanhoComprimidoBytes: number;
  taxa: number;
}

export interface ItemSerializado {
  papel: NomePapel;
  profissionalId: string;
  profissionalNome: string;
  pontuacao: number;
}

/**
 * Comprime (gzip) a versao serializada do resultado, como seria enviada
 * pela rede, e registra o ganho. O retorno continua sendo a lista de
 * `ItemRecomendacao`, porque a interface decorada nao pode mudar: o
 * payload comprimido fica disponivel em `ultimoPayloadComprimido` para a
 * camada de transporte, e `descomprimir` o restaura.
 */
export class CompressaoDecorator extends DecoradorRecomendacao {
  ultimaMetrica?: MetricasCompressao;
  ultimoPayloadComprimido?: Buffer;

  constructor(
    interno: EstrategiaRecomendacao,
    private readonly aoComprimir?: (metricas: MetricasCompressao, payload: Buffer) => void
  ) {
    super(interno);
  }

  recomendar(
    projeto: Projeto,
    papel: PapelRequerido,
    candidatos: Profissional[]
  ): ItemRecomendacao[] {
    const itens = this.interno.recomendar(projeto, papel, candidatos);

    const serializado: ItemSerializado[] = itens.map((i) => ({
      papel: i.papel,
      profissionalId: i.profissional.id,
      profissionalNome: i.profissional.nome,
      pontuacao: i.pontuacao,
    }));
    const original = Buffer.from(JSON.stringify(serializado), "utf-8");
    const comprimido = gzipSync(original);
    const metricas: MetricasCompressao = {
      tamanhoOriginalBytes: original.length,
      tamanhoComprimidoBytes: comprimido.length,
      taxa: original.length === 0 ? 1 : comprimido.length / original.length,
    };

    this.ultimaMetrica = metricas;
    this.ultimoPayloadComprimido = comprimido;
    this.aoComprimir?.(metricas, comprimido);
    return itens;
  }

  static descomprimir(payload: Buffer): ItemSerializado[] {
    return JSON.parse(gunzipSync(payload).toString("utf-8")) as ItemSerializado[];
  }
}
