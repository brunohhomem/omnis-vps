# T007 — Autenticação e tokens

- **Fase:** 2a — Fundação do backend
- **Depende de:** T006
- **ADRs:** 001 (D9, D10)

## Objetivo

Proteger toda a API: login do usuário único com senha + TOTP para a UI, e tokens Bearer com escopo para o MCP e scripts.

## Escopo

### 1. Dependências

`@node-rs/argon2` (binários pré-compilados, sem node-gyp), `otpauth`, `@fastify/cookie`, `@fastify/rate-limit`.

### 2. Config nova

| Variável | Default | Observação |
|---|---|---|
| `OMNIS_SECRET_KEY` | obrigatória | 32 bytes em base64. Criptografa o segredo do TOTP |
| `SESSION_TTL_HOURS` | `168` (7 dias) | |
| `COOKIE_SECURE` | `true` | `false` só se o dev precisar |
| `TRUST_CLOUDFLARE` | `false` | `true` em produção (ver item 7) |

`.env.example` explica como gerar a chave: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.

### 3. Tabelas (`src/db/schema/auth.ts`)

**`users`**: `id`, `username` (unique), `password_hash`, `totp_secret_enc` (AES-256-GCM com `OMNIS_SECRET_KEY`), `created_at`, `updated_at`.

**`sessions`**: `id_hash` (PK, sha256 do id), `user_id`, `created_at`, `expires_at`, `last_seen_at`, `ip`, `user_agent`.

**`api_tokens`**: `id`, `name`, `prefix` (8 chars, exibido na UI), `token_hash` (sha256, unique), `scope`, `created_at`, `last_used_at`, `expires_at` (nullable), `revoked_at` (nullable).

### 4. Shared: `auth/auth.schemas.ts`

`LoginInputSchema` (`username`, `password`, `totp` com 6 dígitos), `MeOutputSchema` (`username`, `authType: 'session' | 'token'`, `scope`), `TokenCreateInputSchema` (`name`, `scope`, `expiresInDays` opcional), `TokenCreateOutputSchema` (inclui o token em texto **uma única vez**), `TokenListOutputSchema` (sem hash nem token).

### 5. Setup do usuário (CLI)

`apps/server/src/cli/user-setup.ts`, script `user:setup`:

1. Se já existe usuário, recusa, a menos que receba `--reset` **e** confirmação digitada.
2. Pede `username` e senha duas vezes (mínimo 12 caracteres, entrada sem eco).
3. Gera o segredo TOTP e imprime a URI `otpauth://` e o segredo base32 para cadastro manual no app autenticador.
4. Pede um código atual e só salva se o código for válido.
5. Usa o mesmo `createDeps` (banco + migrations), sem subir o Fastify.

### 6. Rotas (`/api/auth`)

| Rota | Auth | Comportamento |
|---|---|---|
| `POST /login` | pública | valida usuário + senha + TOTP; cria sessão; seta o cookie; `204` |
| `POST /logout` | sessão | apaga a sessão e o cookie |
| `GET /me` | sessão ou token | `MeOutputSchema` |
| `GET /tokens` | **somente sessão** | lista |
| `POST /tokens` | **somente sessão** | cria e retorna o token uma vez |
| `DELETE /tokens/:id` | **somente sessão** | revoga |

Gestão de tokens só por sessão: um token (inclusive de IA via MCP) nunca cria nem revoga tokens.

Regras do login:

1. Qualquer falha → `401` com a mesma mensagem genérica ("credenciais inválidas"), sem indicar qual campo errou.
2. Usuário inexistente executa uma verificação argon2 falsa, para o tempo de resposta não revelar se o usuário existe.
3. Código TOTP aceito com janela de ±1 período, e o mesmo código não pode ser reutilizado (guardar o último período aceito).
4. Rate limit: 5 tentativas/min e 20/hora por IP de cliente.

### 7. IP do cliente atrás do Cloudflare Tunnel

O Tunnel conecta em `127.0.0.1`, então **todas** as requisições chegam com IP de loopback, e o rate limit por IP bloquearia todo mundo junto. Regra:

- `TRUST_CLOUDFLARE=true` **e** conexão vinda de loopback → IP = header `cf-connecting-ip`.
- Qualquer outro caso → IP do socket.

Uma função `getClientIp(request, config)` é usada pelo rate limit, pela sessão e pela auditoria.

### 8. Sessão e cookie

- Id aleatório de 32 bytes (base64url); o banco guarda só o sha256.
- Cookie `omnis_session`: `httpOnly`, `secure` (conforme config), `sameSite: 'strict'`, `path: '/'`, `maxAge` = TTL.
- Sessão expirada → removida ao ser encontrada. Atualizar `last_seen_at` no máximo 1x por minuto.

### 9. Tokens

- Formato: `omn_<prefix8>_<segredo32>` (base64url).
- Banco guarda o sha256 do token inteiro (alta entropia, então sha256 basta).
- `last_used_at` atualizado no máximo 1x por minuto.
- Escopo hierárquico via `hasScope` do shared.

### 10. Hook global de autenticação

1. Aplicado a tudo sob `/api`, exceto a allowlist: `GET /api/health` e `POST /api/auth/login`.
2. Resolve o `principal`, nesta ordem:
   - header `Authorization: Bearer omn_...` → token válido, não revogado e não expirado;
   - cookie de sessão válido → escopo `admin`.
3. Sem principal → `401 UNAUTHORIZED`.
4. Escopo exigido declarado na rota (`config: { scope: 'ops' }`); padrão `read`. Insuficiente → `403 FORBIDDEN`.
5. Rotas com `config: { sessionOnly: true }` rejeitam token com `403`.
6. `request.principal` tipado via declaration merging: `{ type: 'user' | 'token', id, label, scope }`.
7. Helper `actorFrom(principal)` gera o `Actor` da auditoria.

### 11. Auditoria

Gravar com `withAudit` ou `start`/`succeed`/`fail`: `auth.login` (sucesso e falha, com `target` = username tentado), `auth.logout`, `auth.token.create`, `auth.token.revoke` (params: `name`, `scope`).

### 12. Testes

- Login completo com TOTP gerado no teste; senha errada; TOTP errado; TOTP reutilizado; usuário inexistente → mesma resposta.
- Rate limit dispara na 6ª tentativa.
- `getClientIp`: header honrado só com `TRUST_CLOUDFLARE` + loopback.
- Rota `ops` de teste: token `read` → 403; token `ops` → 200; sessão → 200.
- Token revogado e expirado → 401. Token chamando `POST /tokens` → 403.
- Rotas fora da allowlist sem credencial → 401.

## Verificação

1. `npm run user:setup -w @omnis/server` cria o usuário com um app autenticador real.
2. Login via `curl` com cookie jar → `GET /api/me` funciona.
3. Token `read` criado via sessão consegue `GET /api/system/info`.
4. `typecheck`, `lint` e `test` passam.

## Critérios de aceite

- [x] Nenhuma rota fora da allowlist acessível sem credencial.
- [x] Segredo TOTP criptografado no banco; senhas, sessões e tokens só como hash.
- [x] Tokens não gerenciam tokens.
- [x] IP real considerado atrás do Tunnel.

## Fora de escopo

Tela de login (T021), OAuth para o conector do claude.ai (fase futura), recuperação de senha (o `user:setup --reset` cobre).

## Registro de implementação

- Desvios da spec e motivo:
  - `users.totp_last_period` guarda o último período TOTP aceito. Sem essa coluna o mesmo código voltava a valer dentro da janela de ±1.
  - `user:setup --reset` apaga sessões e revoga tokens além de substituir o usuário. Só existe um operador, e os tokens antigos autenticariam contra o usuário novo.
  - O rate limit usa dois `preHandler` (5/min e 20/h). O plugin aceita uma janela por configuração. O teste cobre a 6ª tentativa no minuto; a janela da hora fica configurada.
  - O hook ignora `request.is404`. O Fastify executa o `preHandler` da raiz também no 404, e sem isso uma URL desconhecida em `/api` virava 401. Rota registrada sem credencial continua 401.
  - A lista de tokens é o array do schema, sem envelope.
  - O ator do `auth.login` começa com `id: null` e `label` igual ao username tentado, porque o `withAudit` abre antes de saber se o login passa.
  - O app autenticador físico não foi usado. O `user:setup` imprimiu a URI `otpauth://` e o código foi gerado com `otpauth`, o mesmo algoritmo do app. O login seguinte esperou o período seguinte, porque o código do setup já tinha sido consumido.
- Problemas encontrados:
  - `@fastify/rate-limit` lança o retorno de `errorResponseBuilder`. Um objeto simples caía no handler como 500. O builder devolve `AppError` `RATE_LIMITED`.
  - `user:setup` aplicou `0002_auth` (`applied: 1`) e gravou backup, porque o banco local já tinha as migrations anteriores.
  - `COOKIE_SECURE=false` ficou só no `.env` local, ignorado pelo git, para o `curl` em `http://127.0.0.1` reenviar o cookie. O default e o `.env.example` continuam `true`.
  - Login `204`, `GET /api/me` devolveu a sessão `admin`, e um token `read` chamou `GET /api/system/info`.
  - `typecheck`, `lint`, `db:check` e `test` passaram (51 testes no server).
  - npm 12 avisa que Node `v22.20.0` está abaixo de `^22.22.2 || ^24.15.0 || >=26`. Os comandos rodaram.
