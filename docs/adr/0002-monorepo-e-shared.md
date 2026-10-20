# ADR-002 — Monorepo, pacote shared e convenções de desenvolvimento

- **Status:** Proposto (revisar antes de rodar a T001)
- **Data:** 2026-10-20
- **Decisores:** Bruno
- **Relacionado:** ADR-001 (D3, D4, D12)

## Contexto

O ADR-001 definiu um monorepo com npm workspaces e três pacotes: `apps/server`, `apps/web` e `packages/shared`. A experiência anterior com monorepos foi ruim, e o objetivo central deste ADR é fazer o `shared` funcionar sem atrito.

Monorepos com pacote compartilhado quebram quase sempre pelos mesmos motivos:

1. O pacote compartilhado precisa de build próprio, em ordem, e de watch no dev. Alguém esquece e o consumidor usa uma versão velha.
2. ESM vs CommonJS: campo `exports` mal configurado gera "funciona no dev, quebra no build".
3. Duas cópias da mesma lib (ex.: zod) resolvidas por pacotes diferentes, com tipos que deixam de bater.
4. Path aliases do TypeScript misturados com resolução de workspaces.
5. Sintaxe de outro gerenciador (`workspace:*` é do pnpm/yarn e quebra no npm).

## Decisões

| # | Tema | Decisão |
|---|---|---|
| M1 | Workspaces | npm workspaces · dependência local declarada com versão `"*"` |
| M2 | Runtime e módulos | Node ≥ 22 (alvo: 24 LTS) · **ESM em todos os pacotes** (`"type": "module"`) |
| M3 | TypeScript | `tsconfig.base.json` na raiz, `moduleResolution: "Bundler"`, cada pacote estende · typecheck com `tsc --noEmit` |
| M4 | Consumo do shared | **Pacote interno sem build**: `exports` aponta para o `.ts` e cada consumidor transpila |
| M5 | Versão única do zod | Mesma versão em todos os pacotes + `overrides` na raiz · verificado com `npm ls zod` |
| M6 | Aliases | **Nenhum** alias entre pacotes · `@/` permitido somente dentro do `apps/web` |
| M7 | Pureza do shared | Só zod, tipos, constantes e funções puras · roda no browser e no Node |
| M8 | Ferramentas | ESLint (lint) + Prettier (format) · Vitest · tsx (dev do server) · tsdown (build do server) · concurrently |
| M9 | Configuração | `node --env-file` (nativo) + validação com zod · sem dotenv |
| M10 | Composição | Objeto `deps` criado no boot e passado aos módulos · sem container de DI |
| M11 | Acesso ao SO | Somente via adaptadores com implementação `real` e `fake` (`OMNIS_MODE`) |
| M12 | Bind de rede | Somente loopback (`127.0.0.1`) em produção, validado no boot |
| M13 | Caminhos relativos | Resolvidos a partir do diretório do pacote server (cwd) |

### M4 — Shared sem build (decisão central)

| | Shared compilado (`dist/`) | **Shared como fonte TS (escolhido)** |
|---|---|---|
| Build do shared | Obrigatório, em ordem | Não existe |
| Dev | Precisa de watch do shared rodando | Alteração reflete na hora nos dois apps |
| Risco de versão velha | Alto (esqueceu o build) | Nenhum |
| Exigência | Nenhuma nos consumidores | Consumidor precisa saber transpilar TS |
| Publicar no npm | Possível | Não (irrelevante para o Omnis) |

Como cada consumidor transpila:

- **web**: `transpilePackages: ['@omnis/shared']` no `next.config`.
- **server (dev)**: `tsx` executa TS direto, incluindo o shared.
- **server (build)**: `tsdown` gera um bundle único com o shared **embutido** (`noExternal: ['@omnis/shared']`). Em produção não existe `packages/shared/dist`.

`package.json` do shared:

```json
{
  "name": "@omnis/shared",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" }
}
```

### M5 — zod com versão única

- `zod` é declarado com a **mesma versão exata** em `shared`, `server` e `web`.
- A raiz define `"overrides": { "zod": "<versão>" }` para forçar uma única cópia, inclusive para dependências de terceiros (`fastify-type-provider-zod`, SDK do MCP).
- A versão (major 3 ou 4) é escolhida na T001 a partir da compatibilidade do `@modelcontextprotocol/sdk` **e** do `fastify-type-provider-zod`, e registrada na task.

### M10 — Composição sem framework

```ts
// esboço
type AppDeps = { config; logger; db; adapters; audit; /* cresce por task */ };

const deps = await createDeps(config);
await app.register(systemModule, { prefix: '/api', deps });
```

Services são factories puras (`createSystemService(deps)`), testáveis sem subir o Fastify.

### M11 — Adaptadores real/fake

Todo acesso a `/proc`, PM2, Docker, journald e comandos do sistema passa por uma interface em `apps/server/src/infra/`. Isso permite:

1. desenvolver em qualquer SO (`OMNIS_MODE=fake`);
2. testes determinísticos;
3. um único ponto de auditoria de segurança: nenhum código fora de `infra/` toca o SO.

Comandos externos usam `execFile` (sem shell) a partir de um registro fechado de comandos. `exec` e `shell: true` são proibidos.

### M12 — Bind em loopback

O Cloudflare Tunnel conecta em `localhost`. Se o Omnis escutar em `0.0.0.0`, a porta fica acessível direto pelo IP da VPS e **contorna o Cloudflare Access**. A validação de config rejeita host não-loopback em produção, a menos que `ALLOW_PUBLIC_BIND=true`.

### M13 — Caminhos

`DATA_DIR` e `MIGRATIONS_DIR` são relativos ao diretório do `apps/server`. `npm run -w @omnis/server ...` e o `cwd` do `ecosystem.config.cjs` garantem esse diretório. Isso evita a diferença de `import.meta.url` entre `src/` (dev) e `dist/` (bundle).

## Consequências

**Positivas**

- Zero passo de build para o shared. O caso mais comum de quebra deixa de existir.
- Um schema zod alterado em `shared` aparece imediatamente no server, no web e nas tools do MCP.
- O dev funciona fora do Linux e os testes não dependem da máquina.

**Negativas / riscos**

- `tsdown` é relativamente novo. Fallback: `tsup`, com a mesma configuração.
- O shared nunca pode importar APIs do Node, ou quebra o build do web. Garantido pela regra M7 e pelo typecheck do web.
- Quem adicionar uma dependência nova precisa respeitar o `overrides` do zod.
