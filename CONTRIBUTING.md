# Contributing to Telesera

Everyone is welcome to contribute code, translations, documentation and reproducible bug reports. Fork the repository, create a focused branch and open a pull request against `main`. You do not need an invitation or collaborator access to propose a change. Maintainers review and merge pull requests; public visibility does not grant direct write access.

## Before changing code

- Describe the problem and expected behavior. For larger changes, open an issue to agree on scope first.
- Keep the client self-contained on the TV. A required companion server is an architectural change.
- Preserve Magic Remote directional navigation, pointer input, visible focus and readable TV-sized controls.
- Keep credentials, Telegram sessions, private chat contents and account-specific installation packages out of Git, issues and logs. See [SECURITY.md](SECURITY.md) for private vulnerability reporting.

## Local checks

```sh
cargo fmt --manifest-path engine/Cargo.toml --check
cargo clippy --manifest-path engine/Cargo.toml --locked -- -D warnings
node --check ui/app.js
node --check ui/i18n.js
node --check webos/launch.js
python3 -m py_compile scripts/install.py scripts/third-party.py
```

Explain which operator flows you exercised, including errors, keyboard focus and navigation back. A passing build does not prove playback on webOS. Label browser-only results separately from tests on an actual TV, and include the TV model and webOS version when relevant. Use a test account or fictional fixtures for message-sending checks.

## Translations

The dictionaries live in `ui/i18n.js`. English is the fallback; the app selects a supported language from the TV's UI locale, with the browser locale as a fallback outside webOS. Keep translation keys and `{placeholder}` names aligned with English, including accessible labels and error messages. Check long labels, the sticker picker, login and date/time formatting. Conversation contents and third-party Mini Apps are not translated by Telesera.

Use `?lang=en` for English screenshots. Public screenshots must show fictional conversations and non-personal artwork, with English message text as well as English application controls. Do not disguise or translate real conversations for publication.

## Pull requests and licensing

Describe the user-visible result, validation and remaining limitations. Keep unrelated changes separate. Contributions are made under the repository's MIT license. Preserve applicable copyright and third-party license notices; do not copy code or assets whose license is incompatible or unknown.
