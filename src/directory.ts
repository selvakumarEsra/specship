/**
 * Directory Management
 *
 * Manages the .specship/ directory structure for SpecShip data.
 */

import * as fs from 'fs';
import * as path from 'path';

/**
 * SpecShip directory name
 */
export const SPECSHIP_DIR = '.specship';

/**
 * Get the .specship directory path for a project
 */
export function getSpecShipDir(projectRoot: string): string {
  return path.join(projectRoot, SPECSHIP_DIR);
}

/**
 * Check if a project has been initialized with SpecShip
 * Requires both .specship/ directory AND specship.db to exist
 */
export function isInitialized(projectRoot: string): boolean {
  const specshipDir = getSpecShipDir(projectRoot);
  if (!fs.existsSync(specshipDir) || !fs.statSync(specshipDir).isDirectory()) {
    return false;
  }
  // Must have specship.db, not just .specship folder
  const dbPath = path.join(specshipDir, 'specship.db');
  return fs.existsSync(dbPath);
}

/**
 * Find the nearest parent directory containing .specship/
 *
 * Walks up from the given path to find a SpecShip-initialized project,
 * similar to how git finds .git/ directories.
 *
 * @param startPath - Directory to start searching from
 * @returns The project root containing .specship/, or null if not found
 */
export function findNearestSpecShipRoot(startPath: string): string | null {
  let current = path.resolve(startPath);
  const root = path.parse(current).root;

  while (current !== root) {
    if (isInitialized(current)) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) break; // Reached filesystem root
    current = parent;
  }

  // Check root as well
  if (isInitialized(current)) {
    return current;
  }

  return null;
}

/**
 * Create the .specship directory structure
 * Note: Only throws if specship.db already exists, not just if .specship/ exists.
 */
export function createDirectory(projectRoot: string): void {
  const specshipDir = getSpecShipDir(projectRoot);
  const dbPath = path.join(specshipDir, 'specship.db');

  // Only throw if SpecShip is actually initialized (db exists)
  // .specship/ folder alone is fine
  if (fs.existsSync(dbPath)) {
    throw new Error(`SpecShip already initialized in ${projectRoot}`);
  }

  // Create main directory (if it doesn't exist)
  fs.mkdirSync(specshipDir, { recursive: true });

  // Create .gitignore inside .specship (if it doesn't exist)
  const gitignorePath = path.join(specshipDir, '.gitignore');
  if (!fs.existsSync(gitignorePath)) {
    const gitignoreContent = `# SpecShip data files — local to each machine, not for committing.
# Ignore everything in .specship/ except this file itself, so transient
# files (the database, daemon.pid, sockets, logs) never show up in git.
*
!.gitignore
`;

    fs.writeFileSync(gitignorePath, gitignoreContent, 'utf-8');
  }
}

/**
 * Remove the .specship directory
 */
export function removeDirectory(projectRoot: string): void {
  const specshipDir = getSpecShipDir(projectRoot);

  if (!fs.existsSync(specshipDir)) {
    return;
  }

  // Verify .specship is a real directory, not a symlink pointing elsewhere
  const lstat = fs.lstatSync(specshipDir);
  if (lstat.isSymbolicLink()) {
    // Only remove the symlink itself, never follow it for recursive delete
    fs.unlinkSync(specshipDir);
    return;
  }

  if (!lstat.isDirectory()) {
    // Not a directory - remove the single file
    fs.unlinkSync(specshipDir);
    return;
  }

  // Recursively remove directory
  fs.rmSync(specshipDir, { recursive: true, force: true });
}

/**
 * Get all files in the .specship directory
 */
export function listDirectoryContents(projectRoot: string): string[] {
  const specshipDir = getSpecShipDir(projectRoot);

  if (!fs.existsSync(specshipDir)) {
    return [];
  }

  const files: string[] = [];

  function walkDir(dir: string, prefix: string = ''): void {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;

      // Skip symlinks to prevent following links outside .specship
      if (entry.isSymbolicLink()) {
        continue;
      }

      if (entry.isDirectory()) {
        walkDir(path.join(dir, entry.name), relativePath);
      } else {
        files.push(relativePath);
      }
    }
  }

  walkDir(specshipDir);
  return files;
}

/**
 * Get the total size of the .specship directory in bytes
 */
export function getDirectorySize(projectRoot: string): number {
  const specshipDir = getSpecShipDir(projectRoot);

  if (!fs.existsSync(specshipDir)) {
    return 0;
  }

  let totalSize = 0;

  function walkDir(dir: string): void {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      // Skip symlinks to prevent following links outside .specship
      if (entry.isSymbolicLink()) {
        continue;
      }

      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        walkDir(fullPath);
      } else {
        const stats = fs.statSync(fullPath);
        totalSize += stats.size;
      }
    }
  }

  walkDir(specshipDir);
  return totalSize;
}

/**
 * Ensure a subdirectory exists within .specship
 */
export function ensureSubdirectory(projectRoot: string, subdirName: string): string {
  if (subdirName.includes('..') || subdirName.includes(path.sep) || subdirName.includes('/')) {
    throw new Error(`Invalid subdirectory name: ${subdirName}`);
  }

  const subdirPath = path.join(getSpecShipDir(projectRoot), subdirName);

  if (!fs.existsSync(subdirPath)) {
    fs.mkdirSync(subdirPath, { recursive: true });
  }

  return subdirPath;
}

/**
 * Check if the .specship directory has valid structure
 */
export function validateDirectory(projectRoot: string): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  const specshipDir = getSpecShipDir(projectRoot);

  if (!fs.existsSync(specshipDir)) {
    errors.push('SpecShip directory does not exist');
    return { valid: false, errors };
  }

  if (!fs.statSync(specshipDir).isDirectory()) {
    errors.push('.specship exists but is not a directory');
    return { valid: false, errors };
  }

  // Auto-repair missing .gitignore (non-critical file)
  const gitignorePath = path.join(specshipDir, '.gitignore');
  if (!fs.existsSync(gitignorePath)) {
    try {
      const gitignoreContent = `# SpecShip data files — local to each machine, not for committing.\n# Ignore everything in .specship/ except this file itself, so transient\n# files (the database, daemon.pid, sockets, logs) never show up in git.\n*\n!.gitignore\n`;
      fs.writeFileSync(gitignorePath, gitignoreContent, 'utf-8');
    } catch {
      // Non-fatal: warn but don't block
      errors.push('.gitignore missing in .specship directory and could not be created');
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
