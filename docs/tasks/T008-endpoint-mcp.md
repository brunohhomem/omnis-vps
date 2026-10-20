# T008 — Endpoint MCP

- **Fase:** 2a — Fundação do backend
- **Depende de:** T005, T007
- **ADRs:** 001 (D3, D8), 002 (M10)

## Objetivo

Expor as capacidades do Omnis como tools MCP em `/mcp`, com o mesmo service usado pela API, autenticação por token com escopo e um contrato de tool que todos os módulos futuros seguem.

## Escopo

### 1. Dependência

`@modelcontextprotocol/sdk` (versão registrada na T001, compatível com o zod do projeto).

### 2. Contrato de tool (`src/core/tool.ts`)

```ts
type ToolContext = {
  principal: Principal;
  actor: Actor;
  source: 'mcp';
};

type ToolDef<I extends z.ZodObject<any>> = {
  name: string;            // snake_case: <modulo>_<acao>, ex.: system_info
  description: string;     // escrita para a IA: o que faz, quando usar, efeitos colaterais
  scope: Scope;            // escopo mínimo
  destructive: boolean;    // altera estado?
  input: I;                // schema zod do shared
  handler: (input: z.infer<I>, ctx: ToolContext) => Promise<unknown>;
};
```

Cada módulo exporta uma factory em `<modulo>.tools.ts`: `createSystemTools(services) => ToolDef[]`.

### 3. Registro explícito (`src/modules/mcp/registry.ts`)

- Lista **explícita** de todas as factories de tools (sem auto-descoberta por glob).
- Validações no boot (erro e o server não sobe):
  1. nomes duplicados;
  2. nome fora do padrão `^[a-z]+(_[a-z]+)+$`;
  3. `destructive: true` sem campo `confirm: ConfirmSchema` no `input`;
  4. `destructive: true` com escopo `read`.

### 4. Rota `/mcp` (`src/modules/mcp/index.ts`)

Fica **fora** do prefixo `/api`, então o hook global da T007 não se aplica. A autenticação é feita aqui:

1. **Somente token Bearer.** Cookie de sessão é ignorado no `/mcp`.
2. Validação do token reaproveitando o service de auth da T007 (mesma função, sem duplicar lógica).
3. **Validação do header `Origin`** (recomendação da spec MCP contra DNS rebinding): se presente e fora de `MCP_ALLOWED_ORIGINS`, `403`.
4. Rate limit: 60 requisições/min por token.
5. **Modo stateless**: a cada `POST /mcp`, criar um `McpServer` e um `StreamableHTTPServerTransport` com `sessionIdGenerator: undefined`, registrar **somente as tools que o escopo do token permite** (`hasScope`), `reply.hijack()` e `transport.handleRequest(request.raw, reply.raw, request.body)`. Fechar server e transport quando a resposta terminar.
6. `GET` e `DELETE /mcp` → `405` (sem sessões nem stream do servidor no MVP).

Um token `read` nem enxerga as tools de `ops`/`admin` na listagem.

### 5. Execução de uma tool

1. O SDK valida o input com o schema zod.
2. `destructive: true` → executa dentro de `withAudit` com `source: 'mcp'` e o ator do token.
3. Tools de leitura não são auditadas (só log em `debug`).
4. Resultado → `content: [{ type: 'text', text: JSON.stringify(resultado) }]`.
5. Resultado com mais de **100 KB** → truncado, com aviso no texto, para não estourar o contexto da IA.
6. `AppError` → `isError: true` com `code` e `message`. Erro inesperado → `INTERNAL_ERROR` genérico, sem stack.

### 6. Config nova

| Variável | Default |
|---|---|
| `MCP_ALLOWED_ORIGINS` | vazio (lista separada por vírgula) |

### 7. Primeiras tools

| Tool | Escopo | Destrutiva | Service |
|---|---|---|---|
| `system_info` | read | não | `system.getInfo` |
| `system_snapshot` | read | não | `system.getSnapshot` |
| `audit_list` | read | não | `audit.list` |

Descrições escritas para a IA, em inglês (melhor desempenho de seleção de tool), explicando quando usar cada uma.

### 8. Testes

- Validações do registro: cada um dos 4 casos de erro.
- Integração com o `Client` + `StreamableHTTPClientTransport` do SDK contra o app escutando em porta aleatória:
  - token `read` lista exatamente as 3 tools e chama `system_info`;
  - sem token → 401; token revogado → 401;
  - `Origin` não permitido → 403;
  - resultado grande truncado.
- Tool destrutiva de teste (registrada só no teste): sem `confirm` → erro de validação; com `confirm` → auditada com `source: 'mcp'`.

## Verificação

1. Criar um token `read` pela API (sessão).
2. Conectar o Claude Code localmente:
   ```
   claude mcp add --transport http omnis http://127.0.0.1:4010/mcp --header "Authorization: Bearer <token>"
   ```
3. Pedir ao Claude Code as informações do sistema e confirmar a chamada de `system_info`.
4. `typecheck`, `lint` e `test` passam.

## Critérios de aceite

- [ ] Tools filtradas pelo escopo do token na listagem.
- [ ] Registro explícito com as 4 validações no boot.
- [ ] Nenhuma lógica de negócio dentro dos arquivos de tools.
- [ ] Ações destrutivas sempre auditadas e com `confirm`.

## Fora de escopo

OAuth para o conector do claude.ai, sessões MCP/SSE, tools de escrita reais (vêm com os módulos).

## Registro de implementação

- Versão do SDK MCP:
- Teste com Claude Code (resultado):
- Desvios da spec e motivo:
- Problemas encontrados:
