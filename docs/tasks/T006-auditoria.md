# T006 — Auditoria

- **Fase:** 2a — Fundação do backend
- **Depende de:** T004
- **ADRs:** 001 (D1, D3)

## Objetivo

Registrar toda ação que altera estado (via UI, MCP, agendador ou sistema), gravando **antes** de executar e fechando o registro depois, para que nenhuma ação suma do log, nem mesmo um restart que derruba o próprio Omnis.

## Escopo

### 1. Shared: `audit/audit.schemas.ts`

- `AuditSourceSchema = z.enum(['ui', 'mcp', 'scheduler', 'system'])`
- `AuditStatusSchema = z.enum(['started', 'succeeded', 'failed', 'interrupted'])`
- `ActorSchema`: `{ type: 'user' | 'token' | 'system', id: string | null, label: string }`
- `AuditEntrySchema`: `id`, `startedAt`, `finishedAt` (nullable), `actor`, `source`, `action`, `target` (nullable), `params` (unknown, nullable), `status`, `error` (nullable)
- `AuditListInputSchema`: paginação + filtros opcionais `action`, `status`, `source`, `from`, `to`
- `AuditListOutputSchema = paginated(AuditEntrySchema)`

### 2. Tabela `audit_log` (`src/db/schema/audit.ts`)

| Coluna | Tipo | Observação |
|---|---|---|
| `id` | integer PK autoincrement | também é o cursor da paginação |
| `started_at` | integer | índice |
| `finished_at` | integer nullable | |
| `actor_type` | text | |
| `actor_id` | text nullable | |
| `actor_label` | text | |
| `source` | text | |
| `action` | text | índice · formato `<modulo>.<acao>`, ex.: `processes.restart` |
| `target` | text nullable | ex.: nome do app |
| `params` | text nullable | JSON sanitizado |
| `status` | text | índice |
| `error` | text nullable | mensagem, sem stack |

### 3. Módulo `audit`

`audit.service.ts` → `createAuditService({ db, logger })`:

| Método | Comportamento |
|---|---|
| `start({ actor, source, action, target?, params? })` | insere com `status='started'`, retorna `id` |
| `succeed(id)` | `status='succeeded'`, `finished_at=agora` |
| `fail(id, error)` | `status='failed'`, guarda a mensagem |
| `reconcileInterrupted()` | todo `started` vira `interrupted` com `finished_at=agora`; retorna a quantidade |
| `list(input)` | ordem `id` desc, cursor = último `id`, filtros |
| `purgeOlderThan(date)` | apaga registros antigos (usado pelo agendador na T009) |

`audit.routes.ts`: `GET /api/audit` com `AuditListInputSchema` na querystring → `AuditListOutputSchema`.

`audit.tools.ts`: `export const auditTools = [];` (a tool `audit_list` entra na T008).

### 4. `core/with-audit.ts`

```ts
withAudit(
  audit: AuditService,
  ctx: { actor: Actor; source: AuditSource },
  meta: { action: string; target?: string; params?: unknown },
  fn: () => Promise<T>,
): Promise<T>
```

1. `start` → executa `fn` → `succeed` ou `fail` → retorna o resultado ou relança o erro.
2. O `start` é gravado de forma síncrona (better-sqlite3 é síncrono) **antes** de chamar `fn`.

### 5. Sanitização de `params` (`core/sanitize.ts`)

- Chaves que batem com `/pass|secret|token|key|cookie|authorization|content/i` → `'[REDACTED]'`, em qualquer profundidade.
- Strings com mais de 500 caracteres → truncadas com o sufixo `…[truncado]`.
- Profundidade máxima 5.

O caso de `content` cobre a escrita de arquivos (T014): o log registra que o arquivo foi alterado, nunca o conteúdo.

### 6. Integração

1. `AppDeps` ganha `audit`.
2. No boot, depois das migrations: `reconcileInterrupted()`. Se o retorno for maior que zero, logar em `warn` com a quantidade.
3. Até a T007, as rotas usam o ator `{ type: 'system', id: null, label: 'anonymous' }`.

### 7. Testes

- `withAudit` com sucesso e com falha: status e `finished_at` corretos, erro relançado.
- `start` existe no banco **antes** de `fn` rodar (verificar dentro da própria `fn`).
- `reconcileInterrupted` só altera os `started`.
- Sanitização: chaves sensíveis aninhadas, truncamento, profundidade.
- `list`: filtros, ordem, cursor e `nextCursor = null` na última página.

## Verificação

1. Migration gerada e aplicada.
2. Simular interrupção: inserir um `started`, reiniciar o server, confirmar `interrupted` e o warn no log.
3. `typecheck`, `lint` e `test` passam.

## Critérios de aceite

- [x] Registro gravado antes da execução.
- [x] Reconciliação no boot.
- [x] Nenhum segredo nem conteúdo de arquivo em `params`.

## Fora de escopo

Retenção automática (job na T009), tela de auditoria (T026).

## Registro de implementação

- Desvios da spec e motivo:
  - O cursor do `PaginationQuerySchema` é string. O `id` numérico trafega como string decimal, e `nextCursor` fica `null` na última página.
  - Passada a profundidade 5, o valor vira `[MAX_DEPTH]`. Nada mais fundo entra no log.
  - `purgeOlderThan` devolve quantas linhas apagou, comparando `started_at` com a data.
  - `succeed` e `fail` com id inexistente lançam `NOT_FOUND`.
  - Nenhuma rota atual altera estado, então nenhuma chama `withAudit` ainda. O ator anônimo fica em `ANONYMOUS_ACTOR` (`system` / `anonymous`) para as rotas usarem até a T007.
- Problemas encontrados:
  - O primeiro boot aplicou `0001_audit` (`applied: 1`) e fez backup, porque o banco já tinha a migration de `settings`.
  - Com uma linha `started` inserida à mão, o boot seguinte logou `reconciled interrupted audit entries` com `count: 1`. A linha ficou `interrupted`, com `finished_at` preenchido. `GET /api/audit` devolveu esse item.
  - `typecheck`, `lint`, `db:check` e `test` passaram (43 testes no server).
  - npm 12 avisa que Node `v22.20.0` está abaixo de `^22.22.2 || ^24.15.0 || >=26`. Os comandos rodaram.
