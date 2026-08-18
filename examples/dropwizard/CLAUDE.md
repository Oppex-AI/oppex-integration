# Dropwizard Example Guide

This folder demonstrates ownership through Dropwizard's `Managed` lifecycle.

- Construct one `IncidentClient` in the managed wrapper.
- `start()` remains empty unless the SDK gains a real start phase.
- `stop()` must close the client.
- Application code may retrieve the supported façade through `getClient()`.
- Keep Dropwizard dependencies local to this example.
- Do not expose internal SDK collaborators or duplicate SDK retry/HTTP behavior.

The wrapper should stay small and usable from an application's `environment.lifecycle().manage(...)` registration.
