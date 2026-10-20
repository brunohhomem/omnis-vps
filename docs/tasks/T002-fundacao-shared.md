# T002 — Fundação do `packages/shared`

- **Fase:** 1 — Monorepo
- **Depende de:** T001
- **ADRs:** 001 (D3), 002 (M4, M5, M7)

## Objetivo

Definir a estrutura e as convenções do `shared` e criar os contratos base que todas as tasks seguintes usam: formato de erro, primitivos, paginação, escopos e schemas do módulo `system`.

## Escopo

### 1. Estrutura

```
packages/shared/
  README.md
  src/
    index.ts                 # barrel: reexporta tudo
    common/
      errors.ts
      primitives.ts
      pagination.ts
    auth/
      scopes.ts
    system/
      system.schemas.ts
```

Regra de organização: uma pasta por módulo do server (`system/`, `audit/`, `auth/`, ...), com arquivo `<modulo>.schemas.ts`. `common/` guarda o que é transversal.

### 2. Convenções de nomes (documentar no `packages/shared/README.md`)

| Elemento | Padrão | Exemplo |
|---|---|---|
| Schema de entidade | `XxxSchema` | `SystemInfoSchema` |
| Entrada de rota/tool | `XxxInputSchema` | `AuditListInputSchema` |
| Saída de rota/tool | `XxxOutputSchema` | `AuditListOutputSchema` |
| Tipo derivado | `export type Xxx = z.infer<typeof XxxSchema>` | `SystemInfo` |
| Enum | `XxxSchema = z.enum([...])` + tipo | `ScopeSchema`, `Scope` |
| Constante | `UPPER_SNAKE_CASE` | `SCOPE_RANK` |

Os tipos sempre derivam do schema. Nunca escrever `interface` ou `type` à mão para algo que tem schema.

### 3. `common/errors.ts`

- `ErrorCodeSchema = z.enum([...])` com: `VALIDATION_ERROR`, `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `RATE_LIMITED`, `CONFIRMATION_REQUIRED`, `ADAPTER_UNAVAILABLE`, `INTERNAL_ERROR`.
- `ApiErrorSchema`:
  ```ts
  z.object({
    error: z.object({
      code: ErrorCodeSchema,
      message: z.string(),
      details: z.unknown().optional(),
    }),
  })
  ```

### 4. `common/primitives.ts`

- `IsoDateTimeSchema`: string ISO 8601 com offset.
- `IdSchema`: string não vazia.
- `ConfirmSchema = z.literal(true)` com descrição explicando que ações destrutivas exigem confirmação explícita.

### 5. `common/pagination.ts`

- `PaginationQuerySchema`: `limit` (coerce number, default 50, máx. 500), `cursor` (string opcional).
- `paginated(itemSchema)`: retorna `z.object({ items: z.array(itemSchema), nextCursor: z.string().nullable() })`.

### 6. `auth/scopes.ts`

- `ScopeSchema = z.enum(['read', 'ops', 'admin'])`.
- `SCOPE_RANK = { read: 1, ops: 2, admin: 3 } as const`.
- `hasScope(granted: Scope, required: Scope): boolean`.

### 7. `system/system.schemas.ts`

- `HealthOutputSchema`: `status: z.literal('ok')`, `version`, `uptimeSec`, `rssBytes`.
- `OmnisModeSchema = z.enum(['real', 'fake'])`.
- `SystemInfoOutputSchema`: `hostname`, `platform`, `kernel` (opcional), `cpuCount`, `totalMemBytes`, `nodeVersion`, `omnisVersion`, `mode: OmnisModeSchema`.

### 8. Remover o smoke da T001

Apagar `SHARED_SMOKE` e `SmokeSchema`. Atualizar o `apps/server/src/index.ts` e a página do web para usar `HealthOutputSchema` (ex.: o web exibe `ScopeSchema.options`; o server faz `parse` de um objeto de health de exemplo). Isso mantém a prova de consumo até as T003 e T021 substituírem esses arquivos.

### 9. Testes (Vitest)

- `hasScope`: todas as 9 combinações.
- `paginated`: aceita saída válida, rejeita `nextCursor` ausente.
- `PaginationQuerySchema`: aplica o default e rejeita `limit > 500`.

## Verificação

1. `npm run typecheck`, `npm run lint` e `npm run test` passam.
2. `npm run dev`: server e web continuam importando do shared.
3. `grep -r "from 'node:" packages/shared` não retorna nada.

## Critérios de aceite

- [ ] Estrutura e convenções documentadas no `packages/shared/README.md`.
- [ ] Nenhum tipo escrito à mão que duplique um schema.
- [ ] Shared sem dependências além de `zod`.
- [ ] Testes passando.

## Fora de escopo

Schemas de módulos que ainda não existem (audit, auth etc. entram nas suas tasks).

## Registro de implementação

- Desvios da spec e motivo:
- Problemas encontrados:
