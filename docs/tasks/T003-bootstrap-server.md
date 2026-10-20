# T003 — Bootstrap do server (Fastify)

- **Fase:** 2a — Fundação do backend
- **Depende de:** T002
- **ADRs:** 001 (D1, D2, D3), 002 (M8, M9, M10, M12, M13)

## Objetivo

Substituir o esqueleto da T001 por um server Fastify com config validada, tratamento de erro padronizado, composição via `deps`, o primeiro módulo (`system`) seguindo a convenção e o arquivo do PM2.

## Escopo

### 1. Dependências

- dependencies: `fastify`, `fastify-type-provider-zod`, `@fastify/static`
- devDependencies: `pino-pretty`

### 2. Estrutura

```
apps/server/
  .env.example
  ecosystem.config.cjs
  src/
    index.ts          # entrypoint: config → deps → app → listen → shutdown
    app.ts            # buildApp(deps): FastifyInstance (usado pelos testes)
    config.ts         # schema zod do ambiente + loadConfig()
    deps.ts           # tipo AppDeps + createDeps(config)
    version.ts        # versão lida do package.json
    plugins/
      error-handler.ts
      static-web.ts
    modules/
      system/
        index.ts
        system.service.ts
        system.routes.ts
        system.tools.ts
  test/
    app.test.ts
    config.test.ts
```

### 3. `config.ts`

Schema zod do `process.env`:

| Variável | Tipo | Default | Observação |
|---|---|---|---|
| `NODE_ENV` | `development` \| `production` \| `test` | `development` | |
| `HOST` | string | `127.0.0.1` | Em produção, só loopback (`127.0.0.1`, `::1`, `localhost`) |
| `ALLOW_PUBLIC_BIND` | boolean | `false` | Única forma de liberar host não-loopback |
| `PORT` | number | `4010` | |
| `LOG_LEVEL` | pino levels | `info` | |
| `OMNIS_MODE` | `real` \| `fake` | `real` | Usado a partir da T005 |
| `WEB_DIST_DIR` | string opcional | — | Caminho do `apps/web/out` |

- `loadConfig(env = process.env)` lança um erro legível listando todas as variáveis inválidas.
- Booleans e números via `z.coerce` / transform explícito (`"false"` precisa virar `false`).
- `.env.example` documenta todas as variáveis. Para dev: `OMNIS_MODE=fake`.

### 4. `deps.ts`

```ts
export type AppDeps = {
  config: Config;
  logger: FastifyBaseLogger; // ou pino Logger
  // T004: db · T005: adapters · T006: audit · ...
};
```

`createDeps(config)` monta as dependências. Cada task seguinte adiciona seu campo aqui. Nada de container de DI.

### 5. `app.ts`

1. `buildApp(deps)` cria o Fastify com:
   - logger pino; `pino-pretty` só em `development`; `redact` em `req.headers.authorization` e `req.headers.cookie`.
   - `validatorCompiler` e `serializerCompiler` do `fastify-type-provider-zod`.
   - `withTypeProvider<ZodTypeProvider>()`.
2. Registra `error-handler`, os módulos com prefixo `/api` e passando `{ deps }`, e por último o `static-web` (se `WEB_DIST_DIR` existir).
3. Não chama `listen`.

### 6. `plugins/error-handler.ts`

Todas as respostas de erro seguem o `ApiErrorSchema` do shared:

| Situação | HTTP | `code` |
|---|---|---|
| Falha de validação zod | 400 | `VALIDATION_ERROR` (com `details` das issues) |
| Rota inexistente | 404 | `NOT_FOUND` |
| Erro com `statusCode` conhecido | o próprio | mapeado |
| Qualquer outro | 500 | `INTERNAL_ERROR`, mensagem genérica em produção, sem stack |

Criar também `src/core/errors.ts` com a classe `AppError(code, message, statusCode, details?)`, para os services lançarem erros tipados **sem depender do Fastify**. Esse arquivo não importa nada do Fastify. O `error-handler` reconhece `AppError` e usa o `code`/`statusCode` dela.

`src/core/` guarda peças transversais usadas por vários módulos (erros, auditoria, tools). Adicionar `core/errors.ts` à estrutura acima.

### 7. `plugins/static-web.ts`

- Serve `WEB_DIST_DIR` em `/` com `@fastify/static`.
- `GET` fora de `/api` e `/mcp` sem arquivo correspondente → serve `404.html` do export com status 404.
- Se `WEB_DIST_DIR` não estiver definido ou não existir, o plugin não é registrado e loga um aviso (situação normal no dev, onde o web roda no `next dev`).

### 8. Módulo `system`

- `system.service.ts`: `createSystemService(deps)` com `getHealth()` e `getInfo()` (`os.hostname()`, `os.platform()`, `os.release()`, `os.cpus().length`, `os.totalmem()`, `process.version`, versão, `config.OMNIS_MODE`).
  - Exceção aceita: `node:os` direto aqui, por ser informação estática do processo. Leituras de `/proc` e comandos vão para `infra/` na T005.
- `system.routes.ts`:
  - `GET /api/health` → `HealthOutputSchema`
  - `GET /api/system/info` → `SystemInfoOutputSchema`
  - Schemas declarados em `schema.response` (o serializer garante que nenhum campo extra vaze).
- `system.tools.ts`: `export const systemTools = [];` (preenchido na T008).
- `index.ts`: plugin que recebe `{ deps }`, cria o service e registra as rotas.

### 9. `index.ts` (entrypoint)

1. `loadConfig()` → `createDeps()` → `buildApp()` → `listen({ host, port })`.
2. `SIGINT` e `SIGTERM`: `app.close()` com timeout de 10 s; se estourar, `process.exit(1)`.
3. Loga host, porta, modo e versão no boot.

### 10. Scripts e PM2

- `dev`: `tsx watch --env-file=.env src/index.ts`
- `start`: `node --env-file=.env dist/index.js`
- `ecosystem.config.cjs`:
  ```js
  module.exports = {
    apps: [{
      name: 'omnis',
      cwd: __dirname,
      script: 'dist/index.js',
      node_args: '--env-file=.env',
      max_memory_restart: '200M',
      kill_timeout: 10000,
      autorestart: true,
    }],
  };
  ```

### 11. Testes (Vitest, via `app.inject`)

- `GET /api/health` → 200 e corpo válido no `HealthOutputSchema`.
- Rota inexistente → 404 no formato `ApiErrorSchema`.
- Rota de teste com schema (registrada no próprio arquivo de teste) recebendo body inválido → 400 `VALIDATION_ERROR`.
- `loadConfig` em `production` com `HOST=0.0.0.0` → lança erro; com `ALLOW_PUBLIC_BIND=true` → aceita.

## Verificação

1. `npm run dev` → `curl http://127.0.0.1:4010/api/health` responde 200.
2. `npm run build -w @omnis/server && npm run start -w @omnis/server` funciona.
3. `rssBytes` do health em idle abaixo de **80 MB**. Registrar o valor medido.
4. `npm run typecheck`, `lint` e `test` passam.

## Critérios de aceite

- [ ] Nenhum service importa `fastify`.
- [ ] Todas as respostas de erro no formato do shared.
- [ ] Bind não-loopback bloqueado em produção.
- [ ] Shutdown gracioso funcionando (`Ctrl+C` encerra limpo).

## Fora de escopo

Banco, autenticação (todas as rotas ficam abertas até a T007), CORS de dev (T021), MCP.

## Registro de implementação

- RSS medido em idle:
- Desvios da spec e motivo:
- Problemas encontrados:
