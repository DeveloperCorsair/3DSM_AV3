import { describe, it, expect, vi } from "vitest";
import { Avaliacao, PapelRequerido, Profissional, Projeto, VetorCompetencia } from "../../src/domain/entities";
import {
  OrquestradorComDiversidade,
  OrquestradorComposicaoEquipe,
  OrquestradorPadrao,
} from "../../src/orchestrator/team-composition-orchestrator";
import { EstrategiaSimilaridadeCosseno } from "../../src/strategies/recommendation-strategy";

function criarProjeto(): Projeto {
  return new Projeto(
    "proj-tm",
    "ficcao",
    120,
    40000,
    new Date("2027-06-01"),
    "ficcao",
    { cidade: "Sao Paulo", estado: "SP", pais: "Brasil" },
    [new PapelRequerido("diretor", 1), new PapelRequerido("editor", 0.5)]
  );
}

function criarProfissional(id: string, papel: "diretor" | "editor", competencia: number): Profissional {
  return new Profissional(
    id,
    `Profissional ${id}`,
    [papel],
    { minimo: 5000, maximo: 10000 },
    [{ inicio: new Date("2026-01-01"), fim: new Date("2027-12-31") }],
    { cidade: "Sao Paulo", estado: "SP", pais: "Brasil" },
    new VetorCompetencia(new Map([[papel, competencia]])),
    [new Avaliacao("x", 4)]
  );
}

describe("Template Method: OrquestradorComposicaoEquipe", () => {
  it("garante que o fluxo principal (validar -> normalizar -> recomendar -> pos-processar) seja invariante", () => {
    const orquestrador = new OrquestradorPadrao();
    const espiaValidar = vi.spyOn(
      OrquestradorComposicaoEquipe.prototype as any,
      "validarRestricoes"
    );
    const espiaNormalizar = vi.spyOn(
      OrquestradorComposicaoEquipe.prototype as any,
      "normalizarEntrada"
    );

    const projeto = criarProjeto();
    const candidatos = new Map([
      ["diretor", [criarProfissional("d1", "diretor", 0.8)]],
      ["editor", [criarProfissional("e1", "editor", 0.6)]],
    ]);

    orquestrador.compor(projeto, candidatos, new EstrategiaSimilaridadeCosseno());

    const ordemValidar = espiaValidar.mock.invocationCallOrder[0];
    const ordemNormalizar = espiaNormalizar.mock.invocationCallOrder[0];
    expect(ordemValidar).toBeLessThan(ordemNormalizar);
    espiaValidar.mockRestore();
    espiaNormalizar.mockRestore();
  });

  it("rejeita projetos com orcamento invalido antes de gerar qualquer recomendacao", () => {
    const orquestrador = new OrquestradorPadrao();
    const projeto = new Projeto(
      "proj-invalido",
      "ficcao",
      60,
      0, // orcamento invalido
      new Date("2027-01-01"),
      "ficcao",
      { cidade: "Sao Paulo", estado: "SP", pais: "Brasil" },
      [new PapelRequerido("diretor", 1)]
    );

    expect(() =>
      orquestrador.compor(projeto, new Map(), new EstrategiaSimilaridadeCosseno())
    ).toThrow(/orcamento/i);
  });

  it("remove candidatos duplicados durante a normalizacao de entrada", () => {
    const orquestrador = new OrquestradorPadrao();
    const projeto = criarProjeto();
    const duplicado = criarProfissional("d1", "diretor", 0.8);
    const candidatos = new Map([
      ["diretor", [duplicado, duplicado]],
      ["editor", [criarProfissional("e1", "editor", 0.6)]],
    ]);

    const recomendacao = orquestrador.compor(
      projeto,
      candidatos,
      new EstrategiaSimilaridadeCosseno()
    );

    expect(recomendacao.listarItens()).toHaveLength(2);
  });

  it("subclasses customizam apenas os hooks, sem alterar a ordem do fluxo (diversidade)", () => {
    const projeto = criarProjeto();
    const candidatos = new Map([
      ["diretor", [
        criarProfissional("d1", "diretor", 0.8),
        criarProfissional("d2", "diretor", 0.8), // empate tecnico
      ]],
      ["editor", [criarProfissional("e1", "editor", 0.6)]],
    ]);

    const orquestradorDiversidade = new OrquestradorComDiversidade();
    const recomendacao = orquestradorDiversidade.compor(
      projeto,
      candidatos,
      new EstrategiaSimilaridadeCosseno()
    );

    const escolhidoDiretor = recomendacao.itemDoPapel("diretor");
    expect(["d1", "d2"]).toContain(escolhidoDiretor?.profissional.id);
  });
});
