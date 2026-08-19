# dsh-remote-desktop manual UI checklist

Run this checklist when layout, iframe container styling, sidebar shell behavior, settings Host switcher behavior, or Better Sidebar visual integration changes. It is not required for every P0 acceptance run.

- [ ] The local unified sidebar remains the only expanded left sidebar in the top-level page.
- [ ] Local and remote workspaces appear as project rows, not grouped by source machine.
- [ ] Remote project rows show a readable host badge and status dot.
- [ ] Remote active state is visually obvious after opening a remote session.
- [ ] Local active state is visually obvious after switching back.
- [ ] No remote overlay remains on top of the local main area after switching to Local.
- [ ] The remote iframe does not show a second expanded left sidebar.
- [ ] Remote Better Sidebar is visible, not clipped, and visually belongs to the remote iframe.
- [ ] Local Better Sidebar and remote Better Sidebar cannot be mistaken for the same instance.
- [ ] Settings keeps the official modal, rail, spacing, token, and control style.
- [ ] The Settings Host switcher is at the top of the left rail and clearly shows Local or the selected remote host.
- [ ] Remote Desktop settings lists SSH config hosts and connected/not connected status.
- [ ] Selecting a connected remote host shows an Open native DSH action rather than embedding remote Settings.
- [ ] The Open native DSH action launches a forwarded remote page without `dshRemoteDesktop=1` or token hash.
- [ ] Failure messages are understandable without reading terminal logs.
