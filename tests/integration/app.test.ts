import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { FastifyInstance } from "fastify";
import { construirApp } from "../../src/server/app";
import { construirDependencias } from "../../src/server/composition-root";
import { CriarProjetoDTO } from "../../src/server/dto";

describe("Integracao: POST /projetos/recomendacoes", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = construirApp(construirDependencias());
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("responde 200/201 com a equipe recomendada para um projeto valido", async () => {
    const payload: CriarProjetoDTO = {
      genero: "documentario",
      duracaoEstimadaMinutos: 90,
      orcamentoTotal: 60000,
      dataEntrega: "2027-05-01T00:00:00.000Z",
      tipoCaptacao: "documentario",
      localizacao: { cidade: "Sao Paulo", estado: "SP", pais: "Brasil" },
      papeisRequeridos: [
        { nome: "diretor", peso: 1 },
        { nome: "editor", peso: 0.5 },
      ],
      estrategia: "similaridade_cosseno",
    };

    const resposta = await app.inject({
      method: "POST",
      url: "/projetos/recomendacoes",
      payload,
    });

    expect(resposta.statusCode).toBe(201);
    const corpo = resposta.json();
    expect(corpo.itens.length).toBeGreaterThan(0);
    expect(corpo.validacao.valido).toBe(true);
    expect(corpo.relatorio.projetoId).toBeDefined();
  });

  it("responde 400 quando o projeto nao possui papeis requeridos", async () => {
    const payloadInvalido = {
      genero: "ficcao",
      duracaoEstimadaMinutos: 90,
      orcamentoTotal: 60000,
      dataEntrega: "2027-05-01T00:00:00.000Z",
      tipoCaptacao: "ficcao",
      localizacao: { cidade: "Sao Paulo", estado: "SP", pais: "Brasil" },
      papeisRequeridos: [],
    };

    const resposta = await app.inject({
      method: "POST",
      url: "/projetos/recomendacoes",
      payload: payloadInvalido,
    });

    expect(resposta.statusCode).toBe(400);
  });

  it("responde 400 quando a data de entrega ja passou", async () => {
    const payloadInvalido: CriarProjetoDTO = {
      genero: "ficcao",
      duracaoEstimadaMinutos: 90,
      orcamentoTotal: 60000,
      dataEntrega: "2020-01-01T00:00:00.000Z",
      tipoCaptacao: "ficcao",
      localizacao: { cidade: "Sao Paulo", estado: "SP", pais: "Brasil" },
      papeisRequeridos: [{ nome: "diretor", peso: 1 }],
    };

    const resposta = await app.inject({
      method: "POST",
      url: "/projetos/recomendacoes",
      payload: payloadInvalido,
    });

    expect(resposta.statusCode).toBe(400);
  });

  it("responde ok em /saude", async () => {
    const resposta = await app.inject({ method: "GET", url: "/saude" });
    expect(resposta.statusCode).toBe(200);
    expect(resposta.json()).toEqual({ status: "ok" });
  });
});
