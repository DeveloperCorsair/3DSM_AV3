import { NomePapel, PapelRequerido, Projeto, TipoCaptacao } from "../domain/entities";
import {
  coletarServicosAtomicos,
  ModoExecucao,
  PacoteServico,
  ServicoAtomico,
  ServicoProjeto,
} from "../composite/project-service";

export interface PapelRequeridoDTO {
  nome: NomePapel;
  peso: number;
}

export interface ServicoAtomicoDTO {
  tipo: "atomico";
  nome: string;
  custo: number;
  prazoDias: number;
  papel: NomePapel;
  peso?: number;
}

export interface PacoteServicoDTO {
  tipo: "pacote";
  nome: string;
  execucao?: ModoExecucao;
  prazoMaximoDias?: number;
  subservicos: ServicoDTO[];
}

export type ServicoDTO = ServicoAtomicoDTO | PacoteServicoDTO;

export interface PoliticaRecomendacaoDTO {
  decoradores?: string[];
}

export interface CriarProjetoDTO {
  id?: string;
  genero: string;
  duracaoEstimadaMinutos: number;
  orcamentoTotal: number;
  dataEntrega: string;
  tipoCaptacao: TipoCaptacao;
  localizacao: { cidade: string; estado: string; pais: string };
  papeisRequeridos?: PapelRequeridoDTO[];
  servicoPrincipal?: ServicoDTO;
  estrategia?: string;
  politica?: PoliticaRecomendacaoDTO;
}

/** Limite de profundidade aceito na entrada, para impedir arvores patologicas. */
export const PROFUNDIDADE_MAXIMA_SERVICOS = 20;

export function dtoParaServico(dto: ServicoDTO, profundidade = 1): ServicoProjeto {
  if (profundidade > PROFUNDIDADE_MAXIMA_SERVICOS) {
    throw new Error(
      `A hierarquia de servicos excede a profundidade maxima de ${PROFUNDIDADE_MAXIMA_SERVICOS} niveis.`
    );
  }
  if (dto?.tipo === "atomico") {
    return new ServicoAtomico(dto.nome, dto.custo, dto.prazoDias, dto.papel, dto.peso ?? 1);
  }
  if (dto?.tipo === "pacote") {
    if (!Array.isArray(dto.subservicos)) {
      throw new Error(`O pacote "${dto.nome}" deve informar a lista de subservicos.`);
    }
    return new PacoteServico(
      dto.nome,
      dto.execucao ?? "sequencial",
      dto.subservicos.map((filho) => dtoParaServico(filho, profundidade + 1)),
      dto.prazoMaximoDias
    );
  }
  throw new Error(`Tipo de servico desconhecido: ${String((dto as { tipo?: unknown })?.tipo)}`);
}

/** Um papel por servico atomico; se o mesmo papel aparece varias vezes, vale o maior peso. */
function derivarPapeis(servico: ServicoProjeto): PapelRequerido[] {
  const pesos = new Map<NomePapel, number>();
  for (const atomico of coletarServicosAtomicos(servico)) {
    pesos.set(atomico.papel, Math.max(pesos.get(atomico.papel) ?? 0, atomico.peso));
  }
  return Array.from(pesos.entries()).map(([nome, peso]) => new PapelRequerido(nome, peso));
}

export function dtoParaProjeto(dto: CriarProjetoDTO, idGerado: string): Projeto {
  const servicoPrincipal = dto.servicoPrincipal ? dtoParaServico(dto.servicoPrincipal) : undefined;

  const informados = dto.papeisRequeridos ?? [];
  const papeis =
    informados.length > 0
      ? informados.map((p) => new PapelRequerido(p.nome, p.peso))
      : servicoPrincipal
        ? derivarPapeis(servicoPrincipal)
        : [];

  if (papeis.length === 0) {
    throw new Error("O projeto deve informar ao menos um papel requerido.");
  }

  return new Projeto(
    dto.id ?? idGerado,
    dto.genero,
    dto.duracaoEstimadaMinutos,
    dto.orcamentoTotal,
    new Date(dto.dataEntrega),
    dto.tipoCaptacao,
    dto.localizacao,
    papeis,
    servicoPrincipal
  );
}
