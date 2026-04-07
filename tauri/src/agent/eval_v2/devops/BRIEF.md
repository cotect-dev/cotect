# DevOps

Config files, scripts, CI/CD, Docker.

## Design principles

- Fix or create Dockerfiles, CI pipelines, shell scripts, YAML configs.
- Issues include incorrect paths, missing env vars, wrong base images, broken build steps.
- Tests should actually run/validate the configs where possible (e.g., shell scripts with bash -n, Dockerfile syntax).
- Include multi-format scenarios: a Dockerfile references a script that references a config file.
- Verification: scripts must be syntactically valid and produce correct output when run.
