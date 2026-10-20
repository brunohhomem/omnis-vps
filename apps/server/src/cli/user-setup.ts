import readline from 'node:readline';
import { Secret, TOTP } from 'otpauth';
import { loadConfig } from '../config';
import { createDeps } from '../deps';

const reset = process.argv.includes('--reset');

async function main(): Promise<void> {
  const config = loadConfig();
  const deps = await createDeps(config);
  try {
    const existing = deps.auth.findUser();
    if (existing && !reset) {
      process.stderr.write(
        'Já existe um usuário. Use --reset para substituir.\n',
      );
      process.exitCode = 1;
      return;
    }
    if (existing && reset) {
      const typed = await ask(
        `Digite ${existing.username} para confirmar o reset: `,
      );
      if (typed !== existing.username) {
        process.stderr.write('Confirmação não confere.\n');
        process.exitCode = 1;
        return;
      }
    }

    const username = await ask('Username: ');
    const password = await askHidden('Senha: ');
    const again = await askHidden('Senha de novo: ');
    if (password !== again) {
      process.stderr.write('As senhas não conferem.\n');
      process.exitCode = 1;
      return;
    }

    const secret = new Secret({ size: 20 });
    const totp = new TOTP({ issuer: 'Omnis', label: username, secret });
    process.stdout.write(`${totp.toString()}\n`);
    process.stdout.write(`Segredo base32: ${secret.base32}\n`);
    const code = (await ask('Código TOTP atual: ')).trim();
    if (TOTP.validate({ token: code, secret, window: 1 }) === null) {
      process.stderr.write('Código TOTP inválido. Nada foi salvo.\n');
      process.exitCode = 1;
      return;
    }

    await deps.auth.setupUser({
      username,
      password,
      totpSecret: secret.base32,
      replace: Boolean(existing && reset),
    });
    process.stdout.write('Usuário salvo.\n');
  } finally {
    deps.db.$client.close();
  }
}

function ask(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function askHidden(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const onData = (chunk: Buffer) => {
    if (
      chunk.toString('utf8').includes('\n') ||
      chunk.toString('utf8').includes('\r')
    ) {
      return;
    }
    readline.cursorTo(process.stdout, question.length);
    readline.clearLine(process.stdout, 1);
  };
  process.stdin.on('data', onData);
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      process.stdin.removeListener('data', onData);
      rl.close();
      resolve(answer);
    });
  });
}

main()
  .then(() => {
    process.exit(process.exitCode ?? 0);
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exit(1);
  });
