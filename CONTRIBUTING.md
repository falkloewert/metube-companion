# Contributing

Thanks for helping. A few things keep this project easy to maintain:

- **Bugs:** open an [issue](../../issues/new) with what you did, what you expected, MeTube version and browser. Failed downloads have a report button that fills most of this in. Remove private links before submitting.
- **Ideas:** open an issue first, so we can agree on the approach before you write code.
- **Pull requests:** keep them small and focused. English only. Run the checks from [AGENTS.md](AGENTS.md#check-before-committing) (syntax, extension build, image build, `tests/smoke.sh`). For UI changes add a before/after screenshot.
- **Shared code:** formats, language detection, progress and the design live in `web/shared.js` and `web/shared.css` and are used by both the web UI and the extension. Change them there.
- **Security:** the companion has no user accounts. Do not add features that make exposing it look safe. Report security problems privately via GitHub's "Report a vulnerability" instead of a public issue.
