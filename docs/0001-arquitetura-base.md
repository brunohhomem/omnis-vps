# ADR-001 — Arquitetura base do Omnis

- **Status:** Proposto
- **Data:** 2026-10-20
- **Decisores:** Bruno

## Contexto

O Omnis é um painel próprio de gerenciamento de uma VPS Hostinger (KVM2: 2 vCPU, 8 GB RAM, 100 GB NVMe). Ele também é acessível por IA via MCP.

Ambiente atual da VPS:

- Aplicações Node rodam no **PM2**.
- O **Postgres roda em Docker**.
- O **Nginx** faz proxy reverso das aplicações.
- O deploy das aplicações é feito via **GitHub Actions** e continua fora do escopo do Omnis.

Princípios do projeto:

1. **Leveza máxima**: meta de < 100 MB de RAM e consumo de CPU desprezível em idle.
2. **Custo zero** de infraestrutura adicional.
3. **Superfície de ação fechada**: nenhuma execução de comando arbitrário. Toda ação é uma operação definida em código.
4. **Mesma lógica para UI e MCP**: tudo o que o painel faz, o MCP faz pelo mesmo serviço.

## Decisões

| # | Tema | Decisão |
|---|---|---|
| D1 | Execução | Omnis roda como processo do **PM2** |
| D2 | Topologia | **Processo único** com módulos isolados |
| D3 | Backend | **Fastify puro** + **zod** (`fastify-type-provider-zod`) |
| D4 | Frontend | **Next.js com `output: 'export'`** + shadcn/ui + Tailwind 4 |
| D5 | Dados próprios | **SQLite** (better-sqlite3) + **Drizzle** com migrations versionadas |
| D6 | Coleta | `/proc`/systeminformation · API programática do PM2 · Docker Engine API · `pg_stat_*` |
| D7 | Backup do Postgres | `pg_dump -Fc` → criptografia → storage S3-compatível (R2/B2) |
| D8 | MCP | Streamable HTTP em `/mcp`, token Bearer com escopo |
| D9 | Exposição de rede | **Cloudflare Tunnel + Cloudflare Access** (plano gratuito) |
| D10 | Autenticação | Usuário único · senha + TOTP · tokens `read` / `ops` / `admin` |
| D11 | Alertas | Bot do **Telegram** |
| D12 | Repositório | Monorepo com **npm workspaces** (sem Turbo no MVP) |
| D13 | Heartbeat externo | **Healthchecks.io** (gratuito) |

### D1 — Execução no PM2

Regras obrigatórias:

1. Ações em massa (ex.: "reiniciar todas as apps") **excluem o próprio Omnis**.
2. A auditoria grava a ação com status `started` **antes** de executá-la. No boot, o Omnis reconcilia ações que ficaram em `started` e as marca como `interrupted`, para que um restart que matou o próprio Omnis não suma do log.
3. Se o daemon do PM2 cair, o Omnis cai junto. O D13 cobre esse cenário.

### D2 — Processo único

Um único processo Fastify contém:

- API REST
- endpoint MCP
- frontend estático
- coletor de métricas
- agendador (backups, rollups, retenção, heartbeat)

Os módulos têm fronteiras explícitas, para permitir separar agente e hub no futuro (multi-servidor) sem reescrever.

### D3 — Backend: Fastify puro, com convenção fixa

Cada módulo é um plugin Fastify com exatamente esta estrutura:

```
apps/server/src/modules/<modulo>/
  index.ts            # registra o plugin (rotas + tools)
  <modulo>.service.ts # regra de negócio — não conhece HTTP nem MCP
  <modulo>.routes.ts  # adaptador HTTP fino → chama o service
  <modulo>.tools.ts   # adaptador MCP fino → chama o service
```

Regras:

1. **Services não importam nada de Fastify nem do SDK MCP.**
2. Routes e tools só validam a entrada, checam o escopo, chamam o service e registram auditoria.
3. Schemas de entrada e saída são **zod**, definidos em `packages/shared`. O mesmo schema valida a rota HTTP, define a tool MCP e tipa o frontend.
4. Nenhum módulo acessa o banco de outro módulo diretamente. A comunicação acontece via service.

Módulos previstos no MVP:

| Módulo | Responsabilidade |
|---|---|
| `metrics` | coleta de sistema, rollups, relatório de pico |
| `processes` | apps do PM2: listar, métricas, restart/stop/start |
| `logs` | logs do PM2, journald, container do Postgres |
| `files` | leitura e escrita em diretórios permitidos, backup antes de escrever, mascarar segredos |
| `scheduler` | jobs agendados (interno e exposto na UI) |
| `backups` | dump, criptografia, upload, retenção, restore em banco novo |
| `postgres` | conexões, tamanho, queries lentas |
| `docker` | containers, imagens, volumes, prune |
| `security` | tentativas de login SSH, expiração de SSL |
| `alerts` | regras e envio via Telegram |
| `auth` | login, TOTP, sessões, tokens com escopo |
| `audit` | registro de todas as ações |
| `system` | reboot, informações gerais, heartbeat |
| `mcp` | registra as tools de todos os módulos no endpoint `/mcp` |

### D4 — Frontend: Next.js em static export

Next.js com `output: 'export'`, servido pelo Fastify via `@fastify/static`. UI com shadcn/ui e Tailwind 4. Gráficos com **uPlot** e editor de arquivos com **CodeMirror 6**.

**Restrições do static export (proibido no projeto):**

1. API Routes / Route Handlers
2. Server Actions
3. `middleware.ts`
4. Server Components que buscam dados em runtime
5. Otimização de imagem do `next/image` (usar `unoptimized`)

Consequências:

- Todo dado vem da API do Fastify, via fetch no cliente.
- A autenticação é um cookie `httpOnly` validado pelo Fastify. A proteção de páginas acontece no cliente, e a segurança real fica na API.
- Rotas dinâmicas usam parâmetros resolvidos no cliente (ex.: `/apps?name=x`) ou `generateStaticParams` com conjunto conhecido.

### D5 — SQLite + Drizzle

- Driver: `better-sqlite3`, com modo **WAL** ativo.
- Banco em um único arquivo (ex.: `/var/lib/omnis/omnis.db`), independente do Postgres monitorado.
- **Migrations**: `drizzle-kit`, arquivos SQL versionados no repositório. São aplicadas automaticamente no boot, **depois de copiar o arquivo `.db`** para `omnis.db.bak-<timestamp>`.
- Retenção de métricas: amostras brutas por 7 dias e agregados por hora por 1 ano.

Motivo: o Postgres pode cair por OOM killer, disco cheio, atualização do Docker ou durante um restore. Se os dados do Omnis estivessem nele, monitoramento, alertas e auditoria parariam junto com o banco.

### D6 — Coleta

- **Sistema**: CPU, RAM, disco, rede e load, em intervalo configurável (padrão 30 s).
- **Apps**: API programática do PM2. O Omnis roda com o mesmo usuário/`PM2_HOME` dos apps.
- **Postgres**: Docker Engine API para estado e consumo do container, e `pg_stat_activity` + `pg_stat_statements` para conexões e queries.

### D7 — Backup do Postgres

- `pg_dump -Fc` via `docker exec`, criptografado antes do upload, enviado para storage S3-compatível.
- Retenção: 7 diários + 4 semanais.
- **Restore sempre em banco novo**, nunca sobrescrevendo o de produção. A troca é uma ação separada e confirmada.
- Agendado fora do horário de pico (2 vCPU).
- ⚠️ **Já existe um backup configurado na VPS para o sistema principal.** O módulo `backups` precisa de um ADR próprio para decidir se o Omnis **adota/monitora** esse backup ou o **substitui**. Em nenhum caso dois dumps podem rodar ao mesmo tempo.

### D8 — MCP

- Transporte **Streamable HTTP** em `/mcp`, com o SDK oficial TypeScript.
- Autenticação por token Bearer com escopo. O token é armazenado como hash.
- Tools de escrita e de ação exigem escopo `ops` ou `admin` **e** o parâmetro `confirm: true`.
- OAuth (para o conector do claude.ai) fica para uma fase futura.

### D9 — Cloudflare Tunnel + Access

- `cloudflared` roda na VPS e expõe `omnis.<dominio>` → `localhost:<porta-omnis>`, sem abrir portas.
- O Cloudflare Access protege a UI (login por código no e-mail).
- `/mcp` tem uma regra de **bypass** no Access e é protegido pelo token do D8.
- O Nginx continua servindo as aplicações. A migração dele para o Tunnel é uma decisão futura.
- **Pré-requisito:** migrar os nameservers do domínio da Hostinger para a Cloudflare (ver Pendências).

### D10 — Autenticação

- Usuário único, senha com hash **argon2** + **TOTP** obrigatório.
- Sessão em cookie `httpOnly`, `secure`, `sameSite=strict`.
- Rate limit no login.
- Escopos dos tokens:
  - `read`: só leitura.
  - `ops`: restart, edição de arquivos, backup manual.
  - `admin`: reboot, restore, gestão de tokens.

### D11 — Alertas via Telegram

Alertas mínimos do MVP:

- disco acima de X%
- app do PM2 parado ou em loop de restart
- falha de backup
- certificado SSL perto de expirar
- pico de tentativas de login SSH

### D12 — Monorepo com npm workspaces

```
omnis/
  apps/server     # Fastify
  apps/web        # Next.js (static export)
  packages/shared # schemas zod, tipos, constantes
```

A estratégia de consumo do `packages/shared` (build vs. fonte TS, ESM, versão única do zod) fica para o **ADR-002**.

### D13 — Heartbeat externo

O Omnis faz ping no Healthchecks.io a cada N minutos. Se o ping parar (VPS fora, PM2 morto, Omnis travado), o Healthchecks.io alerta por e-mail ou Telegram.

## Consequências

**Positivas**

- Uma porta, um processo, um arquivo de dados: deploy e operação simples.
- UI e MCP compartilham services e schemas, sem divergência de comportamento.
- O monitoramento continua funcionando quando o Postgres falha.
- Custo zero.

**Negativas / riscos aceitos**

- Omnis e apps dependem do mesmo daemon do PM2 (mitigado pelo D13).
- O acesso ao socket do Docker equivale a root. Mitigação a discutir antes do módulo `docker`/`postgres`.
- O static export proíbe recursos de servidor do Next, o que exige disciplina (regras do D4).
- O Cloudflare Access adiciona uma dependência externa para acessar a UI.

## Pendências

1. **ADR-002**: monorepo e consumo do `packages/shared`.
2. **ADR de backup**: integração com o backup já existente na VPS.
3. **Migração de nameservers** Hostinger → Cloudflare, replicando todos os registros DNS atuais (incluindo os de e-mail do Resend).
4. A discutir quando chegarmos nos módulos correspondentes:
   - mitigação do socket Docker
   - `sudoers` para reboot/journald
   - checklist de "tudo volta sozinho após reboot"
   - prompt injection via conteúdo lido pelo MCP

## Fora de escopo

- Deploy de aplicações (continua no GitHub Actions)
- DNS, e-mail, FTP
- Terminal web
- Multiusuário
- Loja de apps
