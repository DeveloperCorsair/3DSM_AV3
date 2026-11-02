import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { promises as fs } from "fs";
import * as os from "os";
import * as path from "path";
import { FastifyInstance } from "fastify";
import { construirApp } from "../../src/server/app";
import { construirDependencias } from "../../src/server/composition-root";
import { CriarProjetoDTO, ServicoDTO } from "../../src/server/dto";
import { ServicoRecomendacaoEquipe, SistemaRecomendacao } from "../../src/server/recommendation-service";
import { SujeitoRecomendacao } from "../../src/observers/notification-observer";
import { BarramentoEmMemoria } from "../../src/events/event-bus";
import { RepositorioProfissionaisEmMemoria } from "../../src/repository/professional-repository";
import {
  AdaptadorGoogleCloud,
  AdaptadorLocal,
  AdaptadorS3,
} from "../../src/adapters/storage-adapters";
import {
  AdaptadorPagamento,
  AdaptadorPagSeguro,
  AdaptadorPayPal,
  AdaptadorStripe,
} from "../../src/adapters/payment-adapters";
import {
  AdaptadorIndeed,
  AdaptadorInterno,
  AdaptadorLinkedIn,
  AdaptadorProfissional,
} from "../../src/adapters/professional-adapters";
import { ErroIntegracaoExterna } from "../../src/adapters/errors";
import { ClienteS3Simulado } from "../../src/external/storage-clients";
import {
  criarRecursosPadrao,
  FabricaPilhaRecomendacao,
} from "../../src/decorators/pipeline-factory";
import { PapelRequerido } from "../../src/domain/entities";
import { criarProfissional, criarProjeto, dataEmDias } from "../helpers";

const papeisDeEquipe = [new PapelRequerido("diretor", 1), new PapelRequerido("editor", 0.5)];

function criarServico(repositorio = new RepositorioProfissionaisEmMemoria([
  criarProfissional("prof-d", { papel: "diretor", precoMinimo: 8000, competencia: 0.9 }),
  criarProfissional("prof-e", { papel: "editor", precoMinimo: 4000, competencia: 0.75 }),
])) {
  return new ServicoRecomendacaoEquipe(repositorio, new SujeitoRecomendacao(), new BarramentoEmMemoria());
}

function idsDosItens(itens: { profissional: { id: string } }[]): string[] {
  return itens.map((i) => i.profissional.id).sort();
}

/* ADAPTER (servico) */

describe("Integracao - Adapter: trocar o provedor sem alterar a logica de negocio", () => {
  let diretorioLocal: string;

  beforeAll(async () => {
    diretorioLocal = await fs.mkdtemp(path.join(os.tmpdir(), "cinebridge-int-"));
  });

  afterAll(async () => {
    await fs.rm(diretorioLocal, { recursive: true, force: true });
  });

  it("SistemaRecomendacao e o mesmo ServicoRecomendacaoEquipe", () => {
    expect(SistemaRecomendacao).toBe(ServicoRecomendacaoEquipe);
  });

  it("armazenamento: o mesmo servico arquiva o relatorio em S3, Google Cloud ou disco apos configurarAdaptadores", async () => {
    const servico = criarServico();
    const s3 = new AdaptadorS3();
    const gcs = new AdaptadorGoogleCloud();
    const local = new AdaptadorLocal(diretorioLocal);
    const projeto = criarProjeto({ papeis: papeisDeEquipe });

    const resultados = [];
    for (const adaptador of [s3, gcs, local]) {
      servico.configurarAdaptadores({ armazenamento: adaptador });
      const resultado = await servico.gerarRecomendacao({ projeto, nomeEstrategia: "similaridade_cosseno" });
      resultados.push({ adaptador, resultado });
    }

    for (const { adaptador, resultado } of resultados) {
      expect(resultado.erroArquivamento).toBeUndefined();
      expect(resultado.arquivoRelatorioId).toMatch(/^projetos\/proj-1\/.+relatorio-.+\.json$/);
      const salvo = JSON.parse((await adaptador.recuperarArquivo(resultado.arquivoRelatorioId!)).toString("utf-8"));
      expect(salvo.recomendacaoId).toBe(resultado.recomendacao.id);
      expect(salvo.itens.map((i: { profissionalId: string }) => i.profissionalId).sort()).toEqual(["prof-d", "prof-e"]);
    }
    // cada provedor so enxerga o que foi gravado nele
    expect(await s3.listarArquivos("projetos/")).toHaveLength(1);
    expect(await gcs.listarArquivos("projetos/")).toHaveLength(1);
    expect(await local.listarArquivos("projetos/")).toHaveLength(1);

    const equipes = resultados.map((r) => idsDosItens(r.resultado.recomendacao.listarItens()));
    expect(equipes[1]).toEqual(equipes[0]);
    expect(equipes[2]).toEqual(equipes[0]);
  });

  it("armazenamento fora do ar nao derruba a recomendacao: o erro volta na saida", async () => {
    const servico = criarServico();
    servico.configurarAdaptadores({
      armazenamento: {
        salvarArquivo: async () => {
          throw new ErroIntegracaoExterna("s3", "timeout");
        },
        recuperarArquivo: async () => Buffer.alloc(0),
        listarArquivos: async () => [],
      },
    });
    const resultado = await servico.gerarRecomendacao({
      projeto: criarProjeto({ papeis: papeisDeEquipe }),
      nomeEstrategia: "similaridade_cosseno",
    });
    expect(resultado.recomendacao.listarItens()).toHaveLength(2);
    expect(resultado.arquivoRelatorioId).toBeUndefined();
    expect(resultado.erroArquivamento).toMatch(/timeout/);
  });

  it("sem adaptador de armazenamento, nada e arquivado (comportamento anterior preservado)", async () => {
    const resultado = await criarServico().gerarRecomendacao({
      projeto: criarProjeto({ papeis: papeisDeEquipe }),
      nomeEstrategia: "similaridade_cosseno",
    });
    expect(resultado.arquivoRelatorioId).toBeUndefined();
    expect(resultado.erroArquivamento).toBeUndefined();
  });

  it("pagamento: Stripe, PagSeguro e PayPal pagam a mesma equipe com os mesmos valores", async () => {
    const servico = criarServico();
    const { recomendacao } = await servico.gerarRecomendacao({
      projeto: criarProjeto({ papeis: papeisDeEquipe }),
      nomeEstrategia: "similaridade_cosseno",
    });

    const porProvedor: Record<string, { valor: number; status: string; id?: string }[]> = {};
    for (const [nome, gateway] of [
      ["stripe", new AdaptadorStripe()],
      ["pagseguro", new AdaptadorPagSeguro()],
      ["paypal", new AdaptadorPayPal()],
    ] as [string, AdaptadorPagamento][]) {
      servico.configurarAdaptadores({ pagamento: gateway });
      const comprovantes = await servico.pagarEquipe(recomendacao, "conta-produtora");
      porProvedor[nome] = comprovantes.map((c) => ({ valor: c.valor, status: c.status, id: c.idTransacao }));
      for (const c of comprovantes) {
        expect(await gateway.verificarPagamento(c.idTransacao!)).toBe("APROVADO");
      }
    }

    for (const comprovantes of Object.values(porProvedor)) {
      expect(comprovantes.map((c) => c.valor)).toEqual(porProvedor.stripe.map((c) => c.valor));
      expect(comprovantes.every((c) => c.status === "APROVADO" && c.id)).toBe(true);
    }
    expect(porProvedor.stripe.reduce((total, c) => total + c.valor, 0)).toBe(recomendacao.custoTotalEstimado());
  });

  it("pagamento recusado em um profissional nao interrompe os demais", async () => {
    const servico = criarServico();
    const { recomendacao } = await servico.gerarRecomendacao({
      projeto: criarProjeto({ papeis: papeisDeEquipe }),
      nomeEstrategia: "similaridade_cosseno",
    });
    const real = new AdaptadorStripe();
    servico.configurarAdaptadores({
      pagamento: {
        efetuarPagamento: (valor, origem, destino) =>
          destino === "prof-d"
            ? Promise.reject(new ErroIntegracaoExterna("stripe", "cartao recusado"))
            : real.efetuarPagamento(valor, origem, destino),
        cancelarPagamento: (id) => real.cancelarPagamento(id),
        verificarPagamento: (id) => real.verificarPagamento(id),
      },
    });

    const comprovantes = await servico.pagarEquipe(recomendacao, "conta");
    const porProfissional = Object.fromEntries(comprovantes.map((c) => [c.profissionalId, c]));
    expect(porProfissional["prof-d"]).toMatchObject({ status: "RECUSADO", erro: expect.stringMatching(/cartao recusado/) });
    expect(porProfissional["prof-d"].idTransacao).toBeUndefined();
    expect(porProfissional["prof-e"]).toMatchObject({ status: "APROVADO" });
  });

  it("pagar sem gateway configurado e erro explicito", async () => {
    const servico = criarServico();
    const { recomendacao } = await servico.gerarRecomendacao({
      projeto: criarProjeto({ papeis: papeisDeEquipe }),
      nomeEstrategia: "similaridade_cosseno",
    });
    await expect(servico.pagarEquipe(recomendacao, "conta")).rejects.toThrow(/Nenhum adaptador de pagamento/);
  });

  it("profissionais: a mesma requisicao e atendida por base interna, LinkedIn ou Indeed", async () => {
    const repositorio = new RepositorioProfissionaisEmMemoria([
      criarProfissional("prof-d", { papel: "diretor", precoMinimo: 8000 }),
      criarProfissional("prof-e", { papel: "editor", precoMinimo: 4000 }),
    ]);
    const servico = criarServico(repositorio);
    const projeto = criarProjeto({ papeis: papeisDeEquipe });

    const fontes: [string, AdaptadorProfissional, string][] = [
      ["interno", new AdaptadorInterno(repositorio), "prof-"],
      ["linkedin", new AdaptadorLinkedIn(), "linkedin:"],
      ["indeed", new AdaptadorIndeed(), "indeed:"],
    ];
    for (const [, adaptador, prefixo] of fontes) {
      servico.configurarAdaptadores({ profissional: adaptador });
      const { recomendacao, validacao } = await servico.gerarRecomendacao({
        projeto,
        nomeEstrategia: "similaridade_cosseno",
      });
      const itens = recomendacao.listarItens();
      expect(itens.map((i) => i.papel).sort()).toEqual(["diretor", "editor"]);
      expect(itens.every((i) => i.profissional.id.startsWith(prefixo))).toBe(true);
      expect(validacao.valido).toBe(true);
    }
  });

  it("a escolha do LinkedIn pela estrategia reflete os dados do provedor (Helena e a diretora mais competente)", async () => {
    const servico = criarServico();
    servico.configurarAdaptadores({ profissional: new AdaptadorLinkedIn() });
    const { recomendacao } = await servico.gerarRecomendacao({
      projeto: criarProjeto({ papeis: [new PapelRequerido("diretor", 1)] }),
      nomeEstrategia: "similaridade_cosseno",
    });
    expect(recomendacao.itemDoPapel("diretor")?.profissional.nome).toBe("Helena Prado");
  });

  it("substituirPapel tambem usa a fonte de profissionais configurada", async () => {
    const servico = criarServico();
    servico.configurarAdaptadores({ profissional: new AdaptadorIndeed() });
    const projeto = criarProjeto({ papeis: [new PapelRequerido("editor", 1)] });
    const { recomendacao } = await servico.gerarRecomendacao({ projeto, nomeEstrategia: "similaridade_cosseno" });
    expect(recomendacao.itemDoPapel("editor")?.profissional.id).toBe("indeed:ind-101");
    await servico.substituirPapel(projeto, recomendacao, "editor", "similaridade_cosseno");
    expect(recomendacao.itemDoPapel("editor")?.profissional.id).toBe("indeed:ind-101");
  });

  it("configurarAdaptadores troca so o que foi informado", async () => {
    const servico = criarServico();
    const stripe = new AdaptadorStripe();
    servico.configurarAdaptadores({ pagamento: stripe });
    servico.configurarAdaptadores({ armazenamento: new AdaptadorS3() });
    const { recomendacao, arquivoRelatorioId } = await servico.gerarRecomendacao({
      projeto: criarProjeto({ papeis: papeisDeEquipe }),
      nomeEstrategia: "similaridade_cosseno",
    });
    expect(arquivoRelatorioId).toBeDefined();
    await expect(servico.pagarEquipe(recomendacao, "conta")).resolves.toHaveLength(2); // pagamento seguiu configurado
  });

  it("estrategia: precedencia entrada.estrategia > nomeEstrategia > definirEstrategia, e erro se nenhuma", async () => {
    const servico = criarServico();
    const projeto = criarProjeto({ papeis: papeisDeEquipe });
    await expect(servico.gerarRecomendacao({ projeto })).rejects.toThrow(/Nenhuma estrategia/);

    const chamadas: string[] = [];
    const marcada = (nome: string) => ({
      nome,
      recomendar: () => {
        chamadas.push(nome);
        return [];
      },
    });
    servico.definirEstrategia(marcada("atual"));
    await servico.gerarRecomendacao({ projeto });
    await servico.gerarRecomendacao({ projeto, estrategia: marcada("instancia") });
    await servico.gerarRecomendacao({ projeto, nomeEstrategia: "similaridade_cosseno" });
    expect(chamadas.filter((n) => n === "atual")).toHaveLength(2); // um por papel
    expect(chamadas.filter((n) => n === "instancia")).toHaveLength(2);
    await expect(servico.gerarRecomendacao({ projeto, nomeEstrategia: "inexistente" })).rejects.toThrow(/desconhecida/);
  });
});

/* API HTTP (3 padroes) */

function payloadBase(extra: Partial<CriarProjetoDTO> = {}): CriarProjetoDTO {
  return {
    genero: "documentario",
    duracaoEstimadaMinutos: 90,
    orcamentoTotal: 80000,
    dataEntrega: dataEmDias(300).toISOString(),
    tipoCaptacao: "documentario",
    localizacao: { cidade: "Sao Paulo", estado: "SP", pais: "Brasil" },
    ...extra,
  };
}

const posProducao: ServicoDTO = {
  tipo: "pacote",
  nome: "pos-producao",
  execucao: "sequencial",
  subservicos: [
    { tipo: "atomico", nome: "edicao", custo: 2000, prazoDias: 5, papel: "editor", peso: 0.5 },
    {
      tipo: "pacote",
      nome: "acabamento",
      execucao: "paralela",
      subservicos: [
        { tipo: "atomico", nome: "mixagem", custo: 1800, prazoDias: 4, papel: "sonoplasta", peso: 0.4 },
        {
          tipo: "pacote",
          nome: "efeitos",
          execucao: "sequencial",
          subservicos: [
            { tipo: "atomico", nome: "vfx-1", custo: 3000, prazoDias: 6, papel: "efeitos_visuais", peso: 0.6 },
            { tipo: "atomico", nome: "vfx-2", custo: 2500, prazoDias: 4, papel: "efeitos_visuais", peso: 0.8 },
          ],
        },
      ],
    },
  ],
};

describe("Integracao HTTP - Composite", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = construirApp(
      construirDependencias({
        adaptadores: { armazenamento: new AdaptadorS3() },
        politicaPadrao: { decoradores: [] },
      })
    );
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  const post = (payload: unknown) => app.inject({ method: "POST", url: "/projetos/recomendacoes", payload: payload as object });

  it("projeto descrito por hierarquia de servicos: custo e prazo calculados recursivamente e equipe derivada dos papeis", async () => {
    const resposta = await post(payloadBase({ servicoPrincipal: posProducao }));
    expect(resposta.statusCode).toBe(201);
    const corpo = resposta.json();

    expect(corpo.servicoPrincipal.custoTotal).toBe(2000 + 1800 + 3000 + 2500);
    expect(corpo.servicoPrincipal.prazoTotalDias).toBe(15);
    expect(corpo.servicoPrincipal.estrutura.subservicos[1].subservicos[1]).toMatchObject({
      nome: "efeitos",
      custo: 5500,
      prazoDias: 10,
    });

    const papeis = corpo.itens.map((i: { papel: string }) => i.papel).sort();
    expect(papeis).toEqual(["editor", "efeitos_visuais", "sonoplasta"]);
    expect(corpo.validacao.valido).toBe(true);
  });

  it("projetos sem servicoPrincipal continuam funcionando e nao exibem o bloco", async () => {
    const resposta = await post(payloadBase({ papeisRequeridos: [{ nome: "diretor", peso: 1 }] }));
    expect(resposta.statusCode).toBe(201);
    expect(resposta.json().servicoPrincipal).toBeUndefined();
  });

  it("estrutura invalida (papel inexistente) e recusada com a mensagem do erro", async () => {
    const resposta = await post(
      payloadBase({
        servicoPrincipal: { tipo: "atomico", nome: "x", custo: 10, prazoDias: 3, papel: "mago" as never },
        papeisRequeridos: [{ nome: "diretor", peso: 1 }],
      })
    );
    expect(resposta.statusCode).toBe(400);
    expect(resposta.json().erro).toMatch(/Estrutura de servicos invalida.*papel tecnico invalido \(mago\)/);
  });

  it("prazo maior que o tempo ate a entrega e recusado", async () => {
    const resposta = await post(payloadBase({ servicoPrincipal: posProducao, dataEntrega: dataEmDias(10).toISOString() }));
    expect(resposta.statusCode).toBe(400);
    expect(resposta.json().erro).toMatch(/15 dias.*excede/);
  });

  it("pacote vazio e hierarquia profunda demais sao recusados", async () => {
    const vazio = await post(payloadBase({ servicoPrincipal: { tipo: "pacote", nome: "p", subservicos: [] }, papeisRequeridos: [{ nome: "diretor", peso: 1 }] }));
    expect(vazio.statusCode).toBe(400);
    expect(vazio.json().erro).toMatch(/nao possui subservicos/);

    let no: ServicoDTO = { tipo: "atomico", nome: "f", custo: 1, prazoDias: 1, papel: "editor" };
    for (let i = 0; i < 30; i++) no = { tipo: "pacote", nome: `n${i}`, subservicos: [no] };
    const profundo = await post(payloadBase({ servicoPrincipal: no }));
    expect(profundo.statusCode).toBe(400);
    expect(profundo.json().erro).toMatch(/profundidade maxima/);
  });
});

describe("Integracao HTTP - Adapter e Decorator", () => {
  const apps: FastifyInstance[] = [];
  afterEach(async () => {
    while (apps.length) await apps.pop()!.close();
  });

  function iniciar(opcoes: Parameters<typeof construirDependencias>[0], ajuste?: (d: ReturnType<typeof construirDependencias>) => void) {
    const dependencias = construirDependencias({ adaptadores: { armazenamento: new AdaptadorS3() }, ...opcoes });
    ajuste?.(dependencias);
    const app = construirApp(dependencias);
    apps.push(app);
    return { app, dependencias };
  }

  const corpoEquipe = (extra: Partial<CriarProjetoDTO> = {}) =>
    payloadBase({ papeisRequeridos: [{ nome: "diretor", peso: 1 }, { nome: "editor", peso: 0.5 }], ...extra });

  it("a resposta informa o arquivo do relatorio salvo no provedor configurado", async () => {
    const s3 = new AdaptadorS3(new ClienteS3Simulado(), "bucket-teste");
    const { app } = iniciar({ adaptadores: { armazenamento: s3 } });
    const resposta = await app.inject({ method: "POST", url: "/projetos/recomendacoes", payload: corpoEquipe() as object });
    expect(resposta.statusCode).toBe(201);
    const { arquivoRelatorioId, recomendacaoId } = resposta.json();
    const salvo = JSON.parse((await s3.recuperarArquivo(arquivoRelatorioId)).toString("utf-8"));
    expect(salvo.recomendacaoId).toBe(recomendacaoId);
  });

  it("fonte de profissionais configurada pelo ambiente de composicao alimenta a recomendacao via HTTP", async () => {
    const { app } = iniciar({ adaptadores: { profissional: new AdaptadorLinkedIn() } });
    const resposta = await app.inject({ method: "POST", url: "/projetos/recomendacoes", payload: corpoEquipe() as object });
    expect(resposta.statusCode).toBe(201);
    const ids: string[] = resposta.json().itens.map((i: { profissionalId: string }) => i.profissionalId);
    expect(ids.every((id) => id.startsWith("linkedin:"))).toBe(true);
  });

  it("falha do provedor de profissionais vira 502 (nao 400)", async () => {
    const quebrado: AdaptadorProfissional = {
      listarProfissionais: async () => {
        throw new ErroIntegracaoExterna("linkedin", "servico indisponivel");
      },
      detalharProfissional: async () => {
        throw new Error("nao usado");
      },
      registrarAvaliacao: async () => undefined,
    };
    const { app } = iniciar({ adaptadores: { profissional: quebrado } });
    const resposta = await app.inject({ method: "POST", url: "/projetos/recomendacoes", payload: corpoEquipe() as object });
    expect(resposta.statusCode).toBe(502);
    expect(resposta.json().erro).toMatch(/servico indisponivel/);
  });

  it("Decorator: cache reaproveita o calculo entre requisicoes, auditoria registra tudo e compressao mede o payload", async () => {
    const recursos = criarRecursosPadrao();
    const metricas: unknown[] = [];
    recursos.aoComprimir = (m) => metricas.push(m);
    const { app } = iniciar({}, (d) => {
      d.fabricaPilha = new FabricaPilhaRecomendacao(recursos);
    });
    const politica = { decoradores: ["cache", "auditoria", "compressao"] };

    const primeira = await app.inject({ method: "POST", url: "/projetos/recomendacoes", payload: corpoEquipe({ politica }) as object });
    expect(primeira.statusCode).toBe(201);
    expect(primeira.json().politicaAplicada).toEqual(["cache", "auditoria", "compressao"]);
    expect(recursos.cache.tamanho()).toBe(2);

    const segunda = await app.inject({ method: "POST", url: "/projetos/recomendacoes", payload: corpoEquipe({ politica }) as object });
    expect(segunda.statusCode).toBe(201);
    expect(recursos.cache.tamanho()).toBe(2);
    expect(recursos.sorvedouroAuditoria.registros).toHaveLength(4);
    expect(metricas).toHaveLength(4);

    // o resultado e identico com e sem decorators
    const itens = (r: { json(): { itens: unknown[] } }) => r.json().itens;
    expect(itens(segunda)).toEqual(itens(primeira));
    const sem = await app.inject({ method: "POST", url: "/projetos/recomendacoes", payload: corpoEquipe({ politica: { decoradores: [] } }) as object });
    expect(itens(sem)).toEqual(itens(primeira));
    expect(sem.json().politicaAplicada).toEqual([]);
  });

  it("Decorator: a pilha muda a cada requisicao conforme a preferencia do produtor, sem reiniciar", async () => {
    const recursos = criarRecursosPadrao();
    const { app } = iniciar({}, (d) => {
      d.fabricaPilha = new FabricaPilhaRecomendacao(recursos);
    });
    const enviar = (decoradores: string[]) =>
      app.inject({ method: "POST", url: "/projetos/recomendacoes", payload: corpoEquipe({ politica: { decoradores } }) as object });

    await enviar(["auditoria"]);
    expect(recursos.sorvedouroAuditoria.registros).toHaveLength(2);
    expect(recursos.cache.tamanho()).toBe(0);

    await enviar(["cache"]);
    expect(recursos.cache.tamanho()).toBe(2);
    expect(recursos.sorvedouroAuditoria.registros).toHaveLength(2);
  });

  it("Decorator: usa a politica padrao do servidor quando a requisicao nao informa a sua", async () => {
    const { app, dependencias } = iniciar({ politicaPadrao: { decoradores: ["auditoria"] } });
    const resposta = await app.inject({ method: "POST", url: "/projetos/recomendacoes", payload: corpoEquipe() as object });
    expect(resposta.json().politicaAplicada).toEqual(["auditoria"]);
    expect(dependencias.auditoriaDecorators.registros).toHaveLength(2);
  });

  it("Decorator: nome desconhecido ou repetido na politica e recusado", async () => {
    const { app } = iniciar({});
    for (const decoradores of [["cache", "magia"], ["cache", "cache"]]) {
      const resposta = await app.inject({ method: "POST", url: "/projetos/recomendacoes", payload: corpoEquipe({ politica: { decoradores } }) as object });
      expect(resposta.statusCode).toBe(400);
    }
  });
});

/* Composition root / ambiente */

describe("Composition root: configuracao por variaveis de ambiente", () => {
  const variaveis = [
    "CINEBRIDGE_ARMAZENAMENTO",
    "CINEBRIDGE_PAGAMENTO",
    "CINEBRIDGE_PROFISSIONAIS",
    "CINEBRIDGE_DECORADORES",
    "CINEBRIDGE_DIRETORIO_ARQUIVOS",
  ];
  
  const original = Object.fromEntries(variaveis.map((v) => [v, process.env[v]]));
  afterEach(() => {
    for (const v of variaveis) {
      if (original[v] === undefined) delete process.env[v];
      else process.env[v] = original[v];
    }
  });

  it("sem variaveis: armazenamento local, Stripe, base interna e nenhum decorator", () => {
    for (const v of variaveis) delete process.env[v];
    const d = construirDependencias();
    expect(d.adaptadores.armazenamento).toBeInstanceOf(AdaptadorLocal);
    expect(d.adaptadores.pagamento).toBeInstanceOf(AdaptadorStripe);
    expect(d.adaptadores.profissional).toBeInstanceOf(AdaptadorInterno);
    expect(d.politicaPadrao.decoradores).toEqual([]);
  });

  it("as variaveis escolhem provedores e decorators", () => {
    process.env.CINEBRIDGE_ARMAZENAMENTO = "google_cloud";
    process.env.CINEBRIDGE_PAGAMENTO = "paypal";
    process.env.CINEBRIDGE_PROFISSIONAIS = "indeed";
    process.env.CINEBRIDGE_DECORADORES = "auditoria,cache";
    const d = construirDependencias();
    expect(d.adaptadores.armazenamento).toBeInstanceOf(AdaptadorGoogleCloud);
    expect(d.adaptadores.pagamento).toBeInstanceOf(AdaptadorPayPal);
    expect(d.adaptadores.profissional).toBeInstanceOf(AdaptadorIndeed);
    expect(d.politicaPadrao.decoradores).toEqual(["auditoria", "cache"]);
  });

  it("valor invalido falha na inicializacao, com a lista de opcoes", () => {
    process.env.CINEBRIDGE_PAGAMENTO = "cheque";
    expect(() => construirDependencias()).toThrow(/stripe, pagseguro, paypal/);
  });
});
