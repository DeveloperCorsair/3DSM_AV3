import { describe, it, expect, vi } from "vitest";
import {
  RepositorioProfissionais,
  RepositorioProfissionaisEmMemoria,
  RepositorioProfissionaisTolerranteAFalhas,
} from "../../src/repository/professional-repository";

class RepositorioQueFalha implements RepositorioProfissionais {
  async buscarTodos(): Promise<never> {
    throw new Error("Indisponivel");
  }
  async buscarPorId(): Promise<never> {
    throw new Error("Indisponivel");
  }
}

describe("RepositorioProfissionaisTolerranteAFalhas", () => {
  it("retorna lista vazia (fallback) quando o repositorio interno falha em buscarTodos", async () => {
    const aoFalhar = vi.fn();
    const repositorio = new RepositorioProfissionaisTolerranteAFalhas(
      new RepositorioQueFalha(),
      aoFalhar
    );

    const resultado = await repositorio.buscarTodos();

    expect(resultado).toEqual([]);
    expect(aoFalhar).toHaveBeenCalledOnce();
  });

  it("retorna undefined (fallback) quando o repositorio interno falha em buscarPorId", async () => {
    const repositorio = new RepositorioProfissionaisTolerranteAFalhas(
      new RepositorioQueFalha()
    );

    const resultado = await repositorio.buscarPorId("qualquer");

    expect(resultado).toBeUndefined();
  });

  it("delega normalmente quando o repositorio interno funciona", async () => {
    const interno = new RepositorioProfissionaisEmMemoria();
    const repositorio = new RepositorioProfissionaisTolerranteAFalhas(interno);

    const resultado = await repositorio.buscarTodos();

    expect(resultado).toEqual([]);
  });
});
