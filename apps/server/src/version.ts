import { readFileSync } from 'node:fs';
import path from 'node:path';

type PackageManifest = {
  version?: unknown;
};

function readPackageVersion(): string {
  const manifestPath = path.join(process.cwd(), 'package.json');
  let manifest: PackageManifest;
  try {
    manifest = JSON.parse(
      readFileSync(manifestPath, 'utf8'),
    ) as PackageManifest;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not read version from ${manifestPath}: ${message}`, {
      cause: error,
    });
  }

  if (typeof manifest.version !== 'string' || manifest.version.length === 0) {
    throw new Error(`Missing "version" in ${manifestPath}`);
  }

  return manifest.version;
}

export const version = readPackageVersion();
