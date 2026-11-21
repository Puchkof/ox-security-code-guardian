import { InvalidRepoUrlError } from './errors';
import { RepoUrl } from './repo-url';

describe('RepoUrl', () => {
  it.each([
    ['https://github.com/OWASP/NodeGoat', 'OWASP', 'NodeGoat'],
    ['https://github.com/OWASP/NodeGoat.git', 'OWASP', 'NodeGoat'],
    ['https://github.com/OWASP/NodeGoat/', 'OWASP', 'NodeGoat'],
    ['  https://github.com/some-user/repo.name_x  ', 'some-user', 'repo.name_x'],
  ])('accepts %s', (input, owner, name) => {
    const url = RepoUrl.create(input);
    expect(url.owner).toBe(owner);
    expect(url.name).toBe(name);
    expect(url.cloneUrl).toBe(`https://github.com/${owner}/${name}.git`);
  });

  it.each([
    '',
    'not a url',
    'http://github.com/OWASP/NodeGoat',
    'git@github.com:OWASP/NodeGoat.git',
    'file:///etc/passwd',
    'https://gitlab.com/OWASP/NodeGoat',
    'https://user:token@github.com/OWASP/NodeGoat',
    'https://github.com/OWASP',
    'https://github.com/OWASP/NodeGoat/tree/master',
    'https://github.com/OWASP/NodeGoat?x=1',
    'https://github.com/-bad/NodeGoat',
    'https://github.com/OWASP/..',
    'https://github.com/OWASP/--upload-pack=evil',
  ])('rejects %s', (input) => {
    expect(() => RepoUrl.create(input)).toThrow(InvalidRepoUrlError);
  });
});
