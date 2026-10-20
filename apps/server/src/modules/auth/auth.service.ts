import { randomBytes } from 'node:crypto';
import { hash, hashSync, verify } from '@node-rs/argon2';
import {
  ScopeSchema,
  type MeOutput,
  type Scope,
  type TokenCreateOutput,
  type TokenListOutput,
} from '@omnis/shared';
import { eq, isNull } from 'drizzle-orm';
import { Secret, TOTP } from 'otpauth';
import type { Config } from '../../config';
import { AppError } from '../../core/errors';
import type { Principal } from '../../core/principal';
import { decryptString, encryptString, sha256 } from '../../core/secret-box';
import type { AppDatabase } from '../../db/client';
import { apiTokens, sessions, users } from '../../db/schema/auth';

const INVALID_CREDENTIALS = 'credenciais inválidas';
const MIN_PASSWORD_LENGTH = 12;
const SEEN_INTERVAL_MS = 60_000;
const dummyPasswordHash = hashSync('omnis-timing-placeholder');

export type SetupUserInput = {
  username: string;
  password: string;
  totpSecret: string;
  replace?: boolean;
};

export function createAuthService(deps: { db: AppDatabase; config: Config }) {
  const ttlMs = deps.config.SESSION_TTL_HOURS * 60 * 60 * 1000;

  return {
    async setupUser(input: SetupUserInput): Promise<void> {
      const username = input.username.trim();
      if (username.length < 1 || username.length > 64) {
        throw new AppError('VALIDATION_ERROR', 'Invalid username', 400);
      }
      if (input.password.length < MIN_PASSWORD_LENGTH) {
        throw new AppError(
          'VALIDATION_ERROR',
          'Password must be at least 12 characters',
          400,
        );
      }

      const existing = deps.db.select().from(users).get();
      if (existing && !input.replace) {
        throw new AppError('CONFLICT', 'A user already exists', 409);
      }

      const passwordHash = await hash(input.password);
      const totpSecretEnc = encryptString(
        input.totpSecret,
        deps.config.OMNIS_SECRET_KEY,
      );
      const now = Date.now();

      deps.db.transaction((tx) => {
        if (input.replace) {
          tx.delete(sessions).run();
          tx.delete(users).run();
          tx.update(apiTokens)
            .set({ revokedAt: now })
            .where(isNull(apiTokens.revokedAt))
            .run();
        }
        tx.insert(users)
          .values({
            username,
            passwordHash,
            totpSecretEnc,
            createdAt: now,
            updatedAt: now,
          })
          .run();
      });
    },

    findUser(): { id: number; username: string } | null {
      const row = deps.db.select().from(users).get();
      if (!row) return null;
      return { id: row.id, username: row.username };
    },

    async login(input: {
      username: string;
      password: string;
      totp: string;
      ip: string;
      userAgent: string;
    }): Promise<{ sessionId: string }> {
      const user = deps.db
        .select()
        .from(users)
        .where(eq(users.username, input.username))
        .get();
      const passwordOk = user
        ? await verify(user.passwordHash, input.password)
        : await verify(dummyPasswordHash, input.password).then(() => false);
      if (!user || !passwordOk) {
        throw new AppError('UNAUTHORIZED', INVALID_CREDENTIALS, 401);
      }

      const secret = Secret.fromBase32(
        decryptString(user.totpSecretEnc, deps.config.OMNIS_SECRET_KEY),
      );
      const delta = TOTP.validate({ token: input.totp, secret, window: 1 });
      if (delta === null) {
        throw new AppError('UNAUTHORIZED', INVALID_CREDENTIALS, 401);
      }
      const period = TOTP.counter({}) + delta;
      if (user.totpLastPeriod !== null && period <= user.totpLastPeriod) {
        throw new AppError('UNAUTHORIZED', INVALID_CREDENTIALS, 401);
      }

      const now = Date.now();
      const sessionId = randomBytes(32).toString('base64url');
      deps.db.transaction((tx) => {
        tx.update(users)
          .set({ totpLastPeriod: period, updatedAt: now })
          .where(eq(users.id, user.id))
          .run();
        tx.insert(sessions)
          .values({
            idHash: sha256(sessionId),
            userId: user.id,
            createdAt: now,
            expiresAt: now + ttlMs,
            lastSeenAt: now,
            ip: input.ip,
            userAgent: input.userAgent,
          })
          .run();
      });
      return { sessionId };
    },

    logout(sessionId: string): void {
      deps.db
        .delete(sessions)
        .where(eq(sessions.idHash, sha256(sessionId)))
        .run();
    },

    authenticateSession(sessionId: string): Principal | null {
      const idHash = sha256(sessionId);
      const session = deps.db
        .select()
        .from(sessions)
        .where(eq(sessions.idHash, idHash))
        .get();
      if (!session) return null;

      const now = Date.now();
      if (session.expiresAt <= now) {
        deps.db.delete(sessions).where(eq(sessions.idHash, idHash)).run();
        return null;
      }
      if (now - session.lastSeenAt >= SEEN_INTERVAL_MS) {
        deps.db
          .update(sessions)
          .set({ lastSeenAt: now })
          .where(eq(sessions.idHash, idHash))
          .run();
      }

      const user = deps.db
        .select()
        .from(users)
        .where(eq(users.id, session.userId))
        .get();
      if (!user) return null;
      return {
        type: 'user',
        id: String(user.id),
        label: user.username,
        scope: 'admin',
      };
    },

    authenticateBearer(token: string): Principal | null {
      const row = deps.db
        .select()
        .from(apiTokens)
        .where(eq(apiTokens.tokenHash, sha256(token)))
        .get();
      if (!row || row.revokedAt !== null) return null;
      const now = Date.now();
      if (row.expiresAt !== null && row.expiresAt <= now) return null;
      if (row.lastUsedAt === null || now - row.lastUsedAt >= SEEN_INTERVAL_MS) {
        deps.db
          .update(apiTokens)
          .set({ lastUsedAt: now })
          .where(eq(apiTokens.id, row.id))
          .run();
      }
      return {
        type: 'token',
        id: String(row.id),
        label: row.name,
        scope: ScopeSchema.parse(row.scope),
      };
    },

    me(principal: Principal): MeOutput {
      if (principal.type === 'user') {
        return {
          username: principal.label,
          authType: 'session',
          scope: principal.scope,
        };
      }
      const user = deps.db.select().from(users).get();
      return {
        username: user?.username ?? principal.label,
        authType: 'token',
        scope: principal.scope,
      };
    },

    async createToken(input: {
      name: string;
      scope: Scope;
      expiresInDays?: number;
    }): Promise<TokenCreateOutput> {
      const prefix = randomBytes(6).toString('base64url');
      const secret = randomBytes(24).toString('base64url');
      const token = `omn_${prefix}_${secret}`;
      const now = Date.now();
      const expiresAt =
        input.expiresInDays === undefined
          ? null
          : now + input.expiresInDays * 86_400_000;
      const result = deps.db
        .insert(apiTokens)
        .values({
          name: input.name,
          prefix,
          tokenHash: sha256(token),
          scope: input.scope,
          createdAt: now,
          expiresAt,
        })
        .run();
      return {
        id: Number(result.lastInsertRowid),
        name: input.name,
        prefix,
        token,
        scope: input.scope,
        createdAt: new Date(now).toISOString(),
        expiresAt:
          expiresAt === null ? null : new Date(expiresAt).toISOString(),
      };
    },

    listTokens(): TokenListOutput {
      return deps.db
        .select()
        .from(apiTokens)
        .all()
        .sort((a, b) => b.id - a.id)
        .map((row) => ({
          id: row.id,
          name: row.name,
          prefix: row.prefix,
          scope: ScopeSchema.parse(row.scope),
          createdAt: new Date(row.createdAt).toISOString(),
          lastUsedAt:
            row.lastUsedAt === null
              ? null
              : new Date(row.lastUsedAt).toISOString(),
          expiresAt:
            row.expiresAt === null
              ? null
              : new Date(row.expiresAt).toISOString(),
          revokedAt:
            row.revokedAt === null
              ? null
              : new Date(row.revokedAt).toISOString(),
        }));
    },

    describeToken(id: number): { name: string; scope: Scope } {
      const row = deps.db
        .select()
        .from(apiTokens)
        .where(eq(apiTokens.id, id))
        .get();
      if (!row || row.revokedAt !== null) {
        throw new AppError('NOT_FOUND', 'Token not found', 404);
      }
      return { name: row.name, scope: ScopeSchema.parse(row.scope) };
    },

    revokeToken(id: number): { name: string; scope: Scope } {
      const token = this.describeToken(id);
      deps.db
        .update(apiTokens)
        .set({ revokedAt: Date.now() })
        .where(eq(apiTokens.id, id))
        .run();
      return token;
    },
  };
}

export type AuthService = ReturnType<typeof createAuthService>;
