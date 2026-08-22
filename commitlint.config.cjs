/**
 * Conventional Commits, with a scope vocabulary matching the module
 * boundaries and a footer convention for Trello ticket ids (S0-01).
 */
module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'scope-enum': [
      2,
      'always',
      [
        'events',
        'identity',
        'attendance',
        'admin',
        'health',
        'contract',
        'db',
        'ci',
        'docker',
        'deps',
        'config',
        'docs',
      ],
    ],
    'header-max-length': [2, 'always', 100],
    'body-max-line-length': [1, 'always', 120],
  },
};
