# T001 — Estrutura do monorepo e tooling

- **Fase:** 1 — Monorepo
- **Depende de:** —
- **ADRs:** 001 (D12), 002 (todas)

## Objetivo

Criar o esqueleto do monorepo com npm workspaces e **provar** que `@omnis/shared` é consumido pelo server e pelo web **sem build próprio**, no dev e no build de produção.

## Escopo

### 1. Raiz

1. `package.json`:
   - `"name": "omnis"`, `"private": true`, `"type": "module"`
   - `"workspaces": ["apps/*", "packages/*"]`
   - `"engines": { "node": ">=22" }`
   - `"overrides": { "zod": "<versão escolhida no passo 2>" }`
   - scripts:
     - `dev`: `concurrently -n server,web -c blue,magenta "npm run dev -w @omnis/server" "npm run dev -w @omnis/web"`
     - `build`: `npm run build -w @omnis/web && npm run build -w @omnis/server`
     - `typecheck`: `npm run typecheck --workspaces --if-present`
     - `test`: `npm run test --workspaces --if-present`
     - `lint`: `biome check .`
     - `format`: `biome format --write .`
   - devDependencies: `typescript`, `@biomejs/biome`, `concurrently`, `vitest`
2. `.nvmrc` com `24`.
3. `tsconfig.base.json`:
   ```json
   {
     "compilerOptions": {
       "target": "ES2022",
       "module": "ESNext",
       "moduleResolution": "Bundler",
       "strict": true,
       "noUncheckedIndexedAccess": true,
       "verbatimModuleSyntax": true,
       "isolatedModules": true,
       "resolveJsonModule": true,
       "skipLibCheck": true,
       "forceConsistentCasingInFileNames": true
     }
   }
   ```
4. `biome.json`: aspas simples, indentação de 2 espaços, ignorar `dist`, `out`, `.next`, `node_modules`, `**/drizzle/meta`.
5. `.gitignore`: `node_modules`, `dist`, `out`, `.next`, `*.db`, `*.db-*`, `data/`, `.env`, `.env.*`, `!.env.example`.
6. `README.md` curto: pré-requisitos, `npm install`, `npm run dev`, link para `docs/`.

### 2. Escolha da versão do zod (antes de instalar qualquer coisa)

1. Rodar:
   - `npm view @modelcontextprotocol/sdk dependencies peerDependencies`
   - `npm view fastify-type-provider-zod peerDependencies`
2. Escolher a **maior major do zod compatível com os dois** (versões mais recentes de cada um).
3. Registrar no "Registro de implementação" a versão do zod e as versões do SDK MCP e do type provider que serão usadas nas T003/T008.

### 3. `packages/shared`

1. `package.json`:
   ```json
   {
     "name": "@omnis/shared",
     "private": true,
     "type": "module",
     "exports": { ".": "./src/index.ts" },
     "scripts": {
       "typecheck": "tsc --noEmit",
       "test": "vitest run --passWithNoTests"
     },
     "dependencies": { "zod": "<versão exata>" }
   }
   ```
2. `tsconfig.json` estendendo `../../tsconfig.base.json`, com `"lib": ["ES2022"]` (**sem** `DOM` e **sem** `@types/node`, para impedir APIs de ambiente).
3. `src/index.ts` (temporário, substituído na T002):
   ```ts
   import { z } from 'zod';
   export const SHARED_SMOKE = 'shared-ok' as const;
   export const SmokeSchema = z.object({ message: z.string() });
   ```

### 4. `apps/server` (esqueleto mínimo, substituído na T003)

1. `package.json`: `"name": "@omnis/server"`, `private`, `type: module`.
   - dependencies: `"@omnis/shared": "*"`, `zod` (mesma versão)
   - devDependencies: `tsx`, `tsdown`, `@types/node`
   - scripts: `dev` (`tsx watch src/index.ts`), `build` (`tsdown`), `start` (`node dist/index.js`), `typecheck` (`tsc --noEmit`), `test` (`vitest run --passWithNoTests`)
2. `tsconfig.json` estendendo a base, com `"types": ["node"]`.
3. `tsdown.config.ts`: entry `src/index.ts`, format `esm`, platform `node`, target `node22`, `noExternal: ['@omnis/shared']`, demais dependências externas.
4. `src/index.ts`: importa `SmokeSchema` e `SHARED_SMOKE`, faz `SmokeSchema.parse({ message: SHARED_SMOKE })` e imprime o resultado.

### 5. `apps/web` (esqueleto mínimo, UI só na T021)

1. Next.js com App Router e TypeScript em `apps/web/src/app`, **sem ESLint** (usamos Biome) e **sem Tailwind por enquanto**.
2. `package.json`: `"name": "@omnis/web"`, `private`, dependency `"@omnis/shared": "*"`, scripts `dev` (`next dev -p 3000`), `build` (`next build`), `typecheck` (`tsc --noEmit`).
3. `next.config.ts`:
   ```ts
   const nextConfig = {
     output: 'export',
     trailingSlash: true,
     images: { unoptimized: true },
     transpilePackages: ['@omnis/shared'],
   };
   export default nextConfig;
   ```
4. `src/app/page.tsx`: renderiza `SHARED_SMOKE` importado de `@omnis/shared`.

### 6. Regras do Cursor

Criar `.cursor/rules/omnis.mdc` com o conteúdo abaixo, sem alterações:

```md
---
description: Regras de arquitetura do Omnis
alwaysApply: true
---

# Omnis — regras obrigatórias

## Geral
- A fonte da verdade são os ADRs em docs/adr/. Não contrarie um ADR. Em caso de conflito, pare e pergunte.
- Implemente somente o escopo da task atual. Nada de "melhorias" fora do escopo.
- Não adicione dependências não previstas na task sem justificar no Registro de implementação.
- Lint e formatação: Biome. Nada de ESLint ou Prettier.

## Monorepo
- npm workspaces. Dependência local sempre com versão "*". Nunca use "workspace:*".
- Imports entre pacotes somente pelo nome do pacote (@omnis/shared).
- Proibido path alias entre pacotes e import relativo que atravesse pacotes.
- Alias "@/" permitido somente dentro de apps/web.
- zod: sempre `import { z } from 'zod'`. Versão única definida na raiz (overrides).

## packages/shared
- Contém somente schemas zod, tipos, constantes e funções puras.
- Proibido importar APIs do Node ou do browser, e qualquer dependência além de zod.

## apps/server
- Cada módulo fica em src/modules/<modulo>/ com: index.ts, <modulo>.service.ts, <modulo>.routes.ts, <modulo>.tools.ts.
- Services não importam fastify nem o SDK MCP. Recebem dependências pelo objeto deps.
- Routes e tools são adaptadores finos: validam, checam escopo, chamam o service, auditam.
- Acesso ao SO (/proc, PM2, Docker, journald, comandos) somente via src/infra/.
- Proibido child_process.exec e shell: true. Comandos externos só via CommandRunner (execFile + allowlist).
- Toda ação que altera estado passa por withAudit.
- Datas no banco: inteiro em milissegundos (epoch). Na API: string ISO 8601.

## Banco
- Drizzle. Migrations geradas por drizzle-kit generate e commitadas.
- Proibido drizzle-kit push. Proibido editar migration já commitada.

## apps/web
- Next.js em static export. Proibido: API routes/route handlers, server actions, middleware.ts, busca de dados em server components, next/image otimizado.
- Todo dado vem da API do server, via fetch no cliente.
```

## Arquivos esperados

```
.cursor/rules/omnis.mdc
.gitignore
.nvmrc
biome.json
package.json
package-lock.json
README.md
tsconfig.base.json
packages/shared/{package.json,tsconfig.json,src/index.ts}
apps/server/{package.json,tsconfig.json,tsdown.config.ts,src/index.ts}
apps/web/{package.json,tsconfig.json,next.config.ts,src/app/layout.tsx,src/app/page.tsx}
```

## Verificação

1. `npm install` sem erros e um único `node_modules` na raiz.
2. `npm ls zod` mostra **uma única versão** (as demais como `deduped`).
3. `npm run typecheck` e `npm run lint` passam.
4. `npm run dev` sobe os dois: o server imprime o smoke e a página do web mostra `shared-ok`.
5. Alterar `SHARED_SMOKE` reflete no server e no web **sem build do shared**.
6. `npm run build` gera `apps/web/out/` e `apps/server/dist/index.js`.
7. `node apps/server/dist/index.js` roda e **não existe** `packages/shared/dist` (o shared foi embutido no bundle).

## Critérios de aceite

- [ ] Todos os itens da verificação passam.
- [ ] Nenhum `workspace:*`, nenhum path alias entre pacotes.
- [ ] Versão do zod registrada com a justificativa de compatibilidade.

## Fora de escopo

Fastify, banco, Tailwind, shadcn, qualquer funcionalidade do painel.

## Registro de implementação

> Preenchido pelo Cursor ao final.

- Versões instaladas (node, typescript, zod, next, tsdown, biome):
- Compatibilidade zod × SDK MCP × fastify-type-provider-zod:
- Desvios da spec e motivo:
- Problemas encontrados:
