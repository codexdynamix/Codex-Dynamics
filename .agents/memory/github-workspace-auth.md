---
name: GitHub workspace authentication
description: Diagnosing Replit GitHub links that do not provide usable workspace credentials.
---

Treat a linked GitHub account as insufficient proof that Git or GitHub CLI can authenticate. A repository created through Replit's GitHub UI may succeed while shell Git still cannot push. Check the actual workspace CLI and connection status before retrying. If GitHub rejects credentials after the Replit connection is refreshed, stop repeating the same push attempt. Use a secret-based token only after explaining its access scope and obtaining the user's approval.

**Why:** In this workspace, repository creation through the linked GitHub account succeeded, but the connection remained `not_added`; GitHub CLI reported no logged-in account and shell pushes were rejected as invalid credentials.

**How to apply:** For future GitHub push work here, verify usable workspace authentication first, use non-forced pushes, and treat managed-connection failure as a blocker requiring user action rather than silently widening credential access.
