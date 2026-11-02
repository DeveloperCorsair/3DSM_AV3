import { describe, it, expect } from "vitest";
import { PapelRequerido, Profissional, Projeto, VetorCompetencia } from "../../src/domain/entities";
import { RepositorioProfissionaisEmMemoria } from "../../src/repository/professional-repository";
import { BarramentoEmMemoria, NomeEvento } from "../../src/events/event-bus";
import { SujeitoRecomendacao, ObservadorAuditoria } from "../../src/observers/notification-observer";
import { ServicoRecomendacaoEquipe } from "../../src/server/recommendation-service";

function criarProfissional(id: string, papel: "diretor" | "editor", competencia: number): Profissional {
  return new Profissional(
    id,
    `Profissional ${id}`,
    [papel],
    { minimo: 4000, maximo: 8000 },
    [{ inicio: new Date("2026-01-01"), fim: new Date("2027-12-31") }],
    { cidade: "Sao Paulo", estado: "SP", pais: "Brasil" },
    new VetorCompetencia(new Map([[papel, competencia]])),
    []
  );
}

function criarProjeto(): Projeto {
  return new Projeto(
    "proj-serv",
    "ficcao",
    100,
    30000,
    new Date("2027-03-01"),
    "ficcao",
    { cidade: "Sao Paulo", estado: "SP", pais: "Brasil" },
    [new PapelRequerido("diretor", 1), new PapelRequerido("editor", 0.6)]
  );
}

describe("ServicoRecomendacaoEquipe", () => {
  it("gera recomendacao, notifica observadores e publica eventos de dominio", async () => {
    const repositorio = new RepositorioProfissionaisEmMemoria([
      criarProfissional("d1", "diretor", 0.9),
      criarProfissional("e1", "editor", 0.7),
    ]);
    const barramento = new BarramentoEmMemoria();
    const eventosCapturados: string[] = [];
    barramento.assinar(NomeEvento.RECOMENDACAO_GERADA, () =>
      eventosCapturados.push(NomeEvento.RECOMENDACAO_GERADA)
    );
    barramento.assinar(NomeEvento.CONVITE_ENVIADO, () =>
      eventosCapturados.push(NomeEvento.CONVITE_ENVIADO)
    );

    const sujeito = new SujeitoRecomendacao();
    const auditoria = new ObservadorAuditoria();
    sujeito.inscrever(auditoria);

    const servico = new ServicoRecomendacaoEquipe(repositorio, sujeito, barramento);

    const resultado = await servico.gerarRecomendacao({
      projeto: criarProjeto(),
      nomeEstrategia: "similaridade_cosseno",
    });

    expect(resultado.recomendacao.listarItens()).toHaveLength(2);
    expect(resultado.validacao.valido).toBe(true);
    expect(eventosCapturados).toContain(NomeEvento.RECOMENDACAO_GERADA);
    expect(eventosCapturados.filter((e) => e === NomeEvento.CONVITE_ENVIADO)).toHaveLength(2);
    expect(auditoria.registros).toHaveLength(1);
  });

  it("substitui apenas o papel afetado, mantendo as demais escolhas fixas", async () => {
    const repositorio = new RepositorioProfissionaisEmMemoria([
      criarProfissional("d1", "diretor", 0.9),
      criarProfissional("d2", "diretor", 0.5),
      criarProfissional("e1", "editor", 0.7),
    ]);
    const barramento = new BarramentoEmMemoria();
    const sujeito = new SujeitoRecomendacao();
    const servico = new ServicoRecomendacaoEquipe(repositorio, sujeito, barramento);
    const projeto = criarProjeto();

    const { recomendacao } = await servico.gerarRecomendacao({
      projeto,
      nomeEstrategia: "similaridade_cosseno",
    });

    const escolhidoEditorAntes = recomendacao.itemDoPapel("editor")?.profissional.id;

    await servico.substituirPapel(projeto, recomendacao, "diretor", "similaridade_cosseno");

    expect(recomendacao.itemDoPapel("diretor")?.profissional.id).toBe("d2");
    expect(recomendacao.itemDoPapel("editor")?.profissional.id).toBe(escolhidoEditorAntes);
  });

  it("dispara eventos de equipe consensual e registrada ao finalizar a composicao", async () => {
    const repositorio = new RepositorioProfissionaisEmMemoria([
      criarProfissional("d1", "diretor", 0.9),
      criarProfissional("e1", "editor", 0.7),
    ]);
    const barramento = new BarramentoEmMemoria();
    const eventos: string[] = [];
    barramento.assinar(NomeEvento.EQUIPE_CONSENSUAL, () => eventos.push("consensual"));
    barramento.assinar(NomeEvento.EQUIPE_REGISTRADA, () => eventos.push("registrada"));

    const servico = new ServicoRecomendacaoEquipe(repositorio, new SujeitoRecomendacao(), barramento);
    const projeto = criarProjeto();
    const { recomendacao } = await servico.gerarRecomendacao({
      projeto,
      nomeEstrategia: "similaridade_cosseno",
    });

    servico.registrarComposicaoFinal(projeto, recomendacao);

    expect(recomendacao.status).toBe("registrada");
    expect(eventos).toEqual(["consensual", "registrada"]);
  });

  it("registra resposta de convite (aceito/recusado) e notifica observadores", async () => {
    const repositorio = new RepositorioProfissionaisEmMemoria([
      criarProfissional("d1", "diretor", 0.9),
    ]);
    const barramento = new BarramentoEmMemoria();
    const sujeito = new SujeitoRecomendacao();
    const auditoria = new ObservadorAuditoria();
    sujeito.inscrever(auditoria);
    const servico = new ServicoRecomendacaoEquipe(repositorio, sujeito, barramento);

    const convite = servico.criarConvitesParaRecomendacao(
      (await servico.gerarRecomendacao({
        projeto: new Projeto(
          "proj-conv",
          "ficcao",
          60,
          10000,
          new Date("2027-01-01"),
          "ficcao",
          { cidade: "Sao Paulo", estado: "SP", pais: "Brasil" },
          [new PapelRequerido("diretor", 1)]
        ),
        nomeEstrategia: "similaridade_cosseno",
      })).recomendacao
    )[0];

    servico.registrarRespostaConvite(convite, true);

    expect(convite.status).toBe("aceito");
    expect(auditoria.registros.some((r) => r.tipo === "convite_atualizado")).toBe(true);
  });
});
