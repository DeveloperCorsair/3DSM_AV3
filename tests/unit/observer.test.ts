import { describe, it, expect } from "vitest";
import { Convite, ItemRecomendacao, Profissional, Recomendacao, VetorCompetencia } from "../../src/domain/entities";
import {
  ObservadorAuditoria,
  ObservadorEmail,
  ObservadorMensagemInterna,
  SujeitoRecomendacao,
} from "../../src/observers/notification-observer";

function criarProfissional(id: string): Profissional {
  return new Profissional(
    id,
    `Profissional ${id}`,
    ["diretor"],
    { minimo: 5000, maximo: 10000 },
    [],
    { cidade: "Sao Paulo", estado: "SP", pais: "Brasil" },
    new VetorCompetencia(new Map())
  );
}

describe("Observer: SujeitoRecomendacao", () => {
  it("notifica todos os observadores inscritos, de forma independente, ao gerar uma recomendacao", () => {
    const sujeito = new SujeitoRecomendacao();
    const email = new ObservadorEmail();
    const mensagem = new ObservadorMensagemInterna();
    const auditoria = new ObservadorAuditoria();
    sujeito.inscrever(email);
    sujeito.inscrever(mensagem);
    sujeito.inscrever(auditoria);

    const item = new ItemRecomendacao("diretor", criarProfissional("p1"), 0.9);
    const recomendacao = new Recomendacao("rec-1", "proj-1", [item]);

    sujeito.notificarRecomendacaoGerada(recomendacao);

    expect(email.enviados).toContainEqual(
      expect.stringContaining("email:convite:p1:diretor:proj-1")
    );
    expect(mensagem.mensagens).toContainEqual(
      expect.stringContaining("mensagem:nova_recomendacao:rec-1")
    );
    expect(auditoria.registros).toHaveLength(1);
    expect(auditoria.registros[0].tipo).toBe("recomendacao_gerada");
  });

  it("nao notifica observadores apos desinscricao", () => {
    const sujeito = new SujeitoRecomendacao();
    const email = new ObservadorEmail();
    sujeito.inscrever(email);
    sujeito.desinscrever(email);

    const convite = new Convite("conv-1", "proj-1", "p1", "diretor");
    sujeito.notificarConviteAtualizado(convite);

    expect(email.enviados).toHaveLength(0);
  });

  it("reage a mudanca de estado de convite (aceito/recusado) atualizando cada observador", () => {
    const sujeito = new SujeitoRecomendacao();
    const auditoria = new ObservadorAuditoria();
    sujeito.inscrever(auditoria);

    const convite = new Convite("conv-2", "proj-1", "p1", "editor");
    convite.aceitar();
    sujeito.notificarConviteAtualizado(convite);

    expect(auditoria.registros[0].detalhes.status).toBe("aceito");
  });
});
