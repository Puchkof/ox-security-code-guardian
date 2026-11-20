import { InvalidRepoUrlError } from './errors';

/**
 * GitHub owner: alphanumerics and single hyphens, max 39 chars, no leading hyphen.
 * Repository: letters, digits, '.', '_', '-'. An optional ".git" suffix and trailing slash are accepted.
 * Only https is allowed: no ssh/file/git protocols, no credentials, query strings or fragments.
 * Strict validation also protects the `git clone` invocation from argument injection.
 */
const GITHUB_REPO_PATTERN =
  /^https:\/\/github\.com\/([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9._-]{1,100}?)(?:\.git)?\/?$/;

export class RepoUrl {
  private constructor(
    readonly owner: string,
    readonly name: string,
  ) {}

  static create(raw: string): RepoUrl {
    const match = GITHUB_REPO_PATTERN.exec(raw.trim());
    const owner = match?.[1];
    const name = match?.[2];
    if (owner === undefined || name === undefined || name === '.' || name === '..') {
      throw new InvalidRepoUrlError(raw);
    }
    return new RepoUrl(owner, name);
  }

  /** Canonical clone URL, e.g. https://github.com/OWASP/NodeGoat.git */
  get cloneUrl(): string {
    return `https://github.com/${this.owner}/${this.name}.git`;
  }

  get value(): string {
    return `https://github.com/${this.owner}/${this.name}`;
  }

  toString(): string {
    return this.value;
  }
}
