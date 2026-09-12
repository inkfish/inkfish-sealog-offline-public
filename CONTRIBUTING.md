# Contributing

Bug reports and focused pull requests are welcome. For suspected security issues,
follow [Reporting a vulnerability](docs/SECURITY.md#reporting-a-vulnerability)
instead of including sensitive details in a public issue or pull request.

## Report a bug

Include:

- The **app** and **sw** versions shown in Settings.
- Your browser, operating system, device, and whether the problem occurs online or offline.
- Minimal steps to reproduce, what you expected, and what happened instead.
- Relevant error messages or screenshots, with a small synthetic event/template example when useful.

Remove passwords, tokens, private keys, personal information, and private deployment
details from screenshots, logs, and example files before posting them.

For a feature suggestion, open an issue describing the workflow, the problem it
creates today, and the behavior you would find useful.

## Submit a pull request

1. Fork the repository and work on a branch for one focused change. Explain the problem being solved and link a related issue if one exists.
2. For code changes, use the Node/npm versions in [Testing](docs/TESTING.md), install with `npm ci`, and run `npm run lint` plus the suites relevant to the changed behavior. Add regression coverage when fixing behavior that existing tests do not exercise.
3. For documentation-only changes, check links, examples, and commands; runtime tests are unnecessary unless the change affects application behavior.
4. Update affected documentation and preserve [license notices](THIRD_PARTY_NOTICES.md), including notices for adapted assets. Leave version bumps to release preparation.
5. Describe what changed, why, and how you checked it in the pull request. Include sanitized screenshots for visible UI changes and note any checks you could not run.
