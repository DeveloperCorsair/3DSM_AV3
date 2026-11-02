import { describe, expect, it, vi } from "vitest";
import {
  ItemRecomendacao,
  PapelRequerido,
  Profissional,
  Projeto,
} from "../../src/domain/entities";
import {
  EstrategiaFiltragemColaborativa,
  EstrategiaOrcamentoReduzido,
  EstrategiaRecomendacao,
  EstrategiaSimilaridadeCosseno,
} from "../../src/strategies/recommendation-strategy";
import {
  AuditoriaDecorator,
  CacheDecorator,
  CacheEmMemoria,
  CompressaoDecorator,
  gerarChaveCache,
  RecomendadorBase,
  SorvedouroAuditoriaEmMemoria,
} from "../../src/decorators/recommendation-decorators";
import {
  criarRecursosPadrao,
  FabricaPilhaRecomendacao,
} from "../../src/decorators/pipeline-factory";
import { criarProfissional, criarProjeto, dormir } from "../helpers";

/** Estrategia que conta quantas vezes foi chamada, para provar quando o cache evita o calculo. */
class EstrategiaContadora implements EstrategiaRecomendacao {
  readonly nome = "contadora";
  chamadas = 0;
  private readonly real = new EstrategiaSimilaridadeCosseno();

  recomendar(projeto: Projeto, papel: PapelRequerido, candidatos: Profissional[]): ItemRecomendacao[] {
    this.chamadas++;
    return this.real.recomendar(projeto, papel, candidatos);
  }
}

const papelDiretor = new PapelRequerido("diretor", 1);
const candidatosPadrao = () => [
  criarProfissional("a", { competencia: 0.9 }),
  criarProfissional("b", { competencia: 0.7 }),
  criarProfissional("c", { competencia: 0.5 }),
];

function resumo(itens: ItemRecomendacao[]): [string, number][] {
  return itens.map((i) => [i.profissional.id, i.pontuacao]);
}

describe("RecomendadorBase", () => {
  it("e o recomendador de similaridade de cosseno da primeira atividade", () => {
    const projeto = criarProjeto();
    const base = new RecomendadorBase();
    expect(base.nome).toBe("similaridade_cosseno");
    expect(resumo(base.recomendar(projeto, papelDiretor, candidatosPadrao()))).toEqual(
      resumo(new EstrategiaSimilaridadeCosseno().recomendar(projeto, papelDiretor, candidatosPadrao()))
    );
  });
});

describe("CacheDecorator", () => {
  it("segunda chamada equivalente nao recalcula e devolve o mesmo resultado", () => {
    const base = new EstrategiaContadora();
    const cache = new CacheDecorator(base);
    const projeto = criarProjeto();

    const primeira = cache.recomendar(projeto, papelDiretor, candidatosPadrao());
    const segunda = cache.recomendar(projeto, papelDiretor, candidatosPadrao());

    expect(base.chamadas).toBe(1);
    expect(cache.falhas).toBe(1);
    expect(cache.acertos).toBe(1);
    expect(resumo(segunda)).toEqual(resumo(primeira));
  });

  it("projetos DIFERENTES porem equivalentes para o algoritmo compartilham a entrada (id nao entra na chave)", () => {
    const base = new EstrategiaContadora();
    const cache = new CacheDecorator(base);
    cache.recomendar(criarProjeto({ id: "projeto-A" }), papelDiretor, candidatosPadrao());
    cache.recomendar(criarProjeto({ id: "projeto-B" }), papelDiretor, candidatosPadrao());
    expect(base.chamadas).toBe(1);
  });

  it("recalcula quando muda algo que afeta a pontuacao", () => {
    const base = new EstrategiaContadora();
    const cache = new CacheDecorator(base);
    const projeto = criarProjeto();
    cache.recomendar(projeto, papelDiretor, candidatosPadrao());

    // peso do papel diferente
    cache.recomendar(projeto, new PapelRequerido("diretor", 0.5), candidatosPadrao());
    // competencia de um candidato mudou (mesmo id)
    const alterados = candidatosPadrao();
    alterados[0] = criarProfissional("a", { competencia: 0.2 });
    cache.recomendar(projeto, papelDiretor, alterados);
    // candidato a menos
    cache.recomendar(projeto, papelDiretor, candidatosPadrao().slice(0, 2));
    // orcamento por papel diferente
    cache.recomendar(criarProjeto({ orcamentoTotal: 1000 }), papelDiretor, candidatosPadrao());

    expect(base.chamadas).toBe(5);
    expect(cache.acertos).toBe(0);
  });

  it("a ordem dos candidatos na entrada nao altera a chave", () => {
    const projeto = criarProjeto();
    const a = gerarChaveCache("x", projeto, papelDiretor, candidatosPadrao());
    const b = gerarChaveCache("x", projeto, papelDiretor, candidatosPadrao().reverse());
    expect(a).toBe(b);
  });

  it("estrategias diferentes nunca compartilham entradas", () => {
    const cache = new CacheEmMemoria();
    const projeto = criarProjeto();
    const cosseno = new CacheDecorator(new EstrategiaSimilaridadeCosseno(), cache);
    const colaborativa = new CacheDecorator(new EstrategiaFiltragemColaborativa(), cache);
    const orcamento = new CacheDecorator(new EstrategiaOrcamentoReduzido(), cache);
    const resultados = [cosseno, colaborativa, orcamento].map((d) =>
      resumo(d.recomendar(projeto, papelDiretor, candidatosPadrao()))
    );
    expect(cache.tamanho()).toBe(3);
    expect(new Set(resultados.map((r) => JSON.stringify(r))).size).toBe(3);
  });

  it("no acerto, reidrata com os candidatos ATUAIS e nao com instancias antigas", () => {
    const cache = new CacheDecorator(new EstrategiaContadora());
    const projeto = criarProjeto();
    cache.recomendar(projeto, papelDiretor, candidatosPadrao());

    const atuais = candidatosPadrao();
    const [primeiro] = cache.recomendar(projeto, papelDiretor, atuais);
    expect(primeiro.profissional).toBe(atuais.find((c) => c.id === primeiro.profissional.id));
  });

  it("resultado vazio tambem e guardado", () => {
    const base = new EstrategiaContadora();
    const cache = new CacheDecorator(base);
    const projeto = criarProjeto();
    expect(cache.recomendar(projeto, papelDiretor, [])).toEqual([]);
    expect(cache.recomendar(projeto, papelDiretor, [])).toEqual([]);
    expect(base.chamadas).toBe(1);
  });

  it("entradas expiram apos o TTL", () => {
    let agora = 1_000;
    const cache = new CacheEmMemoria({ ttlMs: 500, relogio: () => agora });
    const base = new EstrategiaContadora();
    const decorator = new CacheDecorator(base, cache);
    const projeto = criarProjeto();

    decorator.recomendar(projeto, papelDiretor, candidatosPadrao());
    agora += 499;
    decorator.recomendar(projeto, papelDiretor, candidatosPadrao());
    expect(base.chamadas).toBe(1);

    agora += 2;
    decorator.recomendar(projeto, papelDiretor, candidatosPadrao());
    expect(base.chamadas).toBe(2);
  });

  it("descarta a entrada mais antiga ao passar do limite", () => {
    const cache = new CacheEmMemoria({ maximoEntradas: 2 });
    cache.guardar("1", []);
    cache.guardar("2", []);
    cache.guardar("1", [{ profissionalId: "x", pontuacao: 1 }]); // atualizar nao desaloja ninguem
    expect(cache.tamanho()).toBe(2);
    cache.guardar("3", []);
    expect(cache.tamanho()).toBe(2);
    expect(cache.obter("1")).toBeUndefined();
    expect(cache.obter("2")).toBeDefined();
    cache.limpar();
    expect(cache.tamanho()).toBe(0);
  });

  it("reduz o tempo de resposta de requisicoes repetidas", () => {
    class EstrategiaLenta extends EstrategiaContadora {
      recomendar(projeto: Projeto, papel: PapelRequerido, candidatos: Profissional[]): ItemRecomendacao[] {
        dormir(30);
        return super.recomendar(projeto, papel, candidatos);
      }
    }
    const lenta = new EstrategiaLenta();
    const cache = new CacheDecorator(lenta);
    const projeto = criarProjeto();

    const t0 = performance.now();
    cache.recomendar(projeto, papelDiretor, candidatosPadrao());
    const primeira = performance.now() - t0;

    const t1 = performance.now();
    cache.recomendar(projeto, papelDiretor, candidatosPadrao());
    const repetida = performance.now() - t1;

    expect(primeira).toBeGreaterThanOrEqual(25);
    expect(repetida).toBeLessThan(primeira / 3);
    expect(lenta.chamadas).toBe(1);
  });
});

describe("AuditoriaDecorator", () => {
  it("registra cada chamada com estrategia, papel, projeto, contagens e duracao", () => {
    const sorvedouro = new SorvedouroAuditoriaEmMemoria();
    let tempo = 100;
    const relogio = () => (tempo += 7);
    const auditoria = new AuditoriaDecorator(new EstrategiaContadora(), sorvedouro, relogio);

    const itens = auditoria.recomendar(criarProjeto({ id: "proj-9" }), papelDiretor, candidatosPadrao());

    expect(itens).toHaveLength(3);
    expect(sorvedouro.registros).toHaveLength(1);
    expect(sorvedouro.registros[0]).toMatchObject({
      estrategia: "contadora",
      papel: "diretor",
      projetoId: "proj-9",
      candidatos: 3,
      resultados: 3,
      duracaoMs: 7,
      sucesso: true,
    });
    expect(sorvedouro.registros[0].timestamp).toBeInstanceOf(Date);
  });

  it("registra a falha e repropaga o mesmo erro", () => {
    const sorvedouro = new SorvedouroAuditoriaEmMemoria();
    const quebrada: EstrategiaRecomendacao = {
      nome: "quebrada",
      recomendar: () => {
        throw new Error("falha interna");
      },
    };
    const auditoria = new AuditoriaDecorator(quebrada, sorvedouro);

    expect(() => auditoria.recomendar(criarProjeto(), papelDiretor, candidatosPadrao())).toThrow("falha interna");
    expect(sorvedouro.registros[0]).toMatchObject({ sucesso: false, erro: "falha interna", resultados: 0 });
  });

  it("nao altera o resultado do recomendador interno", () => {
    const projeto = criarProjeto();
    const direto = new EstrategiaSimilaridadeCosseno().recomendar(projeto, papelDiretor, candidatosPadrao());
    const auditado = new AuditoriaDecorator(new EstrategiaSimilaridadeCosseno()).recomendar(
      projeto,
      papelDiretor,
      candidatosPadrao()
    );
    expect(resumo(auditado)).toEqual(resumo(direto));
  });
});

describe("CompressaoDecorator", () => {
  const muitosCandidatos = () =>
    Array.from({ length: 80 }, (_, i) =>
      criarProfissional(`prof-${String(i).padStart(3, "0")}`, { competencia: 0.3 + (i % 7) / 10 })
    );

  it("o payload comprimido e bem menor que o original e pode ser restaurado sem perdas", () => {
    const metricas: number[] = [];
    const compressao = new CompressaoDecorator(new EstrategiaSimilaridadeCosseno(), (m) => metricas.push(m.taxa));
    const itens = compressao.recomendar(criarProjeto(), papelDiretor, muitosCandidatos());

    const { tamanhoOriginalBytes, tamanhoComprimidoBytes, taxa } = compressao.ultimaMetrica!;
    expect(tamanhoComprimidoBytes).toBeLessThan(tamanhoOriginalBytes);
    expect(taxa).toBeLessThan(0.5);
    expect(metricas).toEqual([taxa]);

    const restaurado = CompressaoDecorator.descomprimir(compressao.ultimoPayloadComprimido!);
    expect(restaurado.map((r) => [r.profissionalId, r.pontuacao])).toEqual(resumo(itens));
    expect(restaurado[0]).toMatchObject({ papel: "diretor", profissionalNome: expect.any(String) });
  });

  it("nao altera o resultado devolvido e lida com lista vazia", () => {
    const projeto = criarProjeto();
    const compressao = new CompressaoDecorator(new EstrategiaSimilaridadeCosseno());
    expect(resumo(compressao.recomendar(projeto, papelDiretor, candidatosPadrao()))).toEqual(
      resumo(new EstrategiaSimilaridadeCosseno().recomendar(projeto, papelDiretor, candidatosPadrao()))
    );
    expect(compressao.recomendar(projeto, papelDiretor, [])).toEqual([]);
    expect(CompressaoDecorator.descomprimir(compressao.ultimoPayloadComprimido!)).toEqual([]);
  });
});

describe("Pilha dinamica de decorators", () => {
  const projeto = criarProjeto();

  function pilha(decoradores: string[]) {
    const recursos = criarRecursosPadrao();
    const base = new EstrategiaContadora();
    const estrategia = new FabricaPilhaRecomendacao(recursos).montar(base, { decoradores });
    return { base, estrategia, recursos };
  }

  it("a ordem de aplicacao decide quem enxerga as chamadas: auditoria por fora do cache ve tudo", () => {
    const { base, estrategia, recursos } = pilha(["cache", "auditoria"]);
    estrategia.recomendar(projeto, papelDiretor, candidatosPadrao());
    estrategia.recomendar(projeto, papelDiretor, candidatosPadrao());
    expect(base.chamadas).toBe(1);
    expect(recursos.sorvedouroAuditoria.registros).toHaveLength(2);
  });

  it("... e com o cache por fora, a auditoria so ve o que passou pelo cache", () => {
    const { base, estrategia, recursos } = pilha(["auditoria", "cache"]);
    estrategia.recomendar(projeto, papelDiretor, candidatosPadrao());
    estrategia.recomendar(projeto, papelDiretor, candidatosPadrao());
    expect(base.chamadas).toBe(1);
    expect(recursos.sorvedouroAuditoria.registros).toHaveLength(1);
  });

  it("qualquer combinacao e ordem dos tres decorators devolve o mesmo resultado do recomendador base", () => {
    const esperado = resumo(
      new EstrategiaSimilaridadeCosseno().recomendar(projeto, papelDiretor, candidatosPadrao())
    );
    const nomes = ["cache", "auditoria", "compressao"];
    const permutacoes = (itens: string[]): string[][] =>
      itens.length <= 1
        ? [itens]
        : itens.flatMap((item, i) =>
            permutacoes([...itens.slice(0, i), ...itens.slice(i + 1)]).map((resto) => [item, ...resto])
          );
    const combinacoes = [
      ...permutacoes(nomes), // 6 ordens com os tres
      ...nomes.flatMap((a) => nomes.filter((b) => b !== a).map((b) => [a, b])), // pares ordenados
      ...nomes.map((n) => [n]),
    ];
    expect(combinacoes.length).toBe(6 + 6 + 3);

    for (const combinacao of combinacoes) {
      const { estrategia } = pilha(combinacao);
      expect(resumo(estrategia.recomendar(projeto, papelDiretor, candidatosPadrao()))).toEqual(esperado);
      expect(resumo(estrategia.recomendar(projeto, papelDiretor, candidatosPadrao()))).toEqual(esperado);
    }
  });

  it("os tres juntos: cache evita o recalculo, auditoria registra tudo e compressao mede o payload", () => {
    const metricas: unknown[] = [];
    const recursos = { ...criarRecursosPadrao(), aoComprimir: (m: unknown) => metricas.push(m) };
    const base = new EstrategiaContadora();
    const estrategia = new FabricaPilhaRecomendacao(recursos).montar(base, {
      decoradores: ["cache", "auditoria", "compressao"],
    });
    for (let i = 0; i < 3; i++) estrategia.recomendar(projeto, papelDiretor, candidatosPadrao());

    expect(base.chamadas).toBe(1);
    expect(recursos.sorvedouroAuditoria.registros).toHaveLength(3);
    expect(metricas).toHaveLength(3);
  });

  it("a pilha e transparente: mantem o nome da estrategia base", () => {
    expect(pilha(["cache", "auditoria", "compressao"]).estrategia.nome).toBe("contadora");
  });

  it("politica vazia devolve a propria estrategia, sem envolver nada", () => {
    const base = new EstrategiaContadora();
    expect(new FabricaPilhaRecomendacao().montar(base, { decoradores: [] })).toBe(base);
  });

  it("a mesma fabrica compartilha o cache entre pilhas montadas em momentos diferentes", () => {
    const fabrica = new FabricaPilhaRecomendacao();
    const base = new EstrategiaContadora();
    fabrica.montar(base, { decoradores: ["cache"] }).recomendar(projeto, papelDiretor, candidatosPadrao());
    fabrica.montar(base, { decoradores: ["cache"] }).recomendar(projeto, papelDiretor, candidatosPadrao());
    expect(base.chamadas).toBe(1);
  });

  it("rejeita decorator desconhecido ou repetido", () => {
    const fabrica = new FabricaPilhaRecomendacao();
    const base = new EstrategiaContadora();
    expect(() => fabrica.montar(base, { decoradores: ["cache", "magia"] })).toThrow(/desconhecido: "magia"/);
    expect(() => fabrica.montar(base, { decoradores: ["cache", "cache"] })).toThrow(/repetido/);
  });

  it("le a politica de um texto de configuracao", () => {
    expect(FabricaPilhaRecomendacao.politicaDeTexto(" Cache, auditoria ,, ")).toEqual({
      decoradores: ["cache", "auditoria"],
    });
    expect(FabricaPilhaRecomendacao.politicaDeTexto(undefined)).toEqual({ decoradores: [] });
    expect(FabricaPilhaRecomendacao.politicaDeTexto("")).toEqual({ decoradores: [] });
  });

  it("decora tambem as outras estrategias, sem alterar suas pontuacoes", () => {
    const fabrica = new FabricaPilhaRecomendacao();
    for (const base of [new EstrategiaFiltragemColaborativa(), new EstrategiaOrcamentoReduzido()]) {
      const direto = resumo(base.recomendar(projeto, papelDiretor, candidatosPadrao()));
      const decorada = fabrica.montar(base, { decoradores: ["cache", "auditoria", "compressao"] });
      expect(resumo(decorada.recomendar(projeto, papelDiretor, candidatosPadrao()))).toEqual(direto);
    }
  });

  it("nao interfere em erros do recomendador interno", () => {
    const quebrada: EstrategiaRecomendacao = {
      nome: "quebrada",
      recomendar: vi.fn(() => {
        throw new Error("boom");
      }),
    };
    const estrategia = new FabricaPilhaRecomendacao().montar(quebrada, {
      decoradores: ["cache", "auditoria", "compressao"],
    });
    expect(() => estrategia.recomendar(projeto, papelDiretor, candidatosPadrao())).toThrow("boom");
  });
});
