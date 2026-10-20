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
     - `lint`: `eslint . && prettier --check .`
     - `format`: `prettier --write .`
   - devDependencies: `typescript`, `eslint`, `@eslint/js`, `typescript-eslint`, `eslint-config-prettier`, `prettier`, `concurrently`, `vitest`
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
4. ESLint e Prettier na raiz: aspas simples, indentação de 2 espaços, ignorar `dist`, `out`, `.next`, `node_modules`, `**/drizzle/meta` e `**/*.md`.
   - `eslint.config.js`: `typescript-eslint` e `eslint-config-prettier`
   - `.prettierrc.json` e `.prettierignore`
5. `.gitignore`: `node_modules`, `dist`, `out`, `.next`, `next-env.d.ts`, `*.db`, `*.db-*`, `data/`, `.env`, `.env.*`, `!.env.example`.
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
3. `tsdown.config.ts`: entry `src/index.ts`, format `esm`, platform `node`, target `node22`, `fixedExtension: false`, `noExternal: ['@omnis/shared']`, demais dependências externas.
4. `src/index.ts`: importa `SmokeSchema` e `SHARED_SMOKE`, faz `SmokeSchema.parse({ message: SHARED_SMOKE })` e imprime o resultado.

### 5. `apps/web` (esqueleto mínimo, UI só na T021)

1. Next.js com App Router e TypeScript em `apps/web/src/app`, **sem Tailwind por enquanto**. Lint e formatação ficam na raiz (ESLint e Prettier).
2. `package.json`: `"name": "@omnis/web"`, `private`, dependencies `"@omnis/shared": "*"` e `axios`, scripts `dev` (`next dev -p 3000`), `build` (`next build`), `typecheck` (`tsc --noEmit`).
3. `next.config.ts`:
   ```ts
   const nextConfig = {
     output: 'export',
     trailingSlash: true,
     images: { unoptimized: true },
     transpilePackages: ['@omnis/shared'],
     agentRules: false,
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
- Lint: ESLint. Formatação: Prettier.

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
- Todo dado vem da API do server, via axios no cliente. Proibido `fetch`.
```

## Arquivos esperados

```
.cursor/rules/omnis.mdc
.gitignore
.nvmrc
eslint.config.js
.prettierrc.json
.prettierignore
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

- [x] Todos os itens da verificação passam.
- [x] Nenhum `workspace:*`, nenhum path alias entre pacotes.
- [x] Versão do zod registrada com a justificativa de compatibilidade.

## Fora de escopo

Fastify, banco, Tailwind, shadcn, qualquer funcionalidade do painel.

## Registro de implementação

> Preenchido pelo Cursor ao final.

- Versões instaladas (node, typescript, zod, next, tsdown, eslint, prettier, axios):
  - Node local `v22.20.0` (`.nvmrc` pede 24; `engines` aceita `>=22`)
  - typescript `6.0.3`, zod `4.6.7`, next `16.4.2`, tsdown `0.23.1`
  - eslint `10.13.0`, `@eslint/js` `10.0.1`, typescript-eslint `8.72.0`, eslint-config-prettier `10.1.8`, prettier `3.9.10`
  - axios `1.20.0`
- Compatibilidade zod × SDK MCP × fastify-type-provider-zod:
  - `@modelcontextprotocol/sdk@1.32.1`: peer e dependency `zod@^3.25 || ^4.0`
  - `fastify-type-provider-zod@7.0.0`: peer `zod@>=4.1.5`
  - Maior major compatível com os dois: **zod 4**. Faixa: `>=4.1.5 <5`. Versão instalada: **4.6.7** (a mais recente nessa faixa). O SDK e o type provider ainda não foram instalados; essas são as versões previstas para T003/T008.
- Desvios da spec e motivo:
  - ESLint + Prettier no lugar de Biome, e axios no lugar de fetch, por decisão posterior à spec.
  - TypeScript `6.0.3` (`~6.0.3`): `typescript-eslint@8.72.0` só aceita `typescript@>=4.8.4 <6.1.0`. A 7.0.2 não instala junto.
  - `@types/node@22` (não a 26): o target do bundle é `node22`.
  - `next`, `react`, `react-dom` e os `@types` correspondentes: necessários para o App Router. `zod` também no web, pelo ADR-002 M5. `"type": "module"` no web, pelo ADR-002 M2.
  - `packages/shared`: `"types": []` e `noEmit`, para o typecheck não herdar `@types/node` hoisted.
  - `fixedExtension: false` no tsdown: com `platform: 'node'` o default é `.mjs`. O pacote é `"type": "module"`, então a saída fica `dist/index.js`.
  - `agentRules: false` no Next: o `next dev` 16 gera `apps/web/AGENTS.md` se a opção ficar ligada.
  - `next-env.d.ts` no `.gitignore`: o Next grava imports de `.next/types`, que não existem antes do primeiro dev/build.
  - Prettier ignora `**/*.md` para não reformatar a documentação já escrita.
  - A página de smoke não chama a API. O axios está declarado no web para as próximas tasks.
- Problemas encontrados:
  - npm 12 avisa que Node `v22.20.0` está abaixo de `^22.22.2 || ^24.15.0 || >=26`. Os comandos rodaram.
  - O postinstall do esbuild foi bloqueado pelo npm; o binário `@esbuild/win32-x64` já estava presente e tsx/tsdown funcionaram.
  - Único `node_modules` aninhado: `node_modules/next/node_modules/postcss`. Não há `node_modules` em `apps/` nem em `packages/`.
  - tsdown avisa que `noExternal` está depreciado (`deps.alwaysBundle`). O build conclui e o shared fica embutido; `zod` continua externo. A opção foi mantida porque o ADR-002 pede `noExternal`.
