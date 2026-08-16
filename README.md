# aadirave.github.io

Source for my personal site, live at **<https://aadirave.github.io>**.

Built with [Jekyll](https://jekyllrb.com/) on the
[al-folio](https://github.com/alshedivat/al-folio) v1.x starter. Pushing to
`main` builds the site in GitHub Actions and publishes it to the `gh-pages`
branch.

## Local development

```bash
bundle install
bundle exec jekyll serve     # http://localhost:4000/
```

Note this is a user page served at the domain root, so `baseurl` is blank. Don't
pass the `--baseurl /al-folio` flag that appears in upstream al-folio docs — it
produces a build whose links don't match production.

Optional extras:

- **ImageMagick** (`convert` on PATH) for responsive WebP generation. Without it
  the build still succeeds, but no resized images are produced.
- **Python deps** (`bin/setup-python-deps`) for notebook rendering.

```bash
bundle exec jekyll build     # one-off build into _site/
npm ci && npm run lint:prettier
```

## Layout

| Path                              | Contents                                                                 |
| --------------------------------- | ------------------------------------------------------------------------ |
| `_pages/`                         | the pages themselves (about, blog, projects, publications, repositories) |
| `_posts/`, `_projects/`, `_news/` | content collections                                                      |
| `_data/`                          | social links, the repository list shown on `/repositories/`              |
| `_config.yml`                     | site settings, plugin wiring, feature flags                              |
| `assets/`                         | images and other static files                                            |

Layouts, includes, styles, and feature JavaScript are **not** in this repo —
they ship in the versioned `al_*` gems pinned in the `Gemfile`. See
`docs/BOUNDARIES.md` for what belongs where.

## License

Site content © Aadi Rave. The underlying al-folio starter is MIT licensed — see
[LICENSE](LICENSE).
