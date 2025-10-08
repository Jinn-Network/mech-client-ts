# Contributing to mech-client-ts

Thank you for your interest in contributing to mech-client-ts! This document outlines the development workflow and guidelines.

## Development Workflow

This package is actively developed within the [jinn-gemini](https://github.com/oaksprout/jinn-gemini) monorepo and periodically synced to this standalone repository for npm publication.

### For Jinn Team Members

1. **Make changes** in `jinn-gemini/packages/mech-client-ts/`
2. **Test thoroughly** in the Jinn context with the full test suite
3. **When ready to publish:**
   ```bash
   cd jinn-gemini
   ./scripts/sync-mech-client.sh
   cd ../mech-client-ts

   # Review synced changes
   git status
   git diff

   # Update version in package.json (e.g., 0.0.1 → 0.0.2)
   # Update CHANGELOG.md with changes

   git add .
   git commit -m "feat: your feature description"
   git push

   # Create release on GitHub (triggers automated npm publish)
   gh release create v0.0.2 --generate-notes
   ```

### For External Contributors

We welcome external contributions! Here's how to contribute:

1. **Fork this repository** on GitHub
2. **Clone your fork** locally
3. **Create a feature branch**: `git checkout -b feature/your-feature-name`
4. **Make your changes** with clear, focused commits
5. **Test your changes**: `yarn build && yarn test`
6. **Push to your fork**: `git push origin feature/your-feature-name`
7. **Submit a pull request** to this repository

**Note:** If your PR is accepted, the Jinn team will:
- Merge it to this standalone repo
- Backport the changes to the jinn-gemini monorepo
- Test in the Jinn context
- Include in the next npm release

## Development Setup

```bash
# Clone the repository
git clone https://github.com/Jinn-Network/mech-client-ts.git
cd mech-client-ts

# Install dependencies
yarn install

# Build
yarn build

# Run tests
yarn test
```

## Code Style

- **TypeScript**: All code should be written in TypeScript
- **Formatting**: Code is automatically formatted (follow existing style)
- **Types**: Prefer strong typing, avoid `any` when possible
- **Documentation**: Add JSDoc comments for public APIs
- **Async/Await**: Use async/await over promises for consistency

## Testing

- Write tests for new features and bug fixes
- Ensure all tests pass before submitting a PR: `yarn test`
- Test the build: `yarn build`
- Verify package contents: `npm pack --dry-run`

## Commit Messages

Follow conventional commit format:

- `feat:` - New features
- `fix:` - Bug fixes
- `docs:` - Documentation changes
- `refactor:` - Code refactoring
- `test:` - Test additions or changes
- `chore:` - Maintenance tasks

Examples:
- `feat: add support for custom RPC timeouts`
- `fix: handle edge case in delivery monitoring`
- `docs: update README with new CLI options`

## Release Process (Jinn Team Only)

1. **Sync from monorepo**: Run `./scripts/sync-mech-client.sh` in jinn-gemini
2. **Update version**: Bump version in package.json following [semver](https://semver.org/)
3. **Update CHANGELOG**: Document changes in CHANGELOG.md
4. **Commit and push**: `git add . && git commit -m "chore: release v0.0.X" && git push`
5. **Create GitHub release**: `gh release create v0.0.X --generate-notes`
6. **Verify npm publish**: Check https://www.npmjs.com/package/@jinn-network/mech-client-ts

The GitHub release automatically triggers the npm publish workflow.

## Python Parity

This client aims for full feature parity with [mech-client-python](https://github.com/valory-xyz/mech-client). When adding features:

- Check if equivalent exists in Python client
- Match behavior and API where possible
- Document any intentional differences

## Questions or Issues?

- **Bug reports**: [GitHub Issues](https://github.com/Jinn-Network/mech-client-ts/issues)
- **Feature requests**: [GitHub Issues](https://github.com/Jinn-Network/mech-client-ts/issues)
- **Security issues**: Please report privately to the Jinn Network team

## License

By contributing, you agree that your contributions will be licensed under the Apache-2.0 License.

---

Thank you for contributing to mech-client-ts! 🚀
