import {
  Avaliacao,
  NomePapel,
  Profissional,
  VetorCompetencia,
} from "../domain/entities";
import { RepositorioProfissionais } from "../repository/professional-repository";
import {
  ApiIndeedSimulada,
  ApiLinkedInSimulada,
  CandidatoIndeed,
  PerfilLinkedIn,
} from "../external/professional-clients";
import { chamarProvedor, ErroIntegracaoExterna } from "./errors";

/**
 * Padrao Adapter - fontes de cadastro de profissionais (rede
 * profissional, portal de empregos, base interna).
 *
 * Cada fonte tem vocabulario e escalas proprias (habilidades em ingles,
 * notas de 0 a 10, faixas salariais...). Os adaptadores convertem tudo
 * para a entidade `Profissional` do dominio, que e o que as Strategies
 * esperam receber.
 */
export interface CriteriosProfissional {
  /** Profissionais que atendam a pelo menos um destes papeis. */
  papeis?: NomePapel[];
  cidade?: string;
  /** Preco minimo do profissional nao pode exceder este valor. */
  precoMaximo?: number;
}

export interface AdaptadorProfissional {
  listarProfissionais(criterios?: CriteriosProfissional): Promise<Profissional[]>;
  detalharProfissional(id: string): Promise<Profissional>;
  registrarAvaliacao(id: string, avaliacao: Avaliacao): Promise<void>;
}

/** Aplica os criterios padronizados; todos os adaptadores usam a mesma regra. */
export function aplicarCriterios(
  profissionais: Profissional[],
  criterios: CriteriosProfissional = {}
): Profissional[] {
  return profissionais.filter((p) => {
    if (criterios.papeis && criterios.papeis.length > 0) {
      if (!criterios.papeis.some((papel) => p.atendePapel(papel))) return false;
    }
    if (criterios.cidade && p.localizacao.cidade.toLowerCase() !== criterios.cidade.toLowerCase()) {
      return false;
    }
    if (criterios.precoMaximo !== undefined && !p.dentroDoOrcamento(criterios.precoMaximo)) {
      return false;
    }
    return true;
  });
}

function inverter(mapa: Record<NomePapel, string>): Record<string, NomePapel> {
  return Object.fromEntries(Object.entries(mapa).map(([papel, termo]) => [termo, papel])) as Record<
    string,
    NomePapel
  >;
}

function extrairIdExterno(provedor: string, id: string): string {
  const prefixo = `${provedor}:`;
  if (!id.startsWith(prefixo) || id.length === prefixo.length) {
    throw new ErroIntegracaoExterna(provedor, `Identificador de profissional invalido: ${id}`);
  }
  return id.slice(prefixo.length);
}

/* ---------------------------------- LinkedIn ---------------------------------- */

const HABILIDADE_POR_PAPEL: Record<NomePapel, string> = {
  diretor: "Directing",
  diretor_fotografia: "Cinematography",
  sonoplasta: "Sound Design",
  editor: "Video Editing",
  roteirista: "Screenwriting",
  efeitos_visuais: "Visual Effects",
};
const PAPEL_POR_HABILIDADE = inverter(HABILIDADE_POR_PAPEL);

function perfilLinkedInParaProfissional(perfil: PerfilLinkedIn): Profissional {
  const especialidades: NomePapel[] = [];
  const competencias = new Map<NomePapel, number>();
  for (const habilidade of perfil.skills) {
    const papel = PAPEL_POR_HABILIDADE[habilidade.name];
    if (!papel) continue;
    especialidades.push(papel);
    competencias.set(papel, Math.min(habilidade.endorsements / 100, 1));
  }
  return new Profissional(
    `linkedin:${perfil.urn}`,
    perfil.fullName,
    especialidades,
    { minimo: perfil.rateRange.from, maximo: perfil.rateRange.to },
    [{ inicio: new Date(perfil.availability.from), fim: new Date(perfil.availability.to) }],
    { cidade: perfil.location.city, estado: perfil.location.state, pais: perfil.location.country },
    new VetorCompetencia(competencias),
    perfil.recommendations.map((r) => new Avaliacao(r.projectRef, r.score, r.text))
  );
}

export class AdaptadorLinkedIn implements AdaptadorProfissional {
  constructor(private readonly api: ApiLinkedInSimulada = new ApiLinkedInSimulada()) {}

  async listarProfissionais(criterios: CriteriosProfissional = {}): Promise<Profissional[]> {
    const keywords = criterios.papeis?.map((papel) => HABILIDADE_POR_PAPEL[papel]);
    const { elements } = await chamarProvedor("linkedin", () => this.api.searchPeople({ keywords }));
    return aplicarCriterios(elements.map(perfilLinkedInParaProfissional), criterios);
  }

  async detalharProfissional(id: string): Promise<Profissional> {
    const urn = extrairIdExterno("linkedin", id);
    const perfil = await chamarProvedor("linkedin", () => this.api.getProfile(urn));
    return perfilLinkedInParaProfissional(perfil);
  }

  async registrarAvaliacao(id: string, avaliacao: Avaliacao): Promise<void> {
    const urn = extrairIdExterno("linkedin", id);
    await chamarProvedor("linkedin", () =>
      this.api.postRecommendation(urn, {
        projectRef: avaliacao.projetoId,
        score: avaliacao.nota,
        text: avaliacao.comentario,
      })
    );
  }
}

/* ----------------------------------- Indeed ----------------------------------- */

const CARGO_POR_PAPEL: Record<NomePapel, string> = {
  diretor: "Film Director",
  diretor_fotografia: "Director of Photography",
  sonoplasta: "Sound Designer",
  editor: "Film Editor",
  roteirista: "Screenwriter",
  efeitos_visuais: "VFX Artist",
};
const PAPEL_POR_CARGO = inverter(CARGO_POR_PAPEL);

function candidatoIndeedParaProfissional(candidato: CandidatoIndeed): Profissional {
  const especialidades: NomePapel[] = [];
  const competencias = new Map<NomePapel, number>();
  for (const cargo of candidato.titles) {
    const papel = PAPEL_POR_CARGO[cargo.title];
    if (!papel) continue;
    especialidades.push(papel);
    competencias.set(papel, Math.min(cargo.score / 10, 1));
  }
  const [inicio, fim] = candidato.open.split("/");
  return new Profissional(
    `indeed:${candidato.candidateId}`,
    candidato.displayName,
    especialidades,
    { minimo: candidato.expectedPay.min, maximo: candidato.expectedPay.max },
    [{ inicio: new Date(inicio), fim: new Date(fim) }],
    { cidade: candidato.city, estado: candidato.region, pais: candidato.country },
    new VetorCompetencia(competencias),
    // a escala do Indeed e 0-10; a do dominio e 0-5
    candidato.feedback.map((f) => new Avaliacao(f.project, f.rating / 2, f.note))
  );
}

export class AdaptadorIndeed implements AdaptadorProfissional {
  constructor(private readonly api: ApiIndeedSimulada = new ApiIndeedSimulada()) {}

  async listarProfissionais(criterios: CriteriosProfissional = {}): Promise<Profissional[]> {
    const q = criterios.papeis?.map((papel) => CARGO_POR_PAPEL[papel]).join("|");
    const { results } = await chamarProvedor("indeed", () =>
      this.api.jobSeekers.search({ q: q || undefined, where: criterios.cidade })
    );
    return aplicarCriterios(results.map(candidatoIndeedParaProfissional), criterios);
  }

  async detalharProfissional(id: string): Promise<Profissional> {
    const candidateId = extrairIdExterno("indeed", id);
    const candidato = await chamarProvedor("indeed", () => this.api.jobSeekers.get(candidateId));
    return candidatoIndeedParaProfissional(candidato);
  }

  async registrarAvaliacao(id: string, avaliacao: Avaliacao): Promise<void> {
    const candidateId = extrairIdExterno("indeed", id);
    await chamarProvedor("indeed", () =>
      this.api.jobSeekers.addFeedback(candidateId, {
        project: avaliacao.projetoId,
        rating: avaliacao.nota * 2,
        note: avaliacao.comentario,
      })
    );
  }
}

/* ---------------------------------- Interno ----------------------------------- */

/** Expoe a base propria de profissionais (repositorio) pela mesma interface das fontes externas. */
export class AdaptadorInterno implements AdaptadorProfissional {
  constructor(private readonly repositorio: RepositorioProfissionais) {}

  async listarProfissionais(criterios: CriteriosProfissional = {}): Promise<Profissional[]> {
    const todos = await this.repositorio.buscarTodos();
    return aplicarCriterios(todos, criterios);
  }

  async detalharProfissional(id: string): Promise<Profissional> {
    const profissional = await this.repositorio.buscarPorId(id);
    if (!profissional) {
      throw new ErroIntegracaoExterna("interno", `Profissional nao encontrado: ${id}`);
    }
    return profissional;
  }

  async registrarAvaliacao(id: string, avaliacao: Avaliacao): Promise<void> {
    const profissional = await this.detalharProfissional(id);
    profissional.historico.push(avaliacao);
  }
}
