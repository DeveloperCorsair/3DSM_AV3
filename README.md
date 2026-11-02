# CineBridge — Microsserviço de Recomendação e Orquestração de Equipes

Implementação da atividade ATVI: microsserviço
que recebe um projeto audiovisual, analisa profissionais cadastrados e monta,
de forma automática, uma equipe recomendada — aplicando conscientemente os
padrões de projeto **Strategy**, **Template Method**, **Observer** e **Visitor** (ATVI) e, na ATVIII, **Adapter**, **Composite** e **Decorator**.

## Stack técnica

- **Node.js** (LTS) + **TypeScript em modo estrito** (`strict: true`)
- **Fastify** para a camada HTTP
- **Vitest** para testes unitários e de integração.

## Estrutura de pastas

```
src/
  domain/          Entidades: Projeto, Profissional, Competencia, Avaliacao,
                    Recomendacao, Convite (a "árvore de dados" visitada)
  strategies/       [Strategy] 3 algoritmos de recomendação + fábrica
  orchestrator/     [Template Method] fluxo fixo de composição de equipe
  observers/        [Observer] notificações (e-mail, mensagens, auditoria)
  visitors/         [Visitor] validação, compatibilidade, relatório
  repository/       Repositório de profissionais + decorator tolerante a falhas
  events/           Barramento de eventos de domínio (in-memory → filas)
  server/           Serviço de aplicação, injeção de dependências, app Fastify
tests/
  unit/             Um arquivo de teste por padrão + serviço + repositório
  integration/       Teste do endpoint REST via app.inject (Fastify)
```

## Como rodar

```bash
npm install
npm run build      # compila para dist/
npm start          # sobe o Fastify em http://localhost:3000
# ou, em desenvolvimento com reload:
npm run dev
```

### Endpoint principal

```
POST /projetos/recomendacoes
Content-Type: application/json

{
  "genero": "documentario",
  "duracaoEstimadaMinutos": 90,
  "orcamentoTotal": 60000,
  "dataEntrega": "2027-05-01T00:00:00.000Z",
  "tipoCaptacao": "documentario",
  "localizacao": { "cidade": "Sao Paulo", "estado": "SP", "pais": "Brasil" },
  "papeisRequeridos": [
    { "nome": "diretor", "peso": 1 },
    { "nome": "editor", "peso": 0.5 }
  ],
  "estrategia": "similaridade_cosseno"
}
```

Retorna a equipe recomendada (`itens`), o resultado da validação de
consistência (Visitor) e um relatório com compatibilidade e margem
orçamentária (Visitor).

## Testes e cobertura

```bash
npm test              # roda toda a suíte (161 testes)
npm run test:coverage # roda com relatório de cobertura (v8)
```

## Requisitos não funcionais atendidos

- **Tolerância a falhas**: `RepositorioProfissionaisTolerranteAFalhas`
  decora o repositório real e retorna fallback (lista vazia /
  `undefined`) em vez de propagar exceções.
- **Auditoria**: `ObservadorAuditoria` registra toda ação relevante
  (recomendação gerada, convite atualizado) com timestamp.
- **Baixa acoplagem para escala futura**: comunicação interna via
  `Barramento` (hoje `EventEmitter`, migrável para fila de mensagens
  sem alterar a lógica de negócio).
- **Injeção de dependências explícita**: veja `server/composition-root.ts`
  — único ponto do sistema que conecta implementações concretas às
  abstrações (sem framework de DI).

## Compatibilidade de plataforma

Testado para rodar em Windows 10+ e Linux Ubuntu 24.04.


## ATVIII — Adapter, Composite e Decorator

### Mapeamento de nomes (enunciado → código)

O enunciado cita classes que na ATVI tinham outro nome; mantivemos os nomes existentes para não quebrar o que já funcionava:

| Enunciado | Código |
|---|---|
| `SistemaRecomendacao` | `ServicoRecomendacaoEquipe` (também exportado como `SistemaRecomendacao`) |
| `RecomendacaoStrategy` | `EstrategiaRecomendacao` (inalterada; alias `RecomendacaoStrategy`) |
| `RecomendadorBase` | `RecomendadorBase`, que estende a estratégia de similaridade de cosseno da ATVI |

### Adapter (`src/adapters`, `src/external`)

- Interfaces: `AdaptadorArmazenamento`, `AdaptadorPagamento`, `AdaptadorProfissional`.
- Adaptadores: S3, Google Cloud, Local · Stripe, PagSeguro, PayPal · LinkedIn, Indeed, Interno.
- `src/external` contém os sistemas externos **simulados** (sem rede), cada um com a assinatura do provedor real
  (centavos em Stripe, texto `"150.50"` em PagSeguro/PayPal, habilidades em inglês no LinkedIn, notas 0–10 no Indeed...).
  Os adaptadores traduzem chamadas, unidades, status, escalas e erros (`ErroIntegracaoExterna`).
- `ServicoRecomendacaoEquipe` recebe os adaptadores no construtor ou via `configurarAdaptadores(...)` (troca só o que for informado).
  Ele usa o adaptador de profissionais como fonte de candidatos, arquiva o relatório de cada recomendação no armazenamento
  (falha de armazenamento não derruba a recomendação) e paga a equipe com `pagarEquipe(...)`.
- As interfaces são **assíncronas** (o diagrama as mostra síncronas): I/O de rede e disco não é síncrono.
- Escolha por ambiente: `CINEBRIDGE_ARMAZENAMENTO` (`s3|google_cloud|local`, padrão `local`),
  `CINEBRIDGE_PAGAMENTO` (`stripe|pagseguro|paypal`), `CINEBRIDGE_PROFISSIONAIS` (`interno|linkedin|indeed`),
  `CINEBRIDGE_DIRETORIO_ARQUIVOS` (pasta do armazenamento local).

### Composite (`src/composite`)

- `ServicoProjeto` (`calcularCusto`, `listarSubservicos`, `obterPrazo`, `validar`), `ServicoAtomico` e `PacoteServico`.
- Pacote `sequencial` soma os prazos; `paralela` usa o maior. Custos sempre somam. Ciclos e filhos duplicados são rejeitados.
- `Projeto` ganhou o parâmetro **opcional** `servicoPrincipal`, com `calcularCustoTotal()`, `obterPrazoTotal()` e
  `validarEstrutura()` (papéis válidos, custos/prazos coerentes e prazo total cabendo até a data de entrega).
  `papeisRequeridos` foi mantido porque as estratégias dependem dele; quando o projeto traz só o `servicoPrincipal`,
  os papéis são derivados dos serviços atômicos.
- O orquestrador recusa compor equipe para estrutura inválida.

Exemplo (`POST /projetos/recomendacoes`):

```json
{
  "genero": "documentario", "duracaoEstimadaMinutos": 90, "orcamentoTotal": 80000,
  "dataEntrega": "2027-05-01T00:00:00.000Z", "tipoCaptacao": "documentario",
  "localizacao": { "cidade": "Sao Paulo", "estado": "SP", "pais": "Brasil" },
  "servicoPrincipal": {
    "tipo": "pacote", "nome": "pos-producao", "execucao": "sequencial",
    "subservicos": [
      { "tipo": "atomico", "nome": "edicao", "custo": 2000, "prazoDias": 5, "papel": "editor", "peso": 0.5 },
      { "tipo": "pacote", "nome": "acabamento", "execucao": "paralela", "subservicos": [
        { "tipo": "atomico", "nome": "mixagem", "custo": 1800, "prazoDias": 4, "papel": "sonoplasta" }
      ] }
    ]
  },
  "politica": { "decoradores": ["cache", "auditoria", "compressao"] }
}
```

### Decorator (`src/decorators`)

- `CacheDecorator`, `AuditoriaDecorator` e `CompressaoDecorator` implementam a mesma interface da estratégia que envolvem.
- **Cache:** a chave usa só o que as estratégias leem (algoritmo, papel e peso, orçamento por papel e dados dos candidatos),
  **sem o id do projeto**, para que projetos similares reaproveitem o resultado. Aceita TTL e limite de entradas.
- **Auditoria:** registra horário, estratégia, papel, projeto, contagens, duração e erros, e repropaga a exceção.
- **Compressão:** comprime (gzip) o resultado serializado e registra o ganho. Como a interface não pode mudar, o retorno
  continua sendo `ItemRecomendacao[]`; o payload comprimido fica em `ultimoPayloadComprimido` para a camada de transporte
  e `CompressaoDecorator.descomprimir` o restaura.
- **Pilha dinâmica:** `FabricaPilhaRecomendacao.montar(base, { decoradores })`. A ordem é a de aplicação: o primeiro nome
  fica mais interno (`["cache","auditoria"]` = `auditoria(cache(base))`). A política vem da requisição (`politica.decoradores`)
  ou do servidor (`CINEBRIDGE_DECORADORES`, ex.: `cache,auditoria,compressao`). Cache e trilha de auditoria são
  compartilhados entre requisições. Sem política, nada é aplicado (comportamento anterior).
- Para usar a pilha sem alterar o serviço, `gerarRecomendacao` aceita `estrategia` (instância pronta); a precedência é
  `estrategia` > `nomeEstrategia` > `definirEstrategia`.
