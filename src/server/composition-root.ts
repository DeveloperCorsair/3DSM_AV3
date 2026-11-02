import {
  Profissional,
  VetorCompetencia,
  Avaliacao,
  NomePapel,
} from "../domain/entities";
import {
  RepositorioProfissionaisEmMemoria,
  RepositorioProfissionaisTolerranteAFalhas,
} from "../repository/professional-repository";
import { BarramentoEmMemoria } from "../events/event-bus";
import {
  SujeitoRecomendacao,
  ObservadorEmail,
  ObservadorMensagemInterna,
  ObservadorAuditoria,
} from "../observers/notification-observer";
import { ServicoRecomendacaoEquipe } from "./recommendation-service";
import { Adaptadores, FabricaAdaptadores } from "../adapters/adapter-factory";
import {
  criarRecursosPadrao,
  FabricaPilhaRecomendacao,
  PoliticaRecomendacao,
} from "../decorators/pipeline-factory";
import { MetricasCompressao, SorvedouroAuditoriaEmMemoria } from "../decorators/recommendation-decorators";

/**
 * Injecao de dependencias explicita (sem framework de DI), conforme
 * exigido pela atividade. Este e o unico ponto do sistema onde as
 * implementacoes concretas sao conectadas as interfaces/abstracoes.
 */
export interface Dependencias {
  servico: ServicoRecomendacaoEquipe;
  observadorEmail: ObservadorEmail;
  observadorMensagemInterna: ObservadorMensagemInterna;
  observadorAuditoria: ObservadorAuditoria;
  repositorioProfissionaisSeed: RepositorioProfissionaisEmMemoria;
  /** Adaptadores efetivamente em uso (armazenamento, pagamento, fonte de profissionais). */
  adaptadores: Required<Adaptadores>;
  /** Monta a pilha de decorators de uma estrategia a partir de uma politica. */
  fabricaPilha: FabricaPilhaRecomendacao;
  /** Politica usada quando a requisicao nao informa a sua. */
  politicaPadrao: PoliticaRecomendacao;
  /** Trilha de auditoria e metricas gravadas pelos decorators. */
  auditoriaDecorators: SorvedouroAuditoriaEmMemoria;
  metricasCompressao: MetricasCompressao[];
}

export interface OpcoesDependencias {
  /** Substitui adaptadores especificos (os demais vem das variaveis de ambiente / padroes). */
  adaptadores?: Adaptadores;
  politicaPadrao?: PoliticaRecomendacao;
}

function criarProfissionalExemplo(
  id: string,
  nome: string,
  especialidades: NomePapel[],
  precoMinimo: number,
  precoMaximo: number,
  notaMedia: number,
  competenciaPorPapel: Partial<Record<NomePapel, number>>
): Profissional {
  const historico =
    notaMedia > 0
      ? [new Avaliacao("projeto-seed", notaMedia), new Avaliacao("projeto-seed-2", notaMedia)]
      : [];

  return new Profissional(
    id,
    nome,
    especialidades,
    { minimo: precoMinimo, maximo: precoMaximo },
    [{ inicio: new Date("2026-01-01"), fim: new Date("2027-12-31") }],
    { cidade: "Sao Paulo", estado: "SP", pais: "Brasil" },
    new VetorCompetencia(new Map(Object.entries(competenciaPorPapel) as [NomePapel, number][])),
    historico
  );
}

/**
 * Cria o container de dependencias com dados de exemplo para desenvolvimento local.
 *
 * Provedores e decorators vem de variaveis de ambiente (ou de `opcoes`):
 *   CINEBRIDGE_ARMAZENAMENTO  s3 | google_cloud | local   (padrao: local)
 *   CINEBRIDGE_PAGAMENTO      stripe | pagseguro | paypal (padrao: stripe)
 *   CINEBRIDGE_PROFISSIONAIS  interno | linkedin | indeed (padrao: interno)
 *   CINEBRIDGE_DECORADORES    ex.: "cache,auditoria,compressao" (padrao: nenhum)
 *   CINEBRIDGE_DIRETORIO_ARQUIVOS  pasta do armazenamento "local"
 */
export function construirDependencias(opcoes: OpcoesDependencias = {}): Dependencias {
  const repositorioProfissionaisSeed = new RepositorioProfissionaisEmMemoria([
    criarProfissionalExemplo(
      "prof-1",
      "Ana Ribeiro",
      ["diretor"],
      8000,
      15000,
      4.5,
      { diretor: 0.9 }
    ),
    criarProfissionalExemplo(
      "prof-2",
      "Bruno Alves",
      ["diretor_fotografia"],
      6000,
      12000,
      4.2,
      { diretor_fotografia: 0.85 }
    ),
    criarProfissionalExemplo(
      "prof-3",
      "Camila Souza",
      ["sonoplasta"],
      3000,
      6000,
      4.0,
      { sonoplasta: 0.8 }
    ),
    criarProfissionalExemplo(
      "prof-4",
      "Daniel Nogueira",
      ["editor"],
      4000,
      8000,
      3.8,
      { editor: 0.75 }
    ),
    criarProfissionalExemplo(
      "prof-5",
      "Elisa Martins",
      ["roteirista"],
      5000,
      9000,
      4.7,
      { roteirista: 0.92 }
    ),
    criarProfissionalExemplo(
      "prof-6",
      "Fabio Teixeira",
      ["efeitos_visuais"],
      7000,
      14000,
      4.1,
      { efeitos_visuais: 0.82 }
    ),
    criarProfissionalExemplo(
      "prof-7",
      "Gabriela Lima",
      ["diretor", "roteirista"],
      3000,
      6000,
      3.5,
      { diretor: 0.6, roteirista: 0.65 }
    ),
  ]);

  const repositorioTolerante = new RepositorioProfissionaisTolerranteAFalhas(
    repositorioProfissionaisSeed,
    (erro) => console.error("Falha no repositorio de profissionais:", erro)
  );

  const adaptadores: Required<Adaptadores> = {
    armazenamento:
      opcoes.adaptadores?.armazenamento ??
      FabricaAdaptadores.armazenamento(
        process.env.CINEBRIDGE_ARMAZENAMENTO ?? "local",
        process.env.CINEBRIDGE_DIRETORIO_ARQUIVOS
      ),
    pagamento:
      opcoes.adaptadores?.pagamento ??
      FabricaAdaptadores.pagamento(process.env.CINEBRIDGE_PAGAMENTO ?? "stripe"),
    profissional:
      opcoes.adaptadores?.profissional ??
      FabricaAdaptadores.profissional(
        process.env.CINEBRIDGE_PROFISSIONAIS ?? "interno",
        repositorioTolerante
      ),
  };

  const metricasCompressao: MetricasCompressao[] = [];
  const recursos = criarRecursosPadrao();
  recursos.aoComprimir = (metricas) => metricasCompressao.push(metricas);
  const fabricaPilha = new FabricaPilhaRecomendacao(recursos);
  const politicaPadrao =
    opcoes.politicaPadrao ??
    FabricaPilhaRecomendacao.politicaDeTexto(process.env.CINEBRIDGE_DECORADORES);

  const barramento = new BarramentoEmMemoria();

  const sujeitoRecomendacao = new SujeitoRecomendacao();
  const observadorEmail = new ObservadorEmail();
  const observadorMensagemInterna = new ObservadorMensagemInterna();
  const observadorAuditoria = new ObservadorAuditoria();
  sujeitoRecomendacao.inscrever(observadorEmail);
  sujeitoRecomendacao.inscrever(observadorMensagemInterna);
  sujeitoRecomendacao.inscrever(observadorAuditoria);

  const servico = new ServicoRecomendacaoEquipe(
    repositorioTolerante,
    sujeitoRecomendacao,
    barramento,
    undefined,
    undefined,
    undefined,
    adaptadores
  );

  return {
    servico,
    observadorEmail,
    observadorMensagemInterna,
    observadorAuditoria,
    repositorioProfissionaisSeed,
    adaptadores,
    fabricaPilha,
    politicaPadrao,
    auditoriaDecorators: recursos.sorvedouroAuditoria,
    metricasCompressao,
  };
}
