import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { promises as fs } from "fs";
import * as os from "os";
import * as path from "path";
import {
  AdaptadorArmazenamento,
  AdaptadorGoogleCloud,
  AdaptadorLocal,
  AdaptadorS3,
  gerarIdArquivo,
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
  aplicarCriterios,
} from "../../src/adapters/professional-adapters";
import { FabricaAdaptadores } from "../../src/adapters/adapter-factory";
import { ErroIntegracaoExterna } from "../../src/adapters/errors";
import {
  ClienteGoogleCloudSimulado,
  ClienteS3Simulado,
} from "../../src/external/storage-clients";
import {
  ClientePagSeguroSimulado,
  ClientePayPalSimulado,
  ClienteStripeSimulado,
} from "../../src/external/payment-clients";
import { ApiIndeedSimulada, ApiLinkedInSimulada } from "../../src/external/professional-clients";
import { Avaliacao } from "../../src/domain/entities";
import { RepositorioProfissionaisEmMemoria } from "../../src/repository/professional-repository";
import { criarProfissional } from "../helpers";

/* ------------------------- armazenamento: contrato comum ------------------------- */

describe("Adapter de armazenamento: contrato comum", () => {
  let diretorioTemporario: string;

  beforeAll(async () => {
    diretorioTemporario = await fs.mkdtemp(path.join(os.tmpdir(), "cinebridge-teste-"));
  });

  afterAll(async () => {
    await fs.rm(diretorioTemporario, { recursive: true, force: true });
  });

  const provedores: [string, (dir: string) => AdaptadorArmazenamento][] = [
    ["S3", () => new AdaptadorS3()],
    ["Google Cloud", () => new AdaptadorGoogleCloud()],
    ["Local", (dir) => new AdaptadorLocal(dir)],
  ];

  describe.each(provedores)("%s", (_nome, criar) => {
    it("salva e recupera exatamente o mesmo conteudo (inclusive bytes nao-texto)", async () => {
      const adaptador = criar(diretorioTemporario);
      const conteudo = Buffer.from([0, 1, 2, 250, 255, 10, 13]);
      const id = await adaptador.salvarArquivo(conteudo, { nome: "amostra.bin", pasta: "midia" });
      expect(Buffer.compare(await adaptador.recuperarArquivo(id), conteudo)).toBe(0);
    });

    it("gera ids com a pasta pedida e lista por prefixo, em ordem", async () => {
      const adaptador = criar(diretorioTemporario);
      const pasta = `projetos/${Math.random().toString(36).slice(2)}`;
      const a = await adaptador.salvarArquivo(Buffer.from("a"), { nome: "roteiro.txt", pasta });
      const b = await adaptador.salvarArquivo(Buffer.from("b"), { nome: "storyboard.pdf", pasta });
      await adaptador.salvarArquivo(Buffer.from("c"), { nome: "outro.txt", pasta: "outra" });

      expect(a.startsWith(`${pasta}/`)).toBe(true);
      expect(await adaptador.listarArquivos(pasta)).toEqual([a, b].sort());
      expect(await adaptador.listarArquivos(`${pasta}-inexistente`)).toEqual([]);
    });

    it("recuperar arquivo inexistente falha com ErroIntegracaoExterna", async () => {
      const adaptador = criar(diretorioTemporario);
      await expect(adaptador.recuperarArquivo("nao/existe.txt")).rejects.toBeInstanceOf(
        ErroIntegracaoExterna
      );
    });

    it("nao permite que nome ou pasta escapem do local de armazenamento", async () => {
      const adaptador = criar(diretorioTemporario);
      const id = await adaptador.salvarArquivo(Buffer.from("x"), {
        nome: "../../fora.txt",
        pasta: "../../../etc",
      });
      // ".." so e perigoso como segmento inteiro do caminho; dentro do nome do arquivo e inofensivo
      expect(id.split("/").some((segmento) => segmento === ".." || segmento === ".")).toBe(false);
      expect((await adaptador.recuperarArquivo(id)).toString()).toBe("x");
    });
  });

  it("Local rejeita identificadores com segmentos de travessia de diretorio", async () => {
    const adaptador = new AdaptadorLocal(diretorioTemporario);
    for (const id of ["../segredo", "a/../../b", "/absoluto", "a\\b", "C:/x"]) {
      await expect(adaptador.recuperarArquivo(id)).rejects.toBeInstanceOf(ErroIntegracaoExterna);
    }
  });

  it("Local lista vazio quando o diretorio base ainda nao existe", async () => {
    const adaptador = new AdaptadorLocal(path.join(diretorioTemporario, "nao-criado"));
    expect(await adaptador.listarArquivos("")).toEqual([]);
  });

  it("gerarIdArquivo usa valores padrao e sanitiza caracteres perigosos", () => {
    expect(gerarIdArquivo()).toMatch(/^geral\/[0-9a-f-]{36}-arquivo\.bin$/);
    expect(gerarIdArquivo({ nome: "a b?.txt", pasta: "x y/z" })).toMatch(/^x_y\/z\/[0-9a-f-]{36}-a_b_\.txt$/);
    expect(gerarIdArquivo({ pasta: "///" })).toMatch(/^geral\//);
  });

  it("cada adaptador traduz para a chamada propria do provedor", async () => {
    const s3 = new ClienteS3Simulado();
    const espiaoS3 = vi.spyOn(s3, "putObject");
    const id = await new AdaptadorS3(s3, "meu-bucket").salvarArquivo(Buffer.from("z"), {
      nome: "a.json",
      tipoConteudo: "application/json",
    });
    expect(espiaoS3).toHaveBeenCalledWith(
      expect.objectContaining({ Bucket: "meu-bucket", Key: id, ContentType: "application/json" })
    );

    const gcs = new ClienteGoogleCloudSimulado();
    const adaptadorGcs = new AdaptadorGoogleCloud(gcs, "outro-bucket");
    const idGcs = await adaptadorGcs.salvarArquivo(Buffer.from("z"));
    const [arquivos] = await gcs.bucket("outro-bucket").getFiles({ prefix: "geral" });
    expect(arquivos.map((a) => a.name)).toEqual([idGcs]);
  });
});

/* --------------------------- pagamento: contrato comum --------------------------- */

describe("Adapter de pagamento: contrato comum", () => {
  const provedores: [string, () => AdaptadorPagamento][] = [
    ["Stripe", () => new AdaptadorStripe()],
    ["PagSeguro", () => new AdaptadorPagSeguro()],
    ["PayPal", () => new AdaptadorPayPal()],
  ];

  describe.each(provedores)("%s", (_nome, criar) => {
    it("efetua, verifica, estorna e verifica de novo", async () => {
      const gateway = criar();
      const id = await gateway.efetuarPagamento(150.5, "conta-produtor", "prof-1");
      expect(id).toBeTruthy();
      expect(await gateway.verificarPagamento(id)).toBe("APROVADO");

      expect(await gateway.cancelarPagamento(id)).toBe(true);
      expect(await gateway.verificarPagamento(id)).toBe("ESTORNADO");
    });

    it("estornar duas vezes devolve false na segunda (sem erro)", async () => {
      const gateway = criar();
      const id = await gateway.efetuarPagamento(10, "conta", "prof");
      expect(await gateway.cancelarPagamento(id)).toBe(true);
      expect(await gateway.cancelarPagamento(id)).toBe(false);
    });

    it("transacao inexistente falha com ErroIntegracaoExterna", async () => {
      const gateway = criar();
      await expect(gateway.verificarPagamento("inexistente")).rejects.toBeInstanceOf(ErroIntegracaoExterna);
      await expect(gateway.cancelarPagamento("inexistente")).rejects.toBeInstanceOf(ErroIntegracaoExterna);
    });

    it("recusa valores nulos, negativos ou nao numericos", async () => {
      const gateway = criar();
      for (const valor of [0, -5, Number.NaN]) {
        await expect(gateway.efetuarPagamento(valor, "conta", "prof")).rejects.toBeInstanceOf(
          ErroIntegracaoExterna
        );
      }
    });

    it("recusa origem ou destino vazios", async () => {
      const gateway = criar();
      await expect(gateway.efetuarPagamento(10, "", "prof")).rejects.toBeInstanceOf(ErroIntegracaoExterna);
      await expect(gateway.efetuarPagamento(10, "conta", "")).rejects.toBeInstanceOf(ErroIntegracaoExterna);
    });
  });

  it("Stripe recebe centavos inteiros e moeda; PagSeguro e PayPal recebem texto com duas casas", async () => {
    const stripe = new ClienteStripeSimulado();
    const espiaoStripe = vi.spyOn(stripe.paymentIntents, "create");
    await new AdaptadorStripe(stripe).efetuarPagamento(150.5, "origem", "destino");
    expect(espiaoStripe).toHaveBeenCalledWith({
      amount: 15050,
      currency: "brl",
      source: "origem",
      destination: "destino",
    });

    const pagseguro = new ClientePagSeguroSimulado();
    const espiaoPs = vi.spyOn(pagseguro, "criarCobranca");
    await new AdaptadorPagSeguro(pagseguro).efetuarPagamento(150.5, "origem", "destino");
    expect(espiaoPs).toHaveBeenCalledWith({ valor: "150.50", pagador: "origem", recebedor: "destino" });

    const paypal = new ClientePayPalSimulado();
    const espiaoPp = vi.spyOn(paypal.orders, "create");
    await new AdaptadorPayPal(paypal).efetuarPagamento(150.5, "origem", "destino");
    expect(espiaoPp).toHaveBeenCalledWith({
      purchase_units: [{ amount: { currency_code: "BRL", value: "150.50" }, payee: { merchant_id: "destino" } }],
      payer: { payer_id: "origem" },
    });
  });

  it("arredonda centavos de forma correta em valores com erro de ponto flutuante", async () => {
    const stripe = new ClienteStripeSimulado();
    const espiao = vi.spyOn(stripe.paymentIntents, "create");
    await new AdaptadorStripe(stripe).efetuarPagamento(0.29, "o", "d"); // 0.29 * 100 = 28.999999999999996
    expect(espiao).toHaveBeenCalledWith(expect.objectContaining({ amount: 29 }));
  });

  it("status desconhecido de um provedor vira ErroIntegracaoExterna, nao um status inventado", async () => {
    const cliente = new ClientePayPalSimulado();
    const id = (
      await cliente.orders.create({
        purchase_units: [{ amount: { currency_code: "BRL", value: "1.00" }, payee: { merchant_id: "d" } }],
        payer: { payer_id: "o" },
      })
    ).id;
    vi.spyOn(cliente.orders, "get").mockResolvedValue({ id, status: "ALGO_NOVO" });
    await expect(new AdaptadorPayPal(cliente).verificarPagamento(id)).rejects.toThrow(/Status de pagamento desconhecido/);
  });
});

/* ------------------------- profissionais: contrato comum ------------------------- */

describe("Adapter de profissionais: contrato comum", () => {
  const repositorioBase = () =>
    new RepositorioProfissionaisEmMemoria([
      criarProfissional("p1", { papel: "diretor", precoMinimo: 8000 }),
      criarProfissional("p2", { papel: "editor", precoMinimo: 3000, cidade: "Campinas" }),
    ]);

  const provedores: [string, () => AdaptadorProfissional][] = [
    ["Interno", () => new AdaptadorInterno(repositorioBase())],
    ["LinkedIn", () => new AdaptadorLinkedIn()],
    ["Indeed", () => new AdaptadorIndeed()],
  ];

  describe.each(provedores)("%s", (_nome, criar) => {
    it("lista profissionais no formato do dominio", async () => {
      const todos = await criar().listarProfissionais();
      expect(todos.length).toBeGreaterThan(0);
      for (const p of todos) {
        expect(p.especialidades.length).toBeGreaterThan(0);
        expect(p.faixaPreco.minimo).toBeLessThanOrEqual(p.faixaPreco.maximo);
        expect(p.localizacao.cidade).toBeTruthy();
        for (const papel of p.especialidades) {
          expect(p.competencias.pesoPara(papel)).toBeGreaterThan(0);
          expect(p.competencias.pesoPara(papel)).toBeLessThanOrEqual(1);
        }
      }
    });

    it("filtra por papel, cidade e preco maximo com a mesma semantica", async () => {
      const adaptador = criar();
      const diretores = await adaptador.listarProfissionais({ papeis: ["diretor"] });
      expect(diretores.length).toBeGreaterThan(0);
      expect(diretores.every((p) => p.atendePapel("diretor"))).toBe(true);

      const campinas = await adaptador.listarProfissionais({ cidade: "campinas" });
      expect(campinas.every((p) => p.localizacao.cidade === "Campinas")).toBe(true);

      const baratos = await adaptador.listarProfissionais({ precoMaximo: 5000 });
      expect(baratos.every((p) => p.faixaPreco.minimo <= 5000)).toBe(true);
    });

    it("detalha um profissional listado e falha para um desconhecido", async () => {
      const adaptador = criar();
      const [primeiro] = await adaptador.listarProfissionais();
      const detalhe = await adaptador.detalharProfissional(primeiro.id);
      expect(detalhe.id).toBe(primeiro.id);
      expect(detalhe.nome).toBe(primeiro.nome);

      await expect(adaptador.detalharProfissional("inexistente")).rejects.toBeInstanceOf(
        ErroIntegracaoExterna
      );
    });

    it("registra uma avaliacao que passa a constar no historico", async () => {
      const adaptador = criar();
      const [primeiro] = await adaptador.listarProfissionais();
      const antes = (await adaptador.detalharProfissional(primeiro.id)).historico.length;

      await adaptador.registrarAvaliacao(primeiro.id, new Avaliacao("proj-novo", 5, "Otimo"));

      const depois = await adaptador.detalharProfissional(primeiro.id);
      expect(depois.historico).toHaveLength(antes + 1);
      expect(depois.historico[depois.historico.length - 1].nota).toBe(5);
    });
  });

  it("LinkedIn e Indeed prefixam ids com a origem e recusam ids de outra origem", async () => {
    const linkedin = new AdaptadorLinkedIn();
    const indeed = new AdaptadorIndeed();
    const [li] = await linkedin.listarProfissionais();
    const [ind] = await indeed.listarProfissionais();
    expect(li.id.startsWith("linkedin:")).toBe(true);
    expect(ind.id.startsWith("indeed:")).toBe(true);
    await expect(linkedin.detalharProfissional(ind.id)).rejects.toBeInstanceOf(ErroIntegracaoExterna);
    await expect(indeed.detalharProfissional("indeed:")).rejects.toBeInstanceOf(ErroIntegracaoExterna);
  });

  it("converte vocabulario e escalas: habilidades em ingles, endorsements 0-100, nota 0-10 do Indeed", async () => {
    const [helena] = await new AdaptadorLinkedIn().listarProfissionais({ papeis: ["diretor"] });
    expect(helena.nome).toBe("Helena Prado");
    expect(helena.especialidades).toEqual(["diretor", "roteirista"]);
    expect(helena.competencias.pesoPara("diretor")).toBeCloseTo(0.9);
    expect(helena.localizacao).toEqual({ cidade: "Sao Paulo", estado: "SP", pais: "Brasil" });

    const [kleber] = await new AdaptadorIndeed().listarProfissionais({ papeis: ["diretor"] });
    expect(kleber.nome).toBe("Kleber Dias");
    expect(kleber.competencias.pesoPara("diretor")).toBeCloseTo(0.8);
    expect(kleber.notaMedia()).toBeCloseTo(4.2); // 8.4 (escala 0-10) -> 4.2 (escala 0-5)
  });

  it("traduz criterios para a busca nativa de cada provedor", async () => {
    const linkedin = new ApiLinkedInSimulada();
    const buscaLinkedin = vi.spyOn(linkedin, "searchPeople");
    await new AdaptadorLinkedIn(linkedin).listarProfissionais({ papeis: ["diretor", "editor"] });
    expect(buscaLinkedin).toHaveBeenCalledWith({ keywords: ["Directing", "Video Editing"] });

    const indeed = new ApiIndeedSimulada();
    const buscaIndeed = vi.spyOn(indeed.jobSeekers, "search");
    await new AdaptadorIndeed(indeed).listarProfissionais({ papeis: ["diretor", "editor"], cidade: "Sao Paulo" });
    expect(buscaIndeed).toHaveBeenCalledWith({ q: "Film Director|Film Editor", where: "Sao Paulo" });
  });

  it("instancias diferentes das APIs simuladas nao compartilham estado", async () => {
    const a = new AdaptadorLinkedIn();
    const b = new AdaptadorLinkedIn();
    const [alvo] = await a.listarProfissionais();
    await a.registrarAvaliacao(alvo.id, new Avaliacao("p", 5));
    expect((await b.detalharProfissional(alvo.id)).historico).toHaveLength(alvo.historico.length);
  });

  it("aplicarCriterios sem criterios devolve tudo; papeis vazios nao filtram", () => {
    const lista = [criarProfissional("a"), criarProfissional("b", { papel: "editor" })];
    expect(aplicarCriterios(lista)).toHaveLength(2);
    expect(aplicarCriterios(lista, { papeis: [] })).toHaveLength(2);
  });
});

/* ---------------------------------- fabrica ---------------------------------- */

describe("FabricaAdaptadores", () => {
  it("resolve cada provedor pelo nome, ignorando caixa e espacos", () => {
    expect(FabricaAdaptadores.armazenamento(" S3 ")).toBeInstanceOf(AdaptadorS3);
    expect(FabricaAdaptadores.armazenamento("google_cloud")).toBeInstanceOf(AdaptadorGoogleCloud);
    expect(FabricaAdaptadores.armazenamento("local")).toBeInstanceOf(AdaptadorLocal);
    expect(FabricaAdaptadores.pagamento("Stripe")).toBeInstanceOf(AdaptadorStripe);
    expect(FabricaAdaptadores.pagamento("pagseguro")).toBeInstanceOf(AdaptadorPagSeguro);
    expect(FabricaAdaptadores.pagamento("paypal")).toBeInstanceOf(AdaptadorPayPal);
    const repositorio = new RepositorioProfissionaisEmMemoria();
    expect(FabricaAdaptadores.profissional("interno", repositorio)).toBeInstanceOf(AdaptadorInterno);
    expect(FabricaAdaptadores.profissional("linkedin", repositorio)).toBeInstanceOf(AdaptadorLinkedIn);
    expect(FabricaAdaptadores.profissional("indeed", repositorio)).toBeInstanceOf(AdaptadorIndeed);
  });

  it("nomes desconhecidos geram erro que lista as opcoes validas", () => {
    expect(() => FabricaAdaptadores.armazenamento("dropbox")).toThrow(/s3, google_cloud, local/);
    expect(() => FabricaAdaptadores.pagamento("bitcoin")).toThrow(/stripe, pagseguro, paypal/);
    expect(() => FabricaAdaptadores.profissional("orkut", new RepositorioProfissionaisEmMemoria())).toThrow(
      /interno, linkedin, indeed/
    );
  });
});
