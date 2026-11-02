import { randomUUID } from "crypto";
import { Dirent, promises as fs } from "fs";
import * as os from "os";
import * as path from "path";
import { ClienteGoogleCloudSimulado, ClienteS3Simulado } from "../external/storage-clients";
import { chamarProvedor, ErroIntegracaoExterna } from "./errors";

/**
 * Padrao Adapter - armazenamento de arquivos (roteiros, storyboards,
 * amostras de video, relatorios).
 *
 * `AdaptadorArmazenamento` e o contrato que o nucleo conhece. Cada
 * adaptador concreto traduz estas tres chamadas para a API especifica do
 * seu provedor, de forma que trocar S3 por Google Cloud (ou pelo disco
 * local) nao exige alterar a logica de negocio.
 */
export interface MetadadosArquivo {
  nome?: string;
  /** "Pasta" logica; pode ter niveis separados por "/". */
  pasta?: string;
  tipoConteudo?: string;
}

export interface AdaptadorArmazenamento {
  /** Grava o conteudo e devolve o identificador (o mesmo aceito por recuperarArquivo). */
  salvarArquivo(conteudo: Buffer, metadados?: MetadadosArquivo): Promise<string>;
  recuperarArquivo(id: string): Promise<Buffer>;
  /** Identificadores que comecam por `prefixo`, em ordem alfabetica. */
  listarArquivos(prefixo: string): Promise<string[]>;
}

function sanitizar(segmento: string): string {
  const limpo = segmento.replace(/[^a-zA-Z0-9._-]/g, "_");
  return /^\.+$/.test(limpo) ? "_" : limpo;
}

/** Gera um identificador "pasta/uuid-nome", igual para todos os provedores, sem caracteres perigosos. */
export function gerarIdArquivo(metadados: MetadadosArquivo = {}): string {
  const pasta = (metadados.pasta ?? "geral")
    .split("/")
    .filter((segmento) => segmento !== "")
    .map(sanitizar)
    .join("/");
  const nome = sanitizar(metadados.nome ?? "arquivo.bin");
  return `${pasta === "" ? "geral" : pasta}/${randomUUID()}-${nome}`;
}

/** Adaptador para Amazon S3 (usa Bucket/Key, putObject, getObject e listObjectsV2). */
export class AdaptadorS3 implements AdaptadorArmazenamento {
  constructor(
    private readonly cliente: ClienteS3Simulado = new ClienteS3Simulado(),
    private readonly bucket: string = "cinebridge-midia"
  ) {}

  async salvarArquivo(conteudo: Buffer, metadados: MetadadosArquivo = {}): Promise<string> {
    const id = gerarIdArquivo(metadados);
    await chamarProvedor("s3", () =>
      this.cliente.putObject({
        Bucket: this.bucket,
        Key: id,
        Body: conteudo,
        ContentType: metadados.tipoConteudo,
      })
    );
    return id;
  }

  async recuperarArquivo(id: string): Promise<Buffer> {
    const resposta = await chamarProvedor("s3", () =>
      this.cliente.getObject({ Bucket: this.bucket, Key: id })
    );
    return resposta.Body;
  }

  async listarArquivos(prefixo: string): Promise<string[]> {
    const resposta = await chamarProvedor("s3", () =>
      this.cliente.listObjectsV2({ Bucket: this.bucket, Prefix: prefixo })
    );
    return resposta.Contents.map((objeto) => objeto.Key).sort();
  }
}

/** Adaptador para Google Cloud Storage (usa bucket().file().save()/download() e getFiles). */
export class AdaptadorGoogleCloud implements AdaptadorArmazenamento {
  constructor(
    private readonly cliente: ClienteGoogleCloudSimulado = new ClienteGoogleCloudSimulado(),
    private readonly nomeBucket: string = "cinebridge-midia"
  ) {}

  async salvarArquivo(conteudo: Buffer, metadados: MetadadosArquivo = {}): Promise<string> {
    const id = gerarIdArquivo(metadados);
    await chamarProvedor("google_cloud", () =>
      this.cliente
        .bucket(this.nomeBucket)
        .file(id)
        .save(conteudo, { contentType: metadados.tipoConteudo })
    );
    return id;
  }

  async recuperarArquivo(id: string): Promise<Buffer> {
    const [conteudo] = await chamarProvedor("google_cloud", () =>
      this.cliente.bucket(this.nomeBucket).file(id).download()
    );
    return conteudo;
  }

  async listarArquivos(prefixo: string): Promise<string[]> {
    const [arquivos] = await chamarProvedor("google_cloud", () =>
      this.cliente.bucket(this.nomeBucket).getFiles({ prefix: prefixo })
    );
    return arquivos.map((arquivo) => arquivo.name).sort();
  }
}

/**
 * Adaptador para o sistema de arquivos local (desenvolvimento e
 * instalacoes sem nuvem). Os identificadores usam sempre "/", e o caminho
 * fisico e montado com `path`, o que funciona igual em Windows e Linux.
 */
export class AdaptadorLocal implements AdaptadorArmazenamento {
  constructor(
    private readonly diretorioBase: string = path.join(os.tmpdir(), "cinebridge-arquivos")
  ) {}

  private caminhoDe(id: string): string {
    const segmentos = id.split("/");
    if (segmentos.some((s) => s === "" || s === "." || s === ".." || /[\\:]/.test(s))) {
      throw new ErroIntegracaoExterna("local", `Identificador de arquivo invalido: ${id}`);
    }
    return path.join(this.diretorioBase, ...segmentos);
  }

  async salvarArquivo(conteudo: Buffer, metadados: MetadadosArquivo = {}): Promise<string> {
    const id = gerarIdArquivo(metadados);
    const caminho = this.caminhoDe(id);
    await chamarProvedor("local", async () => {
      await fs.mkdir(path.dirname(caminho), { recursive: true });
      await fs.writeFile(caminho, conteudo);
    });
    return id;
  }

  async recuperarArquivo(id: string): Promise<Buffer> {
    const caminho = this.caminhoDe(id);
    return chamarProvedor("local", () => fs.readFile(caminho));
  }

  async listarArquivos(prefixo: string): Promise<string[]> {
    const ids: string[] = [];

    const percorrer = async (relativo: string[]): Promise<void> => {
      let entradas: Dirent[];
      try {
        entradas = await fs.readdir(path.join(this.diretorioBase, ...relativo), {
          withFileTypes: true,
        });
      } catch (erro) {
        if ((erro as NodeJS.ErrnoException).code === "ENOENT") return;
        throw erro;
      }
      for (const entrada of entradas) {
        const atual = [...relativo, entrada.name];
        if (entrada.isDirectory()) await percorrer(atual);
        else ids.push(atual.join("/"));
      }
    };

    await chamarProvedor("local", () => percorrer([]));
    return ids.filter((id) => id.startsWith(prefixo)).sort();
  }
}
