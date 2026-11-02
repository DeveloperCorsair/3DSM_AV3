import { describe, it, expect } from "vitest";
import { ItemRecomendacao, PapelRequerido, Profissional, Projeto, Recomendacao, VetorCompetencia } from "../../src/domain/entities";
import {
  VisitanteCompatibilidadeEquipe,
  VisitanteRelatorioEquipe,
  VisitanteValidacaoConsistencia,
} from "../../src/visitors/recommendation-visitor";

function criarProfissional(id: string, precoMinimo: number): Profissional {
  return new Profissional(
    id,
    `Profissional ${id}`,
    ["diretor"],
    { minimo: precoMinimo, maximo: precoMinimo * 2 },
    [],
    { cidade: "Sao Paulo", estado: "SP", pais: "Brasil" },
    new VetorCompetencia(new Map())
  );
}

function criarProjeto(orcamentoTotal: number, papeis: PapelRequerido[]): Projeto {
  return new Projeto(
    "proj-v",
    "documentario",
    60,
    orcamentoTotal,
    new Date("2027-01-01"),
    "documentario",
    { cidade: "Sao Paulo", estado: "SP", pais: "Brasil" },
    papeis
  );
}

describe("Visitor: VisitanteValidacaoConsistencia", () => {
  it("acusa papel obrigatorio nao preenchido", () => {
    const projeto = criarProjeto(20000, [
      new PapelRequerido("diretor", 1),
      new PapelRequerido("editor", 0.5),
    ]);
    const recomendacao = new Recomendacao("rec-1", projeto.id, [
      new ItemRecomendacao("diretor", criarProfissional("p1", 5000), 0.8),
    ]);

    const resultado = new VisitanteValidacaoConsistencia().visitarProjeto(
      projeto,
      recomendacao
    );

    expect(resultado.valido).toBe(false);
    expect(resultado.erros.some((e) => e.includes("editor"))).toBe(true);
  });

  it("acusa orcamento insuficiente quando o custo total excede o orcamento", () => {
    const projeto = criarProjeto(1000, [new PapelRequerido("diretor", 1)]);
    const recomendacao = new Recomendacao("rec-2", projeto.id, [
      new ItemRecomendacao("diretor", criarProfissional("p1", 5000), 0.8),
    ]);

    const resultado = new VisitanteValidacaoConsistencia().visitarProjeto(
      projeto,
      recomendacao
    );

    expect(resultado.valido).toBe(false);
    expect(resultado.erros.some((e) => /orcamento/i.test(e))).toBe(true);
  });

  it("considera valida uma recomendacao completa e dentro do orcamento", () => {
    const projeto = criarProjeto(20000, [new PapelRequerido("diretor", 1)]);
    const recomendacao = new Recomendacao("rec-3", projeto.id, [
      new ItemRecomendacao("diretor", criarProfissional("p1", 5000), 0.8),
    ]);

    const resultado = new VisitanteValidacaoConsistencia().visitarProjeto(
      projeto,
      recomendacao
    );

    expect(resultado.valido).toBe(true);
    expect(resultado.erros).toHaveLength(0);
  });
});

describe("Visitor: VisitanteCompatibilidadeEquipe", () => {
  it("calcula a media ponderada de pontuacao pelos pesos dos papeis", () => {
    const projeto = criarProjeto(20000, [
      new PapelRequerido("diretor", 1),
      new PapelRequerido("editor", 1),
    ]);
    const recomendacao = new Recomendacao("rec-4", projeto.id, [
      new ItemRecomendacao("diretor", criarProfissional("p1", 5000), 1.0),
      new ItemRecomendacao("editor", criarProfissional("p2", 5000), 0.5),
    ]);

    const compatibilidade = new VisitanteCompatibilidadeEquipe().visitarProjeto(
      projeto,
      recomendacao
    );

    expect(compatibilidade).toBeCloseTo(0.75, 5);
  });
});

describe("Visitor: VisitanteRelatorioEquipe", () => {
  it("gera um relatorio completo sem alterar as classes de dominio", () => {
    const projeto = criarProjeto(20000, [new PapelRequerido("diretor", 1)]);
    const recomendacao = new Recomendacao("rec-5", projeto.id, [
      new ItemRecomendacao("diretor", criarProfissional("p1", 5000), 0.9),
    ]);

    const relatorio = new VisitanteRelatorioEquipe().visitarProjeto(
      projeto,
      recomendacao
    );

    expect(relatorio.projetoId).toBe(projeto.id);
    expect(relatorio.margemOrcamentaria).toBe(15000);
    expect(relatorio.papeisPreenchidos).toEqual(["diretor"]);
  });

  it("os tres visitantes operam sobre a mesma estrutura sem se interferir", () => {
    const projeto = criarProjeto(20000, [new PapelRequerido("diretor", 1)]);
    const recomendacao = new Recomendacao("rec-6", projeto.id, [
      new ItemRecomendacao("diretor", criarProfissional("p1", 5000), 0.9),
    ]);

    const validacao = new VisitanteValidacaoConsistencia().visitarProjeto(projeto, recomendacao);
    const compatibilidade = new VisitanteCompatibilidadeEquipe().visitarProjeto(projeto, recomendacao);
    const relatorio = new VisitanteRelatorioEquipe().visitarProjeto(projeto, recomendacao);

    expect(validacao.valido).toBe(true);
    expect(compatibilidade).toBeCloseTo(0.9, 5);
    expect(relatorio.compatibilidadeMedia).toBeCloseTo(0.9, 5);
  });
});
