import { EstrategiaRecomendacao } from "../strategies/recommendation-strategy";
import {
  AuditoriaDecorator,
  CacheDecorator,
  CacheEmMemoria,
  CacheRecomendacao,
  CompressaoDecorator,
  MetricasCompressao,
  SorvedouroAuditoria,
  SorvedouroAuditoriaEmMemoria,
} from "./recommendation-decorators";

export const NOMES_DECORADORES = ["cache", "auditoria", "compressao"] as const;
export type NomeDecorador = (typeof NOMES_DECORADORES)[number];

/**
 * Politica de montagem da pilha, definida por configuracao ou por
 * preferencia do produtor. A ordem e a de APLICACAO: o primeiro nome
 * envolve diretamente o recomendador base (fica mais interno) e o ultimo
 * fica na camada externa. Ex.: ["cache", "auditoria", "compressao"]
 * resulta em compressao(auditoria(cache(base))).
 */
export interface PoliticaRecomendacao {
  decoradores: readonly string[];
}

/** Estado compartilhado entre as pilhas montadas (cache e trilha de auditoria sobrevivem as requisicoes). */
export interface RecursosDecoradores {
  cache: CacheRecomendacao;
  sorvedouroAuditoria: SorvedouroAuditoria;
  aoComprimir?: (metricas: MetricasCompressao, payload: Buffer) => void;
}

export function criarRecursosPadrao(): RecursosDecoradores & {
  sorvedouroAuditoria: SorvedouroAuditoriaEmMemoria;
} {
  return { cache: new CacheEmMemoria(), sorvedouroAuditoria: new SorvedouroAuditoriaEmMemoria() };
}

export class FabricaPilhaRecomendacao {
  constructor(private readonly recursos: RecursosDecoradores = criarRecursosPadrao()) {}

  /** Monta a pilha em tempo de execucao a partir da politica; politica vazia devolve a propria base. */
  montar(base: EstrategiaRecomendacao, politica: PoliticaRecomendacao): EstrategiaRecomendacao {
    const vistos = new Set<string>();
    for (const nome of politica.decoradores) {
      if (!(NOMES_DECORADORES as readonly string[]).includes(nome)) {
        throw new Error(
          `Decorator desconhecido: "${nome}". Use: ${NOMES_DECORADORES.join(", ")}.`
        );
      }
      if (vistos.has(nome)) {
        throw new Error(`Decorator repetido na politica: "${nome}".`);
      }
      vistos.add(nome);
    }
    return politica.decoradores.reduce<EstrategiaRecomendacao>(
      (atual, nome) => this.envolver(nome as NomeDecorador, atual),
      base
    );
  }

  private envolver(nome: NomeDecorador, interno: EstrategiaRecomendacao): EstrategiaRecomendacao {
    switch (nome) {
      case "cache":
        return new CacheDecorator(interno, this.recursos.cache);
      case "auditoria":
        return new AuditoriaDecorator(interno, this.recursos.sorvedouroAuditoria);
      case "compressao":
        return new CompressaoDecorator(interno, this.recursos.aoComprimir);
    }
  }

  /** Le uma politica de texto, ex.: "cache,auditoria,compressao" (variavel de ambiente). */
  static politicaDeTexto(texto: string | undefined): PoliticaRecomendacao {
    const decoradores = (texto ?? "")
      .split(",")
      .map((parte) => parte.trim().toLowerCase())
      .filter((parte) => parte !== "");
    return { decoradores };
  }
}
