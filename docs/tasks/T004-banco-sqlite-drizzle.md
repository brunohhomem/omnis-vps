# T004 — Banco SQLite + Drizzle + migrations

- **Fase:** 2a — Fundação do backend
- **Depende de:** T003
- **ADRs:** 001 (D5), 002 (M10, M13)

## Objetivo

Dar ao Omnis seu banco próprio em SQLite, com migrations versionadas, aplicadas no boot e protegidas por backup automático do arquivo antes de migrar.

## Escopo

### 1. Dependências

- dependencies: `better-sqlite3`, `drizzle-orm`
- devDependencies: `drizzle-kit`, `@types/better-sqlite3`

### 2. Config (adicionar ao `config.ts` e `.env.example`)

| Variável | Default | Observação |
|---|---|---|
| `DATA_DIR` | `./data` | Relativo ao cwd do `apps/server`. Em produção: `/var/lib/omnis` |
| `MIGRATIONS_DIR` | `./drizzle` | Relativo ao cwd do `apps/server` |
| `DB_BACKUPS_KEEP` | `5` | Quantos backups pré-migration manter |

Caminhos resolvidos com `path.resolve(process.cwd(), valor)`.

### 3. Estrutura

```
apps/server/
  drizzle.config.ts
  drizzle/                 # migrations geradas (commitadas)
  src/db/
    client.ts
    migrate.ts
    schema/
      index.ts             # reexporta as tabelas de todos os módulos
      settings.ts
  src/core/
    settings.ts
  test/
    helpers/test-db.ts
    db.test.ts
```

As tabelas ficam centralizadas em `src/db/schema/<modulo>.ts` porque o `drizzle-kit` precisa de um ponto de entrada único. É uma exceção documentada à regra de módulos: **só o módulo dono** importa a própria tabela.

### 4. `db/client.ts`

`openDatabase(filePath | ':memory:')` retorna `{ sqlite, db }` e aplica os pragmas:

```sql
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
PRAGMA synchronous = NORMAL;
```

Cria `DATA_DIR` se não existir, com permissão `0o700`. Arquivo do banco: `${DATA_DIR}/omnis.db`.

### 5. `db/migrate.ts`

`runMigrations({ sqlite, db, dbFilePath, migrationsDir, keep, logger })`:

1. Lê `migrationsDir/meta/_journal.json` e conta as entradas.
2. Conta as migrations já aplicadas em `__drizzle_migrations` (0 se a tabela não existir).
3. Se houver pendentes **e** o arquivo do banco já existia com migrations aplicadas:
   - faz backup com a **API online do better-sqlite3** (`sqlite.backup(destino)`) para `${DATA_DIR}/backups/omnis.db.bak-<timestamp>`. Não usar cópia de arquivo, porque com WAL ela pode perder dados ainda não consolidados;
   - remove backups excedentes, mantendo os `keep` mais recentes.
4. Aplica com o `migrate` de `drizzle-orm/better-sqlite3/migrator`.
5. Loga quantas migrations aplicou e onde ficou o backup.
6. Se a migration falhar: loga o caminho do backup e relança o erro (o boot falha, o PM2 tenta de novo e o backup fica disponível para restaurar à mão).

### 6. Primeira tabela: `settings`

| Coluna | Tipo |
|---|---|
| `key` | text, PK |
| `value` | text (JSON serializado) |
| `updated_at` | integer (epoch ms) |

`core/settings.ts`: `createSettingsService({ db })` com `get<T>(key, schema)` (valida com zod na leitura), `set(key, value)` e `delete(key)`.

### 7. Integração

1. `AppDeps` ganha `db` e `settings`.
2. `createDeps` abre o banco e roda as migrations **antes** de o app ser construído.
3. Hook `onClose` do Fastify fecha o `sqlite`.

### 8. Scripts do `apps/server`

- `db:generate`: `drizzle-kit generate`
- `db:check`: `drizzle-kit check`
- **Não** criar script de `push`.

`drizzle.config.ts`: `dialect: 'sqlite'`, `schema: './src/db/schema/index.ts'`, `out: './drizzle'`.

### 9. Convenções de schema (adicionar ao `.cursor/rules/omnis.mdc` na seção Banco)

- Nomes de tabela e coluna em `snake_case`.
- Datas como `integer` em epoch ms.
- JSON como `text`, validado com zod na leitura.
- Toda tabela de log/série temporal tem índice na coluna de tempo.

### 10. Testes

- `test/helpers/test-db.ts`: `createTestDb()` abre `:memory:` e aplica as migrations.
- `settings`: set/get/delete, e `get` com schema inválido lança erro.
- `runMigrations` num diretório temporário:
  - banco novo → aplica, sem backup;
  - banco existente + migration nova → cria backup e aplica;
  - mais backups que `keep` → remove os antigos.

## Verificação

1. `npm run db:generate -w @omnis/server` gera a migration da `settings`.
2. `npm run dev` cria `apps/server/data/omnis.db` e aplica a migration.
3. Rodar de novo não cria backup (nada pendente).
4. `npm run build` + `start` encontra as migrations (prova de que o `MIGRATIONS_DIR` independe do bundle).
5. `typecheck`, `lint` e `test` passam.

## Critérios de aceite

- [ ] Migrations em SQL commitadas em `apps/server/drizzle/`.
- [ ] Backup via API online antes de migrar banco existente.
- [ ] Nenhum script ou uso de `drizzle-kit push`.
- [ ] Banco aberto e fechado corretamente no ciclo de vida do app.

## Fora de escopo

Tabelas de auditoria, auth e métricas (tasks próprias).

## Registro de implementação

- Versões (better-sqlite3, drizzle-orm, drizzle-kit):
- Desvios da spec e motivo:
- Problemas encontrados (ex.: compilação nativa do better-sqlite3):
