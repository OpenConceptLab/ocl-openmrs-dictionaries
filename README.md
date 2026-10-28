# OCL–OpenMRS collection dictionaries

A working space for making collection-based dictionary management in OCL usable for OpenMRS implementers. The idea is to manage a dictionary as an OCL collection that references concepts from several sources, such as an implementation's own source plus CIEL, instead of cloning them into one source.

- **[Wiki](https://github.com/OpenConceptLab/ocl-openmrs-dictionaries/wiki)**: the scenarios, the rules for equivalency-aware expansion, the requirements and the open questions. Start here.
- **[Equivalency rules prototype](https://openconceptlab.github.io/ocl-openmrs-dictionaries/)**: pick each rule's options and see how each scenario expands. With your own OCL API token, you can also try any CIEL or PIH concept.
- **Tracking ticket:** [OpenConceptLab/ocl_issues#2972](https://github.com/OpenConceptLab/ocl_issues/issues/2972)

This repository is a working space and prototype. It isn't part of the [OCL Digital Public Good](https://github.com/OpenConceptLab/.github/blob/main/DIGITAL-PUBLIC-GOOD.md). The behavior agreed here is meant to be built into OCL's own expansion code, in [oclapi2](https://github.com/OpenConceptLab/oclapi2).

## The prototype

It's plain HTML and JavaScript, with no build step and no dependencies.

| Path | What it is |
| --- | --- |
| `index.html`, `app/main.js`, `app/styles.css` | The page |
| `app/engine.js` | The rules: expands one reference under a set of rule options. Pure functions, no I/O |
| `app/scenarios.js` | The five scenarios, and the results the wiki gives for them |
| `app/data.js` | Reads concepts and mappings from the OCL API, for live mode and the snapshot script |
| `data/snapshot.json` | A stored copy of every concept and mapping the scenarios can reach |
| `assets/tokens.css` | Colors from the [OCL Design System](https://openconceptlab.github.io/ocl-design-system/) |

- **Run it locally:** `python3 -m http.server 8000`, then open <http://localhost:8000>.
- **Run the tests** (Node 20 or later): `npm test`. They check that each scenario gives the result the wiki lists.
- **Refresh the stored data:** `OCL_API_TOKEN=<your token> npm run snapshot`. Your token is on your OCL account page. Then run the tests: a failure means OCL's content changed what a scenario expands to.

Changes to the rules start on the wiki's [Rules](https://github.com/OpenConceptLab/ocl-openmrs-dictionaries/wiki/Rules) page. A new rule option goes into `RULES` in `app/engine.js`, with a test.

## License

[MPL-2.0](LICENSE)
