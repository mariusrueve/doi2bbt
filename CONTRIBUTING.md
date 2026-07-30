# Contributing to doi2bbt

Thanks for helping improve doi2bbt. The project intentionally stays focused:
one identifier in, deterministic BibTeX out, with no accounts or collections.

## Development

Use Node.js 22.13 or newer:

```sh
npm ci
npm run dev
```

Before opening a pull request, run:

```sh
npm run lint
npm run typecheck
npm test
npm run test:contract
npm run deploy:check
```

Add fixtures and tests for changes to identifier parsing, upstream responses,
the citation-key algorithm, or the public API. API v1 and the frozen key
algorithm are compatibility contracts; breaking changes require a new version.

## Pull requests

Keep pull requests small and explain the user-visible behavior. Do not commit
credentials, local environment files, generated build output, or production
metadata. Changes that add storage, tracking, paid services, or new identifier
types should be discussed in an issue first.

By contributing, you agree that your contribution is licensed under the MIT
License.
