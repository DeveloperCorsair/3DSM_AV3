import { RepositorioProfissionais } from "../repository/professional-repository";
import { AdaptadorArmazenamento, AdaptadorGoogleCloud, AdaptadorLocal, AdaptadorS3 } from "./storage-adapters";
import { AdaptadorPagamento, AdaptadorPagSeguro, AdaptadorPayPal, AdaptadorStripe } from "./payment-adapters";
import {
  AdaptadorIndeed,
  AdaptadorInterno,
  AdaptadorLinkedIn,
  AdaptadorProfissional,
} from "./professional-adapters";

/** Conjunto de adaptadores que o servico de recomendacao pode receber (todos opcionais). */
export interface Adaptadores {
  armazenamento?: AdaptadorArmazenamento;
  pagamento?: AdaptadorPagamento;
  profissional?: AdaptadorProfissional;
}

export const PROVEDORES_ARMAZENAMENTO = ["s3", "google_cloud", "local"] as const;
export const PROVEDORES_PAGAMENTO = ["stripe", "pagseguro", "paypal"] as const;
export const PROVEDORES_PROFISSIONAIS = ["interno", "linkedin", "indeed"] as const;

function desconhecido(tipo: string, nome: string, validos: readonly string[]): Error {
  return new Error(`Provedor de ${tipo} desconhecido: "${nome}". Use: ${validos.join(", ")}.`);
}

/** Resolve o provedor pelo nome (ex.: vindo de variavel de ambiente), sem que o nucleo conheca as classes concretas. */
export class FabricaAdaptadores {
  static armazenamento(nome: string, diretorioLocal?: string): AdaptadorArmazenamento {
    switch (nome.trim().toLowerCase()) {
      case "s3":
        return new AdaptadorS3();
      case "google_cloud":
        return new AdaptadorGoogleCloud();
      case "local":
        return new AdaptadorLocal(diretorioLocal);
      default:
        throw desconhecido("armazenamento", nome, PROVEDORES_ARMAZENAMENTO);
    }
  }

  static pagamento(nome: string): AdaptadorPagamento {
    switch (nome.trim().toLowerCase()) {
      case "stripe":
        return new AdaptadorStripe();
      case "pagseguro":
        return new AdaptadorPagSeguro();
      case "paypal":
        return new AdaptadorPayPal();
      default:
        throw desconhecido("pagamento", nome, PROVEDORES_PAGAMENTO);
    }
  }

  static profissional(nome: string, repositorio: RepositorioProfissionais): AdaptadorProfissional {
    switch (nome.trim().toLowerCase()) {
      case "interno":
        return new AdaptadorInterno(repositorio);
      case "linkedin":
        return new AdaptadorLinkedIn();
      case "indeed":
        return new AdaptadorIndeed();
      default:
        throw desconhecido("profissionais", nome, PROVEDORES_PROFISSIONAIS);
    }
  }
}
