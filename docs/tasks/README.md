# Backlog do Omnis

Legenda: ⬜ a fazer · 🟦 em andamento · ✅ concluída · 📝 spec ainda não escrita · ⛔ bloqueada por decisão pendente

Ordem de execução: **monorepo → backend e banco → frontend**.

## Fase 1 — Monorepo

| ID | Task | Depende de | Status |
|---|---|---|---|
| T001 | [Estrutura do monorepo e tooling](T001-estrutura-monorepo.md) | — | ✅ |
| T002 | [Fundação do `packages/shared`](T002-fundacao-shared.md) | T001 | ✅ |

## Fase 2 — Backend e banco

### 2a. Fundação (specs prontas)

| ID | Task | Depende de | Status |
|---|---|---|---|
| T003 | [Bootstrap do server (Fastify)](T003-bootstrap-server.md) | T002 | ✅ |
| T004 | [Banco SQLite + Drizzle + migrations](T004-banco-sqlite-drizzle.md) | T003 | ✅ |
| T005 | [Adaptadores e modo fake](T005-adaptadores-modo-fake.md) | T003 | ✅ |
| T006 | [Auditoria](T006-auditoria.md) | T004 | ✅ |
| T007 | [Autenticação e tokens](T007-autenticacao-tokens.md) | T006 | ✅ |
| T008 | [Endpoint MCP](T008-endpoint-mcp.md) | T005, T007 | ✅ |

### 2b. Módulos (specs escritas após a fundação)

| ID | Task | Depende de | Status | Observação |
|---|---|---|---|---|
| T009 | Agendador (jobs, execuções, retenção) | T006 | 📝 | |
| T010 | Métricas: coleta, rollups, relatório de pico | T005, T009 | 📝 | |
| T011 | **Deploy do Omnis na VPS** (PM2, Tunnel, Access, heartbeat) | T008, T010 | 📝 | Antecipado de propósito, ver abaixo |
| T012 | Processos (PM2) | T008 | 📝 | |
| T013 | Logs (PM2, journald, container) | T012 | 📝 | Acesso ao journald a decidir |
| T014 | Arquivos (allowlist, backup, segredos mascarados) | T008 | 📝 | |
| T015 | Postgres (conexões, tamanho, queries lentas) | T008 | ⛔ | Socket Docker + usuário read-only |
| T016 | Docker (containers, imagens, prune) | T008 | ⛔ | Mitigação do socket Docker |
| T017 | Backups | T009, T015 | ⛔ | ADR-003: backup já existente na VPS |
| T018 | Segurança (logins SSH, expiração de SSL) | T009 | 📝 | |
| T019 | Alertas (Telegram) | T010 | 📝 | |
| T020 | Ações de sistema (reboot) | T008 | ⛔ | `sudoers` + checklist pós-reboot |

## Fase 3 — Frontend

| ID | Task | Depende de | Status |
|---|---|---|---|
| T021 | Base do web: static export, Tailwind 4, shadcn, client da API, login | T007 | 📝 |
| T022 | Dashboard de métricas (uPlot) | T010, T021 | 📝 |
| T023 | Processos e logs | T013, T021 | 📝 |
| T024 | Editor de arquivos (CodeMirror 6) | T014, T021 | 📝 |
| T025 | Agendador, backups e alertas | T017, T019, T021 | 📝 |
| T026 | Auditoria e tokens | T007, T021 | 📝 |

## Por que o deploy (T011) vem antes do frontend

O relatório de horários de pico depende de **dias de coleta real**. Com o backend e o MCP em produção logo após as métricas, os dados acumulam enquanto o frontend é construído, e o Omnis já fica utilizável via MCP desde cedo.

## Por que só T001–T008 têm spec

São a fundação: definem os padrões que todos os módulos seguem. Escrever as specs dos módulos agora geraria specs desatualizadas, porque a fundação vai revelar ajustes. Cada spec da fase 2b será escrita e aprovada antes de ir para o Cursor.

## Decisões pendentes

| Decisão | Bloqueia |
|---|---|
| Mitigação do acesso ao socket Docker | T015, T016 |
| ADR-003: integração com o backup já existente | T017 |
| `sudoers` para reboot e acesso ao journald | T013 (parcial), T020 |
| Checklist "tudo volta sozinho após reboot" | T020 |
| Tratamento de conteúdo não confiável (logs/arquivos) nas tools MCP | T013, T014 |
