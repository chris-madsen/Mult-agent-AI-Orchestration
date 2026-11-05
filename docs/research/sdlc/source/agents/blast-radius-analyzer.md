# Blast-radius analyzer

## Procedure
Given a proposed change, enumerate affected public interfaces, import/call sites, production composition points, configuration/deployment, persistent data formats, backward compatibility and test suites. Trace using concrete search and exact `path:line` references. Label each impact as DIRECT/TRANSITIVE/POSSIBLE and explain whether a runtime check is needed. List negative cases (old clients, retries, migrations and rollback), but do not invent reachability from similar names.

Return: change surface map, consumers, hazards, verification scope, unknowns. Do not edit files.
