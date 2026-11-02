import { describe, it, expect } from "vitest";
import {
  coletarServicosAtomicos,
  descreverServico,
  PacoteServico,
  ServicoAtomico,
} from "../../src/composite/project-service";
import { NomePapel, PapelRequerido } from "../../src/domain/entities";
import { OrquestradorPadrao } from "../../src/orchestrator/team-composition-orchestrator";
import { EstrategiaSimilaridadeCosseno } from "../../src/strategies/recommendation-strategy";
import {
  dtoParaProjeto,
  CriarProjetoDTO,
  PROFUNDIDADE_MAXIMA_SERVICOS,
  ServicoDTO,
} from "../../src/server/dto";
import { criarProfissional, criarProjeto, dataEmDias } from "../helpers";

/**
 * pos-producao (sequencial)
 * |- edicao ........................ 2000 / 5 dias
 * `- acabamento (paralela)
 *    |- coloracao ................... 1500 / 3 dias
 *    |- mixagem ..................... 1800 / 4 dias
 *    `- efeitos (sequencial)
 *       |- vfx-1 .................... 3000 / 6 dias
 *       `- vfx-2 .................... 2500 / 4 dias
 */
function montarPosProducao(): PacoteServico {
  const efeitos = new PacoteServico("efeitos", "sequencial", [
    new ServicoAtomico("vfx-1", 3000, 6, "efeitos_visuais"),
    new ServicoAtomico("vfx-2", 2500, 4, "efeitos_visuais"),
  ]);
  const acabamento = new PacoteServico("acabamento", "paralela", [
    new ServicoAtomico("coloracao", 1500, 3, "diretor_fotografia"),
    new ServicoAtomico("mixagem", 1800, 4, "sonoplasta"),
    efeitos,
  ]);
  return new PacoteServico("pos-producao", "sequencial", [
    new ServicoAtomico("edicao", 2000, 5, "editor"),
    acabamento,
  ]);
}

describe("Composite: calculo recursivo", () => {
  it("servico atomico e uma folha com custo e prazo proprios", () => {
    const edicao = new ServicoAtomico("edicao", 2000, 5, "editor");
    expect(edicao.calcularCusto()).toBe(2000);
    expect(edicao.obterPrazo()).toBe(5);
    expect(edicao.listarSubservicos()).toEqual([]);
  });

  it("soma custos em qualquer profundidade", () => {
    expect(montarPosProducao().calcularCusto()).toBe(2000 + 1500 + 1800 + 3000 + 2500);
  });

  it("prazo: pacote sequencial soma, pacote paralelo usa o maior", () => {
    // efeitos = 6 + 4 = 10; acabamento = max(3, 4, 10) = 10; pos-producao = 5 + 10
    const pos = montarPosProducao();
    expect(pos.obterPrazo()).toBe(15);
    const [, acabamento] = pos.listarSubservicos();
    expect(acabamento.obterPrazo()).toBe(10);
  });

  it("pacote atomico (com um unico filho) e pacote vazio se comportam de forma uniforme", () => {
    const unico = new PacoteServico("unico", "sequencial", [new ServicoAtomico("a", 100, 2, "editor")]);
    expect(unico.calcularCusto()).toBe(100);
    expect(unico.obterPrazo()).toBe(2);

    const vazio = new PacoteServico("vazio");
    expect(vazio.calcularCusto()).toBe(0);
    expect(vazio.obterPrazo()).toBe(0);
  });

  it("um pacote pode conter pacotes de profundidades diferentes lado a lado", () => {
    const raiz = new PacoteServico("raiz", "paralela", [
      new ServicoAtomico("solto", 10, 1, "editor"),
      new PacoteServico("n1", "sequencial", [
        new PacoteServico("n2", "sequencial", [new ServicoAtomico("fundo", 20, 7, "roteirista")]),
      ]),
    ]);
    expect(raiz.calcularCusto()).toBe(30);
    expect(raiz.obterPrazo()).toBe(7);
  });

  it("listarSubservicos devolve copia: alterar o resultado nao muda a estrutura", () => {
    const pacote = new PacoteServico("p", "sequencial", [new ServicoAtomico("a", 1, 1, "editor")]);
    pacote.listarSubservicos().pop();
    expect(pacote.listarSubservicos()).toHaveLength(1);
  });

  it("coletarServicosAtomicos devolve apenas as folhas, em ordem", () => {
    const nomes = coletarServicosAtomicos(montarPosProducao()).map((s) => s.nome);
    expect(nomes).toEqual(["edicao", "coloracao", "mixagem", "vfx-1", "vfx-2"]);
  });

  it("descreverServico gera a arvore com custo e prazo calculados em cada no", () => {
    const descricao = descreverServico(montarPosProducao());
    expect(descricao).toMatchObject({ tipo: "pacote", nome: "pos-producao", custo: 10800, prazoDias: 15 });
    expect(descricao.subservicos?.[1]).toMatchObject({ nome: "acabamento", execucao: "paralela", prazoDias: 10 });
    expect(descricao.subservicos?.[0]).toMatchObject({ tipo: "atomico", papel: "editor", custo: 2000 });
  });
});

describe("Composite: estrutura segura", () => {
  it("rejeita ciclos: pacote dentro de si mesmo ou de um descendente", () => {
    const a = new PacoteServico("a");
    const b = new PacoteServico("b");
    expect(() => a.adicionar(a)).toThrow(/Ciclo/);
    a.adicionar(b);
    expect(() => b.adicionar(a)).toThrow(/Ciclo/);
  });

  it("rejeita o mesmo servico duas vezes no mesmo pacote (custo contado em dobro)", () => {
    const servico = new ServicoAtomico("a", 1, 1, "editor");
    const pacote = new PacoteServico("p").adicionar(servico);
    expect(() => pacote.adicionar(servico)).toThrow(/ja faz parte/);
  });
});

describe("Composite: validacao recursiva", () => {
  it("estrutura correta e valida", () => {
    expect(montarPosProducao().validar()).toEqual({ valido: true, erros: [] });
  });

  it("acumula erros de todos os niveis, citando o servico com problema", () => {
    const profundo = new PacoteServico("l1", "sequencial", [
      new PacoteServico("l2", "sequencial", [
        new ServicoAtomico("papel-ruim", 100, 3, "inexistente" as NomePapel),
        new ServicoAtomico("custo-ruim", -5, 3, "editor"),
        new ServicoAtomico("prazo-ruim", 100, 0, "editor"),
      ]),
      new PacoteServico("vazio"),
    ]);
    const { valido, erros } = profundo.validar();
    expect(valido).toBe(false);
    expect(erros).toHaveLength(4);
    expect(erros.join("\n")).toMatch(/papel-ruim.*papel tecnico invalido/);
    expect(erros.join("\n")).toMatch(/custo-ruim.*custo invalido/);
    expect(erros.join("\n")).toMatch(/prazo-ruim.*prazo deve ser maior que zero/);
    expect(erros.join("\n")).toMatch(/vazio.*nao possui subservicos/);
  });

  it("falha quando o prazo calculado ultrapassa o prazo maximo do pacote", () => {
    const pacote = new PacoteServico(
      "apertado",
      "sequencial",
      [new ServicoAtomico("a", 1, 6, "editor"), new ServicoAtomico("b", 1, 6, "editor")],
      10
    );
    const { valido, erros } = pacote.validar();
    expect(valido).toBe(false);
    expect(erros[0]).toMatch(/12 dias.*excede.*10 dias/);
  });

  it("pacote paralelo cabe no mesmo prazo maximo em que o sequencial estoura", () => {
    const filhos = () => [new ServicoAtomico("a", 1, 6, "editor"), new ServicoAtomico("b", 1, 6, "editor")];
    expect(new PacoteServico("p", "paralela", filhos(), 10).validar().valido).toBe(true);
    expect(new PacoteServico("p", "sequencial", filhos(), 10).validar().valido).toBe(false);
  });

  it("rejeita nome vazio e peso fora de 0..1", () => {
    expect(new ServicoAtomico(" ", 1, 1, "editor").validar().valido).toBe(false);
    expect(new ServicoAtomico("a", 1, 1, "editor", 1.5).validar().valido).toBe(false);
    expect(new PacoteServico("", "sequencial", [new ServicoAtomico("a", 1, 1, "editor")]).validar().valido).toBe(
      false
    );
  });
});

describe("Composite: integracao com Projeto", () => {
  it("calcularCustoTotal e obterPrazoTotal delegam ao servico principal", () => {
    const projeto = criarProjeto({ servicoPrincipal: montarPosProducao() });
    expect(projeto.calcularCustoTotal()).toBe(10800);
    expect(projeto.obterPrazoTotal()).toBe(15);
  });

  it("projeto sem servico principal mantem o comportamento anterior", () => {
    const projeto = criarProjeto();
    expect(projeto.calcularCustoTotal()).toBe(0);
    expect(projeto.obterPrazoTotal()).toBe(0);
    expect(projeto.validarEstrutura()).toEqual({ valido: true, erros: [] });
  });

  it("validarEstrutura confere se o prazo total cabe ate a data de entrega", () => {
    const cabe = criarProjeto({ servicoPrincipal: montarPosProducao(), diasAteEntrega: 30 });
    expect(cabe.validarEstrutura().valido).toBe(true);

    const estoura = criarProjeto({ servicoPrincipal: montarPosProducao(), diasAteEntrega: 10 });
    const resultado = estoura.validarEstrutura();
    expect(resultado.valido).toBe(false);
    expect(resultado.erros.join(" ")).toMatch(/15 dias.*excede.*ate a entrega/);
  });

  it("validarEstrutura aceita uma data de referencia", () => {
    const projeto = criarProjeto({ servicoPrincipal: montarPosProducao(), diasAteEntrega: 20 });
    expect(projeto.validarEstrutura(dataEmDias(10)).valido).toBe(false);
    expect(projeto.validarEstrutura(dataEmDias(0)).valido).toBe(true);
  });

  it("o orquestrador recusa compor equipe para projeto com estrutura invalida", () => {
    const servicoRuim = new PacoteServico("p", "sequencial", [
      new ServicoAtomico("x", 100, 3, "inexistente" as NomePapel),
    ]);
    const projeto = criarProjeto({ servicoPrincipal: servicoRuim });
    const candidatos = new Map([["diretor", [criarProfissional("p1")]]]);
    expect(() =>
      new OrquestradorPadrao().compor(projeto, candidatos, new EstrategiaSimilaridadeCosseno())
    ).toThrow(/Estrutura de servicos invalida.*papel tecnico invalido/);
  });
});

describe("Composite: DTO", () => {
  function dtoBase(extra: Partial<CriarProjetoDTO>): CriarProjetoDTO {
    return {
      genero: "ficcao",
      duracaoEstimadaMinutos: 100,
      orcamentoTotal: 90000,
      dataEntrega: dataEmDias(300).toISOString(),
      tipoCaptacao: "ficcao",
      localizacao: { cidade: "Sao Paulo", estado: "SP", pais: "Brasil" },
      ...extra,
    };
  }

  const arvore: ServicoDTO = {
    tipo: "pacote",
    nome: "producao",
    execucao: "sequencial",
    subservicos: [
      { tipo: "atomico", nome: "roteiro", custo: 5000, prazoDias: 20, papel: "roteirista", peso: 0.6 },
      { tipo: "atomico", nome: "direcao", custo: 9000, prazoDias: 30, papel: "diretor" },
      { tipo: "atomico", nome: "revisao", custo: 1000, prazoDias: 5, papel: "roteirista", peso: 0.9 },
    ],
  };

  it("monta a hierarquia e deriva os papeis requeridos dos servicos atomicos (maior peso por papel)", () => {
    const projeto = dtoParaProjeto(dtoBase({ servicoPrincipal: arvore }), "id-1");
    expect(projeto.calcularCustoTotal()).toBe(15000);
    expect(projeto.obterPrazoTotal()).toBe(55);
    const pesos = Object.fromEntries(projeto.papeisRequeridos.map((p) => [p.nome, p.peso]));
    expect(pesos).toEqual({ roteirista: 0.9, diretor: 1 });
  });

  it("papeisRequeridos informados explicitamente tem precedencia sobre os derivados", () => {
    const projeto = dtoBase({
      servicoPrincipal: arvore,
      papeisRequeridos: [{ nome: "editor", peso: 0.5 }],
    });
    expect(dtoParaProjeto(projeto, "id-1").papeisRequeridos).toEqual([new PapelRequerido("editor", 0.5)]);
  });

  it("sem papeis e sem servicos continua sendo erro", () => {
    expect(() => dtoParaProjeto(dtoBase({}), "id-1")).toThrow(/ao menos um papel requerido/);
  });

  it("rejeita tipo desconhecido e pacote sem lista de subservicos", () => {
    expect(() =>
      dtoParaProjeto(dtoBase({ servicoPrincipal: { tipo: "outro" } as unknown as ServicoDTO }), "id")
    ).toThrow(/Tipo de servico desconhecido/);
    expect(() =>
      dtoParaProjeto(dtoBase({ servicoPrincipal: { tipo: "pacote", nome: "x" } as unknown as ServicoDTO }), "id")
    ).toThrow(/lista de subservicos/);
  });

  it("limita a profundidade da hierarquia recebida", () => {
    let no: ServicoDTO = { tipo: "atomico", nome: "folha", custo: 1, prazoDias: 1, papel: "editor" };
    for (let i = 0; i < PROFUNDIDADE_MAXIMA_SERVICOS; i++) {
      no = { tipo: "pacote", nome: `n${i}`, subservicos: [no] };
    }
    expect(() => dtoParaProjeto(dtoBase({ servicoPrincipal: no }), "id")).toThrow(/profundidade maxima/);
  });
});
