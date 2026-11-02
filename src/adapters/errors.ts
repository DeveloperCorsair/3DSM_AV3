/**
 * Erro unico que o nucleo do sistema enxerga quando um provedor externo
 * falha. Cada adaptador traduz os erros especificos do seu provedor para
 * este tipo, de modo que a logica de negocio nao precise conhecer
 * mensagens ou codigos de Stripe, S3, LinkedIn etc.
 */
export class ErroIntegracaoExterna extends Error {
  constructor(
    public readonly provedor: string,
    mensagem: string,
    public readonly causa?: unknown
  ) {
    super(`[${provedor}] ${mensagem}`);
    this.name = "ErroIntegracaoExterna";
  }
}

/** Executa uma chamada ao provedor e converte qualquer falha em ErroIntegracaoExterna. */
export async function chamarProvedor<T>(
  provedor: string,
  chamada: () => T | Promise<T>
): Promise<T> {
  try {
    return await chamada();
  } catch (erro) {
    if (erro instanceof ErroIntegracaoExterna) throw erro;
    throw new ErroIntegracaoExterna(
      provedor,
      erro instanceof Error ? erro.message : String(erro),
      erro
    );
  }
}
