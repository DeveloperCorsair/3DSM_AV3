import { createHash } from "crypto";

/**
 * Sistemas de armazenamento EXTERNOS simulados.
 *
 * Imitam a forma das SDKs reais (nomes de metodos, parametros e retornos
 * de cada provedor) sem acesso a rede. Sao os "adaptees" do padrao
 * Adapter: nada aqui conhece as interfaces do CineBridge.
 */

/** Estilo Amazon S3 (aws-sdk). */
export class ClienteS3Simulado {
  private readonly objetos = new Map<string, Buffer>();

  async putObject(params: {
    Bucket: string;
    Key: string;
    Body: Buffer;
    ContentType?: string;
  }): Promise<{ ETag: string }> {
    if (!params.Bucket || !params.Key) {
      throw new Error("S3 InvalidRequest: Bucket e Key sao obrigatorios.");
    }
    this.objetos.set(`${params.Bucket}/${params.Key}`, Buffer.from(params.Body));
    return { ETag: `"${createHash("md5").update(params.Body).digest("hex")}"` };
  }

  async getObject(params: { Bucket: string; Key: string }): Promise<{ Body: Buffer }> {
    const objeto = this.objetos.get(`${params.Bucket}/${params.Key}`);
    if (!objeto) throw new Error(`S3 NoSuchKey: ${params.Key}`);
    return { Body: Buffer.from(objeto) };
  }

  async listObjectsV2(params: {
    Bucket: string;
    Prefix?: string;
  }): Promise<{ Contents: { Key: string }[] }> {
    const base = `${params.Bucket}/`;
    const prefixo = base + (params.Prefix ?? "");
    const Contents = [...this.objetos.keys()]
      .filter((chave) => chave.startsWith(prefixo))
      .map((chave) => ({ Key: chave.slice(base.length) }));
    return { Contents };
  }
}

/** Estilo Google Cloud Storage (@google-cloud/storage). */
export class ClienteGoogleCloudSimulado {
  private readonly armazem = new Map<string, Buffer>();

  bucket(nome: string): BucketGoogleCloudSimulado {
    return new BucketGoogleCloudSimulado(nome, this.armazem);
  }
}

export class BucketGoogleCloudSimulado {
  constructor(
    public readonly nome: string,
    private readonly armazem: Map<string, Buffer>
  ) {}

  file(caminho: string): {
    save(dados: Buffer, opcoes?: { contentType?: string }): Promise<void>;
    download(): Promise<[Buffer]>;
  } {
    const chave = `${this.nome}/${caminho}`;
    return {
      save: async (dados) => {
        this.armazem.set(chave, Buffer.from(dados));
      },
      download: async () => {
        const dados = this.armazem.get(chave);
        if (!dados) throw new Error(`GCS 404 Not Found: ${caminho}`);
        return [Buffer.from(dados)];
      },
    };
  }

  async getFiles(opcoes: { prefix?: string } = {}): Promise<[{ name: string }[]]> {
    const base = `${this.nome}/`;
    const prefixo = base + (opcoes.prefix ?? "");
    const arquivos = [...this.armazem.keys()]
      .filter((chave) => chave.startsWith(prefixo))
      .map((chave) => ({ name: chave.slice(base.length) }));
    return [arquivos];
  }
}
