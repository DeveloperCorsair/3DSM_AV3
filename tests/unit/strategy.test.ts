import { describe, it, expect } from "vitest";
import { Avaliacao, PapelRequerido, Profissional, Projeto, VetorCompetencia } from "../../src/domain/entities";
import {
  EstrategiaFiltragemColaborativa,
  EstrategiaOrcamentoReduzido,
  EstrategiaSimilaridadeCosseno,
  FabricaEstrategiaRecomendacao,
} from "../../src/strategies/recommendation-strategy";

function criarProjeto(orcamentoTotal: number): Projeto {
  return new Projeto(
    "proj-1",
    "documentario social",
    90,
    orcamentoTotal,
    new Date("2027-01-01"),
    "documentario",
    { cidade: "Sao Paulo", estado: "SP", pais: "Brasil" },
    [new PapelRequerido("diretor", 1)]
  );
}

function criarProfissional(
  id: string,
  precoMinimo: number,
  competencia: number,
  nota: number,
  qtdAvaliacoes: number
): Profissional {
  const historico = Array.from(
    { length: qtdAvaliacoes },
    () => new Avaliacao("proj-x", nota)
  );
  return new Profissional(
    id,
    `Profissional ${id}`,
    ["diretor"],
    { minimo: precoMinimo, maximo: precoMinimo * 2 },
    [{ inicio: new Date("2026-01-01"), fim: new Date("2027-12-31") }],
    { cidade: "Sao Paulo", estado: "SP", pais: "Brasil" },
    new VetorCompetencia(new Map([["diretor", competencia]])),
    historico
  );
}

describe("Strategy: EstrategiaSimilaridadeCosseno", () => {
  it("ranqueia profissionais pela maior competencia no papel", () => {
    const estrategia = new EstrategiaSimilaridadeCosseno();
    const projeto = criarProjeto(50000);
    const papel = projeto.papeisRequeridos[0];
    const candidatos = [
      criarProfissional("a", 5000, 0.4, 4, 3),
      criarProfissional("b", 5000, 0.9, 3, 1),
    ];

    const resultado = estrategia.recomendar(projeto, papel, candidatos);

    expect(resultado[0].profissional.id).toBe("b");
    expect(resultado[0].pontuacao).toBeGreaterThan(resultado[1].pontuacao);
  });
});

describe("Strategy: EstrategiaFiltragemColaborativa", () => {
  it("prioriza profissionais com melhor nota media e mais avaliacoes", () => {
    const estrategia = new EstrategiaFiltragemColaborativa();
    const projeto = criarProjeto(50000);
    const papel = projeto.papeisRequeridos[0];
    const candidatos = [
      criarProfissional("a", 5000, 0.5, 5, 10),
      criarProfissional("b", 5000, 0.5, 2, 10),
    ];

    const resultado = estrategia.recomendar(projeto, papel, candidatos);

    expect(resultado[0].profissional.id).toBe("a");
  });
});

describe("Strategy: EstrategiaOrcamentoReduzido", () => {
  it("descarta candidatos fora do orcamento por papel", () => {
    const estrategia = new EstrategiaOrcamentoReduzido();
    const projeto = criarProjeto(6000); // orcamento por papel baixo (1 papel)
    const papel = projeto.papeisRequeridos[0];
    const candidatos = [
      criarProfissional("barato", 3000, 0.5, 4, 2),
      criarProfissional("caro", 20000, 0.9, 5, 5),
    ];

    const resultado = estrategia.recomendar(projeto, papel, candidatos);

    expect(resultado).toHaveLength(1);
    expect(resultado[0].profissional.id).toBe("barato");
  });
});

describe("FabricaEstrategiaRecomendacao", () => {
  it("resolve a estrategia correta pelo nome e altera o resultado da recomendacao", () => {
    const projeto = criarProjeto(50000);
    const papel = projeto.papeisRequeridos[0];
    const candidatos = [
      criarProfissional("competente_caro", 15000, 0.95, 3, 1),
      criarProfissional("mediano_barato", 3000, 0.5, 4, 8),
    ];

    const porCosseno = FabricaEstrategiaRecomendacao.obter(
      "similaridade_cosseno"
    ).recomendar(projeto, papel, candidatos);
    const porColaborativa = FabricaEstrategiaRecomendacao.obter(
      "filtragem_colaborativa"
    ).recomendar(projeto, papel, candidatos);

    // A troca de estrategia altera qual profissional fica em primeiro lugar.
    expect(porCosseno[0].profissional.id).toBe("competente_caro");
    expect(porColaborativa[0].profissional.id).toBe("mediano_barato");
  });

  it("lanca erro para estrategia desconhecida", () => {
    expect(() => FabricaEstrategiaRecomendacao.obter("inexistente")).toThrow();
  });
});
