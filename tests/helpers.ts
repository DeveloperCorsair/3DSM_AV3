import {
  Avaliacao,
  NomePapel,
  PapelRequerido,
  Profissional,
  Projeto,
  VetorCompetencia,
} from "../src/domain/entities";
import { ServicoProjeto } from "../src/composite/project-service";

export const UM_DIA_MS = 86_400_000;

/** Data de entrega relativa a hoje, para os testes nao envelhecerem. */
export function dataEmDias(dias: number): Date {
  return new Date(Date.now() + dias * UM_DIA_MS);
}

export interface OpcoesProfissional {
  papel?: NomePapel;
  precoMinimo?: number;
  competencia?: number;
  nota?: number;
  avaliacoes?: number;
  cidade?: string;
}

export function criarProfissional(id: string, opcoes: OpcoesProfissional = {}): Profissional {
  const {
    papel = "diretor",
    precoMinimo = 5000,
    competencia = 0.8,
    nota = 4,
    avaliacoes = 2,
    cidade = "Sao Paulo",
  } = opcoes;
  return new Profissional(
    id,
    `Profissional ${id}`,
    [papel],
    { minimo: precoMinimo, maximo: precoMinimo * 2 },
    [{ inicio: new Date("2026-01-01"), fim: new Date("2030-12-31") }],
    { cidade, estado: "SP", pais: "Brasil" },
    new VetorCompetencia(new Map([[papel, competencia]])),
    Array.from({ length: avaliacoes }, () => new Avaliacao("proj-x", nota))
  );
}

export interface OpcoesProjeto {
  id?: string;
  orcamentoTotal?: number;
  papeis?: PapelRequerido[];
  servicoPrincipal?: ServicoProjeto;
  diasAteEntrega?: number;
}

export function criarProjeto(opcoes: OpcoesProjeto = {}): Projeto {
  return new Projeto(
    opcoes.id ?? "proj-1",
    "documentario",
    90,
    opcoes.orcamentoTotal ?? 60000,
    dataEmDias(opcoes.diasAteEntrega ?? 400),
    "documentario",
    { cidade: "Sao Paulo", estado: "SP", pais: "Brasil" },
    opcoes.papeis ?? [new PapelRequerido("diretor", 1)],
    opcoes.servicoPrincipal
  );
}

/** Bloqueia a thread por `ms` milissegundos, simulando um algoritmo caro de forma deterministica. */
export function dormir(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
