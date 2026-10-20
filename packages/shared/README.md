# @omnis/shared

Schemas zod, tipos derivados, constantes e funções puras compartilhados pelo server e pelo web.

O pacote não tem build: `exports` aponta para `src/index.ts` e cada consumidor transpila o TypeScript. A única dependência é `zod`. Não importa APIs do Node nem do browser.

## Estrutura

Uma pasta por módulo do server, com o arquivo `<modulo>.schemas.ts`. `common/` guarda o que é transversal.

```
src/
  index.ts                 # barrel
  common/
    errors.ts
    primitives.ts
    pagination.ts
  auth/
    scopes.ts
  system/
    system.schemas.ts
```

## Convenções de nomes

| Elemento | Padrão | Exemplo |
|---|---|---|
| Schema de entidade | `XxxSchema` | `SystemInfoSchema` |
| Entrada de rota/tool | `XxxInputSchema` | `AuditListInputSchema` |
| Saída de rota/tool | `XxxOutputSchema` | `AuditListOutputSchema` |
| Tipo derivado | `export type Xxx = z.infer<typeof XxxSchema>` | `SystemInfo` |
| Enum | `XxxSchema = z.enum([...])` + tipo | `ScopeSchema`, `Scope` |
| Constante | `UPPER_SNAKE_CASE` | `SCOPE_RANK` |

Os tipos sempre derivam do schema. Não escrever `interface` ou `type` à mão para algo que tem schema.

## Import

Somente pelo nome do pacote:

```ts
import { HealthOutputSchema, type HealthOutput } from '@omnis/shared';
```
