import Fastify, { FastifyInstance } from "fastify";
import { randomUUID } from "crypto";
import { construirDependencias, Dependencias } from "./composition-root";
import { CriarProjetoDTO, dtoParaProjeto } from "./dto";
import { FabricaEstrategiaRecomendacao } from "../strategies/recommendation-strategy";
import { descreverServico } from "../composite/project-service";
import { ErroIntegracaoExterna } from "../adapters/errors";

export function construirApp(dependencias: Dependencias = construirDependencias()): FastifyInstance {
  const app = Fastify({ logger: true });
  const { servico, fabricaPilha, politicaPadrao } = dependencias;

  app.get("/saude", async () => ({ status: "ok" }));

  /**
   * Endpoint principal: aceita um projeto, aplica a estrategia
   * configurada (Strategy) atraves do orquestrador (Template Method),
   * retorna a equipe recomendada e, como efeito colateral, notifica
   * os observadores (Observer) e publica eventos de dominio.
   */
  app.post<{ Body: CriarProjetoDTO }>("/projetos/recomendacoes", async (request, reply) => {
    try {
      const dto = request.body;
      const projeto = dtoParaProjeto(dto, randomUUID());
      const base = FabricaEstrategiaRecomendacao.obter(dto.estrategia ?? "similaridade_cosseno");

      // Decorators (cache, auditoria, compressao): politica da requisicao ou a padrao do servidor.
      const politica = dto.politica?.decoradores
        ? { decoradores: dto.politica.decoradores }
        : politicaPadrao;
      const estrategia = fabricaPilha.montar(base, politica);

      const resultado = await servico.gerarRecomendacao({ projeto, estrategia });

      return reply.status(201).send({
        recomendacaoId: resultado.recomendacao.id,
        projetoId: projeto.id,
        status: resultado.recomendacao.status,
        itens: resultado.recomendacao.listarItens().map((item) => ({
          papel: item.papel,
          profissionalId: item.profissional.id,
          profissionalNome: item.profissional.nome,
          pontuacao: item.pontuacao,
        })),
        validacao: resultado.validacao,
        relatorio: resultado.relatorio,
        politicaAplicada: [...politica.decoradores],
        arquivoRelatorioId: resultado.arquivoRelatorioId,
        erroArquivamento: resultado.erroArquivamento,
        servicoPrincipal: projeto.servicoPrincipal
          ? {
              custoTotal: projeto.calcularCustoTotal(),
              prazoTotalDias: projeto.obterPrazoTotal(),
              estrutura: descreverServico(projeto.servicoPrincipal),
            }
          : undefined,
      });
    } catch (erro) {
      request.log.error(erro);
      // falha de provedor externo = bad gateway; demais erros sao de entrada invalida
      const status = erro instanceof ErroIntegracaoExterna ? 502 : 400;
      return reply.status(status).send({
        erro: erro instanceof Error ? erro.message : "Erro desconhecido",
      });
    }
  });

  return app;
}

/* istanbul ignore next -- ponto de entrada do processo, nao coberto por testes unitarios */
if (require.main === module) {
  const app = construirApp();
  const porta = Number(process.env.PORT ?? 3000);
  app.listen({ port: porta, host: "0.0.0.0" }).catch((erro) => {
    app.log.error(erro);
    process.exit(1);
  });
}
