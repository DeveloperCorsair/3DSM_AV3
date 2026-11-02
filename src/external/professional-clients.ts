/**
 * APIs de cadastro de profissionais EXTERNAS simuladas (sem rede), com
 * vocabulario, escalas e formatos de dados proprios de cada plataforma.
 * Sao os adaptees do padrao Adapter.
 */

function clonar<T>(valor: T): T {
  return JSON.parse(JSON.stringify(valor)) as T;
}

/* ---------------------------------- LinkedIn ---------------------------------- */

export interface PerfilLinkedIn {
  urn: string;
  fullName: string;
  /** Habilidades em ingles; endorsements indicam a forca de cada uma (0 a 100). */
  skills: { name: string; endorsements: number }[];
  location: { city: string; state: string; country: string };
  rateRange: { from: number; to: number };
  availability: { from: string; to: string };
  recommendations: { projectRef: string; score: number; text?: string }[];
}

export const PERFIS_LINKEDIN_PADRAO: PerfilLinkedIn[] = [
  {
    urn: "li-001",
    fullName: "Helena Prado",
    skills: [
      { name: "Directing", endorsements: 90 },
      { name: "Screenwriting", endorsements: 60 },
    ],
    location: { city: "Sao Paulo", state: "SP", country: "Brasil" },
    rateRange: { from: 9000, to: 16000 },
    availability: { from: "2026-01-01", to: "2027-12-31" },
    recommendations: [
      { projectRef: "ext-a", score: 4.8, text: "Excelente conducao de elenco" },
      { projectRef: "ext-b", score: 4.6 },
    ],
  },
  {
    urn: "li-002",
    fullName: "Igor Campos",
    skills: [
      { name: "Video Editing", endorsements: 80 },
      { name: "Visual Effects", endorsements: 70 },
    ],
    location: { city: "Rio de Janeiro", state: "RJ", country: "Brasil" },
    rateRange: { from: 4500, to: 9000 },
    availability: { from: "2026-03-01", to: "2027-12-31" },
    recommendations: [{ projectRef: "ext-c", score: 4.2 }],
  },
  {
    urn: "li-003",
    fullName: "Julia Rocha",
    skills: [
      { name: "Sound Design", endorsements: 85 },
      { name: "Cinematography", endorsements: 75 },
    ],
    location: { city: "Sao Paulo", state: "SP", country: "Brasil" },
    rateRange: { from: 5000, to: 11000 },
    availability: { from: "2026-01-01", to: "2027-06-30" },
    recommendations: [],
  },
];

export class ApiLinkedInSimulada {
  private readonly perfis: PerfilLinkedIn[];

  constructor(perfis: PerfilLinkedIn[] = PERFIS_LINKEDIN_PADRAO) {
    this.perfis = clonar(perfis);
  }

  async searchPeople(filtros: { keywords?: string[] } = {}): Promise<{ elements: PerfilLinkedIn[] }> {
    const { keywords } = filtros;
    const elements = this.perfis.filter(
      (perfil) =>
        !keywords ||
        keywords.length === 0 ||
        perfil.skills.some((skill) => keywords.includes(skill.name))
    );
    return { elements: clonar(elements) };
  }

  async getProfile(urn: string): Promise<PerfilLinkedIn> {
    const perfil = this.perfis.find((p) => p.urn === urn);
    if (!perfil) throw new Error(`LinkedIn 404: perfil ${urn} nao encontrado.`);
    return clonar(perfil);
  }

  async postRecommendation(
    urn: string,
    recomendacao: { projectRef: string; score: number; text?: string }
  ): Promise<void> {
    const perfil = this.perfis.find((p) => p.urn === urn);
    if (!perfil) throw new Error(`LinkedIn 404: perfil ${urn} nao encontrado.`);
    perfil.recommendations.push({ ...recomendacao });
  }
}

/* ----------------------------------- Indeed ----------------------------------- */

export interface CandidatoIndeed {
  candidateId: string;
  displayName: string;
  /** Cargos em ingles, cada um com pontuacao de 0 a 10. */
  titles: { title: string; score: number }[];
  city: string;
  region: string;
  country: string;
  expectedPay: { min: number; max: number };
  /** Janela de disponibilidade no formato "AAAA-MM-DD/AAAA-MM-DD". */
  open: string;
  /** Avaliacoes de empregadores em escala 0-10. */
  feedback: { project: string; rating: number; note?: string }[];
}

export const CANDIDATOS_INDEED_PADRAO: CandidatoIndeed[] = [
  {
    candidateId: "ind-100",
    displayName: "Kleber Dias",
    titles: [
      { title: "Film Director", score: 8 },
      { title: "Screenwriter", score: 6 },
    ],
    city: "Sao Paulo",
    region: "SP",
    country: "Brasil",
    expectedPay: { min: 7000, max: 13000 },
    open: "2026-01-01/2027-12-31",
    feedback: [{ project: "ext-x", rating: 8.4, note: "Entrega pontual" }],
  },
  {
    candidateId: "ind-101",
    displayName: "Lara Mendes",
    titles: [{ title: "Film Editor", score: 9 }],
    city: "Campinas",
    region: "SP",
    country: "Brasil",
    expectedPay: { min: 3500, max: 7500 },
    open: "2026-02-01/2027-12-31",
    feedback: [
      { project: "ext-y", rating: 9 },
      { project: "ext-z", rating: 8 },
    ],
  },
  {
    candidateId: "ind-102",
    displayName: "Marcos Vidal",
    titles: [
      { title: "Sound Designer", score: 7 },
      { title: "VFX Artist", score: 8 },
      { title: "Director of Photography", score: 6 },
    ],
    city: "Sao Paulo",
    region: "SP",
    country: "Brasil",
    expectedPay: { min: 6000, max: 12000 },
    open: "2026-01-01/2027-12-31",
    feedback: [],
  },
];

export class ApiIndeedSimulada {
  private readonly candidatos: CandidatoIndeed[];

  readonly jobSeekers = {
    /** `q` aceita varios cargos separados por "|"; `where` filtra pela cidade. */
    search: async (
      consulta: { q?: string; where?: string } = {}
    ): Promise<{ results: CandidatoIndeed[] }> => {
      const cargos = consulta.q ? consulta.q.split("|") : undefined;
      const results = this.candidatos.filter(
        (c) =>
          (!cargos || c.titles.some((t) => cargos.includes(t.title))) &&
          (!consulta.where || c.city.toLowerCase() === consulta.where.toLowerCase())
      );
      return { results: clonar(results) };
    },

    get: async (candidateId: string): Promise<CandidatoIndeed> => {
      const candidato = this.candidatos.find((c) => c.candidateId === candidateId);
      if (!candidato) throw new Error(`Indeed 404: candidato ${candidateId} nao encontrado.`);
      return clonar(candidato);
    },

    addFeedback: async (
      candidateId: string,
      feedback: { project: string; rating: number; note?: string }
    ): Promise<void> => {
      const candidato = this.candidatos.find((c) => c.candidateId === candidateId);
      if (!candidato) throw new Error(`Indeed 404: candidato ${candidateId} nao encontrado.`);
      candidato.feedback.push({ ...feedback });
    },
  };

  constructor(candidatos: CandidatoIndeed[] = CANDIDATOS_INDEED_PADRAO) {
    this.candidatos = clonar(candidatos);
  }
}
