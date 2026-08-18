# dsh-remote-desktop manual UI checklist

Run this checklist when layout, iframe container styling, sidebar shell behavior, or Better Sidebar visual integration changes. It is not required for every P0 acceptance run.

- [ ] The local unified sidebar remains the only expanded left sidebar in the top-level page.
- [ ] Remote active state is visually obvious.
- [ ] Local active state is visually obvious after switching back.
- [ ] No remote overlay remains on top of the local main area after switching to Local.
- [ ] The remote iframe does not show a second expanded left sidebar.
- [ ] Remote Better Sidebar is visible, not clipped, and visually belongs to the remote iframe.
- [ ] Local Better Sidebar and remote Better Sidebar cannot be mistaken for the same instance.
- [ ] Settings copy explains that remote dsh must already be running and the companion must be installed remotely.
- [ ] Failure messages are understandable without reading terminal logs.
